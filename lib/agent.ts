import type Anthropic from "@anthropic-ai/sdk";
import { type AgentTool, TOOLS, ToolError, ukTime } from "./agent-tools";

type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const MODEL = "claude-sonnet-5-5";

/** Everything that bounds what one question can cost. */
export const LIMITS = {
  /** Model calls per question. On the last one the tools are switched off. */
  maxSteps: 5,
  /** Tool calls run from a single model response; the rest are refused. */
  maxToolCallsPerStep: 4,
  /** How long one tool may take. */
  toolTimeoutMs: 10_000,
  /** Output cap for one model call, thinking included. */
  maxOutputTokens: 8000,
  /** Input plus output tokens across all the steps of one question. */
  maxRunTokens: 60_000,
  /** Conversation turns sent to the model; older ones are dropped. */
  maxTurns: 20,
  /** Length of one user message. */
  maxUserChars: 2000,
  /** Length of one earlier reply, which the browser sends back. */
  maxAssistantChars: 8000,
};
export type Limits = typeof LIMITS;

/** One turn of the conversation as the browser holds it: text only. */
export type ChatTurn = { role: "user" | "assistant"; content: string };

/** The one model call the loop needs, so tests can script the model. */
export type CreateMessage = (
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => Promise<Message>;

export type ToolCall = {
  name: string;
  input: unknown;
  /** What the tool returned, or the error message sent to the model. */
  output: unknown;
  isError: boolean;
};

export type AgentStatus =
  /** The model answered. */
  | "done"
  /** The model answered on the last step, where it had no tools left. */
  | "step_limit"
  /** Stopped before another round of tools: the token budget was spent. */
  | "token_limit"
  /** The reply hit the output cap and is cut short. */
  | "truncated"
  /** The model declined the request. */
  | "refused";

export type AgentResult = {
  status: AgentStatus;
  text: string;
  toolCalls: ToolCall[];
  steps: number;
  tokens: number;
};

/** The conversation from the browser isn't usable. Safe to show to the user. */
export class InvalidConversation extends Error {}

const STOPPED_TEXT: Partial<Record<AgentStatus, string>> = {
  token_limit:
    "That took more work than I can do for one question. Try asking about one thing at a time.",
  refused: "I can't help with that here.",
  truncated: "My answer got too long to finish. Try a narrower question.",
  step_limit: "I couldn't finish working that out. Try a simpler question.",
};

function systemPrompt(now: Date) {
  return `You are the assistant inside Carbon Helper, a web app that helps people in Great Britain run their appliances when the electricity grid is cleanest. People ask you things like when to run the washing machine, how clean the grid is right now, or why the forecast changes through the day.

Every figure you give (intensities, times, savings, the generation mix) has to come from a tool result in this conversation. The forecast changes every half hour, so anything you remember or estimate is wrong. If a tool fails, say the data isn't available rather than guessing. General explanations of how the grid works don't need a tool.

Figures are for Great Britain as a whole unless the user gives a postcode; the first half, such as SW1A, is enough. Only ask for one if they want local figures. The forecast covers the next 48 hours and nothing beyond. Tools give times in UK local time.

Your replies appear in a small chat panel that shows plain text, so answer in a few short sentences without Markdown. When find_greenest_window returns a calendar link, the app shows an "Add to calendar" button under your reply, so mention the button instead of writing the link out.

Stay on electricity, carbon and timing appliances. For anything else, say briefly that it's outside what you can help with here.

Current UK time: ${ukTime(now)}`;
}

/**
 * Checks the browser's conversation and turns it into API messages. Only text
 * turns are accepted, so a client can't plant tool results in the history.
 */
export function toMessages(turns: unknown, limits: Limits): MessageParam[] {
  if (!Array.isArray(turns)) throw new InvalidConversation("Send a list of messages.");
  for (const turn of turns) {
    const { role, content } = (turn ?? {}) as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") {
      throw new InvalidConversation("Each message needs a role of user or assistant.");
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw new InvalidConversation("Each message needs some text.");
    }
    const max = role === "user" ? limits.maxUserChars : limits.maxAssistantChars;
    if (content.length > max) {
      throw new InvalidConversation(`Keep messages under ${max} characters.`);
    }
  }
  const recent: ChatTurn[] = turns.slice(-limits.maxTurns);
  // The API needs the conversation to open with the user.
  while (recent[0]?.role === "assistant") recent.shift();
  if (recent.at(-1)?.role !== "user") {
    throw new InvalidConversation("The last message has to be from the user.");
  }
  return recent.map(({ role, content }) => ({ role, content }));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ToolError("The tool timed out. The data isn't available right now.")),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs one tool call. Never throws: a failure becomes an error result the model can read. */
async function callTool(
  tools: AgentTool[],
  request: ToolUse,
  limits: Limits,
): Promise<ToolCall> {
  const call = { name: request.name, input: request.input };
  try {
    const tool = tools.find((t) => t.definition.name === request.name);
    if (!tool) throw new ToolError(`There is no tool called ${request.name}.`);
    const output = await withTimeout(
      tool.run(request.input as Record<string, unknown>),
      limits.toolTimeoutMs,
    );
    return { ...call, output, isError: false };
  } catch (error) {
    if (error instanceof ToolError) {
      return { ...call, output: error.message, isError: true };
    }
    // Unexpected failures are logged, not shown: the model gets a plain message.
    console.error(error);
    return {
      ...call,
      output: "The tool failed. The data isn't available right now.",
      isError: true,
    };
  }
}

const textOf = (message: Message) =>
  message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();

/**
 * Answers the last user turn: calls the model, runs the tools it asks for,
 * sends the results back, and repeats until the model answers or a limit stops it.
 * Errors from the model call itself (network, rate limit, abort) are thrown.
 */
export async function runAgent({
  createMessage,
  turns,
  tools = TOOLS,
  limits = LIMITS,
  signal,
  now = new Date(),
}: {
  createMessage: CreateMessage;
  turns: unknown;
  tools?: AgentTool[];
  limits?: Limits;
  signal?: AbortSignal;
  now?: Date;
}): Promise<AgentResult> {
  const messages = toMessages(turns, limits);
  const toolCalls: ToolCall[] = [];
  let tokens = 0;

  for (let step = 1; ; step++) {
    const lastStep = step >= limits.maxSteps;
    const response = await createMessage(
      {
        model: MODEL,
        max_tokens: limits.maxOutputTokens,
        output_config: { effort: "low" },
        // If a safety classifier declines the request, retry it on another model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: systemPrompt(now),
        tools: tools.map((tool) => tool.definition),
        // With no tools left the model has to answer from what it already has.
        tool_choice: { type: lastStep ? "none" : "auto" },
        messages,
      },
      { signal },
    );

    const { usage } = response;
    tokens +=
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    const finish = (status: AgentStatus, text = textOf(response)): AgentResult => ({
      status,
      text: text || (STOPPED_TEXT[status] ?? ""),
      toolCalls,
      steps: step,
      tokens,
    });

    // A refusal can arrive with partial output; none of it is shown.
    if (response.stop_reason === "refusal") return finish("refused", "");
    // A response cut off mid-way may hold a half-written tool call: don't run it.
    if (response.stop_reason === "max_tokens") return finish("truncated");

    const requests = response.content.filter(
      (block): block is ToolUse => block.type === "tool_use",
    );
    if (requests.length === 0 || lastStep) {
      return finish(lastStep ? "step_limit" : "done");
    }
    if (tokens >= limits.maxRunTokens) return finish("token_limit", "");

    // The whole assistant turn goes back, thinking blocks included, followed
    // by one user turn holding a result for every tool call in it.
    messages.push({ role: "assistant", content: response.content });
    const calls = await Promise.all(
      requests.map((request, i) =>
        i < limits.maxToolCallsPerStep
          ? callTool(tools, request, limits)
          : {
              name: request.name,
              input: request.input,
              output: `Not run: only ${limits.maxToolCallsPerStep} tool calls are allowed at once.`,
              isError: true,
            },
      ),
    );
    toolCalls.push(...calls);
    messages.push({
      role: "user",
      content: calls.map(
        (call, i): ToolResult => ({
          type: "tool_result",
          tool_use_id: requests[i].id,
          content: call.isError ? String(call.output) : JSON.stringify(call.output),
          is_error: call.isError,
        }),
      ),
    });
  }
}
