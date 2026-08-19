// Repeating events.
//
// Both services speak RRULE (RFC 5545) — Google takes it as a string in a
// `recurrence` array, Apple as a line inside the VEVENT — so the rule is
// built once here and handed to whichever path is creating the event.
// Anything that diverged per-service would eventually drift, and a weekly
// standup that repeats correctly on Google and wrongly on iCloud is worse
// than one that doesn't repeat at all.

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type Recurrence = {
  frequency: Frequency;
  // Every N days/weeks/months/years. 1 for "every week", 2 for
  // "every other week".
  interval: number;
  // Which days a weekly rule fires on. Empty means "the day the event
  // starts", which is what RRULE does by default.
  byDay?: Weekday[];
  // Exactly one of these, or neither for "forever".
  count?: number;
  until?: string;
};

// Guards against a typo turning into an event that repeats 10,000 times.
export const MAX_INTERVAL = 52;
export const MAX_COUNT = 730;

const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function weekdayOf(date: Date): Weekday {
  return WEEKDAYS[date.getDay()];
}

// RRULE's UNTIL must be a UTC timestamp when the event is timed. A bare
// date works for all-day events, but sending the timestamp form for both
// is simpler and accepted either way.
function toUntilStamp(value: string): string {
  const d = new Date(value.length <= 10 ? `${value}T23:59:59` : value);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// The single source of truth for what a rule looks like on the wire.
// Returns the bare rule without the "RRULE:" prefix — Google wants it
// prefixed inside an array, Apple wants it as a prefixed line, and
// neither wants to guess.
export function toRRuleBody(recurrence: Recurrence): string {
  const parts = [`FREQ=${recurrence.frequency.toUpperCase()}`];

  const interval = Math.max(1, Math.min(recurrence.interval, MAX_INTERVAL));
  if (interval > 1) parts.push(`INTERVAL=${interval}`);

  if (recurrence.frequency === "weekly" && recurrence.byDay?.length) {
    parts.push(`BYDAY=${recurrence.byDay.join(",")}`);
  }

  // COUNT and UNTIL are mutually exclusive in RFC 5545 — a rule carrying
  // both is rejected outright by some clients, so COUNT wins and UNTIL
  // is dropped rather than sending both and hoping.
  if (recurrence.count) {
    parts.push(`COUNT=${Math.max(1, Math.min(recurrence.count, MAX_COUNT))}`);
  } else if (recurrence.until) {
    parts.push(`UNTIL=${toUntilStamp(recurrence.until)}`);
  }

  return parts.join(";");
}

export function toGoogleRecurrence(recurrence: Recurrence): string[] {
  return [`RRULE:${toRRuleBody(recurrence)}`];
}

export function toICalRRule(recurrence: Recurrence): string {
  return `RRULE:${toRRuleBody(recurrence)}`;
}

const DAY_NAMES: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};

// Plain English, for the form's live summary and the action log. Someone
// setting up a rule that fires for the next two years should be able to
// read that back before committing, not decode FREQ=WEEKLY;COUNT=104.
export function describeRecurrence(recurrence: Recurrence): string {
  const interval = Math.max(1, recurrence.interval);

  let base: string;
  if (interval === 1) {
    base = {
      daily: "Every day",
      weekly: "Every week",
      monthly: "Every month",
      yearly: "Every year",
    }[recurrence.frequency];
  } else {
    const unit = {
      daily: "days",
      weekly: "weeks",
      monthly: "months",
      yearly: "years",
    }[recurrence.frequency];
    base = `Every ${interval} ${unit}`;
  }

  if (recurrence.frequency === "weekly" && recurrence.byDay?.length) {
    const days = recurrence.byDay.map((d) => DAY_NAMES[d]);
    const list =
      days.length === 1
        ? days[0]
        : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
    base += ` on ${list}`;
  }

  if (recurrence.count) {
    return `${base}, ${recurrence.count} times`;
  }
  if (recurrence.until) {
    const d = new Date(
      recurrence.until.length <= 10
        ? `${recurrence.until}T12:00:00`
        : recurrence.until
    );
    if (!Number.isNaN(d.getTime())) {
      return `${base}, until ${d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`;
    }
  }

  return base;
}

// Parse and clamp whatever came off the wire. Returns null for anything
// unusable rather than a half-valid rule — a create that silently didn't
// repeat is harder to notice than one that refused.
export function parseRecurrence(value: unknown): Recurrence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  const frequency = v.frequency;
  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "monthly" &&
    frequency !== "yearly"
  ) {
    return null;
  }

  const rawInterval = typeof v.interval === "number" ? v.interval : 1;
  const interval = Math.max(1, Math.min(Math.floor(rawInterval), MAX_INTERVAL));

  const byDay = Array.isArray(v.byDay)
    ? v.byDay.filter((d): d is Weekday =>
        WEEKDAYS.includes(d as Weekday)
      )
    : undefined;

  const recurrence: Recurrence = { frequency, interval };
  if (byDay?.length) recurrence.byDay = byDay;

  if (typeof v.count === "number" && v.count > 0) {
    recurrence.count = Math.min(Math.floor(v.count), MAX_COUNT);
  } else if (typeof v.until === "string" && v.until.trim()) {
    const d = new Date(v.until);
    if (!Number.isNaN(d.getTime())) recurrence.until = v.until;
  }

  return recurrence;
}
