"use client";

import { useState } from "react";
import type { ChatTurn } from "@/lib/agent";

type Turn = ChatTurn & { calendarLink?: string | null };

const SUGGESTIONS = [
  "When should I run the washing machine?",
  "How clean is the grid right now?",
  "When is the best time to charge my car in SW1A?",
];
// Matches the server's limit on one message.
const MAX_CHARS = 2000;

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    const content = question.trim();
    if (!content || pending) return;
    const asked: Turn[] = [...turns, { role: "user", content }];
    setTurns(asked);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only the text goes back: the server works everything else out again.
        body: JSON.stringify({
          messages: asked.map(({ role, content }) => ({ role, content })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setTurns([
        ...asked,
        { role: "assistant", content: body.text, calendarLink: body.calendarLink },
      ]);
    } catch (cause) {
      // Take the question back off so it can be asked again.
      setTurns(turns);
      setDraft(content);
      setError(
        (cause instanceof Error && cause.message) ||
          "HailplusAI isn't available right now.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => send(suggestion)}
                className="cursor-pointer rounded-full border border-grid px-3 py-1.5 text-sm text-muted"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={
              turn.role === "user"
                ? "max-w-[85%] self-end rounded-2xl bg-foreground px-4 py-2 text-background"
                : "max-w-[85%] self-start rounded-2xl border border-grid px-4 py-2"
            }
          >
            <p className="whitespace-pre-wrap">{turn.content}</p>
            {turn.calendarLink && (
              <a
                href={turn.calendarLink}
                download="carbon-helper.ics"
                className="mt-3 mb-1 inline-block rounded-md border border-grid bg-foreground px-4 py-2 text-sm text-background"
              >
                Add to calendar
              </a>
            )}
          </div>
        ))}
        {pending && (
          <p className="self-start text-sm text-muted">Checking the forecast…</p>
        )}
      </div>

      {error && (
        <p className="text-sm" role="alert">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="mt-auto flex gap-3 rounded-2xl border border-grid bg-background/60 p-4"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHARS}
          placeholder="Ask about the grid or your appliances"
          aria-label="Your question"
          className="min-w-0 flex-1 rounded-md border border-grid bg-background px-3 py-2 text-base text-foreground"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded-md border border-grid bg-foreground px-4 py-2 text-base text-background disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
