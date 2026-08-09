"use client";

import { useEffect, useState } from "react";

interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

function formatFrom(raw: string): string {
  const match = raw.match(/^(.+?)\s*<.*>$/);
  return match ? match[1].replace(/^"|"$/g, "") : raw;
}

function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return raw;
  }
}

export default function Inbox() {
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gmail/messages")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
        return data;
      })
      .then((data) => setMessages(data.messages))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">Inbox</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Your 20 most recent Gmail messages.
      </p>

      <div className="mt-4">
        {loading && (
          <p className="text-sm text-neutral-400">Loading inbox&hellip;</p>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {!loading && !error && messages.length === 0 && (
          <p className="text-sm text-neutral-500">No messages found.</p>
        )}

        {!loading && !error && messages.length > 0 && (
          <ul className="divide-y divide-neutral-100">
            {messages.map((msg) => (
              <li key={msg.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {formatFrom(msg.from) || "Unknown"}
                  </p>
                  <span className="shrink-0 text-xs text-neutral-400">
                    {formatDate(msg.date)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm text-neutral-700">
                  {msg.subject || "(no subject)"}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-400">
                  {msg.snippet}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
