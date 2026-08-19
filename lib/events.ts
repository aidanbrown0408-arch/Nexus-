// The one event shape the rest of the app knows about. Google Calendar
// and iCloud (CalDAV) both normalize into this, so the Calendar box, the
// Brief, and Chat never have to care which service an event came from —
// they read a single sorted list.

export type EventSource = "google" | "apple";

export type EventSummary = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendeeCount: number;
  hangoutLink: string | null;
  // Which service this came from. Used for the little source label in the
  // UI and nothing else — no logic should branch on it.
  source: EventSource;
  // The calendar the event lives on ("Work", "Family"), when the source
  // gives us a usable name. Null when it doesn't.
  calendarName: string | null;
  // Which calendar to address a write to. Google needs this on every
  // mutation — the event id alone doesn't say where the event lives, and
  // guessing "primary" would fail on every secondary calendar. Null for
  // Apple events, which have no write path here.
  calendarId: string | null;
  // For one occurrence of a repeating event, the id of the series it
  // belongs to. Null on one-off events. This is what lets the delete
  // confirm ask "just this one, or all of them?" — without it every
  // delete would silently mean one instance, which is the wrong answer
  // about half the time.
  recurringEventId: string | null;
  // iCalendar UID. Both services expose it, and it's what lets us
  // recognize the same meeting sitting on a Google calendar and an
  // iCloud one. Not shown to the user.
  uid: string | null;
  // Attendee email addresses, capped. Used to find mail related to a
  // meeting when drafting its prep checklist — not rendered anywhere.
  attendees: string[];
  // Stable identity for this specific occurrence, assigned by
  // mergeEvents. Prep checklists hang off it, so it has to survive a
  // refetch and stay distinct between two instances of a weekly meeting.
  // See eventKey below for why it isn't just `id`.
  key: string;
};

// Prep items are stored against this, so it has to hold still. Three
// things it has to survive:
//
//   - Refetching. Google's per-instance id is stable, but Apple's is
//     built from the UID plus an occurrence timestamp, and the same
//     meeting invited to both services has a different id on each.
//   - Deduping. Whichever copy of a meeting wins in mergeEvents has to
//     produce the same key, or a checklist would vanish on a day when
//     Google is unreachable and the iCloud copy shows instead.
//   - Recurrence. Every instance of a weekly standup shares a UID, so
//     the start time has to be part of the key — otherwise "print the
//     agenda" would be checked off for every future Tuesday at once.
export function eventKey(event: {
  uid: string | null;
  id: string;
  start: string;
}): string {
  const identity = (event.uid ?? event.id).trim().toLowerCase();
  const start = new Date(event.start).getTime();
  return `${identity}|${Number.isNaN(start) ? event.start : start}`;
}

// Same meeting, two services: an invite that landed in Gmail and also
// synced to iCloud. The UID travels with the invite, so that's the
// reliable key. Where a UID is missing we fall back to title + instants,
// which is a heuristic — two genuinely different events that share a
// title and a start time would collapse into one, but that costs the
// user less than seeing every meeting twice.
// What the fetchers produce. `key` is assigned by mergeEvents rather
// than by each service, so there's one implementation of it and both
// sources can't drift apart.
export type RawEvent = Omit<EventSummary, "key">;

function dedupeKeys(event: RawEvent): string[] {
  const keys: string[] = [];
  if (event.uid) keys.push(`uid:${event.uid.trim().toLowerCase()}`);
  keys.push(
    `sig:${event.summary.trim().toLowerCase()}|${instant(event.start)}|${instant(
      event.end
    )}`
  );
  return keys;
}

// All-day events carry a bare YYYY-MM-DD while timed events carry a full
// timestamp, so raw strings don't compare against each other. Parse to a
// number and sort on that instead.
function instant(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// Merge event lists into one sorted, deduped list.
//
// Order matters: earlier lists win a tie. Pass Google first — its events
// carry attendee counts and Meet links that the CalDAV copy of the same
// meeting usually doesn't, so the richer record is the one that survives.
export function mergeEvents(
  lists: RawEvent[][],
  limit: number
): EventSummary[] {
  const seen = new Set<string>();
  const merged: EventSummary[] = [];

  for (const list of lists) {
    for (const event of list) {
      const keys = dedupeKeys(event);
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      merged.push({ ...event, key: eventKey(event) });
    }
  }

  merged.sort((a, b) => instant(a.start) - instant(b.start));
  return merged.slice(0, limit);
}
