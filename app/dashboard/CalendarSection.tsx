"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppleConnectForm from "./AppleConnectForm";
import AddEventForm from "./AddEventForm";
import EventRow, { formatDay } from "./EventRow";
import type { EventSummary } from "@/lib/events";
import type { PrepItem } from "@/lib/prep";

// One list, however many calendars feed it. Google and Apple events are
// merged server-side, so this component renders a single timeline and
// only distinguishes the two when something needs fixing — a missing
// scope, a revoked app password.

type SourceStatus =
  | "ok"
  | "not_connected"
  | "scope_missing"
  | "auth_failed"
  | "error";

type Sources = { google: SourceStatus; apple: SourceStatus };

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const RANGE_OPTIONS = [7, 30, 90] as const;

const RANGE_SHORT: Record<(typeof RANGE_OPTIONS)[number], string> = {
  7: "Week",
  30: "Month",
  90: "3 months",
};

const RANGE_LABEL: Record<(typeof RANGE_OPTIONS)[number], string> = {
  7: "7 days",
  30: "30 days",
  90: "90 days",
};

export default function CalendarSection({
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
  // The window the card is showing. Whitelisted server-side too — this
  // value reaches a Google API call and an iCloud time-range query.
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [truncated, setTruncated] = useState(false);
  // Same Expand / Collapse affordance the Inbox panel has.
  const [expanded, setExpanded] = useState(true);

  // Going full screen while the panel happened to be folded would hand
  // the whole row to a one-line summary — force it back open.
  useEffect(() => {
    if (focused) setExpanded(true);
  }, [focused]);
  // Switching 90 days → 7 days fires two requests, and the slower one is
  // usually the wider one. Without this, the 90-day response could land
  // last and paint three months of events under a "next 7 days" heading,
  // with a truncation banner belonging to the other request.
  const requestId = useRef(0);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [sources, setSources] = useState<Sources | null>(null);
  // Prep lives here rather than inside each row so it survives a refresh
  // and so the header can count what's outstanding across the week.
  const [prep, setPrep] = useState<Record<string, PrepItem[]>>({});
  const [generated, setGenerated] = useState<Set<string>>(new Set());
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [showAppleForm, setShowAppleForm] = useState(false);

  const fetchEvents = useCallback(async () => {
    const id = ++requestId.current;
    const isCurrent = () => id === requestId.current;

    setLoadingEvents(true);
    setEventsError(null);
    try {
      const res = await fetch(`/api/calendar/events?days=${days}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "not_connected") {
          if (!isCurrent()) return;
          setStatus({ kind: "disconnected" });
          setSources({ google: "not_connected", apple: "not_connected" });
          setEvents([]);
          // Cleared with everything else, or a disconnect leaves last
          // session's truncation banner hanging over an empty card.
          setTruncated(false);
          setPrep({});
          setGenerated(new Set());
          return;
        }
        throw new Error(body?.error ?? "Failed to load events");
      }
      const body = (await res.json()) as {
        events: EventSummary[];
        sources: Sources;
        prep: Record<string, PrepItem[]>;
        generated: string[];
        truncated?: boolean;
      };
      if (!isCurrent()) return;
      setEvents(body.events ?? []);
      setSources(body.sources);
      setPrep(body.prep ?? {});
      setGenerated(new Set(body.generated ?? []));
      setTruncated(Boolean(body.truncated));
      setStatus({ kind: "ready" });
    } catch (err) {
      if (!isCurrent()) return;
      setEventsError(
        err instanceof Error ? err.message : "Failed to load events"
      );
      setStatus({ kind: "ready" });
    } finally {
      // Only the newest request owns the spinner — a stale one finishing
      // shouldn't say the current one is done.
      if (isCurrent()) setLoadingEvents(false);
    }
  }, [days]);

  // The events route reports what's connected as part of its answer, so
  // there's no separate status check to make first. Refires when the
  // window changes, which is what makes the range buttons work.
  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleItemsChange = useCallback(
    (eventKey: string, items: PrepItem[]) => {
      setPrep((current) => ({ ...current, [eventKey]: items }));
    },
    []
  );

  const handleGenerated = useCallback((eventKey: string) => {
    setGenerated((current) => new Set(current).add(eventKey));
  }, []);

  // Drop the row once the server confirms the delete. Its prep items go
  // with it — they hang off an event that no longer exists, and leaving
  // them would keep the header's outstanding count wrong.
  //
  // When a whole series went, every occurrence goes rather than the one
  // row that was clicked — otherwise next Tuesday's standup sits there
  // looking alive until the page is refreshed.
  // Patch a row in place once the server confirms an edit. Not
  // optimistic — see the comment on EventRow's onUpdated prop — so this
  // only ever runs after the PATCH already succeeded.
  const handleUpdated = useCallback(
    (eventKey: string, fields: Partial<EventSummary>) => {
      setEvents((current) =>
        current.map((e) => (e.key === eventKey ? { ...e, ...fields } : e))
      );
    },
    []
  );

  const handleDeleted = useCallback((eventKey: string, seriesId?: string) => {
    setEvents((current) => {
      const doomed = new Set(
        current
          .filter((e) =>
            seriesId ? e.recurringEventId === seriesId : e.key === eventKey
          )
          .map((e) => e.key)
      );
      doomed.add(eventKey);

      setPrep((prepState) => {
        const next = { ...prepState };
        doomed.forEach((key) => delete next[key]);
        return next;
      });

      return current.filter((e) => !doomed.has(e.key));
    });
  }, []);

  const disconnectApple = useCallback(async () => {
    await fetch("/api/apple/disconnect", { method: "POST" });
    fetchEvents();
  }, [fetchEvents]);

  const googleConnected = sources ? sources.google !== "not_connected" : false;
  const appleConnected = sources ? sources.apple !== "not_connected" : false;

  // Only counts prep for events still on screen — an item attached to an
  // event that has since passed shouldn't keep nagging from the header.
  // Events arrive as one flat, already-sorted list; the board wants them
  // bucketed under Today / Tomorrow / a weekday. Insertion order into the
  // Map preserves the sort, so the groups come out chronological too.
  const dayGroups = (() => {
    const buckets = new Map<string, EventSummary[]>();
    for (const event of events) {
      const day = formatDay(event.start) || "Later";
      const bucket = buckets.get(day);
      if (bucket) bucket.push(event);
      else buckets.set(day, [event]);
    }
    return Array.from(buckets, ([day, list]) => ({ day, events: list }));
  })();

  const openPrepCount = events.reduce(
    (total, event) =>
      total + (prep[event.key] ?? []).filter((item) => !item.done).length,
    0
  );

  return (
    <section className="nx-board-panel">
      <header className="nx-board-head">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="shrink-0 text-base font-semibold tracking-tight text-ink">
            Calendar
          </h2>
          <div className="flex shrink-0 items-center gap-3.5">
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
          {openPrepCount > 0
            ? `${openPrepCount} to do first`
            : `Next ${RANGE_LABEL[days]}`}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        {status.kind === "ready" && (
          <div
            role="group"
            aria-label="How far ahead to look"
            className="nx-segment"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                aria-pressed={days === option}
                data-active={days === option}
                className="!px-3.5 !py-1.5 !text-[13px]"
              >
                {RANGE_SHORT[option]}
              </button>
            ))}
          </div>
        )}
        {status.kind === "ready" && (
          <button
            type="button"
            onClick={fetchEvents}
            disabled={loadingEvents}
            className="text-[13px] font-semibold text-ink transition-colors hover:text-accent-600 disabled:opacity-60"
          >
            {loadingEvents ? "Refreshing…" : "Refresh"}
          </button>
        )}
        </div>
      </header>

      {!expanded ? (
        <p className="mt-3 text-sm text-ink-ghost">
          {events.length} event{events.length === 1 ? "" : "s"} in the next{" "}
          {RANGE_LABEL[days]}.
        </p>
      ) : (
      <div className="nx-board-body mt-3">
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
            Connect Google or Apple below to see your upcoming events here.
          </p>
        )}

        {status.kind === "ready" && (
          <>
            {eventsError && (
              <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                {eventsError}
              </p>
            )}

            {/* A source in trouble gets called out by name — the events
                list can't show a gap, so silence would read as "nothing
                scheduled" rather than "half your calendar is missing". */}
            {sources?.google === "scope_missing" && (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Calendar was added after you connected Google, so your
                existing permission doesn&apos;t cover it.{" "}
                <a
                  href="/api/google/connect"
                  className="font-medium underline underline-offset-2"
                >
                  Reconnect to grant access
                </a>{" "}
                — your inbox stays connected either way.
              </p>
            )}

            {sources?.apple === "auth_failed" && (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Apple isn&apos;t accepting your app-specific password
                anymore — it was probably revoked.{" "}
                <button
                  type="button"
                  onClick={() => setShowAppleForm(true)}
                  className="font-medium underline underline-offset-2"
                >
                  Enter a new one
                </button>
                .
              </p>
            )}

            {(sources?.google === "error" || sources?.apple === "error") && (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Couldn&apos;t reach{" "}
                {sources.google === "error" ? "Google" : "iCloud"} just now,
                so some events may be missing.
              </p>
            )}

            {loadingEvents && events.length === 0 ? (
              <EventListSkeleton />
            ) : events.length === 0 && !eventsError ? (
              <p className="text-sm text-neutral-500">
                Nothing scheduled in the next {RANGE_LABEL[days]}.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {dayGroups.map((group) => (
                  <div key={group.day}>
                    {/* Day headers carry the date so the rows don't have
                        to repeat it — the canvas puts a mono label and a
                        hairline across the top of each day. */}
                    <div className="flex items-center gap-2.5">
                      <span
                        className={
                          "nx-label-lg shrink-0 " +
                          (group.day === "Today" ? "text-accent-600" : "")
                        }
                      >
                        {group.day}
                      </span>
                      <span className="h-px flex-1 bg-line-soft" />
                    </div>

                    <ul className="mt-2.5 flex flex-col gap-2">
                      {group.events.map((event) => (
                        <EventRow
                          key={event.key}
                          event={event}
                          items={prep[event.key] ?? []}
                          generated={generated.has(event.key)}
                          onItemsChange={handleItemsChange}
                          onGenerated={handleGenerated}
                          onDeleted={handleDeleted}
                          onUpdated={handleUpdated}
                          // Naming the calendar only earns its space once
                          // both services are in play — otherwise every
                          // row says the same word.
                          showCalendarName={googleConnected && appleConnected}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Either service can take a new event now, so this shows
                whenever at least one is connected. The picker inside
                decides what's actually writable — a calendar the user
                can only read never reaches the dropdown. */}
            {(googleConnected || appleConnected) && (
              <AddEventForm onCreated={fetchEvents} />
            )}
          </>
        )}

      {showAppleForm ? (
        <AppleConnectForm
          onConnected={() => {
            setShowAppleForm(false);
            fetchEvents();
          }}
          onCancel={() => setShowAppleForm(false)}
        />
      ) : (
        status.kind !== "loading" && (
          <footer className="mt-5 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
            <span className="nx-label">
              Calendars
            </span>

            {googleConnected ? (
              <span className="rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-neutral-600">
                Google connected
              </span>
            ) : (
              <a
                href="/api/google/connect"
                className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
              >
                Connect Google
              </a>
            )}

            {appleConnected ? (
              <span className="flex items-center gap-2 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-neutral-600">
                Apple connected
                <button
                  type="button"
                  onClick={disconnectApple}
                  className="text-neutral-400 transition-colors hover:text-neutral-700"
                >
                  Disconnect
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowAppleForm(true)}
                className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-800"
              >
                Connect Apple
              </button>
            )}
          </footer>
        )
      )}
      {truncated && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          That&apos;s more events than this card shows at once — some later
          ones in this range are hidden. Narrow the window to see a complete
          list.
        </p>
      )}
      </div>
      )}
    </section>
  );
}

function EventListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="flex gap-3 rounded-card border border-line-soft bg-surface-soft p-3"
        >
          <span className="w-[3px] shrink-0 rounded-full bg-surface-sunken" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-surface-sunken" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-sunken" />
          </div>
        </li>
      ))}
    </ul>
  );
}
