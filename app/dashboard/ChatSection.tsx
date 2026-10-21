"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Orb, { type OrbMode } from "../Orb";
import { speakableText } from "@/lib/speech-text";
import { useChat, type ChatMessage, type PerformedAction } from "./ChatContext";

// The assistant, in two shapes over one shared state (ChatContext):
//
// - "full": the Home board's centre panel — a header like the other
//   panels, then either the orb (Voice) or a proper chat thread (Text).
// - "compact": the slim bar above a full-width page, so the mic and the
//   Voice/Text switch stay reachable everywhere.
//
// Switching between them no longer loses the conversation, because
// neither one owns it.

const EXAMPLE_QUESTIONS: { label: string; icon: "spark" | "mail" | "archive" }[] = [
  { label: "What's blocking me this week?", icon: "spark" },
  { label: "Draft a reply to the newest email", icon: "mail" },
  { label: "Archive the newsletters", icon: "archive" },
];

const STATUS_LABEL: Record<OrbMode, string> = {
  listening: "Listening",
  speaking: "Speaking",
  thinking: "Thinking",
  idle: "Ready",
};

const connectHref = "/api/google/connect";

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- small pieces ---------------------------------------------------------

function Glyph({
  name,
  size = 16,
  className = "",
}: {
  name:
    | "mic"
    | "send"
    | "copy"
    | "check"
    | "speaker-on"
    | "speaker-off"
    | "replay"
    | "new"
    | "spark"
    | "mail"
    | "archive"
    | "undo"
    | "close"
    | "chat";
  size?: number;
  className?: string;
}) {
  const paths: Record<string, JSX.Element> = {
    mic: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </>
    ),
    send: <path d="M5 12h13M13 6l6 6-6 6" />,
    copy: (
      <>
        <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
        <path d="M15.5 8.5V6.5A2 2 0 0 0 13.5 4.5h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
      </>
    ),
    check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    "speaker-on": (
      <>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
      </>
    ),
    "speaker-off": (
      <>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="m16 9 5 6M21 9l-5 6" />
      </>
    ),
    replay: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      </>
    ),
    new: <path d="M12 5v14M5 12h14" />,
    spark: (
      <path d="M12 3.5 13.8 8.2 18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8Z" />
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    archive: (
      <>
        <rect x="3" y="4" width="18" height="5" rx="1.5" />
        <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
      </>
    ),
    undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    chat: (
      <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12Z" />
    ),
  };
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"shrink-0 " + className}
    >
      {paths[name]}
    </svg>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active = false,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
        (active
          ? "bg-accent-50 text-accent-700 hover:bg-accent-100"
          : "text-ink-ghost hover:bg-surface-muted hover:text-ink")
      }
    >
      {children}
    </button>
  );
}

// The Nexus mark, small, as the assistant's avatar in the thread.
function AssistantAvatar({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-500 to-accent-800 shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_1px_2px_rgba(16,24,40,.18)]"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.58}
        height={size * 0.58}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M6 17 12 7l6 10" opacity=".85" />
        <path d="M6 17h12" opacity=".55" />
        <circle cx="12" cy="7" r="2.4" fill="white" stroke="none" />
        <circle cx="6" cy="17" r="2.4" fill="white" stroke="none" />
        <circle cx="18" cy="17" r="2.4" fill="white" stroke="none" />
      </svg>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      label={copied ? "Copied" : "Copy"}
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {});
      }}
    >
      <Glyph name={copied ? "check" : "copy"} size={14} />
    </IconButton>
  );
}

function ActionReceipts({
  messageId,
  actions,
}: {
  messageId: string;
  actions: PerformedAction[];
}) {
  const { undoAction, undoing } = useChat();
  if (!actions.length) return null;

  return (
    <ul className="mt-3 space-y-1.5 border-t border-line-soft pt-3">
      {actions.map((action) => (
        <li
          key={action.id}
          className="flex items-center justify-between gap-3 rounded-lg bg-surface-soft px-2.5 py-1.5 text-[13px]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={
                "grid h-4 w-4 shrink-0 place-items-center rounded-full " +
                (action.undone
                  ? "bg-line text-ink-ghost"
                  : "bg-emerald-100 text-emerald-700")
              }
            >
              <Glyph name={action.undone ? "undo" : "check"} size={10} />
            </span>
            <span
              className={
                "min-w-0 truncate " +
                (action.undone ? "text-ink-wisp line-through" : "text-ink-body")
              }
              title={action.summary}
            >
              {action.summary}
            </span>
          </span>
          {action.undone ? (
            <span className="nx-chip-label shrink-0 text-ink-wisp">Undone</span>
          ) : (
            action.undoable && (
              <button
                type="button"
                onClick={() => undoAction(messageId, action.id)}
                disabled={undoing === action.id}
                className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold text-accent-700 transition-colors hover:bg-accent-50 disabled:opacity-60"
              >
                {undoing === action.id ? "Undoing…" : "Undo"}
              </button>
            )
          )}
        </li>
      ))}
    </ul>
  );
}

function TypingDots() {
  return (
    <span aria-hidden className="flex items-center gap-1">
      <span className="nx-typing-dot" />
      <span className="nx-typing-dot [animation-delay:160ms]" />
      <span className="nx-typing-dot [animation-delay:320ms]" />
    </span>
  );
}

// --- the thread (Text mode) -----------------------------------------------

function MessageBubble({
  message,
  showMeta,
}: {
  message: ChatMessage;
  showMeta: boolean;
}) {
  const { speaker } = useChat();

  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end">
        {showMeta && (
          <span className="mb-1 mr-1 text-[11.5px] text-ink-wisp">
            You · {timeLabel(message.at)}
          </span>
        )}
        <div className="max-w-[78%] whitespace-pre-wrap break-words rounded-[18px] rounded-tr-md bg-gradient-to-b from-accent-500 to-accent-600 px-4 py-2.5 text-[14.5px] leading-[1.55] text-white shadow-[0_1px_2px_rgba(16,24,40,.08),0_2px_6px_-2px_rgba(21,94,239,.35)]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-3">
      <div className="w-7 shrink-0">{showMeta && <AssistantAvatar />}</div>
      <div className="flex min-w-0 max-w-[85%] flex-col items-start">
        {showMeta && (
          <span className="mb-1 ml-1 text-[11.5px] text-ink-wisp">
            <span className="font-semibold text-ink-body">Nexus</span> ·{" "}
            {timeLabel(message.at)}
          </span>
        )}
        <div className="relative rounded-[18px] rounded-tl-md border border-line bg-white px-4 py-3 text-[14.5px] leading-[1.6] text-ink-body shadow-[0_1px_2px_rgba(16,24,40,.04)]">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
          {message.actions && (
            <ActionReceipts messageId={message.id} actions={message.actions} />
          )}
        </div>
        <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyButton text={message.content} />
          {speaker.supported && (
            <IconButton
              label="Read aloud"
              onClick={() => {
                speaker.prime();
                speaker.speak(speakableText(message.content));
              }}
            >
              <Glyph name="replay" size={14} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({ autoFocus = false }: { autoFocus?: boolean }) {
  const { input, setInput, send, sending, dictation, setMode } = useChat();
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text, up to a few lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className="flex items-end gap-1.5 rounded-2xl border border-line-strong bg-white p-1.5 pl-4 shadow-raised transition-shadow focus-within:border-accent-300 focus-within:ring-4 focus-within:ring-accent-100"
    >
      <textarea
        ref={ref}
        rows={1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter is a new line — the convention every
          // chat app has trained people into.
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(input);
          }
        }}
        disabled={sending}
        placeholder="Ask about your mail or calendar…"
        aria-label="Ask about your mail or calendar"
        className="min-h-[36px] min-w-0 flex-1 resize-none border-0 bg-transparent py-2 text-[14.5px] leading-[1.45] text-ink outline-none placeholder:text-ink-wisp disabled:cursor-not-allowed"
      />
      {dictation.supported && (
        <button
          type="button"
          onClick={() => {
            setMode("voice");
            dictation.start();
          }}
          title="Speak instead"
          aria-label="Speak instead"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-ghost transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <Glyph name="mic" />
        </button>
      )}
      <button
        type="submit"
        disabled={sending || !input.trim()}
        aria-label="Send"
        title="Send (Enter)"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-600 text-white shadow-raised transition-all hover:bg-accent-700 active:scale-95 disabled:bg-line disabled:text-ink-wisp disabled:shadow-none"
      >
        <Glyph name="send" />
      </button>
    </form>
  );
}

function Suggestions({ center = false }: { center?: boolean }) {
  const { send, sending } = useChat();
  return (
    <div
      className={
        "flex flex-wrap gap-2 " + (center ? "justify-center" : "justify-start")
      }
    >
      {EXAMPLE_QUESTIONS.map(({ label, icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => send(label)}
          disabled={sending}
          className="group inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2 text-[13.5px] text-ink-body shadow-raised transition-colors hover:border-accent-200 hover:bg-accent-50 hover:text-accent-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Glyph
            name={icon}
            size={14}
            className="text-ink-wisp transition-colors group-hover:text-accent-600"
          />
          {label}
        </button>
      ))}
    </div>
  );
}

function ErrorNotice() {
  const { status, dismissError, dictation } = useChat();
  return (
    <>
      {status.kind === "error" && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-800"
        >
          <p className="min-w-0 flex-1">
            {status.message} Your question is still in the box — press Send to
            try again.
          </p>
          <button
            type="button"
            onClick={dismissError}
            aria-label="Dismiss"
            className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-red-700 hover:bg-red-100"
          >
            <Glyph name="close" size={12} />
          </button>
        </div>
      )}
      {dictation.error && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-800">
          <p className="min-w-0 flex-1">{dictation.error}</p>
          <button
            type="button"
            onClick={dictation.clearError}
            aria-label="Dismiss"
            className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-amber-700 hover:bg-amber-100"
          >
            <Glyph name="close" size={12} />
          </button>
        </div>
      )}
    </>
  );
}

function TextThread() {
  const { messages, sending, status } = useChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view — including when switching in from
  // Voice with a conversation already going.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-2 py-8 text-center">
            <Orb mode={sending ? "thinking" : "idle"} size={72} />
            <h3 className="mt-5 text-[19px] font-semibold tracking-tight text-ink">
              How can I help today?
            </h3>
            <p className="mt-1.5 max-w-[360px] text-[14px] leading-relaxed text-ink-ghost">
              Ask about your inbox or calendar, or have Nexus draft, archive
              and schedule for you.
            </p>
            <div className="mt-6">
              <Suggestions center />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            {messages.map((message, i) => (
              <MessageBubble
                key={message.id}
                message={message}
                showMeta={i === 0 || messages[i - 1].role !== message.role}
              />
            ))}
            {sending && (
              <div className="flex items-start gap-3">
                <AssistantAvatar />
                <div className="rounded-[18px] rounded-tl-md border border-line bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
                  <span className="sr-only">Nexus is thinking…</span>
                  <TypingDots />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 pt-3">
        <ErrorNotice />
        {status.kind !== "disconnected" && <Composer />}
        <p className="text-center text-[11px] text-ink-wisp">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
}

// --- the orb (Voice mode) ------------------------------------------------

function VoiceStage() {
  const {
    input,
    setInput,
    send,
    sending,
    dictation,
    speaker,
    orbMode,
    lastAssistant,
    messages,
  } = useChat();

  const transcribing = Boolean(input.trim());
  const active = orbMode !== "idle";

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-1 py-4">
      <div className="my-auto flex w-full flex-col items-center">
        {/* The orb is the microphone. */}
        <button
          type="button"
          onClick={() => {
            speaker.prime();
            if (dictation.listening) dictation.stop();
            else dictation.start();
          }}
          disabled={sending || !dictation.supported}
          aria-label={dictation.listening ? "Stop listening" : "Start listening"}
          className="rounded-full transition-transform duration-300 hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <Orb mode={orbMode} size={148} />
        </button>

        <span
          className={
            "mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11.5px] font-semibold uppercase tracking-label transition-colors " +
            (active
              ? "bg-accent-50 text-accent-700"
              : "bg-surface-muted text-ink-ghost")
          }
        >
          <span
            className={
              "h-1.5 w-1.5 rounded-full " +
              (active ? "animate-pulse bg-accent-600" : "bg-ink-wisp")
            }
          />
          {STATUS_LABEL[orbMode]}
        </span>

        {/* The speech bubble. It points up at the orb, so what's in it
            reads as coming from (or going to) the thing on screen. */}
        <div className="mt-5 w-full max-w-[540px]">
          {transcribing ? (
            <div className="nx-speech nx-speech-user">
              <p className="nx-label mb-1.5 !text-accent-700">You</p>
              <p className="whitespace-pre-wrap break-words text-[16px] font-medium leading-snug text-ink">
                {input}
                {dictation.listening && <span className="nx-caret" />}
              </p>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    dictation.stop();
                    setInput("");
                  }}
                  className="nx-btn-ghost nx-btn-sm"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={sending}
                  className="nx-btn-primary nx-btn-sm"
                >
                  <Glyph name="send" size={14} />
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          ) : sending ? (
            <div className="nx-speech flex items-center gap-3">
              <AssistantAvatar size={24} />
              <TypingDots />
            </div>
          ) : lastAssistant ? (
            <div className="nx-speech">
              <div className="mb-2 flex items-center gap-2.5">
                <AssistantAvatar size={24} />
                <p className="text-[12.5px] text-ink-wisp">
                  <span className="font-semibold text-ink-body">Nexus</span> ·{" "}
                  {timeLabel(lastAssistant.at)}
                </p>
                <div className="ml-auto flex gap-0.5">
                  <CopyButton text={lastAssistant.content} />
                  {speaker.supported &&
                    (speaker.speaking ? (
                      <IconButton label="Stop reading" onClick={speaker.cancel} active>
                        <Glyph name="speaker-off" size={14} />
                      </IconButton>
                    ) : (
                      <IconButton
                        label="Read aloud"
                        onClick={() => {
                          speaker.prime();
                          speaker.speak(speakableText(lastAssistant.content));
                        }}
                      >
                        <Glyph name="replay" size={14} />
                      </IconButton>
                    ))}
                </div>
              </div>
              <div className="max-h-[28vh] overflow-y-auto whitespace-pre-wrap break-words text-[15.5px] leading-[1.6] text-ink">
                {lastAssistant.content}
              </div>
              {lastAssistant.actions && (
                <ActionReceipts
                  messageId={lastAssistant.id}
                  actions={lastAssistant.actions}
                />
              )}
              {messages.length > 2 && (
                <p className="mt-3 text-[12px] text-ink-wisp">
                  Switch to Text to see the whole conversation.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              <p className="max-w-[400px] text-center text-[16px] leading-snug text-ink-ghost">
                {dictation.supported
                  ? "Tap the orb and say what you need."
                  : "This browser has no microphone support — switch to Text."}
              </p>
              <Suggestions center />
            </div>
          )}
        </div>

        <div className="mt-4 w-full max-w-[540px] space-y-2">
          <ErrorNotice />
        </div>
      </div>
    </div>
  );
}

// --- shared bits ----------------------------------------------------------

function ModeSwitch({ small = false }: { small?: boolean }) {
  const { mode, setMode } = useChat();
  const cls = small ? "!px-3 !py-1 !text-[13px]" : "!px-3.5 !py-1 !text-[13px]";
  return (
    <div className="nx-segment shrink-0" role="group" aria-label="Voice or text">
      <button
        type="button"
        data-active={mode === "voice"}
        onClick={() => setMode("voice")}
        className={cls + " inline-flex items-center gap-1.5"}
      >
        <Glyph name="mic" size={13} />
        Voice
      </button>
      <button
        type="button"
        data-active={mode === "text"}
        onClick={() => setMode("text")}
        className={cls + " inline-flex items-center gap-1.5"}
      >
        <Glyph name="chat" size={13} />
        Text
      </button>
    </div>
  );
}

function ConnectPrompt() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
      <Orb mode="idle" size={120} />
      <h3 className="mt-2 text-[18px] font-semibold tracking-tight text-ink">
        Connect Google to get started
      </h3>
      <p className="max-w-[380px] text-[14px] leading-relaxed text-ink-ghost">
        Once your Google account is connected you can ask Nexus about your mail
        and calendar here.
      </p>
      <a href={connectHref} className="nx-btn-primary">
        Connect Google
      </a>
    </div>
  );
}

// --- the component ----------------------------------------------------------

export default function ChatSection({
  variant = "full",
  onExitFocus,
}: {
  variant?: "full" | "compact";
  onExitFocus?: () => void;
} = {}) {
  const chat = useChat();
  const {
    mode,
    setMode,
    status,
    sending,
    orbMode,
    dictation,
    speaker,
    input,
    setInput,
    send,
    lastAssistant,
    messages,
    voiceReplies,
    toggleVoiceReplies,
    clearConversation,
  } = chat;
  const isVoice = mode === "voice";

  if (variant === "compact") {
    return (
      <section className="nx-panel flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
        <button
          type="button"
          onClick={() => {
            speaker.prime();
            if (dictation.listening) {
              dictation.stop();
            } else {
              setMode("voice");
              dictation.start();
            }
          }}
          disabled={sending || !dictation.supported || status.kind === "disconnected"}
          aria-label={dictation.listening ? "Stop listening" : "Start listening"}
          className="shrink-0 rounded-full transition-transform hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:hover:scale-100"
        >
          <Orb mode={orbMode} size={44} />
        </button>

        <div className="order-3 min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
          {status.kind === "disconnected" ? (
            <p className="truncate text-[14px] text-ink-muted">
              Connect Google to talk to Nexus about your mail and calendar.
            </p>
          ) : isVoice ? (
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={
                  "shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-label " +
                  (orbMode === "idle"
                    ? "bg-surface-muted text-ink-ghost"
                    : "bg-accent-50 text-accent-700")
                }
              >
                {STATUS_LABEL[orbMode]}
              </span>
              <p
                className="min-w-0 flex-1 truncate text-[14.5px] text-ink"
                title={lastAssistant?.content}
              >
                {input.trim() ? (
                  <span className="font-medium">“{input.trim()}”</span>
                ) : lastAssistant ? (
                  <>
                    <span className="font-semibold text-ink-body">Nexus: </span>
                    {lastAssistant.content}
                  </>
                ) : (
                  <span className="text-ink-ghost">
                    Tap the orb and say what you need.
                  </span>
                )}
              </p>
              {input.trim() && (
                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={sending}
                  className="nx-btn-primary nx-btn-sm shrink-0"
                >
                  Send
                </button>
              )}
            </div>
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
                placeholder={
                  lastAssistant
                    ? `Nexus: ${lastAssistant.content.slice(0, 80)}${lastAssistant.content.length > 80 ? "…" : ""}`
                    : "Ask about your mail or calendar…"
                }
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
          <ModeSwitch small />
        )}

        {onExitFocus && (
          <button
            type="button"
            onClick={onExitFocus}
            className="nx-btn-quiet nx-btn-sm shrink-0 lg:hidden"
          >
            Home
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="nx-board-panel h-full">
      <header className="nx-board-head !flex-row items-center !gap-3">
        <AssistantAvatar size={30} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">
            Assistant
          </h2>
          <p className="flex items-center gap-1.5 truncate text-[13px] text-ink-ghost">
            <span
              className={
                "h-1.5 w-1.5 shrink-0 rounded-full " +
                (status.kind === "disconnected"
                  ? "bg-ink-wisp"
                  : orbMode === "idle"
                    ? "bg-emerald-500"
                    : "animate-pulse bg-accent-600")
              }
            />
            {status.kind === "disconnected"
              ? "Not connected"
              : orbMode === "idle"
                ? "Online · voice or text"
                : STATUS_LABEL[orbMode] + "…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {speaker.supported && (
            <IconButton
              label={voiceReplies ? "Reading replies aloud — turn off" : "Read replies aloud"}
              onClick={toggleVoiceReplies}
              active={voiceReplies}
            >
              <Glyph name={voiceReplies ? "speaker-on" : "speaker-off"} />
            </IconButton>
          )}
          {messages.length > 0 && (
            <IconButton label="New conversation" onClick={clearConversation}>
              <Glyph name="new" />
            </IconButton>
          )}
          {status.kind !== "disconnected" && <ModeSwitch />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col pt-3">
        {status.kind === "disconnected" ? (
          <ConnectPrompt />
        ) : isVoice ? (
          <VoiceStage />
        ) : (
          <TextThread />
        )}
      </div>
    </section>
  );
}
