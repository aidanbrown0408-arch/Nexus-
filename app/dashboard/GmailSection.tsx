"use client";

import { PanelIcon, PanelIconButton } from "./PanelActions";
import HousekeepingDrawer from "./HousekeepingDrawer";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DraftReply from "./DraftReply";
import EmailBody from "./EmailBody";
import AddTaskFromEmail from "./AddTaskFromEmail";

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
  // Connected once, but the token can no longer be refreshed.
  | { kind: "expired" }
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
  // Which row is expanded into the reading pane. One at a time — a full
  // email is tall, and a list of open ones is a worse way to read an inbox
  // than a closed one.
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
        // The grant is dead rather than the request being unlucky.
        // Retrying is what the red box invites and the one thing that
        // can't work, so this gets its own state with a link out.
        if (body?.code === "reauth_required") {
          setStatus({ kind: "expired" });
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
  //
  // The banner text is copied into state first. It used to be read
  // straight from the URL — and the very same effect strips it from the
  // URL — so "access denied" or "something went wrong" rendered for one
  // frame and vanished before anyone could read it.
  const flashParam = searchParams.get("google");
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flashParam) return;
    setFlash(flashParam);
    if (flashParam === "connected" || flashParam === "partial") {
      // Reload messages now that we have tokens.
      fetchMessages();
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    // Rides along with google=partial from the OAuth callback. The
    // Calendar panel reads the real answer from its own response rather
    // than this hint, so the param has no job left once the redirect
    // has landed — but leaving it behind means it survives every
    // subsequent navigation.
    url.searchParams.delete("calendarWrite");
    router.replace(url.pathname + (url.search ? url.search : ""));
  }, [flashParam, fetchMessages, router]);

  const connectHref = "/api/google/connect";
  const unreadCount = messages.filter((m) => m.unread).length;

  return (
    <section className="nx-board-panel">
      <header className="nx-board-head">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="flex shrink-0 items-center gap-2 text-[17px] font-semibold tracking-tight text-ink">
            Inbox
            {unreadCount > 0 && (
              <span className="rounded-md bg-accent-50 px-1.5 py-0.5 text-[12px] font-semibold leading-none text-accent-700">
                {unreadCount}
              </span>
            )}
          </h2>
          <div className="flex shrink-0 items-center gap-0.5">
          {status.kind === "connected" && <HousekeepingDrawer />}
          {status.kind === "connected" && (
            <PanelIconButton
              icon="refresh"
              label={loadingMessages ? "Refreshing…" : "Refresh inbox"}
              onClick={fetchMessages}
              disabled={loadingMessages}
              spinning={loadingMessages}
            />
          )}
          {(status.kind === "disconnected" || status.kind === "expired") && (
            <a
              href={connectHref}
              className="nx-btn-primary nx-btn-sm"
            >
              {status.kind === "expired" ? "Reconnect Gmail" : "Connect Gmail"}
            </a>
          )}
            {onToggleFocus && (
              <PanelIconButton
                icon={focused ? "minimize" : "maximize"}
                label={focused ? "Exit full screen" : "Full screen"}
                onClick={onToggleFocus}
                pressed={focused}
              />
            )}
            <PanelIconButton
              icon={expanded ? "chevron-up" : "chevron-down"}
              label={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((v) => !v)}
              expanded={expanded}
            />
          </div>
        </div>
        <p className="text-[13px] text-ink-ghost">
          {status.kind === "loading"
            ? "Checking your inbox…"
            : status.kind === "disconnected"
              ? "Gmail isn't connected"
              : status.kind === "expired"
                ? "Connection expired"
                : status.kind === "error"
                  ? "Couldn't reach Gmail"
                  : unreadCount > 0
                    ? `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`
                    : loadingMessages && messages.length === 0
                      ? "Loading…"
                      : "You're all caught up"}
        </p>
      </header>

      {!expanded ? (
        <p className="mt-3 text-sm text-ink-ghost">
          {messages.length} message{messages.length === 1 ? "" : "s"} loaded.
        </p>
      ) : (
      <div className="nx-board-body">

      {(flash === "denied" || flash === "error") && (
        <div
          role="status"
          className={`mt-4 flex items-start gap-3 rounded-xl px-3 py-2 text-sm ${
            flash === "denied"
              ? "bg-amber-50 text-amber-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          <p className="min-w-0 flex-1">
            {flash === "denied"
              ? "Gmail access was denied. You can try connecting again anytime."
              : "Something went wrong connecting Gmail. Please try again."}
          </p>
          <button
            type="button"
            onClick={() => setFlash(null)}
            className="shrink-0 text-xs font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
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

        {status.kind === "expired" && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Your Google connection expired — Gmail stopped accepting it.{" "}
            <a
              href={connectHref}
              className="font-medium underline underline-offset-2"
            >
              Reconnect Google
            </a>{" "}
            and your mail comes straight back.
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
              <ul className="flex flex-col divide-y divide-line-soft">
                {messages.map((msg) => {
                  const open = openId === msg.id;
                  const tint = AVATAR_TINTS[avatarTint(msg.fromEmail || msg.from)];
                  return (
                    <li
                      key={msg.id}
                      className={
                        "relative rounded-lg py-3 pl-3.5 pr-2 transition-colors " +
                        (open ? "bg-surface-soft" : "hover:bg-surface-soft")
                      }
                    >
                      {msg.unread && (
                        <span
                          aria-label="Unread"
                          className="absolute left-0.5 top-[26px] h-1.5 w-1.5 rounded-full bg-accent-600"
                        />
                      )}
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
                              aria-label={open ? "Close message" : "Open message"}
                              title={open ? "Close" : "Open"}
                              className="-my-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-wisp transition-colors hover:bg-surface-muted hover:text-ink"
                            >
                              <PanelIcon
                                name={open ? "chevron-up" : "chevron-down"}
                                size={14}
                              />
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
                            {msg.snippet && !open && (
                              <p className="mt-[3px] truncate text-[13px] leading-normal text-ink-ghost">
                                {msg.snippet}
                              </p>
                            )}
                          </button>

                          {open && (
                            <>
                              <EmailBody messageId={msg.id} />
                              <DraftReply messageId={msg.id} />
                              <AddTaskFromEmail
                                messageId={msg.id}
                                threadId={msg.threadId}
                                subject={msg.subject}
                                from={msg.from}
                              />
                            </>
                          )}
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
    <ul className="flex flex-col divide-y divide-line-soft">
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="flex items-start gap-3 py-3.5"
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
