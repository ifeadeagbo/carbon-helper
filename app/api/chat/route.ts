import Anthropic from "@anthropic-ai/sdk";
import { InvalidConversation, LIMITS, runAgent, toMessages } from "@/lib/agent";
import {
  VISITOR_DAILY_LIMIT,
  chatLimiters,
  checkChatLimits,
  visitorId,
} from "@/lib/rate-limit";

// How long the host lets this function run, in seconds.
export const maxDuration = 60;
// Give up on a question before the host does, so the visitor gets a proper error.
const RUN_TIMEOUT_MS = 45_000;
// Far above any conversation the limits allow.
const MAX_BODY_CHARS = 200_000;

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

const limitError = {
  visitor: () =>
    error(
      `You've asked ${VISITOR_DAILY_LIMIT} questions today, which is the daily limit. Try again tomorrow.`,
      429,
    ),
  site: () =>
    error("HailplusAI has answered all it can for today. Try again tomorrow.", 429),
  unavailable: () => error("HailplusAI isn't available right now.", 503),
};

/** Answers the last message of the conversation in the request body. */
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return error("That conversation is too long.", 413);
  let body: { messages?: unknown } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    return error("Send JSON.", 400);
  }

  try {
    // Check the conversation first, so a malformed request isn't counted.
    toMessages(body?.messages, LIMITS);
  } catch (cause) {
    if (cause instanceof InvalidConversation) return error(cause.message, 400);
    throw cause;
  }

  const limiters = chatLimiters();
  if (limiters) {
    const check = await checkChatLimits(visitorId(request.headers), limiters);
    if (!check.allowed) return limitError[check.reason]();
  } else if (process.env.NODE_ENV === "production") {
    // Never answer in production with nothing counting the questions.
    console.error("Chat refused: the rate limit store isn't configured.");
    return limitError.unavailable();
  }

  try {
    // Reads ANTHROPIC_API_KEY from the environment.
    const client = new Anthropic({ maxRetries: 1 });
    const result = await runAgent({
      createMessage: (params, options) =>
        client.beta.messages.create(params, options),
      turns: body?.messages,
      // Stop paying for a run nobody is waiting for.
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(RUN_TIMEOUT_MS),
      ]),
    });
    const calendarLink = result.toolCalls.findLast(
      (call) => call.name === "find_greenest_window" && !call.isError,
    )?.output as { calendar_link: string | null } | undefined;
    return Response.json({
      status: result.status,
      text: result.text,
      calendarLink: calendarLink?.calendar_link ?? null,
    });
  } catch (cause) {
    if (cause instanceof InvalidConversation) return error(cause.message, 400);
    console.error(cause);
    if (cause instanceof Anthropic.RateLimitError) {
      return error("HailplusAI is busy. Try again in a minute.", 429);
    }
    return error("HailplusAI isn't available right now.", 503);
  }
}
