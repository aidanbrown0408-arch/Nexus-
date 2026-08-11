"use client";

import { useCallback, useEffect, useState } from "react";

type EventSummary = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendeeCount: number;
  hangoutLink: string | null;
};

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "needs_reconnect" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeRange(event: EventSummary): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime())) return "";
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (Number.isNaN(end.getTime())) return time(start);
  return `${time(start)} – ${time(end)}`;
}

export default function CalendarSection() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const res = await fetch("/api/calendar/events", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "not_connected") {
          setStatus({ kind: "disconnected" });
          setEvents([]);
          return;
        }
        if (body?.code === "scope_missing") {
          setStatus({ kind: "needs_reconnect" });
          setEvents([]);
          return;
        }
        throw new Error(body?.error ?? "Failed to load events");
      }
      const body = (await res.json()) as { events: EventSummary[] };
      setEvents(body.events ?? []);
      setStatus({ kind: "connected" });
    } catch (err) {
      setEventsError(
        err instanceof Error ? err.message : "Failed to load events"
      );
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // On mount, check whether Google is connected and load events if so.
  // fetchEvents narrows further — a connected account can still be
  // missing the Calendar scope.
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
          fetchEvents();
        } else {
          setStatus({ kind: "disconnected" });
        }
      } catch {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: "Couldn't check Calendar connection.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchEvents]);

  const connectHref = "/api/google/connect";

  return (
    <section className="mt-8 w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Upcoming</h2>
          <p className="text-sm text-neutral-500">
            Your events for the next 7 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "connected" && (
            <button
              type="button"
              onClick={fetchEvents}
              disabled={loadingEvents}
              className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingEvents ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {(status.kind === "disconnected" ||
            status.kind === "needs_reconnect") && (
            <a
              href={connectHref}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              {status.kind === "needs_reconnect"
                ? "Reconnect to enable Calendar"
                : "Connect Calendar"}
            </a>
          )}
        </div>
      </header>

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
            Connect your Google account to see your upcoming events here.
          </p>
        )}

        {status.kind === "needs_reconnect" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Calendar was added after you connected, so your existing
            permission doesn&apos;t cover it. Reconnect to grant access —
            your inbox stays connected either way.
          </p>
        )}

        {status.kind === "connected" && (
          <>
            {eventsError && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {eventsError}
              </p>
            )}

            {loadingEvents && events.length === 0 ? (
              <EventListSkeleton />
            ) : events.length === 0 && !eventsError ? (
              <p className="text-sm text-neutral-500">
                Nothing scheduled in the next 7 days.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {events.map((event) => (
                  <li key={event.id} className="py-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-sm font-medium text-neutral-900">
                            {event.summary}
                          </p>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {formatDay(event.start)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm text-neutral-600">
                          {formatTimeRange(event)}
                        </p>
                        {(event.location || event.attendeeCount > 0) && (
                          <p className="mt-0.5 truncate text-xs text-neutral-500">
                            {[
                              event.location,
                              event.attendeeCount > 0
                                ? `${event.attendeeCount} attendee${
                                    event.attendeeCount === 1 ? "" : "s"
                                  }`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        {event.hangoutLink && (
                          <a
                            href={event.hangoutLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            Join meeting
                          </a>
                        )}
                      </div>
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

function EventListSkeleton() {
  return (
    <ul className="divide-y divide-neutral-100">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="py-3">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
