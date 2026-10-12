import type { Metadata } from "next";
import Link from "next/link";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Chat with HailplusAI" };

export default function ChatPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <Link href="/" className="text-sm text-muted underline">
          Back to the planner
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Chat with HailplusAI
        </h1>
        <p className="mt-2 text-muted">
          Ask when to run something or how clean the grid is. Answers use the
          live forecast; add your postcode for local figures.
        </p>
      </header>
      <Chat />
    </main>
  );
}
