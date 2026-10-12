import Anthropic from "@anthropic-ai/sdk";
import { InvalidConversation, runAgent } from "@/lib/agent";

// How long the host lets this function run, in seconds.
export const maxDuration = 60;
// Give up on a question before the host does, so the visitor gets a proper error.
const RUN_TIMEOUT_MS = 45_000;
// Far above any conversation the limits allow.
const MAX_BODY_CHARS = 200_000;

const error = (message: string, status: number) =>
  Response.json({ error: message }, { status });

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
