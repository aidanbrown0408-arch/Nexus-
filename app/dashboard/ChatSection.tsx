"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

const EXAMPLE_QUESTIONS = [
  "What's blocking me this week?",
  "Who am I waiting on a reply from?",
  "What's on my calendar tomorrow?",
];

export default function ChatSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status.kind]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status.kind === "sending") return;

      const next = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(next);
      setInput("");
      setStatus({ kind: "sending" });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ messages: next }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body?.code === "not_connected") {
            // Roll the question back into the input — it was never answered.
            setMessages(messages);
            setInput(trimmed);
            setStatus({ kind: "disconnected" });
            return;
          }
          throw new Error(body?.error ?? "Couldn't answer that just now.");
        }

        const body = (await res.json()) as { reply: ChatMessage };
        setMessages([...next, body.reply]);
        setStatus({ kind: "idle" });
      } catch (err) {
        // Drop the unanswered question back into the input so it isn't lost,
        // and leave the prior conversation intact.
        setMessages(messages);
        setInput(trimmed);
        setStatus({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Couldn't answer that just now.",
        });
      }
    },
    [messages, status.kind]
  );

  const sending = status.kind === "sending";
  const connectHref = "/api/google/connect";

  return (
    <section className="mt-8 w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Chat</h2>
          <p className="text-sm text-neutral-500">
            Ask about your mail and calendar.
          </p>
        </div>
        {status.kind === "disconnected" && (
          <a
            href={connectHref}
            className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Connect Google
          </a>
        )}
      </header>

      <div className="mt-4">
        {status.kind === "disconnected" && (
          <p className="mb-3 text-sm text-neutral-500">
            Connect your Google account and you can ask about your mail and
            calendar here.
          </p>
        )}

        {messages.length === 0 && status.kind !== "disconnected" ? (
          <div className="py-2">
            <p className="text-sm text-neutral-500">Try asking:</p>
            <ul className="mt-2 space-y-2">
              {EXAMPLE_QUESTIONS.map((question) => (
                <li key={question}>
                  <button
                    type="button"
                    onClick={() => send(question)}
                    disabled={sending}
                    className="rounded-full border border-neutral-200 px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {question}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-96 space-y-3 overflow-y-auto pr-1"
          >
            {messages.map((message, i) => (
              <div
                key={i}
                className={
                  "flex " +
                  (message.role === "user" ? "justify-end" : "justify-start")
                }
              >
                <div
                  className={
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed " +
                    (message.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-neutral-100 text-neutral-800")
                  }
                >
                  {message.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-neutral-100 px-3.5 py-2.5">
                  <span className="sr-only">Thinking…</span>
                  <span aria-hidden className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {status.kind === "error" && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {status.message} Your question is still in the box — press Send to
            try again.
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-4 flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder="Ask about your mail or calendar…"
            aria-label="Ask about your mail or calendar"
            className="min-w-0 flex-1 rounded-full border border-neutral-200 px-4 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-neutral-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="shrink-0 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </form>
      </div>
    </section>
  );
}
