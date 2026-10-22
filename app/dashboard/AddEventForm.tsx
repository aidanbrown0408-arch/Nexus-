"use client";

import { useEffect, useRef, useState } from "react";
import GuestPicker, { type Guest } from "./GuestPicker";
import FindTime from "./FindTime";
import RepeatPicker from "./RepeatPicker";
import { describeRecurrence, type Recurrence } from "@/lib/recurrence";
import { toDayKey } from "@/lib/event-days";

// Putting something on the calendar.
//
// Collapsed to a single link until asked for — the Upcoming card is for
// reading what's coming, and a permanent form at the top of it would make
// the common case worse to serve the rarer one. Open/closed is owned by
// the parent rather than kept locally, though: clicking an empty slot in
// the week or month grid needs to open this same form pre-filled with
// the date (and time) that was clicked, and a form that only knew how to
// open itself with today's defaults couldn't do that.
//
// Guests are the one field here that reaches other people, so it stays
// empty by default and the button says plainly when invites will go out.
//
// The calendar picker starts unselected on purpose and the form won't
// submit without it. Defaulting to a primary calendar would be one less
// click and a steady trickle of events filed somewhere the user didn't
// mean — and once an event is on the wrong shared calendar, everyone
// with access has already seen it.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  // What to prefill the form with when it opens — set by a grid click.
  // Left undefined for the plain "+ Add an event" link, which falls back
  // to "today, an hour from now".
  initialDate?: string;
  initialStartTime?: string;
  initialEndTime?: string;
  initialAllDay?: boolean;
};

type Target = {
  id: string;
  name: string;
  source: "google" | "apple";
  primary: boolean;
};

// The form's date field is a local calendar date, so it has to be built
// from local parts. `toISOString()` converts to UTC first, which from
// early evening onwards in the Americas returns *tomorrow* — so opening
// "New event" at 9pm pre-filled the next day while the time field,
// built from `toTimeString()`, stayed local. The two disagreed by a day.
// The next full hour, for an hour. The date comes from the start rather
// than from "today", and the end never wraps past midnight: at 10pm the
// old defaults were 11pm–12am on the same date (rejected as ending before
// it starts), and after 11pm they were midnight of the day just begun.
function defaultSlot(now: Date = new Date()): {
  date: string;
  start: string;
  end: string;
} {
  const start = new Date(now);
  start.setHours(start.getHours() + 1, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
  const sameDay = toDayKey(end) === toDayKey(start);
  return {
    date: toDayKey(start),
    start: hhmm(start),
    end: sameDay ? hhmm(end) : "23:59",
  };
}

export default function AddEventForm({
  open,
  onOpenChange,
  onCreated,
  initialDate,
  initialStartTime,
  initialEndTime,
  initialAllDay,
}: Props) {
  const [summary, setSummary] = useState("");
  const [date, setDate] = useState(() => defaultSlot().date);
  const [startTime, setStartTime] = useState(() => defaultSlot().start);
  const [endTime, setEndTime] = useState(() => defaultSlot().end);
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [guests, setGuests] = useState<Guest[]>([]);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  // Holds "source:id" rather than the bare id — a CalDAV URL and a Google
  // calendar id are both opaque strings, so the source has to travel
  // with the choice rather than being guessed from its shape.
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [created, setCreated] = useState<{
    summary: string;
    calendarName: string;
    repeats: string | null;
    actionId: string | null;
    htmlLink: string | null;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const selected = targets.find((t) => `${t.source}:${t.id}` === target);
  // iCloud invitations mean iTIP scheduling, which the API refuses. Say
  // so while they're picking rather than on submit.
  const guestsUnsupported = selected?.source === "apple" && guests.length > 0;

  // Every time the form opens, load its date/time from whatever the
  // caller asked for — a grid click — or fall back to the old "today, an
  // hour from now" defaults for the plain link. Runs on `open` alone:
  // the initial* props are only meaningful at the moment of opening, and
  // re-running this whenever the parent re-renders with a new (but
  // equivalent) prefill object would stomp on whatever the person is
  // mid-typing.
  useEffect(() => {
    if (!open) return;
    setSummary("");
    setLocation("");
    setGuests([]);
    setRecurrence(null);
    setError(null);
    setNeedsReconnect(false);
    const slot = defaultSlot();
    setDate(initialDate ?? slot.date);
    setAllDay(initialAllDay ?? false);
    setStartTime(initialStartTime ?? slot.start);
    setEndTime(initialEndTime ?? slot.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetched when the form opens rather than on mount — most dashboard
  // visits never add an event, and this is two network calls against two
  // services.
  //
  // The "have we already asked" flag is a ref, not state, and state the
  // effect writes is kept out of the dependency array. An earlier version
  // depended on `loadingTargets` and set it in the same effect: React
  // then tore the effect down the moment the fetch began, which flipped
  // the `cancelled` flag and made every branch that would have ended the
  // loading state unreachable. It span forever on "Loading calendars…".
  const requested = useRef(false);

  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;

    let cancelled = false;

    (async () => {
      setLoadingTargets(true);
      try {
        const res = await fetch("/api/calendar/targets", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error ?? "Couldn't load your calendars");
        }
        if (!cancelled) setTargets(body.calendars ?? []);
      } catch (err) {
        if (!cancelled) {
          // Let them try again — a ref that stays true after a failure
          // would make "reopen the form" do nothing.
          requested.current = false;
          setError(
            err instanceof Error ? err.message : "Couldn't load your calendars"
          );
        }
      } finally {
        if (!cancelled) setLoadingTargets(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.trim() || !selected || guestsUnsupported) return;

    setSaving(true);
    setError(null);
    setNeedsReconnect(false);

    // All-day events carry bare dates; timed ones need the local date and
    // time joined so the browser's own zone is what gets sent.
    const start = allDay ? date : `${date}T${startTime}`;
    const end = allDay ? date : `${date}T${endTime}`;

    try {
      const res = await fetch("/api/calendar/events/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: summary.trim(),
          start,
          end,
          allDay,
          location: location.trim() || undefined,
          attendees: guests.map((g) => g.email),
          calendarId: selected.id,
          source: selected.source,
          recurrence: recurrence ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body?.error ?? "Couldn't add that event.");
        setNeedsReconnect(body?.code === "scope_missing");
        return;
      }

      // Left open on success, showing the confirmation below — closing
      // the instant the request resolves would yank the modal away
      // before anyone could read "added to Work" or reach for Undo.
      setCreated({
        summary: summary.trim(),
        calendarName: selected.name,
        repeats: recurrence ? describeRecurrence(recurrence) : null,
        actionId: body.actionId ?? null,
        htmlLink: body.event?.htmlLink ?? null,
      });
      onCreated();
    } catch {
      setError("Couldn't reach Nexus. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function undo(actionId: string) {
    setUndoing(true);
    try {
      await fetch(`/api/actions/${actionId}/undo`, { method: "POST" });
      setCreated(null);
      onCreated();
    } finally {
      setUndoing(false);
    }
  }

  if (created) {
    return (
      <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <div className="flex flex-wrap items-center gap-2">
          {/* Naming the calendar is the confirmation that matters — it's
              the one thing the user can't see from the Upcoming list,
              and it syncs to their phone from here. */}
          <span>
            “{created.summary}” is on {created.calendarName}
            {created.repeats ? ` — ${created.repeats.toLowerCase()}` : ""}.
          </span>
          {created.htmlLink && (
            <a
              href={created.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium underline"
            >
              Open it
            </a>
          )}
          {created.actionId && (
            <button
              type="button"
              onClick={() => undo(created.actionId!)}
              disabled={undoing}
              className="text-xs font-medium underline disabled:opacity-60"
            >
              {undoing ? "Removing…" : "Undo"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              onOpenChange(false);
            }}
            className="ml-auto text-xs text-emerald-700"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="mt-3 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
      >
        + Add an event
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded-xl border border-line bg-surface-soft p-3"
    >
      <input
        type="text"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="What is it?"
        maxLength={200}
        autoFocus
        className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none"
        />
        {!allDay && (
          <>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none"
            />
            <span className="text-sm text-neutral-500">to</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none"
            />
          </>
        )}
        <label className="flex items-center gap-1.5 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All day
        </label>
      </div>

      {/* Directly under the date, since the rule is about when this
          recurs rather than anything to do with where or who. */}
      <RepeatPicker
        startDate={date}
        value={recurrence}
        onChange={setRecurrence}
      />

      {/* Sits under the time fields because that's what it fills in.
          Hidden for all-day events, which have no time to find. */}
      {!allDay && (
        <FindTime
          guests={guests}
          onPick={(slot) => {
            const start = new Date(slot.start);
            const end = new Date(slot.end);
            // Local, not ISO — these feed date and time inputs, which
            // are always in the browser's own zone.
            const pad = (n: number) => String(n).padStart(2, "0");
            setDate(
              `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(
                start.getDate()
              )}`
            );
            setStartTime(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
            setEndTime(`${pad(end.getHours())}:${pad(end.getMinutes())}`);
          }}
        />
      )}

      <input
        type="text"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        placeholder="Where? (optional)"
        className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />

      <GuestPicker
        guests={guests}
        onChange={setGuests}
        disabled={selected?.source === "apple"}
        disabledHint="Guests aren't supported on iCloud calendars"
      />

      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">
          {loadingTargets ? "Loading calendars…" : "Which calendar?"}
        </option>
        {/* Grouped by service so it's obvious which device an event will
            show up on, and so two calendars sharing a name (a "Personal"
            on each) can be told apart. */}
        {(["google", "apple"] as const).map((source) => {
          const group = targets.filter((t) => t.source === source);
          if (!group.length) return null;
          return (
            <optgroup
              key={source}
              label={source === "google" ? "Google Calendar" : "iCloud"}
            >
              {group.map((t) => (
                <option key={`${t.source}:${t.id}`} value={`${t.source}:${t.id}`}>
                  {t.name}
                  {t.primary ? " (default)" : ""}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      {!loadingTargets && targets.length === 0 && (
        <p className="mt-1 text-xs text-neutral-500">
          No calendars you can write to. Reconnect Google to grant event
          access, or connect iCloud.
        </p>
      )}

      {guestsUnsupported && (
        <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          Nexus can&apos;t send invitations through iCloud. Pick a Google
          calendar, or clear the guest list.
        </p>
      )}

      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {error}{" "}
          {needsReconnect && (
            <a href="/api/google/connect" className="font-medium underline">
              Reconnect Google
            </a>
          )}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={saving || !summary.trim() || !selected || guestsUnsupported}
          className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving
            ? "Adding…"
            : !selected
              ? "Pick a calendar"
              : guests.length
                ? `Add and invite ${guests.length}`
                : recurrence
                ? `Add repeating to ${selected.name}`
                : `Add to ${selected.name}`}
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-surface-soft"
        >
          Cancel
        </button>
        {guests.length > 0 && !guestsUnsupported && (
          <span className="text-xs text-neutral-500">
            Invites go out immediately.
          </span>
        )}
      </div>
    </form>
  );
}
