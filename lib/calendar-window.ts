import { resolveTimezone, zonedWindow } from "./clock";

// The window both calendar sources ask for.
//
// It used to start at `now`, which meant an event dropped off the board
// the moment it ended: at 6pm, a day whose only meeting was at 9am read
// as "Nothing scheduled today", and the Day and Week grids had a blank
// morning above the current hour. A calendar that forgets the part of
// the day you already lived is worse than useless for checking what
// happened — so the window starts at midnight today, and today's
// earlier events stay on screen (dimmed, see `isPast`) until the day
// itself is over.
//
// The end moves with it: `days` counts calendar days from that midnight,
// so the 7-day window is exactly the seven columns the week grid draws
// rather than 7×24 hours from whenever the request happened to fire.
//
// Which midnight, though, is the whole question. This used to call
// `setHours(0, 0, 0, 0)` on a fresh Date, which is midnight *where the
// code is running* — and this code runs on serverless hosts whose clock
// is UTC. So "local midnight" was UTC midnight for everybody. For a New
// York user that is 8pm the previous evening, which meant that from 8pm
// onwards the window began *tonight* and this morning's 9am meeting fell
// outside it: the board claimed an empty morning for exactly the reason
// this module exists to prevent. East of UTC it failed the other way,
// starting the window partway through yesterday and clipping the last
// day short.
//
// So the zone is now an argument. Callers that know whose calendar they
// are fetching pass it; the host is the fallback, and is explicitly a
// fallback rather than a silent default.

export function calendarWindow(
  days: number,
  timeZone?: string | null
): { start: Date; end: Date } {
  return zonedWindow(days, resolveTimezone(timeZone));
}

// Whether an event has already finished. Used only for styling — a past
// event is still shown, just quieted down.
export function isPast(event: { end: string; allDay: boolean }): boolean {
  if (event.allDay) return false;
  const end = new Date(event.end);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}
