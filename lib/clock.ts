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
