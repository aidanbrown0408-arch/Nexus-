import type { EventSummary } from "@/lib/events";

// Which calendar days an event actually occupies.
//
// Both grids used to bucket an event under `start` alone, which is right
// for a 2pm call and wrong for everything that lasts longer than a day:
// a week of travel showed up as a single chip on the Saturday it began
// and nothing at all on the six days it actually covered, and a trip
// that started before the grid's first cell vanished from the month
// entirely — its only day key pointed at a cell that wasn't rendered.
// A red-eye that lands the next morning had the same problem in Week.
//
// So: expand each event into every local day it touches, and let the
// callers mark which of those days is the first one (the day that gets
// the start time on its chip) and which is the last.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A bare YYYY-MM-DD read as a *local* day. `new Date("2026-08-29")`
// parses as UTC midnight, which is the previous day everywhere west of
// Greenwich — the same trap that had the month header starting on
// Saturday.
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

// A guard, not a policy: a malformed end date shouldn't be able to spin
// out a million cells. Nothing a person schedules runs a year of
// contiguous days.
const MAX_SPAN_DAYS = 366;

function dayRange(first: Date, last: Date): string[] {
  const keys: string[] = [];
  let cursor = first;
  for (let i = 0; i < MAX_SPAN_DAYS && cursor <= last; i += 1) {
    keys.push(toDayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

// --- due-date buckets ---------------------------------------------------

// Which heading a reminder sits under on the Reminders list.
//
// Lives here rather than in the component because it has to run in two
// places that must agree — the list itself, and the count on the tab —
// and because a pure date function with this many boundary cases is worth
// a test. Overdue comes first on purpose: an item attached to a meeting
// that already happened is the one thing on the list that can't be fixed
// by waiting, so burying it under next week's would be backwards.
export type DueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "week"
  | "later"
  | "undated";

export const DUE_BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "week",
  "later",
  "undated",
];

// An item's own due date wins; one hanging off a meeting with no date of
// its own is due when the meeting is. The server's lib/prep has the same
// rule in effectiveDate() — they have to match, which is what the test
// for this function is really checking.
export function effectiveDueDate(item: {
  dueAt?: string | null;
  eventStart?: string | null;
}): string | null {
  return item.dueAt ?? item.eventStart ?? null;
}

export function dueBucket(when: string | null, now: Date = new Date()): DueBucket {
  if (!when) return "undated";
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return "undated";

  const today = startOfDay(now);
  const day = startOfDay(date);

  if (day < today) return "overdue";

  const key = toDayKey(day);
  if (key === toDayKey(today)) return "today";
  if (key === toDayKey(addDays(today, 1))) return "tomorrow";

  // "This week" is the next seven days, not the calendar week. On a
  // Saturday the calendar sense would leave one day in the bucket and
  // push everything real into Later.
  if (day < addDays(today, 7)) return "week";

  return "later";
}

export function eventDayKeys(event: EventSummary): string[] {
  if (event.allDay) {
    // All-day events carry bare dates, and `end` is *exclusive* in both
    // iCalendar and the Google API — a one-day event on the 29th ends on
    // the 30th. So the last day the user sees is end - 1.
    const first = parseDayKey(event.start);
    if (Number.isNaN(first.getTime())) return [];
    const endExclusive = event.end ? parseDayKey(event.end) : new Date(NaN);
    let last = Number.isNaN(endExclusive.getTime())
      ? first
      : addDays(endExclusive, -1);
    if (last < first) last = first;
    return dayRange(first, last);
  }

  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return [];
  const first = startOfDay(start);
  const end = new Date(event.end);
  if (Number.isNaN(end.getTime()) || end <= start) return [toDayKey(first)];
  // An event ending exactly at midnight ends on the day before, not on a
  // day it occupies for zero minutes.
  let last = startOfDay(new Date(end.getTime() - 1));
  if (last < first) last = first;
  return dayRange(first, last);
}

export type DayEntry = {
  event: EventSummary;
  // The day the event starts on — the one that shows a start time and no
  // continuation marker.
  first: boolean;
  last: boolean;
};

export function bucketByDay(events: EventSummary[]): Map<string, DayEntry[]> {
  const byDate = new Map<string, DayEntry[]>();
  for (const event of events) {
    const keys = eventDayKeys(event);
    keys.forEach((key, i) => {
      const entry: DayEntry = {
        event,
        first: i === 0,
        last: i === keys.length - 1,
      };
      const bucket = byDate.get(key);
      if (bucket) bucket.push(entry);
      else byDate.set(key, [entry]);
    });
  }
  return byDate;
}
