import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { RawEvent } from "./events";
import { resolveTimezone, zonedParts } from "./clock";

// "Find 30 minutes with Sarah this week."
//
// Two sources of busy-ness, merged. Google answers freebusy directly and
// cheaply, including for guests whose calendars the user can see. Apple
// has no freebusy over CalDAV, so its busy blocks are derived from the
// events we already fetch.
//
// Nothing here writes or sends. It proposes times; creating the event is
// the existing, separately-confirmed path.

export type Slot = {
  start: string;
  end: string;
};

export type BusyBlock = {
  start: number;
  end: number;
};

export type AvailabilityRequest = {
  durationMinutes: number;
  daysAhead: number;
  // Local hours the user is willing to meet between. A slot that's
  // technically free at 4am is not a slot.
  workdayStartHour: number;
  workdayEndHour: number;
  // The zone those hours are in. Without it they were read on the host,
  // which is UTC — so "9 to 6" meant 9 to 6 UTC for everyone.
  timeZone?: string | null;
  // Guests whose calendars should also be checked. Google only returns
  // real detail for people who share their calendar with the user;
  // everyone else comes back empty, which reads as "free" — see
  // `unknownGuests` on the result.
  guestEmails?: string[];
};

export type AvailabilityResult = {
  slots: Slot[];
  // Guests whose availability Google wouldn't tell us. Surfaced rather
  // than swallowed: a proposal that silently assumed someone was free is
  // worse than one that says it couldn't check.
  unknownGuests: string[];
};

const MAX_SLOTS = 6;
// Don't propose something starting in eight minutes.
const LEAD_TIME_MINUTES = 30;
// Slot starts land on clean boundaries. "10:00–10:30" is a time someone
// will actually agree to; "10:07–10:37" reads like a machine wrote it.
const GRANULARITY_MINUTES = 15;

function toBusyBlocks(
  periods: { start?: string | null; end?: string | null }[]
): BusyBlock[] {
  return periods
    .map((p) => ({
      start: p.start ? new Date(p.start).getTime() : NaN,
      end: p.end ? new Date(p.end).getTime() : NaN,
    }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
}

// Apple events become busy blocks directly. All-day events block the
// whole day rather than being skipped — someone with an all-day "Annual
// leave" is not available at 2pm.
export function eventsToBusy(events: RawEvent[]): BusyBlock[] {
  return events
    .map((event) => {
      if (event.allDay) {
        const day = new Date(`${event.start.slice(0, 10)}T00:00:00`);
        // The event's own end, not "the next day". A five-day "Annual
        // leave" was blocking Monday and leaving Tuesday to Friday
        // bookable — the function's own comment says that is exactly what
        // it exists to prevent. All-day ends are already exclusive in
        // both Google and CalDAV, so no day is added when one is present.
        const rawEnd = event.end?.slice(0, 10);
        const end = rawEnd ? new Date(`${rawEnd}T00:00:00`) : null;
        if (end && end.getTime() > day.getTime()) {
          return { start: day.getTime(), end: end.getTime() };
        }
        const next = new Date(day);
        next.setDate(next.getDate() + 1);
        return { start: day.getTime(), end: next.getTime() };
      }
      return {
        start: new Date(event.start).getTime(),
        end: new Date(event.end).getTime(),
      };
    })
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
}

// Overlapping and adjacent blocks collapse into one. Without this, a
// meeting on two calendars would leave a zero-width "free" gap between
// its two copies, and the search would happily propose it.
export function mergeBusy(blocks: BusyBlock[]): BusyBlock[] {
  if (!blocks.length) return [];

  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  // Copied, not referenced: extending `last.end` below would otherwise
  // write straight through into the caller's array.
  const merged: BusyBlock[] = [{ ...sorted[0] }];

  for (const block of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

// Walk the window on a fixed grid, keeping starts that clear both the
// working-hours bound and every busy block.
export function findSlots(
  busy: BusyBlock[],
  request: AvailabilityRequest,
  now = new Date()
): Slot[] {
  const durationMs = request.durationMinutes * 60_000;
  const timeZone = resolveTimezone(request.timeZone);
  const merged = mergeBusy(busy);

  const earliest = new Date(now.getTime() + LEAD_TIME_MINUTES * 60_000);
  // Round up to the next grid boundary so proposals are clean times.
  const step = GRANULARITY_MINUTES * 60_000;
  let cursor = Math.ceil(earliest.getTime() / step) * step;

  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + request.daysAhead);
  const windowEndMs = windowEnd.getTime();

  const slots: Slot[] = [];

  while (cursor + durationMs <= windowEndMs && slots.length < MAX_SLOTS) {
    const start = new Date(cursor);
    const end = new Date(cursor + durationMs);

    // Read in the user's zone, not the host's. `getHours()` on a
    // serverless host answers in UTC, so "9 to 6" was being applied to
    // UTC — a Los Angeles user was offered 2am to 11am and never saw a
    // free afternoon.
    const from = zonedParts(start, timeZone);
    const to = zonedParts(end, timeZone);

    const startHour = from.hour + from.minute / 60;
    const endHour = to.hour + to.minute / 60;
    const sameDay = from.day === to.day;

    const withinHours =
      sameDay &&
      startHour >= request.workdayStartHour &&
      endHour <= request.workdayEndHour;

    if (!withinHours) {
      // Jump straight to the next opening rather than stepping through
      // the night a quarter-hour at a time. Computed as an offset from
      // the current wall-clock hour so it lands correctly in the user's
      // zone without having to construct a date in it.
      const hoursAhead =
        (request.workdayStartHour - startHour + 24) % 24 || 24;
      const advanced =
        Math.ceil((cursor + hoursAhead * 3_600_000) / step) * step;
      cursor = advanced > cursor ? advanced : cursor + step;
      continue;
    }

    const conflict = merged.find(
      (b) => b.start < cursor + durationMs && b.end > cursor
    );

    if (conflict) {
      // Skip to the end of what's in the way, rounded onto the grid.
      cursor = Math.ceil(conflict.end / step) * step;
      continue;
    }

    slots.push({ start: start.toISOString(), end: end.toISOString() });
    // Space proposals out so the three offered aren't 10:00, 10:15 and
    // 10:30 — those are one option, not three.
    cursor += Math.max(durationMs, 60 * 60_000);
  }

  return slots;
}

// Ask Google when the user — and any guests it can see — are busy.
export async function fetchGoogleBusy(
  client: OAuth2Client,
  request: AvailabilityRequest
): Promise<{ busy: BusyBlock[]; unknownGuests: string[] }> {
  const calendar = google.calendar({ version: "v3", auth: client });

  const now = new Date();
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + request.daysAhead);

  const guests = request.guestEmails ?? [];
  const items = [{ id: "primary" }, ...guests.map((email) => ({ id: email }))];

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      items,
    },
  });

  const calendars = res.data.calendars ?? {};
  const busy: BusyBlock[] = [];
  const unknownGuests: string[] = [];

  for (const [id, entry] of Object.entries(calendars)) {
    // Google reports "notFound" or a permission error for a calendar the
    // user can't see. That's not free — it's unknown, and the difference
    // matters when proposing a time to someone.
    if (entry.errors?.length) {
      if (id !== "primary") unknownGuests.push(id);
      continue;
    }
    busy.push(...toBusyBlocks(entry.busy ?? []));
  }

  return { busy, unknownGuests };
}
