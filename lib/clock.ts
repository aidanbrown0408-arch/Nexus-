// What time is it for *this user*?
//
// Nexus runs on serverless hosts whose clock is UTC, so
// `Intl.DateTimeFormat().resolvedOptions().timeZone` resolves to "UTC" no
// matter who is asking. Every prompt that opened with "Today is ..." was
// telling the model the server's day, which after 8pm is the wrong one
// for anyone west of London — the brief would wish you good morning about
// tomorrow.
//
// The onboarding interview already asks for a timezone. This reads it,
// falls back to the host only when it's missing or unusable, and hands
// back the lines every prompt wants.

// Cheap validity check. An unknown IANA name throws here rather than
// somewhere deeper in a format call, and a stored timezone can be stale
// (a renamed zone, a typo from a hand-edited row), so this never trusts
// the string it was given.
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The timezone to reason in. The user's stated one wins; the host is the
 * fallback, and is usually UTC.
 */
export function resolveTimezone(timezone: string | null | undefined): string {
  const stated = timezone?.trim();
  if (stated && isValidTimezone(stated)) return stated;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The calendar day a moment falls on, in a given zone, as YYYY-MM-DD.
 *
 * `en-CA` is the shortest route to ISO ordering out of `Intl` without
 * assembling the parts by hand.
 */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * "Tuesday, August 18, 2026" in the user's zone.
 */
export function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * "4:12 PM" in the user's zone.
 */
export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * The three lines nearly every prompt opens with. Returned as an array so
 * callers can splice them into the line lists they already build.
 */
export function nowLines(timeZone: string, now: Date = new Date()): string[] {
  return [
    `Today is ${formatDay(now, timeZone)}.`,
    `The current time is ${formatTime(now, timeZone)}.`,
    `The user's timezone is ${timeZone} — every time you mention should be in it.`,
  ];
}

/**
 * The hour of the day (0-23) in a given zone.
 *
 * The scheduler's whole job is "is it this user's morning yet?", and that
 * question is meaningless without a zone — 7am is a different instant for
 * every person on the list.
 */
export function hourIn(timeZone: string, now: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(now);
  // en-US with hour12:false renders midnight as "24" in some ICU
  // versions, which would never match a stored "00:00".
  return Number(hour) % 24;
}

/**
 * The weekday in a given zone, 0 = Sunday.
 */
export function weekdayIn(timeZone: string, now: Date = new Date()): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const index = days.indexOf(name);
  if (index === -1) {
    // Falling back to 0 would mean Sunday, and a caller suppressing
    // weekend delivery would then suppress every day forever. Monday is
    // the fail-visible default: something still happens, and the log
    // says why it might be wrong.
    console.error(`Clock: unrecognised weekday "${name}" for ${timeZone}`);
    return 1;
  }
  return index;
}

/**
 * The wall-clock hour, minute and calendar day in a given zone.
 *
 * One formatter call for all three, because anything that reasons about
 * "is this during working hours" needs them together and needs them in
 * the user's zone — `getHours()` on a serverless host answers in UTC,
 * which is nobody's working day.
 */
export function zonedParts(
  date: Date,
  timeZone: string
): { hour: number; minute: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "0";

  return {
    // Some ICU builds render midnight as 24 under hour12:false.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    day: `${get("year")}-${get("month")}-${get("day")}`,
  };
}
