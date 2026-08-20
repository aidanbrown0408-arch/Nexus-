"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakableText } from "@/lib/speech-text";
import { useDictation, useSpeaker } from "./useSpeech";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  // What the assistant actually changed on this turn. Attached to the
  // message rather than kept in a separate list so the receipt stays next
  // to the sentence that claimed it — "I archived those" is a claim, this
  // is the thing that proves it and takes it back.
  actions?: PerformedAction[];
};

type PerformedAction = {
  id: string;
  summary: string;
  undoable: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

const EXAMPLE_QUESTIONS = [
  "What's blocking me this week?",
  "Draft a reply to the newest email",
  "Archive the newsletters",
];

function ActionReceipts({ actions }: { actions: PerformedAction[] }) {
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);

  if (!actions.length) return null;

  async function undo(id: string) {
    setWorking(id);
    try {
      const res = await fetch(`/api/actions/${id}/undo`, { method: "POST" });
      if (res.ok) setUndone((current) => new Set(current).add(id));
    } finally {
      setWorking(null);
    }
  }

  return (
    <ul className="mt-2 space-y-1 border-t border-neutral-200/70 pt-2">
      {actions.map((action) => {
        const isUndone = undone.has(action.id);
        return (
          <li
            key={action.id}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <span
              className={
                isUndone ? "text-neutral-400 line-through" : "text-neutral-600"
              }
            >
              {action.summary}
            </span>
            {action.undoable && !isUndone && (
              <button
                type="button"
                onClick={() => undo(action.id)}
                disabled={working === action.id}
                className="shrink-0 font-medium text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-800 disabled:opacity-60"
              >
                {working === action.id ? "Undoing…" : "Undo"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function ChatSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [voiceReplies, setVoiceReplies] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Dictation writes into the same input box typing does — there's no
  // separate "voice message" in the transcript, and `send` can't tell the
  // difference. That's the point: a mis-heard "archive the newsletters"
  // sits in an editable box until you press Send, and every guardrail on
  // /api/chat applies unchanged because the request is unchanged.
  const handleTranscript = useCallback((text: string) => setInput(text), []);
  const dictation = useDictation(handleTranscript);
  // Stable across renders, unlike the object it came off — so `send`
  // isn't rebuilt on every keystroke just to hold onto it.
  const stopDictation = dictation.stop;

  const speaker = useSpeaker();
  const { speak, cancel: cancelSpeech, prime: primeSpeech } = speaker;
  // Index of the last message read aloud, so a re-render — undoing an
  // action, say — doesn't make Nexus repeat itself.
  const lastSpokenRef = useRef(-1);

  // Muted is the default, and a failed read stays muted: an app that
  // starts talking in an open-plan office without being asked is a first
  // impression people fix by closing the tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          profile: { voice_replies?: boolean | null } | null;
        };
        if (!cancelled && body.profile?.voice_replies === true) {
          setVoiceReplies(true);
        }
      } catch {
        /* stay muted */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!voiceReplies) return;
    const index = messages.length - 1;
    const last = messages[index];
    if (!last || last.role !== "assistant") return;
    if (lastSpokenRef.current >= index) return;
    lastSpokenRef.current = index;
    // Content only. The action receipts underneath are UI — the undo
    // button is on screen, and reading it out loud is noise.
    speak(speakableText(last.content));
  }, [messages, voiceReplies, speak]);

  const toggleVoice = useCallback(() => {
    const next = !voiceReplies;
    setVoiceReplies(next);
    // Turning it on shouldn't make it read the answer already sitting on
    // screen, which the user has by now read themselves.
    lastSpokenRef.current = messages.length - 1;
    if (next) primeSpeech();
    else cancelSpeech();

    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: { voice_replies: next } }),
    }).catch(() => {
      // The toggle still works for this session; it just won't follow
      // them to another device. Not worth an error message.
    });
  }, [voiceReplies, messages.length, primeSpeech, cancelSpeech]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status.kind]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status.kind === "sending") return;

      // Whatever the mic was still catching, the question has been asked.
      stopDictation();

      const next = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(next);
      setInput("");
      setStatus({ kind: "sending" });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          // Strip the receipts: the API validates a strict {role, content}
          // shape, and they're ours to render, not part of the transcript.
          body: JSON.stringify({
            messages: next.map(({ role, content }) => ({ role, content })),
          }),
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

        const body = (await res.json()) as {
          reply: ChatMessage;
          actions?: PerformedAction[];
        };
        setMessages([
          ...next,
          { ...body.reply, actions: body.actions ?? [] },
        ]);
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
    [messages, status.kind, stopDictation]
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
        <div className="flex items-center gap-3">
          {speaker.supported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-pressed={voiceReplies}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                (voiceReplies
                  ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                  : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")
              }
            >
              {voiceReplies ? "Reading replies aloud" : "Read replies aloud"}
            </button>
          )}
          {speaker.speaking && (
            <button
              type="button"
              onClick={cancelSpeech}
              className="text-xs font-medium text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-800"
            >
              Stop
            </button>
          )}
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
                  {message.role === "assistant" && message.actions && (
                    <ActionReceipts actions={message.actions} />
                  )}
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
          {/* Nothing renders in Firefox, which has no SpeechRecognition.
              A missing button is a better experience than an error about
              a button nobody asked for. */}
          {dictation.supported && (
            <button
              type="button"
              onClick={() => {
                // Both taps are user gestures, which is what iOS wants to
                // see before it will play synthesised speech later.
                primeSpeech();
                if (dictation.listening) dictation.stop();
                else dictation.start();
              }}
              disabled={sending}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? "Stop listening" : "Ask by voice"}
              title={dictation.listening ? "Stop listening" : "Ask by voice"}
              className={
                "shrink-0 rounded-full border p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
                (dictation.listening
                  ? "animate-pulse border-indigo-400 bg-indigo-50 text-indigo-700"
                  : "border-neutral-200 text-neutral-500 hover:bg-neutral-50")
              }
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder={
              dictation.listening
                ? "Listening…"
                : "Ask about your mail or calendar…"
            }
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

        {dictation.error && (
          <p className="mt-2 text-xs text-neutral-500">
            {dictation.error}{" "}
            <button
              type="button"
              onClick={dictation.clearError}
              className="underline underline-offset-2 hover:text-neutral-800"
            >
              Dismiss
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
