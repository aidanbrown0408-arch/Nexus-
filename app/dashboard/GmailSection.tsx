"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

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

export default function GmailSection() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [messages, setMessages] = useState<EmailSummary[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

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

  return (
    <section className="mt-8 w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Inbox</h2>
          <p className="text-sm text-neutral-500">
            Your 20 most recent Gmail messages.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "connected" && (
            <button
              type="button"
              onClick={fetchMessages}
              disabled={loadingMessages}
              className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingMessages ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {status.kind === "disconnected" && (
            <a
              href={connectHref}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Connect Gmail
            </a>
          )}
        </div>
      </header>

      {flash === "denied" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Gmail access was denied. You can try connecting again anytime.
        </p>
      )}
      {flash === "error" && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Something went wrong connecting Gmail. Please try again.
        </p>
      )}

      <div className="mt-4">
        {status.kind === "loading" && (
          <p className="text-sm text-neutral-500">Loading…</p>
        )}

        {status.kind === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
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
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
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
              <ul className="divide-y divide-neutral-100">
                {messages.map((msg) => (
                  <li key={msg.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full " +
                          (msg.unread ? "bg-indigo-500" : "bg-neutral-300")
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p
                            className={
                              "truncate text-sm " +
                              (msg.unread
                                ? "font-semibold text-neutral-900"
                                : "font-medium text-neutral-700")
                            }
                            title={msg.fromEmail}
                          >
                            {msg.from}
                          </p>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {formatDate(msg.date)}
                          </span>
                        </div>
                        <p
                          className={
                            "mt-0.5 truncate text-sm " +
                            (msg.unread
                              ? "text-neutral-900"
                              : "text-neutral-600")
                          }
                        >
                          {msg.subject}
                        </p>
                        {msg.snippet && (
                          <p className="mt-0.5 truncate text-xs text-neutral-500">
                            {msg.snippet}
                          </p>
                        )}
                      </div>
                      <span className="sr-only">
                        {msg.unread ? "Unread" : "Read"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function EmailListSkeleton() {
  return (
    <ul className="divide-y divide-neutral-100">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="py-3">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
