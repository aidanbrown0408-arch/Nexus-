import { dayKey, hourIn, resolveTimezone, weekdayIn } from "./clock";

// When is it someone's morning?
//
// Lives here rather than in the cron route because it's the whole
// decision — who gets an email and which day it counts as — and a route
// is a bad place for anything you want to test without an HTTP request.

// How long after someone's morning the brief may still arrive.
//
// Without a window the schedule is a single instant: one Anthropic 503 or
// one Resend hiccup at exactly 7am means no brief that day, and the
// delivery claim released "so the next run can retry" is released into a
// run that will never consider them again.
//
// It also covers the spring-forward hole — a morning_time of 02:00 has no
// 2am on that date, and exact-hour matching would skip the day entirely.
export const GRACE_HOURS = 3;

export type Schedulable = {
  morning_time: string | null;
  timezone: string | null;
  weekend_contact: string | null;
};

export type DeliveryWindow = {
  timeZone: string;
  // The calendar day of the user's *morning*, which is the key the
  // duplicate guard uses.
  day: string;
};

/**
 * Parse a stored morning time to an hour.
 *
 * Strict on purpose. `Number("")` is 0, so a loose parse turns a missing
 * answer into "send at midnight" — the one hour nobody chose.
 */
export function morningHour(value: string | null): number | null {
  const match = /^\s*(\d{1,2}):[0-5]\d(?::[0-5]\d)?\s*$/.exec(value ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Is it this user's morning, and which morning is it?
 *
 * Returning the day rather than a boolean is what makes the grace window
 * safe. The duplicate guard is keyed on a date, and "now" is the wrong
 * date once the window crosses midnight: a morning_time of 22:00 sends at
 * 22:00 under day D, then at 00:00 the window is still open but the key
 * has become D+1 — a second brief an hour after the first, every night.
 * Winding back to the hour their morning started keeps one morning to one
 * key, and lets the weekend rule judge a Friday-night brief as Friday.
 */
export function deliveryWindow(
  candidate: Schedulable,
  now: Date = new Date()
): DeliveryWindow | null {
  // A morning time without a timezone is not a time. Rather than guess —
  // which on a UTC host means emailing a Los Angeles user at midnight and
  // calling it their morning — skip and let them set one.
  if (!candidate.timezone) return null;
  const timeZone = resolveTimezone(candidate.timezone);

  const hour = morningHour(candidate.morning_time);
  if (hour === null) return null;

  // Distance forward from their morning, wrapping at midnight.
  const since = (hourIn(timeZone, now) - hour + 24) % 24;
  if (since > GRACE_HOURS) return null;

  const morning = new Date(now.getTime() - since * 60 * 60 * 1000);

  if (candidate.weekend_contact === "never") {
    const day = weekdayIn(timeZone, morning);
    if (day === 0 || day === 6) return null;
  }

  return { timeZone, day: dayKey(morning, timeZone) };
}
