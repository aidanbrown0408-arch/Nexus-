"use client";

import { PanelIcon, PanelIconButton } from "./PanelActions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppleConnectForm from "./AppleConnectForm";
import AddEventForm from "./AddEventForm";
import EventRow from "./EventRow";
import WeekView from "./WeekView";
import MonthView from "./MonthView";
import AgendaView from "./AgendaView";
import RemindersSection from "./RemindersSection";
import CalendarModal from "./CalendarModal";
import { buildCalendarPalette, calendarLabel, colorFor, type CalendarColor } from "./calendarColors";
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
  | "auth_expired"
  | "auth_failed"
  | "error";

type Sources = { google: SourceStatus; apple: SourceStatus };

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const RANGE_OPTIONS = [1, 7, 30, 90] as const;

type Range = (typeof RANGE_OPTIONS)[number];

const RANGE_SHORT: Record<Range, string> = {
  1: "Day",
  7: "Week",
  30: "Month",
  90: "3 mo",
};

// How the window gets named in a sentence — "Next 7 days" works, "Next 1
// days" does not, so Day gets its own wording throughout.
const RANGE_LABEL: Record<Range, string> = {
  1: "today",
  7: "7 days",
  30: "30 days",
  90: "90 days",
};

// The same window as a heading. "Next today" is not a phrase.
function rangeHeading(days: Range): string {
  return days === 1 ? "Today" : `Next ${RANGE_LABEL[days]}`;
}

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
  // Which half of the panel is showing. Reminders are event-scoped, so
  // they belong in the same panel as the events rather than competing for
  // a fourth column the board doesn't have.
  const [tab, setTab] = useState<"calendar" | "reminders">("calendar");

  // The window the card is showing. Whitelisted server-side too — this
  // value reaches a Google API call and an iCloud time-range query.
  const [days, setDays] = useState<Range>(7);
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
  // When the newest request last came back, so a refresh triggered by
  // tabbing back to the page can skip the round-trip if it just ran.
  const lastFetchedAt = useRef(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [sources, setSources] = useState<Sources | null>(null);
  // Google can list a calendar it isn't allowed to change — two separate
  // consents on one screen. Tracked so the panel can say so up front
  // rather than letting a Delete click discover it.
  const [googleCanWrite, setGoogleCanWrite] = useState(true);
  // Prep lives here rather than inside each row so it survives a refresh
  // and so the header can count what's outstanding across the week.
  const [prep, setPrep] = useState<Record<string, PrepItem[]>>({});
  const [generated, setGenerated] = useState<Set<string>>(new Set());
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [showAppleForm, setShowAppleForm] = useState(false);
  // The grid views (week/month) don't have room for a full row's worth
  // of prep checklist and edit controls, so clicking an event there just
  // selects it — the detail panel below renders the same EventRow the
  // agenda list uses, with everything it already knows how to do.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // A different window means a different grid — the previously selected
  // event may not even be on screen anymore.
  useEffect(() => {
    setSelectedKey(null);
  }, [days]);

  // The add form's open/prefill state lives here, not inside the form
  // itself, so a click on an empty slot in Week or Month can hand it a
  // date (and, in Week, a time) to start from — the same form the plain
  // "+ Add an event" link opens, just already pointed at what was
  // clicked.
  const [addOpen, setAddOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState<{
    date: string;
    startTime?: string;
    endTime?: string;
    allDay?: boolean;
  } | null>(null);

  // Both open in a modal now — dead center over the panel the instant
  // they're triggered, rather than appended below the grid where seeing
  // them meant scrolling past it. That means only one of "adding" and
  // "looking at an event" can be on screen at once, so each closes the
  // other.
  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setAddPrefill(null);
  }, []);

  const openAddAt = useCallback(
    (date: Date, time?: { hour: number; minute: number }) => {
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
      )}`;
      if (time) {
        const end = new Date(date);
        // A default hour-long slot — setHours rolls the minutes over
        // into the next hour on its own when they overflow past 60.
        end.setHours(time.hour, time.minute + 60, 0, 0);
        setAddPrefill({
          date: dateStr,
          startTime: `${pad(time.hour)}:${pad(time.minute)}`,
          endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
          allDay: false,
        });
      } else {
        setAddPrefill({ date: dateStr });
      }
      setSelectedKey(null);
      setAddOpen(true);
    },
    []
  );

  // The plain "add an event" trigger — the top-of-panel button and the
  // one on the collapsed preview — has no clicked date to start from, so
  // the form falls back to its own "today, an hour from now" defaults.
  const openAddBlank = useCallback(() => {
    setAddPrefill(null);
    setSelectedKey(null);
    setAddOpen(true);
  }, []);

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
        googleCanWrite?: boolean;
        prep: Record<string, PrepItem[]>;
        generated: string[];
        truncated?: boolean;
      };
      if (!isCurrent()) return;
      setEvents(body.events ?? []);
      setSources(body.sources);
      setGoogleCanWrite(body.googleCanWrite !== false);
      setPrep(body.prep ?? {});
      setGenerated(new Set(body.generated ?? []));
      setTruncated(Boolean(body.truncated));
      setStatus({ kind: "ready" });
      lastFetchedAt.current = Date.now();
      setUpdatedAt(new Date());
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

  // Nothing pushes changes at this panel. Google and iCloud are both
  // polled, so an event you moved in Calendar.app on your phone reaches
  // the board only when the board asks again — and it used to ask
  // exactly once, on mount. Anyone leaving a tab open saw a stale week
  // and no way to tell it was stale.
  //
  // So: ask again whenever the tab comes back to the foreground, and on
  // a slow timer while it's there. The timer is deliberately five
  // minutes rather than seconds — a CalDAV round trip across every
  // iCloud calendar is not cheap, and iCloud rate-limits. The focus
  // check is what actually makes it feel live, since a change made on
  // your phone is one you come back to the tab to look at.
  useEffect(() => {
    const POLL_MS = 5 * 60 * 1000;
    // A tab that's focused and blurred repeatedly shouldn't fire a
    // request each time.
    const MIN_GAP_MS = 30 * 1000;

    function refresh(force: boolean) {
      if (document.visibilityState !== "visible") return;
      if (!force && Date.now() - lastFetchedAt.current < MIN_GAP_MS) return;
      fetchEvents();
    }

    const onFocus = () => refresh(false);
    const timer = window.setInterval(() => refresh(true), POLL_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
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

  // Reads `events` rather than deriving the doomed set inside a
  // setEvents updater. Updaters have to be pure — React calls them twice
  // in development, and this one was firing setPrep and setSelectedKey
  // from inside itself each time.
  const handleDeleted = useCallback(
    (eventKey: string, seriesId?: string) => {
      const doomed = new Set(
        events
          .filter((e) =>
            seriesId ? e.recurringEventId === seriesId : e.key === eventKey
          )
          .map((e) => e.key)
      );
      doomed.add(eventKey);

      setEvents((current) => current.filter((e) => !doomed.has(e.key)));
      setPrep((prepState) => {
        const next = { ...prepState };
        doomed.forEach((key) => delete next[key]);
        return next;
      });
      setSelectedKey((current) =>
        current && doomed.has(current) ? null : current
      );
    },
    [events]
  );

  const disconnectApple = useCallback(async () => {
    await fetch("/api/apple/disconnect", { method: "POST" });
    fetchEvents();
  }, [fetchEvents]);

  const googleConnected = sources ? sources.google !== "not_connected" : false;
  const appleConnected = sources ? sources.apple !== "not_connected" : false;

  // Only counts prep for events still on screen — an item attached to an
  // event that has since passed shouldn't keep nagging from the header.
  const openPrepCount = events.reduce(
    (total, event) =>
      total + (prep[event.key] ?? []).filter((item) => !item.done).length,
    0
  );

  // One color per calendar name — built once here, from whatever is
  // actually on screen, so Week and Month (and the legend below) all
  // agree on which color belongs to which calendar.
  const calendarPalette = useMemo(() => buildCalendarPalette(events), [events]);
  const calendarLegend = useMemo(() => {
    const seen = new Map<string, CalendarColor>();
    for (const event of events) {
      const label = calendarLabel(event);
      const color = calendarPalette.get(label);
      if (!seen.has(label) && color) seen.set(label, color);
    }
    return Array.from(seen, ([label, color]) => ({ label, color })).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
  }, [events, calendarPalette]);

  // Toggling the same event closes its detail modal again — a second
  // click reads as "never mind" rather than a no-op. Opening one also
  // closes any pending add, so the two modals never compete.
  const toggleSelected = useCallback((key: string) => {
    setAddOpen(false);
    setAddPrefill(null);
    setSelectedKey((current) => (current === key ? null : key));
  }, []);

  const selectedEvent = selectedKey
    ? events.find((e) => e.key === selectedKey) ?? null
    : null;

  return (
    <section className="nx-board-panel">
      <header className="nx-board-head">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Calendar or reminders"
            className="flex shrink-0 items-baseline gap-3"
          >
            {(["calendar", "reminders"] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                aria-pressed={tab === name}
                className={`text-[17px] font-semibold tracking-tight transition-colors ${
                  tab === name
                    ? "text-ink"
                    : "text-ink-wisp hover:text-ink-muted"
                }`}
              >
                {name === "calendar" ? "Calendar" : "Reminders"}
                {/* The count rides on the tab you aren't looking at —
                    that's the whole reason to glance over. */}
                {name === "reminders" && openPrepCount > 0 && (
                  <span className="ml-1.5 rounded-md bg-surface-muted px-1.5 py-0.5 align-middle text-[12px] font-semibold leading-none text-ink-muted">
                    {openPrepCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {status.kind === "ready" && tab === "calendar" && (
              <PanelIconButton
                icon="refresh"
                label={
                  loadingEvents
                    ? "Refreshing…"
                    : updatedAt
                      ? `Refresh · updated ${updatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                      : "Refresh calendar"
                }
                onClick={fetchEvents}
                disabled={loadingEvents}
                spinning={loadingEvents}
              />
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
        <p className="truncate text-[13px] text-ink-ghost">
          {tab === "reminders"
            ? "Everything that needs doing"
            : openPrepCount > 0
              ? `${openPrepCount} to do first`
              : rangeHeading(days)}
        </p>
        <div
          className="mt-1 flex flex-wrap items-center justify-between gap-2"
          hidden={tab === "reminders"}
        >
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
                className="!px-2.5 !py-1 !text-[13px]"
              >
                {RANGE_SHORT[option]}
              </button>
            ))}
          </div>
        )}
        {/* Adding lives up here, not buried below the grid — the thing
            you reach for most from a calendar shouldn't need a scroll. */}
        {status.kind === "ready" && (googleConnected || appleConnected) && (
          <button
            type="button"
            onClick={openAddBlank}
            className="nx-btn-primary nx-btn-sm !gap-1.5 !px-3 !py-1.5"
          >
            <PanelIcon name="plus" size={14} />
            New
          </button>
        )}
        </div>
      </header>

      {tab === "reminders" ? (
        expanded ? (
          <RemindersSection />
        ) : (
          <p className="mt-3 text-sm text-ink-ghost">
            {openPrepCount === 0
              ? "Nothing outstanding."
              : `${openPrepCount} to do before your next events.`}
          </p>
        )
      ) : !expanded ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-sm text-ink-ghost">
            {events.length} event{events.length === 1 ? "" : "s"}{" "}
            {days === 1 ? "today" : `in the next ${RANGE_LABEL[days]}`}.
          </p>
          {status.kind === "ready" && (googleConnected || appleConnected) && (
            <button
              type="button"
              onClick={openAddBlank}
              aria-label="Add event"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-600 text-white transition-colors hover:bg-accent-700"
            >
              <span aria-hidden className="text-[15px] leading-none">
                +
              </span>
            </button>
          )}
        </div>
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

            {sources?.google === "auth_expired" && (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Your Google connection expired, so none of your Google
                events are showing.{" "}
                <a
                  href="/api/google/connect"
                  className="font-medium underline underline-offset-2"
                >
                  Reconnect Google
                </a>{" "}
                — nothing else needs redoing.
              </p>
            )}

            {sources?.google === "ok" && !googleCanWrite && (
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Google is showing your events but hasn&apos;t granted
                permission to change them — the consent screen lists
                reading and editing separately, and only reading was
                ticked. Edit and Delete will fail until that&apos;s
                granted.{" "}
                <a
                  href="/api/google/connect"
                  className="font-medium underline underline-offset-2"
                >
                  Reconnect and allow calendar changes
                </a>
                .
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
                {days === 1
                  ? "Nothing scheduled today."
                  : `Nothing scheduled in the next ${RANGE_LABEL[days]}.`}
              </p>
            ) : days === 1 || days === 7 ? (
              <>
                {/* Named once per calendar, not per event — this is what
                    tells the reader "sky = Work, violet = Family" rather
                    than making them guess from context. Only worth the
                    space once there's more than one calendar to tell
                    apart. */}
                {calendarLegend.length > 1 && (
                  <CalendarLegend legend={calendarLegend} />
                )}
                {/* Week: a real hour grid, the way a calendar app shows
                    "this week" — time and duration as position, not
                    text. */}
                <WeekView
                  dayCount={days}
                  events={events}
                  selectedKey={selectedKey}
                  onSelect={toggleSelected}
                  onAddSlot={
                    googleConnected || appleConnected ? openAddAt : undefined
                  }
                  palette={calendarPalette}
                />
              </>
            ) : days === 30 ? (
              <>
                {calendarLegend.length > 1 && (
                  <CalendarLegend legend={calendarLegend} />
                )}
                {/* Month: a box per day. Thirty days as a scrolling list
                    of headings stops being scannable well before day
                    thirty. */}
                <MonthView
                  events={events}
                  windowDays={days}
                  selectedKey={selectedKey}
                  onSelect={toggleSelected}
                  onAddSlot={
                    googleConnected || appleConnected
                      ? (date) => openAddAt(date)
                      : undefined
                  }
                  palette={calendarPalette}
                />
              </>
            ) : (
              // 3 months stays an agenda — a grid that wide would be
              // mostly empty cells, and this is the range for scanning
              // ahead rather than seeing a week or month at a glance.
              // It's a dense one, though: full event rows (prep
              // checklist, edit controls and all) turned ninety days
              // into something you scrolled rather than scanned, so the
              // rows here are one line each and open the same detail
              // modal the grids do.
              <>
                {calendarLegend.length > 1 && (
                  <CalendarLegend legend={calendarLegend} />
                )}
                <AgendaView
                  events={events}
                  selectedKey={selectedKey}
                  onSelect={toggleSelected}
                  palette={calendarPalette}
                />
              </>
            )}

            {/* For the 3-month agenda, "add" is still a plain link at
                the bottom of the list — there's no grid to hand a
                clicked date to, so the header/preview button and this
                link both just open the same blank modal. */}
            {days === 90 && (googleConnected || appleConnected) && (
              <button
                type="button"
                onClick={openAddBlank}
                className="mt-3 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
              >
                + Add an event
              </button>
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
                className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
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
                className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-800"
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

      {/* Add and "here's what's on this event" are mutually exclusive
          (each closes the other on open — see toggleSelected/openAddAt),
          so one modal slot covers both. Rendered fixed to the viewport,
          so it shows up centered immediately regardless of where the
          panel is scrolled to. */}
      {addOpen && (googleConnected || appleConnected) && (
        <CalendarModal title="Add an event" onClose={closeAdd}>
          <AddEventForm
            open={addOpen}
            onOpenChange={(next) => {
              if (!next) closeAdd();
            }}
            onCreated={fetchEvents}
            initialDate={addPrefill?.date}
            initialStartTime={addPrefill?.startTime}
            initialEndTime={addPrefill?.endTime}
            initialAllDay={addPrefill?.allDay}
          />
        </CalendarModal>
      )}

      {!addOpen && selectedEvent && (
        <CalendarModal
          title={selectedEvent.summary}
          onClose={() => setSelectedKey(null)}
        >
          <ul className="flex flex-col gap-2">
            <EventRow
              key={selectedEvent.key}
              event={selectedEvent}
              items={prep[selectedEvent.key] ?? []}
              generated={generated.has(selectedEvent.key)}
              onItemsChange={handleItemsChange}
              onGenerated={handleGenerated}
              onDeleted={handleDeleted}
              onUpdated={handleUpdated}
              color={colorFor(selectedEvent, calendarPalette)}
              showCalendarName={googleConnected && appleConnected}
            />
          </ul>
        </CalendarModal>
      )}
    </section>
  );
}

function CalendarLegend({
  legend,
}: {
  legend: { label: string; color: CalendarColor }[];
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {legend.map(({ label, color }) => (
        <span key={label} className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`} />
          {label}
        </span>
      ))}
    </div>
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
