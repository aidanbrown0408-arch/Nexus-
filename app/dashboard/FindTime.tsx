"use client";

import { useState } from "react";
import type { Guest } from "./GuestPicker";

// "Find 30 minutes with Sarah this week."
//
// Deliberately stops short of booking. It fills in the date and time on
// the form above it, and the user still presses Add — so the thing that
// reaches other people goes through the same explicit confirm as any
// other event. A one-click "hold this" that quietly landed on someone's
// calendar would be a different promise than this app makes anywhere
// else.

type Slot = { start: string; end: string };

type Props = {
  guests: Guest[];
  onPick: (slot: Slot) => void;
};

type State =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "results"; slots: Slot[]; unknownGuests: string[] }
  | { kind: "error"; message: string };

const DURATIONS = [15, 30, 45, 60, 90];

function formatSlot(slot: Slot): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const day = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time(start)} – ${time(end)}`;
}

export default function FindTime({ guests, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(30);
  const [daysAhead, setDaysAhead] = useState(7);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function search() {
    setState({ kind: "searching" });
    try {
      const res = await fetch("/api/calendar/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          durationMinutes: duration,
          daysAhead,
          guestEmails: guests.map((g) => g.email),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          message: body?.error ?? "Couldn't work out when you're free.",
        });
        return;
      }
      setState({
        kind: "results",
        slots: (body.slots ?? []) as Slot[],
        unknownGuests: (body.unknownGuests ?? []) as string[],
      });
    } catch {
      setState({ kind: "error", message: "Couldn't reach Nexus. Try again." });
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700"
      >
        Find a time for me
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
        <span>Find</span>
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
        >
          {DURATIONS.map((d) => (
            <option key={d} value={d}>
              {d} min
            </option>
          ))}
        </select>
        <span>within the next</span>
        <select
          value={daysAhead}
          onChange={(e) => setDaysAhead(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
        >
          <option value={1}>day</option>
          <option value={3}>3 days</option>
          <option value={7}>week</option>
          <option value={14}>2 weeks</option>
        </select>
        <button
          type="button"
          onClick={search}
          disabled={state.kind === "searching"}
          className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60"
        >
          {state.kind === "searching" ? "Looking…" : "Search"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setState({ kind: "idle" });
          }}
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      {guests.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          Checking your calendars and {guests.length} guest
          {guests.length === 1 ? "" : "s"}.
        </p>
      )}

      {state.kind === "error" && (
        <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {state.message}
        </p>
      )}

      {state.kind === "results" && (
        <div className="mt-2">
          {/* Google returns nothing for a calendar it can't see, which
              reads identically to "free". Saying so is the difference
              between a proposal and a guess. */}
          {state.unknownGuests.length > 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
              Couldn&apos;t see {state.unknownGuests.join(", ")}&apos;s
              calendar, so these times only account for yours.
            </p>
          )}

          {state.slots.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Nothing free that long in that window. Try a shorter meeting or
              a wider range.
            </p>
          ) : (
            <>
              <p className="mb-1.5 text-xs text-neutral-500">
                Pick one to fill in the form above — nothing is booked until
                you press Add.
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {state.slots.map((slot) => (
                  <li key={slot.start}>
                    <button
                      type="button"
                      onClick={() => onPick(slot)}
                      className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-900 transition-colors hover:bg-indigo-100"
                    >
                      {formatSlot(slot)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
