"use client";

import { useEffect, useMemo, useRef } from "react";
import type { EventSummary } from "@/lib/events";
import { colorFor, type CalendarColor } from "./calendarColors";
import { isPast } from "@/lib/calendar-window";
import {
  addDays,
  bucketByDay,
  startOfDay,
  toDayKey,
  type DayEntry,
} from "@/lib/event-days";

// The time grid: N day columns over an hour scale, the way every
// calendar app renders a day or a week. Agenda-style lists are fine for
// scanning, but "day" and "week" only read as a calendar once
// time-of-day and duration are visible as position and height rather
// than as a line of text.
//
// One component serves both ranges — Day is the same grid with a single
// column, which is why it gets the same all-day band, the same now-line,
// and the same click-empty-space-to-add. It just has room to say more
// inside each block.

const HOUR_HEIGHT = 48; // px per hour row
const MIN_BLOCK_HEIGHT = 20; // a 15-minute meeting still needs a click target
// The grid scrolls rather than growing without bound: a day with a 6am
// flight and an 11pm dinner is eighteen hours tall, which would push the
// panel's own footer somewhere off the bottom of the board.
const MAX_GRID_HEIGHT = 460;
// Where the scroll lands on open — a little above the current hour, so
// "now" sits near the top of the visible slice with the rest of the day
// below it rather than pinned to the very edge.
const SCROLL_LEAD_PX = 80;

const MINUTES_PER_DAY = 24 * 60;

// Minutes from the top of *this* column's day. Using getHours() instead
// meant a block that crossed midnight had an "end" numerically before its
// start, so a red-eye rendered as a 30-minute stub on the evening it left
// and nothing at all on the morning it landed.
function minutesIn(iso: string, dayStart: Date, fallback: number): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  return (d.getTime() - dayStart.getTime()) / 60000;
}

// The slice of an event that belongs to one column, clamped to that
// day's own midnight-to-midnight window.
function clampToDay(
  event: EventSummary,
  dayStart: Date
): { start: number; end: number } {
  const rawStart = minutesIn(event.start, dayStart, 0);
  const rawEnd = minutesIn(event.end, dayStart, rawStart + 30);
  const start = Math.min(Math.max(rawStart, 0), MINUTES_PER_DAY);
  let end = Math.min(Math.max(rawEnd, 0), MINUTES_PER_DAY);
  if (end <= start) end = Math.min(MINUTES_PER_DAY, start + 30);
  return { start, end };
}

function formatHourLabel(h: number): string {
  if (h === 24) return "12 AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${h < 12 ? "AM" : "PM"}`;
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(" ", "");
}

type Positioned = {
  event: EventSummary;
  top: number;
  height: number;
  left: number;
  width: number;
};

// Interval partitioning: each event goes in the first column whose most
// recent occupant has already ended. Overlapping meetings end up side by
// side instead of stacked unreadably on top of one another.
function layoutDay(
  dayEvents: EventSummary[],
  startHour: number,
  dayStart: Date
): Positioned[] {
  const bounds = dayEvents.map((event) => ({
    event,
    ...clampToDay(event, dayStart),
  }));

  const sorted = [...bounds].sort((a, b) => {
    const byStart = a.start - b.start;
    if (byStart !== 0) return byStart;
    return b.end - a.end;
  });

  const columns: { end: number }[] = [];
  const placements = sorted.map(({ event, start, end }) => {
    let col = columns.findIndex((c) => c.end <= start);
    if (col === -1) {
      col = columns.length;
      columns.push({ end });
    } else {
      columns[col].end = end;
    }
    return { event, start, end, col };
  });

  const totalCols = Math.max(1, columns.length);

  return placements.map(({ event, start, end, col }) => ({
    event,
    top: ((start - startHour * 60) / 60) * HOUR_HEIGHT,
    height: Math.max(MIN_BLOCK_HEIGHT, ((end - start) / 60) * HOUR_HEIGHT),
    left: (col / totalCols) * 100,
    width: 100 / totalCols,
  }));
}

export default function WeekView({
  events,
  selectedKey,
  onSelect,
  onAddSlot,
  palette,
  dayCount = 7,
}: {
  events: EventSummary[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  // Clicking empty space in the grid — not an event — opens the add
  // form pre-filled with that day and that half-hour. Optional so this
  // view still works read-only.
  onAddSlot?: (date: Date, time?: { hour: number; minute: number }) => void;
  // One color per calendar (Work, Family, iCloud, …), built once by the
  // parent so Day, Week and Month agree on which calendar is which color.
  palette?: Map<string, CalendarColor>;
  // 1 for the Day view, 7 for the Week. Everything else follows from it.
  dayCount?: number;
}) {
  const today = startOfDay(new Date());
  const single = dayCount === 1;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(today, i)),
    // `today` is a fresh Date each render; its day key is what actually
    // matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayCount, toDayKey(today)]
  );

  // Every day an event covers, not just the day it starts — see
  // event-days.ts. A trip that began last week now appears on the days of
  // it that fall inside this window, instead of nowhere at all.
  const byDate = bucketByDay(events);

  const allDayByDate = new Map<string, DayEntry[]>();
  const timedByDate = new Map<string, EventSummary[]>();
  for (const day of days) {
    const key = toDayKey(day);
    const list = byDate.get(key) ?? [];
    allDayByDate.set(
      key,
      list.filter((entry) => entry.event.allDay)
    );
    timedByDate.set(
      key,
      list.filter((entry) => !entry.event.allDay).map((entry) => entry.event)
    );
  }

  // The visible hour band. Starts at a working-day default and stretches
  // only as far as the events on screen actually reach — and it measures
  // each event by the slice that falls in *this* column, so one red-eye
  // no longer forces every column to render a full midnight-to-midnight
  // scale with fourteen empty hours in it.
  let startHour = 8;
  let endHour = 20;
  for (const day of days) {
    for (const event of timedByDate.get(toDayKey(day)) ?? []) {
      const { start, end } = clampToDay(event, day);
      startHour = Math.min(startHour, Math.floor(start / 60));
      endHour = Math.max(endHour, Math.ceil(end / 60));
    }
  }
  startHour = Math.max(0, Math.min(startHour, 23));
  endHour = Math.min(24, Math.max(endHour, startHour + 1));
  const hours = Array.from(
    { length: endHour - startHour },
    (_, i) => startHour + i
  );
  const totalHeight = (endHour - startHour) * HOUR_HEIGHT;

  const hasAllDay = Array.from(allDayByDate.values()).some(
    (list) => list.length > 0
  );

  const nowOffset = (() => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < startHour * 60 || minutes > endHour * 60) return null;
    return ((minutes - startHour * 60) / 60) * HOUR_HEIGHT;
  })();

  // Open on the current hour rather than on 8am — the part of the day
  // you're about to live is the part worth showing first.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || nowOffset === null) return;
    el.scrollTop = Math.max(0, nowOffset - SCROLL_LEAD_PX);
    // Only on the first paint of a given range — re-running on every
    // refresh would yank the grid back while someone is reading it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayCount]);

  function chipClasses(event: EventSummary, selected: boolean): string {
    const c = colorFor(event, palette);
    return `w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] font-medium transition-colors ${c.border} ${c.bg} ${c.text} hover:opacity-90 ${
      selected ? `ring-2 ${c.ring} ring-offset-1` : ""
    }`;
  }

  const gutter = "w-12 shrink-0 sm:w-14";

  return (
    <div className="overflow-hidden rounded-card border border-line-soft bg-white">
      {/* Day headers — today's date lifted in accent, matching the rest
          of the board's convention for "this is the one that matters".
          Weekends get a faint tint so the shape of the week is legible
          before any event is read. */}
      <div className="flex border-b border-line-soft">
        <div className={gutter} />
        {days.map((d) => {
          const isToday = toDayKey(d) === toDayKey(today);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div
              key={toDayKey(d)}
              className={`min-w-0 flex-1 border-l border-line-soft px-1 py-2 ${
                single ? "text-left ps-3" : "text-center"
              } ${weekend && !single ? "bg-surface-soft/40" : ""}`}
            >
              {single ? (
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-[15px] font-semibold ${
                      isToday ? "text-accent-600" : "text-ink"
                    }`}
                  >
                    {d.toLocaleDateString(undefined, {
                      weekday: "long",
                    })}
                  </span>
                  <span className="nx-label">
                    {d.toLocaleDateString(undefined, {
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
              ) : (
                <>
                  <div className="nx-label">
                    {d.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div
                    className={`mt-0.5 text-[15px] font-semibold ${
                      isToday ? "text-accent-600" : "text-ink"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="flex border-b border-line-soft bg-surface-soft/60">
          <div className={`${gutter} px-1 py-1.5 text-right`}>
            <span className="nx-label">All day</span>
          </div>
          {days.map((d) => {
            const key = toDayKey(d);
            const list = allDayByDate.get(key) ?? [];
            return (
              <div
                key={key}
                onClick={() => onAddSlot?.(d)}
                className={`flex min-w-0 flex-1 flex-col gap-1 border-l border-line-soft p-1 ${
                  onAddSlot ? "cursor-pointer hover:bg-surface-soft/70" : ""
                }`}
              >
                {list.map(({ event, first, last }) => (
                  <button
                    key={event.key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(event.key);
                    }}
                    className={chipClasses(event, selectedKey === event.key)}
                    // Named on every day it spans. The middle days of a
                    // trip used to be blank, which read as "nothing
                    // scheduled" rather than "still travelling".
                    title={
                      first ? event.summary : `${event.summary} (continues)`
                    }
                  >
                    {!first && (
                      <span aria-hidden className="mr-1 opacity-60">
                        ↳
                      </span>
                    )}
                    {event.summary}
                    {first && !last && (
                      <span aria-hidden className="ml-1 opacity-60">
                        →
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* The hour grid. Each day column is a relatively-positioned box of
          fixed height; event blocks are absolutely placed inside it by
          minutes-since-startHour, so a 30-minute call and a 2-hour block
          read as different sizes the way they do on paper. */}
      <div
        ref={scrollRef}
        className="flex overflow-y-auto overflow-x-auto"
        style={{ maxHeight: MAX_GRID_HEIGHT }}
      >
        <div
          className={`relative ${gutter} bg-white`}
          style={{ height: totalHeight }}
        >
          {hours.map((h) => (
            <div
              key={h}
              className="absolute right-1.5 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] text-ink-ghost"
              style={{ top: (h - startHour) * HOUR_HEIGHT }}
            >
              {formatHourLabel(h)}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const key = toDayKey(d);
          const positioned = layoutDay(timedByDate.get(key) ?? [], startHour, d);
          const isToday = toDayKey(d) === toDayKey(today);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div
              key={key}
              onClick={(e) => {
                if (!onAddSlot) return;
                // Where in the column the click landed becomes the
                // event's start time, snapped to the nearest half hour —
                // clicking 2:40 on the grid means "something around 2:30
                // or 3", not an exact-to-the-minute meeting.
                const rect = e.currentTarget.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                const minutesFromTop = (offsetY / HOUR_HEIGHT) * 60;
                const snapped = Math.round(minutesFromTop / 30) * 30;
                const totalMinutes = Math.min(
                  Math.max(startHour * 60 + snapped, startHour * 60),
                  endHour * 60 - 30
                );
                onAddSlot(d, {
                  hour: Math.floor(totalMinutes / 60),
                  minute: totalMinutes % 60,
                });
              }}
              className={`relative flex-1 border-l border-line-soft ${
                single ? "min-w-0" : "min-w-[92px]"
              } ${weekend && !single ? "bg-surface-soft/30" : ""} ${
                isToday && !single ? "bg-accent-50/30" : ""
              } ${onAddSlot ? "cursor-pointer" : ""}`}
              style={{ height: totalHeight }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 border-t border-line-soft/60"
                  style={{ top: (h - startHour) * HOUR_HEIGHT }}
                />
              ))}
              {isToday && nowOffset !== null && (
                <div
                  className="absolute inset-x-0 z-10 flex items-center"
                  style={{ top: nowOffset }}
                  aria-hidden
                >
                  <span className="-ml-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                  <span className="h-px flex-1 bg-danger" />
                </div>
              )}
              {positioned.map((p) => {
                const c = colorFor(p.event, palette);
                // A single column is wide enough to say the time range
                // and where it is; seven columns are not, and cramming
                // it in is what made the week grid look busy.
                const roomy = single && p.height > 28;
                // Finished meetings stay on the grid — the morning you
                // already lived is part of the day — but they step back
                // so the eye lands on what's still ahead.
                const past = isPast(p.event);
                return (
                  <button
                    key={p.event.key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(p.event.key);
                    }}
                    className={`absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight transition-colors ${
                      c.border
                    } ${c.bg} ${c.text} hover:opacity-100 ${
                      past ? "opacity-50" : "hover:opacity-90"
                    } ${
                      selectedKey === p.event.key
                        ? `ring-2 ${c.ring} ring-offset-1`
                        : ""
                    }`}
                    style={{
                      top: p.top,
                      height: p.height,
                      left: `${p.left}%`,
                      width: `calc(${p.width}% - 3px)`,
                    }}
                    title={p.event.summary}
                  >
                    <span
                      className={`block truncate font-medium ${
                        single ? "text-[12px]" : ""
                      }`}
                    >
                      {p.event.summary}
                    </span>
                    {roomy ? (
                      <span className="block truncate font-mono text-[10px] opacity-80">
                        {formatClock(p.event.start)} – {formatClock(p.event.end)}
                        {p.event.location ? ` · ${p.event.location}` : ""}
                      </span>
                    ) : (
                      p.height > 32 && (
                        <span className="block truncate font-mono text-[10px] opacity-80">
                          {formatClock(p.event.start)}
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
