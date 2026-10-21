"use client";

import { useEffect, useState } from "react";

// The reading pane. A row in the inbox shows a hundred characters of
// snippet; opening it should show the actual email — every message in the
// conversation, oldest first, with who it was from and who it went to.
//
// Fetched on open rather than with the list: twenty full threads is a
// slow inbox, and most of them are never read.

type ThreadMessage = {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  date: string;
  body: string;
};

type EmailThread = {
  threadId: string;
  subject: string;
  messages: ThreadMessage[];
};

type State =
  | { kind: "loading" }
  | { kind: "ready"; thread: EmailThread }
  | { kind: "error"; message: string };

function formatFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Bare URLs in a plain-text body are the one bit of markup worth
// restoring — a link you can't click is the most common reason to give up
// and go open Gmail.
function linkify(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>()[\]]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-accent-600 underline underline-offset-2 hover:text-accent-800"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function MessageBlock({
  message,
  only,
}: {
  message: ThreadMessage;
  only: boolean;
}) {
  // In a conversation, older messages start folded: the one you clicked
  // is almost always the one you want, and the rest are context.
  const [open, setOpen] = useState(only);

  return (
    <div className="border-t border-line-soft pt-2.5 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {message.from}
          <span className="ml-1.5 font-normal text-ink-ghost">
            {message.fromEmail && message.fromEmail !== message.from
              ? `<${message.fromEmail}>`
              : ""}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink-wisp">
          {formatFull(message.date)}
        </span>
      </button>

      {open && (
        <>
          {(message.to || message.cc) && (
            <p className="mt-0.5 truncate text-[11px] text-ink-wisp">
              {message.to ? `To ${message.to}` : ""}
              {message.cc ? ` · Cc ${message.cc}` : ""}
            </p>
          )}
          <div className="mt-2 max-h-[28rem] overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-body">
            {message.body ? linkify(message.body) : "(no text content)"}
          </div>
        </>
      )}
    </div>
  );
}

export default function EmailBody({ messageId }: { messageId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/gmail/thread?messageId=${encodeURIComponent(messageId)}`,
          { cache: "no-store" }
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({
            kind: "error",
            message: body?.error ?? "Couldn't open that email.",
          });
          return;
        }
        setState({ kind: "ready", thread: body.thread as EmailThread });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "Couldn't reach Nexus." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  if (state.kind === "loading") {
    return (
      <div className="mt-3 space-y-2 rounded-xl border border-line-soft bg-surface p-3">
        <div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
        <div className="h-3 w-full animate-pulse rounded bg-surface-sunken" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-surface-sunken" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[13px] text-red-800">
        {state.message}
      </p>
    );
  }

  const { thread } = state;

  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-surface p-3">
      <p className="text-sm font-semibold text-ink">{thread.subject}</p>
      {thread.messages.length > 1 && (
        <p className="nx-label mt-0.5">
          {thread.messages.length} messages in this thread
        </p>
      )}
      <div className="mt-2.5 flex flex-col gap-2.5">
        {thread.messages.map((m, i) => (
          <MessageBlock
            key={m.id || i}
            message={m}
            only={i === thread.messages.length - 1}
          />
        ))}
      </div>
      <a
        href={`https://mail.google.com/mail/u/0/#inbox/${thread.threadId}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-[12px] font-medium text-ink-ghost underline-offset-2 hover:underline"
      >
        Open in Gmail
      </a>
    </div>
  );
}
