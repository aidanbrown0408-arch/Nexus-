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
  // Which calendar to address a write to. On Google this is the calendar
  // id; on Apple it's the CalDAV collection URL. Both mutations (update,
  // delete) need it to find the right calendar before they can touch the
  // event. Null when the event didn't come with one — an event Nexus
  // can't write to.
  calendarId: string | null;
  // Whether this account can actually change this event, as opposed to
  // merely see it.
  //
  // The Upcoming list is built from every calendar the user can *read*,
  // which includes calendars shared with them at reader access and
  // subscribed feeds. Google answers a delete on one of those with a
  // bare 403 "Forbidden" — no reason, nothing a reconnect fixes. The
  // Edit and Delete controls used to be offered on those events anyway,
  // gated only on knowing which calendar the event was on, so the only
  // way to discover a read-only calendar was to try to change it and
  // fail. Google reports the access role on the calendar list; this
  // carries that decision to the UI instead.
  canWrite: boolean;
  // The CalDAV object URL for this event's .ics resource. Apple-only —
  // this is what actually addresses a single event for update or delete
  // over CalDAV, since `id` there is just the iCalendar UID and doesn't
  // resolve to a resource on its own. Null for Google events, which are
  // addressed by `id` + `calendarId` instead.
  objectUrl: string | null;
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
  // The occurrence has to be part of the key, not just the UID. Every
  // instance of a recurring series shares one UID, so keying on it alone
  // meant a weekly standup appeared once and every later occurrence was
  // silently dropped from the merged list — the calendar card and the
  // brief would say Wednesday was clear while a standup sat on it.
  //
  // eventKey below already reasoned this out for its own key ("otherwise
  // 'print the agenda' would be checked off for every future Tuesday at
  // once"); the dedupe key never had the same treatment applied.
  //
  // The title+time signature below is a fallback for events with no UID
  // at all, not an extra key added on top of a real one. It used to run
  // unconditionally — every event, UID or not, got a `sig:` key pushed
  // alongside its `uid:` key — so two genuinely different events on two
  // different calendars that happened to share a title and a time (a
  // generic "Lunch" on both Work and Life, say) collided on that `sig:`
  // key and one silently vanished from the merged list. Whichever
  // calendar's copy came first "won"; the other one's event just
  // disappeared rather than showing up under its own, correct calendar.
  if (event.uid) {
    keys.push(`uid:${event.uid.trim().toLowerCase()}|${instant(event.start)}`);
    return keys;
  }
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
//
// With one exception, learned the hard way. Someone whose iCloud
// calendars are also subscribed into Google has two copies of every
// event, and the Google copy of a subscribed calendar is *read-only* —
// Google answers any change to it with a bare 403 "Forbidden". Taking
// the Google copy unconditionally therefore handed the UI the one copy
// of the event that could not be edited or deleted, while the writable
// iCloud copy sat right there in the other list. The symptom was a
// Delete button that failed every time on an event the user plainly
// owns, with an error blaming permissions that had in fact been
// granted.
//
// So richer still wins — but never at the cost of writable. A copy that
// can be changed displaces one that can't.
export function mergeEvents(
  lists: RawEvent[][],
  limit: number
): EventSummary[] {
  // Maps each dedupe key to where its event sits in `merged`, so a
  // later duplicate can replace the earlier one rather than only being
  // dropped.
  const seen = new Map<string, number>();
  const merged: EventSummary[] = [];

  for (const list of lists) {
    for (const event of list) {
      const keys = dedupeKeys(event);

      let index: number | undefined;
      for (const k of keys) {
        const found = seen.get(k);
        if (found !== undefined) {
          index = found;
          break;
        }
      }

      if (index !== undefined) {
        const kept = merged[index];
        if (!kept.canWrite && event.canWrite) {
          // The identity stays the one already assigned. Prep
          // checklists hang off `key`, and swapping which copy is shown
          // shouldn't detach them.
          merged[index] = { ...event, key: kept.key };
          keys.forEach((k) => seen.set(k, index as number));
        }
        continue;
      }

      merged.push({ ...event, key: eventKey(event) });
      keys.forEach((k) => seen.set(k, merged.length - 1));
    }
  }

  merged.sort((a, b) => instant(a.start) - instant(b.start));
  return merged.slice(0, limit);
}
