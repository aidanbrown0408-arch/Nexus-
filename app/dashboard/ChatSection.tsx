"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakableText } from "@/lib/speech-text";
import { useDictation, useSpeaker } from "./useSpeech";
import Orb, { type OrbMode } from "../Orb";

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
    <ul className="mt-2 space-y-1 border-t border-line/70 pt-2">
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

export default function ChatSection({
  variant = "full",
  onExitFocus,
}: {
  // "compact" is the slim top bar shown above a panel in full screen mode
  // — same assistant, same hooks, just a bar instead of the centered
  // layout, so the mic and the Voice/Text switch stay reachable while a
  // single panel takes the rest of the screen.
  variant?: "full" | "compact";
  onExitFocus?: () => void;
} = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"voice" | "text">("voice");
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

  // Voice and text are the same assistant with one switch, so the
  // transcript, the input and the send path are shared — `mode` only
  // decides which face of it is on screen.
  const isVoice = mode === "voice";

  // What the orb is doing, in priority order: the user talking beats us
  // talking beats us thinking.
  const orbMode: OrbMode = dictation.listening
    ? "listening"
    : speaker.speaking
      ? "speaking"
      : sending
        ? "thinking"
        : "idle";

  const STATUS_LABEL: Record<OrbMode, string> = {
    listening: "Listening",
    speaking: "Speaking",
    thinking: "Thinking",
    idle: "Ready",
  };

  // The last thing the assistant said, shown under the orb so voice mode
  // still leaves something readable on screen.
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");

  if (variant === "compact") {
    return (
      <section className="nx-panel flex shrink-0 flex-wrap items-center gap-3 px-5 py-3.5 sm:flex-nowrap">
        {/* The orb doubles as the mic here too — tap to start or stop
            dictation without leaving full screen. */}
        <button
          type="button"
          onClick={() => {
            primeSpeech();
            if (dictation.listening) {
              dictation.stop();
            } else {
              setMode("voice");
              dictation.start();
            }
          }}
          disabled={
            sending || !dictation.supported || status.kind === "disconnected"
          }
          aria-label={dictation.listening ? "Stop listening" : "Start listening"}
          className="shrink-0 rounded-full transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <Orb mode={orbMode} size={52} />
        </button>

        <div className="order-3 min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
          {status.kind === "disconnected" ? (
            <p className="truncate text-[15px] text-ink-muted">
              Connect Google to talk to Nexus about your mail and calendar.
            </p>
          ) : isVoice ? (
            <>
              <p className="nx-label">{STATUS_LABEL[orbMode]}</p>
              <p className="truncate text-[15px] font-medium text-ink">
                {input.trim() ||
                  lastAssistant?.content ||
                  "Tap the orb and say what you need."}
              </p>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sending}
                placeholder="Ask about your mail or calendar…"
                aria-label="Ask about your mail or calendar"
                className="nx-input !py-2"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="nx-btn-primary nx-btn-sm shrink-0"
              >
                {sending ? "…" : "Send"}
              </button>
            </form>
          )}
        </div>

        {status.kind === "disconnected" ? (
          <a href={connectHref} className="nx-btn-primary nx-btn-sm shrink-0">
            Connect Google
          </a>
        ) : (
          <div
            className="nx-segment shrink-0"
            role="group"
            aria-label="Voice or text"
          >
            <button
              type="button"
              data-active={isVoice}
              onClick={() => {
                primeSpeech();
                setMode("voice");
              }}
              className="!px-4 !py-1.5 !text-[13px]"
            >
              Voice
            </button>
            <button
              type="button"
              data-active={!isVoice}
              onClick={() => {
                stopDictation();
                setMode("text");
              }}
              className="!px-4 !py-1.5 !text-[13px]"
            >
              Text
            </button>
          </div>
        )}

        {onExitFocus && (
          <button
            type="button"
            onClick={onExitFocus}
            className="nx-btn-quiet nx-btn-sm shrink-0"
          >
            Back to all
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-h-full flex-col items-center justify-center px-2 py-6">
      {/* Voice / Text. One switch, the same assistant behind both. */}
      <div
        className="nx-segment shrink-0"
        role="group"
        aria-label="Voice or text"
      >
        <button
          type="button"
          data-active={isVoice}
          onClick={() => {
            // A tap counts as the user gesture iOS wants before it will
            // synthesise speech later on.
            primeSpeech();
            setMode("voice");
          }}
        >
          Voice
        </button>
        <button
          type="button"
          data-active={!isVoice}
          onClick={() => {
            stopDictation();
            setMode("text");
          }}
        >
          Text
        </button>
      </div>

      {status.kind === "disconnected" ? (
        <div className="mt-10 flex flex-col items-center gap-4 text-center">
          <Orb mode="idle" size={150} />
          <p className="max-w-[380px] text-[15px] leading-relaxed text-ink-muted">
            Connect your Google account and you can ask about your mail and
            calendar here.
          </p>
          <a href={connectHref} className="nx-btn-primary">
            Connect Google
          </a>
        </div>
      ) : isVoice ? (
        <div className="mt-8 flex w-full max-w-[560px] flex-col items-center">
          {/* The orb is the microphone. Clicking it starts and stops
              dictation, so there's no separate mic button to find. */}
          <button
            type="button"
            onClick={() => {
              primeSpeech();
              if (dictation.listening) dictation.stop();
              else dictation.start();
            }}
            disabled={sending || !dictation.supported}
            aria-label={
              dictation.listening ? "Stop listening" : "Start listening"
            }
            className="group rounded-full transition-transform duration-300 hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <Orb mode={orbMode} size={200} />
          </button>

          <p
            className={
              "nx-label-lg mt-7 transition-colors " +
              (orbMode === "idle" ? "text-ink-ghost" : "text-accent-600")
            }
          >
            {STATUS_LABEL[orbMode]}
          </p>

          {/* One slot under the orb, three things it can hold: what you
              are saying right now, what the assistant last said, or the
              invitation to start. */}
          <div className="mt-4 flex min-h-[92px] w-full flex-col items-center">
            {input.trim() ? (
              <>
                <p className="text-center text-lg font-medium leading-snug text-ink">
                  {input}
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => send(input)}
                    disabled={sending}
                    className="nx-btn-primary nx-btn-sm"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stopDictation();
                      setInput("");
                    }}
                    className="nx-btn-quiet nx-btn-sm"
                  >
                    Clear
                  </button>
                </div>
              </>
            ) : lastAssistant ? (
              <p className="max-w-[480px] text-center text-lg font-medium leading-snug text-ink">
                {lastAssistant.content}
              </p>
            ) : (
              <p className="max-w-[420px] text-center text-lg leading-snug text-ink-faint">
                {dictation.supported
                  ? "Tap the orb and say what you need."
                  : "This browser has no microphone support — switch to Text."}
              </p>
            )}
          </div>

          {speaker.speaking && (
            <button
              type="button"
              onClick={cancelSpeech}
              className="nx-btn-quiet nx-btn-sm mt-1"
            >
              Stop reading
            </button>
          )}
        </div>
      ) : (
        <div className="mt-7 flex w-full max-w-[640px] flex-col">
          {messages.length > 0 && (
            <div
              ref={scrollRef}
              className="flex max-h-[46vh] flex-col gap-2.5 overflow-y-auto px-0.5 pb-1"
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
                      "max-w-[82%] whitespace-pre-wrap rounded-[18px] px-4 py-2.5 text-[15px] leading-[1.55] " +
                      (message.role === "user"
                        ? "bg-accent-600 text-white"
                        : "border border-line bg-white text-ink shadow-raised")
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
                  <div className="rounded-[18px] border border-line bg-white px-4 py-3.5 shadow-raised">
                    <span className="sr-only">Thinking…</span>
                    <span aria-hidden className="flex gap-1.5">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-wisp [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-wisp [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-wisp [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mt-4 flex items-center gap-1 rounded-full border border-line bg-white py-1.5 pl-5 pr-1.5 shadow-raised transition-colors focus-within:border-accent-400"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
              placeholder="Ask about your mail or calendar…"
              aria-label="Ask about your mail or calendar"
              className="min-w-0 flex-1 border-0 bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-ink-ghost disabled:cursor-not-allowed"
            />
            {dictation.supported && (
              <button
                type="button"
                onClick={() => {
                  primeSpeech();
                  setMode("voice");
                  dictation.start();
                }}
                title="Switch to voice"
                aria-label="Switch to voice"
                className="shrink-0 rounded-full p-2 text-ink-ghost transition-colors hover:bg-surface-muted hover:text-ink"
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
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="nx-btn-primary nx-btn-sm shrink-0"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      )}

      {status.kind === "error" && (
        <p className="mt-4 max-w-[560px] rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-center text-[13px] leading-relaxed text-red-800">
          {status.message} Your question is still in the box — press Send to try
          again.
        </p>
      )}

      {dictation.error && (
        <p className="mt-3 text-center text-xs text-ink-ghost">
          {dictation.error}{" "}
          <button
            type="button"
            onClick={dictation.clearError}
            className="underline underline-offset-2 hover:text-ink"
          >
            Dismiss
          </button>
        </p>
      )}

      {/* Suggestions, as chips — only while there's nothing else to read. */}
      {messages.length === 0 &&
        status.kind !== "disconnected" &&
        !input.trim() && (
          <div className="mt-8 flex max-w-[620px] flex-wrap justify-center gap-2">
            {EXAMPLE_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => send(question)}
                disabled={sending}
                className="nx-chip disabled:cursor-not-allowed disabled:opacity-60"
              >
                {question}
              </button>
            ))}
          </div>
        )}

      {/* Reading replies aloud is a preference, not a mode, so it sits
          quietly at the bottom rather than competing with the switch. */}
      {speaker.supported && (
        <button
          type="button"
          onClick={toggleVoice}
          aria-pressed={voiceReplies}
          className={
            "mt-8 flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 transition-colors " +
            (voiceReplies
              ? "bg-accent-50 text-accent-700"
              : "text-ink-ghost hover:bg-surface-muted hover:text-ink")
          }
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            {voiceReplies ? (
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            ) : (
              <path d="m16 9 4 6M20 9l-4 6" />
            )}
          </svg>
          <span className="nx-chip-label">
            {voiceReplies ? "Reading replies aloud" : "Replies are silent"}
          </span>
        </button>
      )}
    </section>
  );
}
