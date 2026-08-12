"use client";

import { useCallback, useEffect, useState } from "react";

type Priority = {
  title: string;
  reason: string;
  source: "email" | "calendar" | "both";
  sourceId?: string;
};

type Brief = {
  greeting: string;
  headline: string;
  priorities: Priority[];
  scheduleNote: string;
  calendarUnavailable?: boolean;
};

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string }
  | { kind: "ready"; brief: Brief };

const SOURCE_LABEL: Record<Priority["source"], string> = {
  email: "Email",
  calendar: "Calendar",
  both: "Email + Calendar",
};

export default function BriefSection() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const fetchBrief = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/brief", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "not_connected") {
          setStatus({ kind: "disconnected" });
          return;
        }
        throw new Error(body?.error ?? "Failed to load your brief");
      }
      const body = (await res.json()) as { brief: Brief };
      setStatus({ kind: "ready", brief: body.brief });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to load your brief",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  const connectHref = "/api/google/connect";

  return (
    <section className="mt-8 w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Morning Brief
          </h2>
          <p className="text-sm text-neutral-500">
            What needs you today, across mail and calendar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "ready" && (
            <button
              type="button"
              onClick={fetchBrief}
              disabled={refreshing}
              className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {status.kind === "disconnected" && (
            <a
              href={connectHref}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Connect Google
            </a>
          )}
          {status.kind === "error" && (
            <button
              type="button"
              onClick={fetchBrief}
              disabled={refreshing}
              className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      </header>

      <div className="mt-4">
        {status.kind === "loading" && <BriefSkeleton />}

        {status.kind === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {status.message}
          </p>
        )}

        {status.kind === "disconnected" && (
          <p className="text-sm text-neutral-500">
            Connect your Google account and your brief will appear here each
            morning.
          </p>
        )}

        {status.kind === "ready" && (
          <>
            <p className="text-base font-semibold text-neutral-900">
              {status.brief.greeting}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-700">
              {status.brief.headline}
            </p>

            {status.brief.calendarUnavailable && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Based on your email only — your calendar wasn&apos;t available
                this morning.
              </p>
            )}

            {status.brief.priorities.length > 0 && (
              <ul className="mt-4 divide-y divide-neutral-100 border-t border-neutral-100">
                {status.brief.priorities.map((priority, i) => (
                  <li key={priority.sourceId ?? i} className="py-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-neutral-900">
                            {priority.title}
                          </p>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {SOURCE_LABEL[priority.source]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm leading-relaxed text-neutral-600">
                          {priority.reason}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {status.brief.scheduleNote && (
              <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                {status.brief.scheduleNote}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function BriefSkeleton() {
  return (
    <div>
      <div className="h-4 w-2/5 animate-pulse rounded bg-neutral-100" />
      <div className="mt-2 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-100" />
      </div>
      <ul className="mt-4 divide-y divide-neutral-100 border-t border-neutral-100">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="py-3">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-200" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
    </div>
  );
}
