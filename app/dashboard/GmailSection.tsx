"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DraftReply from "./DraftReply";

type EmailSummary = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
};

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

// Row avatars. Gmail gives us a display name and an address but no
// picture, so the row leads with initials on a tint picked from the
// address — stable per sender, so the same person keeps the same colour
// from one load to the next.
const AVATAR_TINTS = [
  "bg-accent-100 text-accent-800",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-800",
  "bg-surface-sunken text-ink-body",
  "bg-violet-100 text-violet-800",
];

function avatarTint(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % AVATAR_TINTS.length;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export default function GmailSection({
  focused = false,
  onToggleFocus,
}: {
  // Full screen: the board hands this panel the whole row (chat collapses
  // to a bar above it) instead of a third of it. Purely a layout signal
  // from the parent — this component just needs to know so it can force
  // itself open and offer the way back.
  focused?: boolean;
  onToggleFocus?: () => void;
} = {}) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [messages, setMessages] = useState<EmailSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  // Which row is expanded. One at a time — the draft panel is tall, and a
  // list of open drafts is a worse way to read an inbox than a closed one.
  const [openId, setOpenId] = useState<string | null>(null);
  // Expand / Collapse, as in the canvas: the panel can be folded down to
  // its one-line summary so the assistant gets the whole board.
  const [expanded, setExpanded] = useState(true);
  const searchParams = useSearchParams();
  const router = useRouter();

  // Going full screen while the panel happened to be folded would hand
  // the whole row to a one-line summary — force it back open.
  useEffect(() => {
    if (focused) setExpanded(true);
  }, [focused]);

  const fetchMessages = useCallback(async () => {
    setLoadingMessages(true);
    setMessagesError(null);
    try {
      const res = await fetch("/api/gmail/messages", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "not_connected") {
          setStatus({ kind: "disconnected" });
          setMessages([]);
          return;
        }
        throw new Error(body?.error ?? "Failed to load emails");
      }
      const body = (await res.json()) as { messages: EmailSummary[] };
      setMessages(body.messages ?? []);
      setStatus({ kind: "connected" });
    } catch (err) {
      setMessagesError(
        err instanceof Error ? err.message : "Failed to load emails"
      );
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // On mount, check whether Google is connected and load messages if so.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/google/status", { cache: "no-store" });
        if (!res.ok) throw new Error("status check failed");
        const body = (await res.json()) as { connected: boolean };
        if (cancelled) return;
        if (body.connected) {
          setStatus({ kind: "connected" });
          fetchMessages();
        } else {
          setStatus({ kind: "disconnected" });
        }
      } catch {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: "Couldn't check Gmail connection.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMessages]);

  // Turn the ?google=... hint from the OAuth callback into a banner, then
  // clean it out of the URL so refreshes don't re-show it.
  const flash = searchParams.get("google");
  useEffect(() => {
    if (!flash) return;
    if (flash === "connected") {
      // Reload messages now that we have tokens.
      fetchMessages();
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    router.replace(url.pathname + (url.search ? url.search : ""));
  }, [flash, fetchMessages, router]);

  const connectHref = "/api/google/connect";
  const unreadCount = messages.filter((m) => m.unread).length;

  return (
    <section className="nx-board-panel">
      <header className="nx-board-head">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="shrink-0 text-base font-semibold tracking-tight text-ink">
            Inbox
          </h2>
          <div className="flex shrink-0 items-center gap-3.5">
          {status.kind === "connected" && (
            <button
              type="button"
              onClick={fetchMessages}
              disabled={loadingMessages}
              className="text-[13px] font-semibold text-ink transition-colors hover:text-accent-600 disabled:opacity-60"
            >
              {loadingMessages ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {status.kind === "disconnected" && (
            <a
              href={connectHref}
              className="nx-btn-primary nx-btn-sm"
            >
              Connect Gmail
            </a>
          )}
            {onToggleFocus && (
              <button
                type="button"
                onClick={onToggleFocus}
                aria-pressed={focused}
                className="nx-board-toggle"
              >
                {focused ? "Exit full screen" : "Full screen"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="nx-board-toggle"
            >
              {expanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
        <p className="nx-label truncate">
          {unreadCount > 0 ? `${unreadCount} unread` : "All read"}
        </p>
      </header>

      {!expanded ? (
        <p className="mt-3 text-sm text-ink-ghost">
          {messages.length} message{messages.length === 1 ? "" : "s"} loaded.
        </p>
      ) : (
      <div className="nx-board-body">

      {flash === "denied" && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Gmail access was denied. You can try connecting again anytime.
        </p>
      )}
      {flash === "error" && (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          Something went wrong connecting Gmail. Please try again.
        </p>
      )}

      <div className="mt-3">
        {status.kind === "loading" && (
          <p className="text-sm text-neutral-500">Loading…</p>
        )}

        {status.kind === "error" && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
            {status.message}
          </p>
        )}

        {status.kind === "disconnected" && (
          <p className="text-sm text-neutral-500">
            Connect your Gmail account to see your recent emails here.
          </p>
        )}

        {status.kind === "connected" && (
          <>
            {messagesError && (
              <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                {messagesError}
              </p>
            )}

            {loadingMessages && messages.length === 0 ? (
              <EmailListSkeleton />
            ) : messages.length === 0 && !messagesError ? (
              <p className="text-sm text-neutral-500">
                No recent messages found.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {messages.map((msg) => {
                  const open = openId === msg.id;
                  const tint = AVATAR_TINTS[avatarTint(msg.fromEmail || msg.from)];
                  return (
                    <li
                      key={msg.id}
                      className={
                        "rounded-card border p-3.5 transition-colors " +
                        (msg.unread
                          ? "border-accent-100 bg-accent-50/60"
                          : "border-line-soft bg-surface-soft")
                      }
                    >
                      <div className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className={
                            "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold tracking-[0.02em] " +
                            tint
                          }
                        >
                          {initials(msg.from)}
                        </span>

                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <div className="flex min-w-0 items-baseline gap-2.5">
                            <p
                              className={
                                "min-w-0 flex-1 truncate text-sm text-ink " +
                                (msg.unread ? "font-semibold" : "font-medium")
                              }
                              title={msg.fromEmail}
                            >
                              {msg.from}
                            </p>
                            <span className="shrink-0 font-mono text-[11px] text-ink-wisp">
                              {formatDate(msg.date)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenId(open ? null : msg.id)}
                              aria-expanded={open}
                              className="shrink-0 text-[13px] font-medium text-accent-600 transition-colors hover:text-accent-800"
                            >
                              {open ? "Close" : "Reply"}
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => setOpenId(open ? null : msg.id)}
                            className="min-w-0 text-left"
                          >
                            <p
                              className={
                                "truncate text-sm text-ink " +
                                (msg.unread ? "font-semibold" : "font-medium")
                              }
                            >
                              {msg.subject}
                            </p>
                            {msg.snippet && (
                              <p className="mt-[3px] truncate text-[13px] leading-normal text-ink-ghost">
                                {msg.snippet}
                              </p>
                            )}
                          </button>

                          <span
                            className={
                              "nx-chip-label mt-1 self-start rounded-full px-2 py-[2px] " +
                              (msg.unread
                                ? "bg-accent-100 text-accent-800"
                                : "bg-surface-sunken text-ink-muted")
                            }
                          >
                            {msg.unread ? "New" : "Read"}
                          </span>

                          {open && <DraftReply messageId={msg.id} />}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
      </div>
      )}
    </section>
  );
}

function EmailListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 rounded-card border border-line-soft bg-surface-soft p-3.5"
        >
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface-sunken" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-1/2 animate-pulse rounded bg-surface-sunken" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-surface-sunken" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
          </div>
        </li>
      ))}
    </ul>
  );
}
