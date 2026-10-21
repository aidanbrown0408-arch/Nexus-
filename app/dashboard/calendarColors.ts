import type { EventSummary } from "@/lib/events";

// One color per calendar, not per service — someone with Work, Family,
// and US Holidays all synced through Google would otherwise see every
// event painted the same "Google" blue in the week and month grids,
// which defeats the point of a color-coded calendar. Apple vs. Google
// still matters when nothing else does (an event with no calendar name
// at all), so it's the fallback identity, not the primary one.

export type CalendarColor = {
  bg: string;
  text: string;
  border: string;
  dot: string;
  ring: string;
};

// Eight visually distinct hues, each pulled to the same 50/600-700/900
// weights the rest of the design already uses for its amber/accent
// chips — so a new calendar's color reads as "part of this app" rather
// than a clashing import.
const PALETTE: CalendarColor[] = [
  { bg: "bg-sky-50", text: "text-sky-900", border: "border-sky-600/25", dot: "bg-sky-600", ring: "ring-sky-600" },
  { bg: "bg-violet-50", text: "text-violet-900", border: "border-violet-600/25", dot: "bg-violet-600", ring: "ring-violet-600" },
  { bg: "bg-emerald-50", text: "text-emerald-900", border: "border-emerald-600/25", dot: "bg-emerald-600", ring: "ring-emerald-600" },
  { bg: "bg-amber-50", text: "text-amber-900", border: "border-amber-700/30", dot: "bg-amber-700", ring: "ring-amber-700" },
  { bg: "bg-rose-50", text: "text-rose-900", border: "border-rose-600/25", dot: "bg-rose-600", ring: "ring-rose-600" },
  { bg: "bg-teal-50", text: "text-teal-900", border: "border-teal-600/25", dot: "bg-teal-600", ring: "ring-teal-600" },
  { bg: "bg-fuchsia-50", text: "text-fuchsia-900", border: "border-fuchsia-600/25", dot: "bg-fuchsia-600", ring: "ring-fuchsia-600" },
  { bg: "bg-orange-50", text: "text-orange-900", border: "border-orange-600/25", dot: "bg-orange-600", ring: "ring-orange-600" },
];

const FALLBACK: CalendarColor = {
  bg: "bg-surface-soft",
  text: "text-ink",
  border: "border-line",
  dot: "bg-ink-muted",
  ring: "ring-ink-muted",
};

// What the user actually thinks of as "the calendar" — the named
// calendar when the source gives us one, and the service's own name
// when it doesn't (an Apple event with no CalDAV display name, say).
export function calendarLabel(event: {
  calendarName: string | null;
  source: EventSummary["source"];
}): string {
  return event.calendarName ?? (event.source === "apple" ? "iCloud" : "Google");
}

// Alphabetical rather than first-seen: first-seen would reassign colors
// every time the fetched window changes and a different calendar happens
// to appear first, which is the opposite of "differentiated" — the same
// calendar should keep the same color across Week, Month, and a refresh.
export function buildCalendarPalette(
  events: { calendarName: string | null; source: EventSummary["source"] }[]
): Map<string, CalendarColor> {
  const labels = Array.from(new Set(events.map(calendarLabel))).sort((a, b) =>
    a.localeCompare(b)
  );
  const map = new Map<string, CalendarColor>();
  labels.forEach((label, i) => map.set(label, PALETTE[i % PALETTE.length]));
  return map;
}

export function colorFor(
  event: { calendarName: string | null; source: EventSummary["source"] },
  palette: Map<string, CalendarColor> | undefined
): CalendarColor {
  if (!palette) return FALLBACK;
  return palette.get(calendarLabel(event)) ?? FALLBACK;
}
