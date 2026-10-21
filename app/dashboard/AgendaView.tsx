"use client";

import { Fragment, useMemo } from "react";
import type { EventSummary } from "@/lib/events";
import { colorFor, type CalendarColor } from "./calendarColors";
import { isPast } from "@/lib/calendar-window";
import {
  addDays,
  bucketByDay,
  parseDayKey,
  startOfDay,
  toDayKey,
} from "@/lib/event-days";

// The long view. Three months as a grid would be mostly empty cells, and
// three months as a stack of full event rows — each with its own prep
// checklist and edit controls — is a page you scroll through rather than
// scan.
//
// So: a dense agenda. A date gutter on the left, the day's events beside
// it, month rules to break up the run, and empty days left out entirely.
// Clicking anything opens the same detail modal the grids open, so
// nothing is lost by making the row itself small.

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(" ", "");
}

export default function AgendaView({
  events,
  selectedKey,
  onSelect,
  palette,
}: {
  events: EventSummary[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  palette?: Map<string, CalendarColor>;
}) {
  const today = startOfDay(new Date());
  const todayKey = toDayKey(today);
  const tomorrowKey = toDayKey(addDays(today, 1));

  // Bucketed by every day an event covers, so a week of travel appears
  // on each of its days rather than only the day it began — the same
  // rule the two grids follow.
  const days = useMemo(() => {
    const byDate = bucketByDay(events);
    return Array.from(byDate.entries())
      .filter(([key]) => key >= todayKey)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entries]) => ({
        key,
        date: parseDayKey(key),
        entries: entries.slice().sort((a, b) => {
          // All-day and multi-day bands first, then the day's
          // appointments in the order they happen.
          const aBand = a.event.allDay || !a.first || !a.last;
          const bBand = b.event.allDay || !b.first || !b.last;
          if (aBand !== bBand) return aBand ? -1 : 1;
          return (
            new Date(a.event.start).getTime() -
            new Date(b.event.start).getTime()
          );
        }),
      }));
  }, [events, todayKey]);

  let lastMonth = "";

  return (
    <div className="flex flex-col">
      {days.map(({ key, date, entries }) => {
        const month = date.toLocaleDateString(undefined, {
          month: "long",
          year:
            date.getFullYear() === today.getFullYear() ? undefined : "numeric",
        });
        const newMonth = month !== lastMonth;
        lastMonth = month;
        const isToday = key === todayKey;
        const weekend = date.getDay() === 0 || date.getDay() === 6;

        return (
          <Fragment key={key}>
            {/* One rule per month, so ninety days of rows still have a
                shape to them when you scroll. */}
            {newMonth && (
              <div className="sticky top-0 z-10 -mx-1 mb-1.5 mt-4 flex items-center gap-2.5 bg-white/95 px-1 py-1 backdrop-blur first:mt-0">
                <span className="nx-label-lg shrink-0">{month}</span>
                <span className="h-px flex-1 bg-line-soft" />
              </div>
            )}

            <div className="flex gap-3 border-b border-line-soft/70 py-2 last:border-b-0">
              {/* The date gutter: weekday over date, so the eye can run
                  down one column instead of re-reading a heading. */}
              <div className="w-10 shrink-0 pt-0.5 text-center">
                <div
                  className={`nx-label ${
                    isToday
                      ? "text-accent-600"
                      : weekend
                        ? "text-ink-ghost"
                        : ""
                  }`}
                >
                  {isToday
                    ? "Today"
                    : key === tomorrowKey
                      ? "Tmrw"
                      : date.toLocaleDateString(undefined, {
                          weekday: "short",
                        })}
                </div>
                <div
                  className={`mt-0.5 font-mono text-[13px] ${
                    isToday
                      ? "mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-accent-600 text-white"
                      : "text-ink-muted"
                  }`}
                >
                  {date.getDate()}
                </div>
              </div>

              <ul className="flex min-w-0 flex-1 flex-col gap-1">
                {entries.map(({ event, first, last }) => {
                  const c = colorFor(event, palette);
                  const spans = !first || !last;
                  // Already over: still listed, just quieted.
                  const past = isPast(event);
                  return (
                    <li key={event.key + key}>
                      <button
                        type="button"
                        onClick={() => onSelect(event.key)}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition-opacity ${c.border} ${c.bg} ${c.text} hover:opacity-100 ${
                          past ? "opacity-50" : "hover:opacity-90"
                        } ${
                          selectedKey === event.key
                            ? `ring-2 ${c.ring} ring-offset-1`
                            : ""
                        }`}
                      >
                        <span className="w-[62px] shrink-0 font-mono text-[11px] opacity-75">
                          {event.allDay
                            ? "All day"
                            : first
                              ? formatClock(event.start)
                              : "cont."}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {event.summary}
                        </span>
                        {event.location && (
                          <span className="hidden max-w-[38%] shrink-0 truncate text-[11px] opacity-70 sm:block">
                            {event.location}
                          </span>
                        )}
                        {spans && !last && (
                          <span aria-hidden className="shrink-0 opacity-60">
                            →
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
