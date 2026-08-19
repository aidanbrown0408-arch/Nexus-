"use client";

import { useState } from "react";
import {
  describeRecurrence,
  weekdayOf,
  MAX_COUNT,
  MAX_INTERVAL,
  type Frequency,
  type Recurrence,
  type Weekday,
} from "@/lib/recurrence";

// Setting up a repeat.
//
// Collapsed to a dropdown of presets, because "every week" covers most of
// what anyone wants and a full RRULE builder in front of that would make
// the common case worse. Custom opens the rest.
//
// Everything is echoed back in plain English before the event is created.
// A rule that fires 104 times over two years is a thing someone should be
// able to read, not decode from FREQ=WEEKLY;COUNT=104.

type Props = {
  // The event's start date, so "weekly" can default to the right weekday
  // and the preset labels can name it.
  startDate: string;
  value: Recurrence | null;
  onChange: (recurrence: Recurrence | null) => void;
};

const WEEKDAYS: { code: Weekday; label: string }[] = [
  { code: "MO", label: "M" },
  { code: "TU", label: "T" },
  { code: "WE", label: "W" },
  { code: "TH", label: "T" },
  { code: "FR", label: "F" },
  { code: "SA", label: "S" },
  { code: "SU", label: "S" },
];

type Preset = "none" | "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | "custom";

function startDay(startDate: string): Weekday {
  const d = new Date(`${startDate}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "MO" : weekdayOf(d);
}

export default function RepeatPicker({ startDate, value, onChange }: Props) {
  const [preset, setPreset] = useState<Preset>("none");
  const [endMode, setEndMode] = useState<"never" | "count" | "until">("never");

  // Custom-panel state. Kept separate from `value` so fiddling with the
  // controls doesn't emit half-built rules on every keystroke.
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [interval, setInterval] = useState(1);
  const [byDay, setByDay] = useState<Weekday[]>([]);
  const [count, setCount] = useState(10);
  const [until, setUntil] = useState("");

  function emitPreset(next: Preset) {
    setPreset(next);
    setEndMode("never");

    const day = startDay(startDate);

    switch (next) {
      case "none":
        onChange(null);
        return;
      case "daily":
        onChange({ frequency: "daily", interval: 1 });
        return;
      case "weekly":
        onChange({ frequency: "weekly", interval: 1, byDay: [day] });
        return;
      case "biweekly":
        onChange({ frequency: "weekly", interval: 2, byDay: [day] });
        return;
      case "monthly":
        onChange({ frequency: "monthly", interval: 1 });
        return;
      case "yearly":
        onChange({ frequency: "yearly", interval: 1 });
        return;
      case "custom":
        setFrequency("weekly");
        setInterval(1);
        setByDay([day]);
        onChange({ frequency: "weekly", interval: 1, byDay: [day] });
        return;
    }
  }

  // Rebuild the whole rule from the custom panel. Called on every change
  // there so the summary underneath always matches the controls.
  function emitCustom(patch: Partial<Recurrence> & { endMode?: typeof endMode }) {
    const mode = patch.endMode ?? endMode;
    const next: Recurrence = {
      frequency: patch.frequency ?? frequency,
      interval: patch.interval ?? interval,
    };

    const days = patch.byDay ?? byDay;
    if (next.frequency === "weekly" && days.length) next.byDay = days;

    if (mode === "count") next.count = patch.count ?? count;
    else if (mode === "until") {
      const value = patch.until ?? until;
      if (value) next.until = value;
    }

    onChange(next);
  }

  function toggleDay(day: Weekday) {
    // Never let the last day be unticked — a weekly rule with no days is
    // not a rule, and silently falling back to the start day would be a
    // different rule than the one on screen.
    const next = byDay.includes(day)
      ? byDay.filter((d) => d !== day)
      : [...byDay, day];
    if (!next.length) return;
    setByDay(next);
    emitCustom({ byDay: next });
  }

  return (
    <div className="mt-2">
      <select
        value={preset}
        onChange={(e) => emitPreset(e.target.value as Preset)}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="none">Doesn&apos;t repeat</option>
        <option value="daily">Every day</option>
        <option value="weekly">Every week</option>
        <option value="biweekly">Every 2 weeks</option>
        <option value="monthly">Every month</option>
        <option value="yearly">Every year</option>
        <option value="custom">Custom…</option>
      </select>

      {preset === "custom" && (
        <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-700">
            <span>Every</span>
            <input
              type="number"
              min={1}
              max={MAX_INTERVAL}
              value={interval}
              onChange={(e) => {
                const n = Math.max(
                  1,
                  Math.min(Number(e.target.value) || 1, MAX_INTERVAL)
                );
                setInterval(n);
                emitCustom({ interval: n });
              }}
              className="w-14 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
            />
            <select
              value={frequency}
              onChange={(e) => {
                const f = e.target.value as Frequency;
                setFrequency(f);
                emitCustom({ frequency: f });
              }}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
            >
              <option value="daily">days</option>
              <option value="weekly">weeks</option>
              <option value="monthly">months</option>
              <option value="yearly">years</option>
            </select>
          </div>

          {frequency === "weekly" && (
            <div className="mt-2 flex flex-wrap gap-1">
              {WEEKDAYS.map((d, i) => (
                <button
                  key={`${d.code}-${i}`}
                  type="button"
                  onClick={() => toggleDay(d.code)}
                  aria-pressed={byDay.includes(d.code)}
                  className={`h-7 w-7 rounded-full text-xs font-medium transition-colors ${
                    byDay.includes(d.code)
                      ? "bg-indigo-600 text-white"
                      : "border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-700">
            <span>Ends</span>
            <select
              value={endMode}
              onChange={(e) => {
                const mode = e.target.value as typeof endMode;
                setEndMode(mode);
                emitCustom({ endMode: mode });
              }}
              className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
            >
              <option value="never">never</option>
              <option value="count">after…</option>
              <option value="until">on…</option>
            </select>

            {endMode === "count" && (
              <>
                <input
                  type="number"
                  min={1}
                  max={MAX_COUNT}
                  value={count}
                  onChange={(e) => {
                    const n = Math.max(
                      1,
                      Math.min(Number(e.target.value) || 1, MAX_COUNT)
                    );
                    setCount(n);
                    emitCustom({ count: n });
                  }}
                  className="w-16 rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
                />
                <span>times</span>
              </>
            )}

            {endMode === "until" && (
              <input
                type="date"
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  emitCustom({ until: e.target.value });
                }}
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none"
              />
            )}
          </div>
        </div>
      )}

      {/* The rule read back as a sentence. This is the check that
          catches "every 2 days for 730 times" before it's created. */}
      {value && (
        <p className="mt-1.5 text-xs text-indigo-700">
          {describeRecurrence(value)}
        </p>
      )}
    </div>
  );
}
