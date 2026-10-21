"use client";

import { useState } from "react";
import type { EventSummary } from "@/lib/events";
import { colorFor, type CalendarColor } from "./calendarColors";
import { isPast } from "@/lib/calendar-window";
import { addDays, bucketByDay, startOfDay, toDayKey } from "@/lib/event-days";

// A month grid: weekday header, boxes for each date, events as small
// chips inside their day. This is what "month" means in every calendar
// app — a flat agenda list stops being scannable once it's covering
// thirty days at once.
//
// The events feeding this are whatever the board already fetched (the
// next 30 days from today), not a fixed calendar month — so the grid
// starts on the Sunday of the current week and runs forward in full
// weeks far enough to cover that whole window, rather than pretending
// to be a navigable month picker with a prev/next the data can't back.

const MAX_VISIBLE = 3;

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(" ", "");
}

// Column headers, and the columns themselves, both start on Sunday.
// They used to disagree: this list was built from `new Date("2024-01-07")`,
// which is an ISO date-only string and therefore parsed as *UTC*
// midnight — 7pm Saturday the 6th in New York. So the header read
// Sat/Sun/Mon… over columns that were actually Sun/Mon/Tue…, and every
// event in the grid looked like it was on the wrong weekday. Building
// the date from local parts keeps the two in step in every time zone.
const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
  addDays(new Date(2024, 0, 7), i).toLocaleDateString(undefined, {
    weekday: "short",
  })
);

export default function MonthView({
  events,
  windowDays,
  selectedKey,
  onSelect,
  onAddSlot,
  palette,
}: {
  events: EventSummary[];
  // How many days ahead the board actually fetched — the grid needs to
  // run at least this far so the last fetched day still has a cell.
  windowDays: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  // Clicking empty space in a day cell opens the add form pre-filled
  // with that date. Only offered for days inside the fetched window —
  // a padding day past it would create an event the board can't show
  // until it happens to refetch far enough to cover it.
  onAddSlot?: (date: Date) => void;
  // One color per calendar (Work, Family, iCloud, …), built once by the
  // parent so Week and Month agree on which calendar is which color.
  palette?: Map<string, CalendarColor>;
}) {
  const today = startOfDay(new Date());
  const gridStart = addDays(today, -today.getDay());
  const weeksNeeded = Math.ceil((today.getDay() + windowDays) / 7);
  const totalCells = weeksNeeded * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));

  // Every day an event covers, not just the day it starts — see
  // eventDays.ts. This is what puts a week of travel on all seven of its
  // days instead of only the first, and what keeps a trip that began
  // before this grid's first cell from disappearing outright.
  const byDate = bucketByDay(events);

  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  function chipClasses(event: EventSummary): string {
    const c = colorFor(event, palette);
    return `flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] font-medium transition-colors ${c.border} ${c.bg} ${c.text} hover:opacity-90`;
  }

  return (
    <div className="overflow-hidden rounded-card border border-line-soft bg-white">
      <div className="grid grid-cols-7 border-b border-line-soft">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-1.5 py-2 text-center">
            <span className="nx-label">{label}</span>
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weeksNeeded}, minmax(0, 1fr))` }}
      >
        {cells.map((date, i) => {
          const key = toDayKey(date);
          const dayEvents = (byDate.get(key) ?? []).slice().sort((a, b) => {
            // Multi-day bands sit above the day's own appointments —
            // that's where a calendar app puts them, and it keeps a trip
            // from being pushed under the "+2 more" fold by the meetings
            // happening during it.
            const aBand = a.event.allDay || !a.first || !a.last;
            const bBand = b.event.allDay || !b.first || !b.last;
            if (aBand !== bBand) return aBand ? -1 : 1;
            return (
              new Date(a.event.start).getTime() - new Date(b.event.start).getTime()
            );
          });
          const isToday = key === toDayKey(today);
          const inWindow = date >= today && date < addDays(today, windowDays);
          const expanded = expandedDay === key;
          const visible = expanded ? dayEvents : dayEvents.slice(0, MAX_VISIBLE);
          const hiddenCount = dayEvents.length - visible.length;

          const canAdd = Boolean(onAddSlot) && inWindow;
          return (
            <div
              key={key}
              onClick={() => {
                if (canAdd) onAddSlot?.(date);
              }}
              className={`flex min-h-[92px] flex-col gap-1 border-b border-l border-line-soft p-1.5 last:border-r ${
                inWindow ? "bg-white" : "bg-surface-soft/40"
              } ${i % 7 === 0 ? "border-l-0" : ""} ${
                canAdd ? "cursor-pointer hover:bg-surface-soft/60" : ""
              }`}
            >
              <span
                className={`self-end font-mono text-[11px] ${
                  isToday
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 text-white"
                    : inWindow
                      ? "text-ink-muted"
                      : "text-ink-ghost"
                }`}
              >
                {date.getDate()}
              </span>

              <div className="flex flex-1 flex-col gap-0.5">
                {visible.map(({ event, first, last }) => {
                  const spans = !first || !last;
                  // A meeting that's already over stays in its day and
                  // steps back, rather than vanishing from the grid.
                  const past = isPast(event);
                  return (
                    <button
                      key={event.key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(event.key);
                      }}
                      className={`${chipClasses(event)} ${
                        past ? "opacity-50" : ""
                      } ${
                        selectedKey === event.key
                          ? `ring-2 ${colorFor(event, palette).ring} ring-offset-1`
                          : ""
                      }`}
                      // The title still names the event on every day it
                      // covers — a middle day of a trip used to render
                      // nothing at all, so there was no label to read.
                      title={
                        spans && !first ? `${event.summary} (continues)` : event.summary
                      }
                    >
                      {!event.allDay && first && (
                        <span className="shrink-0 font-mono text-[10px] opacity-75">
                          {formatClock(event.start)}
                        </span>
                      )}
                      {spans && !first && (
                        <span aria-hidden className="shrink-0 opacity-60">
                          ↳
                        </span>
                      )}
                      <span className="truncate">{event.summary}</span>
                    </button>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDay(key);
                    }}
                    className="text-left text-[11px] font-medium text-ink-ghost hover:text-ink"
                  >
                    +{hiddenCount} more
                  </button>
                )}
                {expanded && dayEvents.length > MAX_VISIBLE && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDay(null);
                    }}
                    className="text-left text-[11px] font-medium text-ink-ghost hover:text-ink"
                  >
                    Show less
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
