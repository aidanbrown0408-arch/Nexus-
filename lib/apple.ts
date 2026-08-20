import { createDAVClient, type DAVCalendar } from "tsdav";
import ICAL from "ical.js";
import { getSupabaseAdmin, type AppleCredentialRow } from "./supabase";
import { decryptSecret, encryptSecret } from "./crypto";
import { toICalRRule, type Recurrence } from "./recurrence";
import type { RawEvent } from "./events";

// Apple Calendar, via CalDAV.
//
// Google gave us OAuth: a redirect, a consent screen, a token. Apple has
// no equivalent for iCloud Calendar — the only way in is CalDAV with an
// app-specific password the user generates at appleid.apple.com and
// pastes into a form. So there's no connect/callback pair here, just
// credentials we store and reuse.
//
// The other difference is the data. Google returns clean JSON; CalDAV
// returns raw iCalendar text, with recurring events as a rule rather
// than a list of instances. Everything below exists to turn that into
// the same EventSummary the Google side produces, so nothing downstream
// has to know two sources exist.

const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";

// Guards against a pathological series (a daily event set up in 2009)
// walking thousands of iterations before it reaches our window.
const MAX_OCCURRENCES_PER_SERIES = 3000;
export const APPLE_MAX_EVENTS = 250;
const MAX_EVENTS = APPLE_MAX_EVENTS;
// Matches the cap on the Google side — enough to know who a meeting is
// with, not so many that a big invite list rides along everywhere.
const MAX_ATTENDEES = 20;

export type AppleCredentials = {
  appleId: string;
  appPassword: string;
};

export class AppleAuthError extends Error {
  constructor(message = "Apple rejected those credentials") {
    super(message);
    this.name = "AppleAuthError";
  }
}

// --- credential storage -------------------------------------------------

export async function saveAppleCredentials(
  userId: string,
  credentials: AppleCredentials
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("apple_credentials").upsert(
    {
      user_id: userId,
      apple_id: credentials.appleId,
      // Encrypted rather than stored raw: unlike an OAuth token, an
      // app-specific password doesn't expire and grants whatever the
      // user generated it for until they revoke it by hand.
      app_password: encryptSecret(credentials.appPassword),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) throw error;
}

export async function getAppleCredentials(
  userId: string
): Promise<AppleCredentials | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("apple_credentials")
    .select("apple_id, app_password")
    .eq("user_id", userId)
    .maybeSingle<Pick<AppleCredentialRow, "apple_id" | "app_password">>();

  if (error) throw error;
  if (!data) return null;

  return {
    appleId: data.apple_id,
    appPassword: decryptSecret(data.app_password),
  };
}

export async function deleteAppleCredentials(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("apple_credentials")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

// Whether a row exists, without decrypting anything. The status route
// only needs to know "is this connected", and a key rotation shouldn't
// make that question fail.
export async function getAppleConnection(
  userId: string
): Promise<{ appleId: string; updatedAt: string | null } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("apple_credentials")
    .select("apple_id, updated_at")
    .eq("user_id", userId)
    .maybeSingle<Pick<AppleCredentialRow, "apple_id" | "updated_at">>();

  if (error) throw error;
  if (!data) return null;
  return { appleId: data.apple_id, updatedAt: data.updated_at ?? null };
}

// --- CalDAV -------------------------------------------------------------

type DAVClient = Awaited<ReturnType<typeof createDAVClient>>;

async function connect(credentials: AppleCredentials): Promise<DAVClient> {
  try {
    return await createDAVClient({
      serverUrl: ICLOUD_CALDAV_URL,
      credentials: {
        username: credentials.appleId,
        password: credentials.appPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  } catch (err) {
    // tsdav surfaces a 401 from the initial PROPFIND as a generic
    // error. Anything that fails this early is a credential problem in
    // practice — a wrong Apple ID, a typo'd password, or one the user
    // has since revoked on Apple's site.
    throw new AppleAuthError(
      err instanceof Error && /401|unauthor/i.test(err.message)
        ? "Apple rejected that Apple ID and app-specific password"
        : "Couldn't sign in to iCloud with those credentials"
    );
  }
}

// Try the credentials and report what we found, so the connect route can
// save only after confirming they work — and tell the user how many
// calendars came back rather than a bare "saved".
export async function verifyAppleCredentials(
  credentials: AppleCredentials
): Promise<{ calendarCount: number }> {
  const client = await connect(credentials);
  const calendars = await client.fetchCalendars();
  return { calendarCount: eventCalendars(calendars).length };
}

// iCloud hands back address books, reminder lists, and subscribed feeds
// alongside real calendars. Only collections that advertise VEVENT hold
// events; the rest would just be empty round-trips.
function eventCalendars(calendars: DAVCalendar[]): DAVCalendar[] {
  return calendars.filter((c) => {
    if (!c.url) return false;
    const components = c.components ?? [];
    return components.length === 0 || components.includes("VEVENT");
  });
}

function calendarName(calendar: DAVCalendar): string | null {
  const name = calendar.displayName;
  if (typeof name === "string" && name.trim()) return name.trim();
  return null;
}

// --- writes -------------------------------------------------------------

// An iCloud calendar the user can put an event on.
//
// CalDAV advertises write access through the `privilege-set` property,
// but iCloud is inconsistent about returning it, so read-only
// collections are excluded by what they are instead: subscribed feeds
// (which iCloud marks with a `subscribed` resource type) and anything
// that doesn't hold VEVENTs. A shared calendar someone gave read-only
// access to can still slip through — the create call fails cleanly with
// a 403 in that case, which the route turns into a readable message.
export type WritableAppleCalendar = {
  // The CalDAV collection URL. Unlike Google's calendar ids this is a
  // full URL, which is why targets are addressed as opaque strings
  // everywhere upstream rather than parsed.
  url: string;
  name: string;
};

export async function listWritableAppleCalendars(
  credentials: AppleCredentials
): Promise<WritableAppleCalendar[]> {
  const client = await connect(credentials);
  const calendars = eventCalendars(await client.fetchCalendars());

  return calendars
    .filter((c) => {
      const resourceType = c.resourcetype;
      // Subscribed feeds (holidays, sports fixtures) are readable and
      // never writable.
      if (Array.isArray(resourceType) && resourceType.includes("subscribed")) {
        return false;
      }
      return true;
    })
    .map((c) => ({
      url: c.url as string,
      name: calendarName(c) ?? "iCloud",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// iCloud wants UTC timestamps in basic format: 20260814T160000Z.
function toICalUtc(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// All-day events carry a bare YYYYMMDD with VALUE=DATE, and DTEND is
// exclusive — an all-day event on the 14th ends on the 15th. Getting
// this wrong is the classic way an all-day event renders as two days.
function toICalDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, "");
}

function nextDay(value: string): string {
  const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// iCalendar folds lines at 75 octets and escapes a specific set of
// characters. A comma in a location is enough to corrupt the file
// without this.
function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export type NewAppleEvent = {
  calendarUrl: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  recurrence?: Recurrence;
};

export type CreatedAppleEvent = {
  uid: string;
  calendarUrl: string;
  objectUrl: string;
};

// Put an event on an iCloud calendar.
//
// No attendee support, deliberately. Sending invitations over CalDAV
// means iTIP scheduling — the server mails guests on the organizer's
// behalf, and iCloud's handling of that from a third-party client is
// inconsistent enough that a half-working invite is worse than none.
// Guests on an Apple-targeted event are refused at the route rather than
// silently dropped here.
export async function createAppleEvent(
  credentials: AppleCredentials,
  event: NewAppleEvent
): Promise<CreatedAppleEvent> {
  const client = await connect(credentials);

  const calendars = await client.fetchCalendars();
  const calendar = calendars.find((c) => c.url === event.calendarUrl);
  if (!calendar) {
    throw new Error("That iCloud calendar is no longer there");
  }

  const uid = `nexus-${crypto.randomUUID()}`;
  const stamp = toICalUtc(new Date().toISOString());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nexus//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${toICalDate(event.start)}`
      : `DTSTART:${toICalUtc(event.start)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${toICalDate(nextDay(event.end))}`
      : `DTEND:${toICalUtc(event.end)}`,
    `SUMMARY:${escapeICalText(event.summary)}`,
  ];

  if (event.location) {
    lines.push(`LOCATION:${escapeICalText(event.location)}`);
  }
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }
  // Same RRULE the Google path sends, built by the same function. One
  // rule, two wire formats — a standup that repeats correctly on one
  // service and wrongly on the other is worse than one that doesn't
  // repeat at all.
  if (event.recurrence) {
    lines.push(toICalRRule(event.recurrence));
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  // CRLF, not LF. RFC 5545 requires it and iCloud rejects files that
  // use bare newlines.
  const iCalString = lines.join("\r\n") + "\r\n";
  const filename = `${uid}.ics`;

  const response = await client.createCalendarObject({
    calendar,
    filename,
    iCalString,
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("That iCloud calendar is read-only");
    }
    throw new Error(
      `iCloud refused the event (${response.status ?? "unknown error"})`
    );
  }

  const base = event.calendarUrl.endsWith("/")
    ? event.calendarUrl
    : `${event.calendarUrl}/`;

  return { uid, calendarUrl: event.calendarUrl, objectUrl: `${base}${filename}` };
}

// Remove an event Nexus created. Addressed by the object URL returned at
// creation, which is why only Nexus's own Apple events can be deleted —
// events fetched from iCloud don't carry their object URL through the
// parse path, so the delete route refuses them rather than guessing.
export async function deleteAppleEvent(
  credentials: AppleCredentials,
  objectUrl: string
): Promise<void> {
  const client = await connect(credentials);
  const response = await client.deleteCalendarObject({
    calendarObject: { url: objectUrl, etag: "" },
  });

  // Already gone is the state we were after.
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `iCloud refused the deletion (${response.status ?? "unknown error"})`
    );
  }
}

// Fetch events from now through `days` ahead across every iCloud
// calendar. Mirrors fetchUpcomingEvents on the Google side: same window,
// same output, one unreadable calendar doesn't sink the rest.
export async function fetchAppleEvents(
  credentials: AppleCredentials,
  days: number
): Promise<RawEvent[]> {
  const windowStart = new Date();
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + days);

  const client = await connect(credentials);
  const calendars = eventCalendars(await client.fetchCalendars());

  const results = await Promise.allSettled(
    calendars.map(async (calendar) => {
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start: windowStart.toISOString(),
          end: windowEnd.toISOString(),
        },
      });

      return objects.flatMap((object) => {
        if (!object.data || typeof object.data !== "string") return [];
        try {
          return parseCalendarObject(
            object.data,
            calendarName(calendar),
            windowStart,
            windowEnd
          );
        } catch (err) {
          // One malformed .ics shouldn't cost the user the calendar it
          // sits on, let alone every other calendar.
          console.error(
            "Apple Calendar: unparseable event",
            err instanceof Error ? err.message : err
          );
          return [];
        }
      });
    })
  );

  const events = results.flatMap((result, i) => {
    if (result.status === "fulfilled") return result.value;
    console.error(
      `Apple Calendar fetch failed for ${calendars[i]?.url}`,
      result.reason instanceof Error ? result.reason.message : result.reason
    );
    return [];
  });

  events.sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
  return events.slice(0, MAX_EVENTS);
}

// --- iCalendar parsing --------------------------------------------------

// A single .ics object can hold one event, or a recurring series plus
// every edited instance of it ("moved just this Tuesday's standup").
// Those edits arrive as separate VEVENTs sharing the series UID and
// carrying a RECURRENCE-ID, so they have to be related back to the
// master before expansion — otherwise the moved instance shows up twice,
// once at the old time and once at the new.
// Exported for testing: this is the only part of the Apple path that can
// be exercised without live iCloud credentials.
export function parseCalendarObject(
  ics: string,
  calendar: string | null,
  windowStart: Date,
  windowEnd: Date
): RawEvent[] {
  const component = new ICAL.Component(ICAL.parse(ics));

  // Floating and TZID-qualified times can't be resolved without the
  // VTIMEZONE definitions that ship in the same file.
  for (const vtimezone of component.getAllSubcomponents("vtimezone")) {
    const timezone = new ICAL.Timezone(vtimezone);
    if (timezone.tzid && !ICAL.TimezoneService.has(timezone.tzid)) {
      ICAL.TimezoneService.register(timezone, timezone.tzid);
    }
  }

  const vevents = component.getAllSubcomponents("vevent");
  if (!vevents.length) return [];

  const masters = vevents.filter((v) => !v.hasProperty("recurrence-id"));
  const overrides = vevents.filter((v) => v.hasProperty("recurrence-id"));
  const claimed = new Set<ICAL.Component>();
  const out: RawEvent[] = [];

  for (const master of masters) {
    const event = new ICAL.Event(master);

    for (const override of overrides) {
      if (override.getFirstPropertyValue("uid") !== event.uid) continue;
      claimed.add(override);
      try {
        event.relateException(new ICAL.Event(override));
      } catch {
        // ical.js throws when an override's UID or range doesn't line up
        // with the series. Dropping the relation leaves the unedited
        // occurrence in place, which beats dropping the event.
      }
    }

    if (!event.isRecurring()) {
      const single = toEventSummary(
        event,
        master,
        event.startDate,
        event.endDate,
        calendar
      );
      if (single && overlapsWindow(single, windowStart, windowEnd)) {
        out.push(single);
      }
      continue;
    }

    const iterator = event.iterator();
    let occurrence = iterator.next();
    let count = 0;

    while (occurrence && count < MAX_OCCURRENCES_PER_SERIES) {
      count++;
      // Occurrences come out in order, so the first one past the window
      // means every later one is too.
      if (occurrence.toJSDate() > windowEnd) break;

      const details = event.getOccurrenceDetails(occurrence);
      const summary = toEventSummary(
        // An edited instance carries its own title, location, and
        // attendees — read those off the override, not the master.
        details.item,
        details.item.component,
        details.startDate,
        details.endDate,
        calendar
      );

      if (summary && overlapsWindow(summary, windowStart, windowEnd)) {
        // Every instance of a series shares one UID, so the id has to
        // carry the occurrence too or React keys collide.
        out.push({ ...summary, id: `${summary.id}::${occurrence.toString()}` });
      }

      occurrence = iterator.next();
    }
  }

  // An override whose master isn't in this file (a single edited instance
  // synced on its own) would otherwise vanish entirely.
  for (const override of overrides) {
    if (claimed.has(override)) continue;
    const event = new ICAL.Event(override);
    const summary = toEventSummary(
      event,
      override,
      event.startDate,
      event.endDate,
      calendar
    );
    if (summary && overlapsWindow(summary, windowStart, windowEnd)) {
      out.push(summary);
    }
  }

  return out;
}

// An event counts as in-window if any part of it overlaps — a meeting
// that started an hour ago and runs another hour is still happening, and
// dropping it would be worse than showing it.
function overlapsWindow(
  event: RawEvent,
  windowStart: Date,
  windowEnd: Date
): boolean {
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  if (Number.isNaN(start)) return false;
  const finish = Number.isNaN(end) ? start : end;
  return finish >= windowStart.getTime() && start <= windowEnd.getTime();
}

function toEventSummary(
  event: ICAL.Event,
  component: ICAL.Component,
  startDate: ICAL.Time,
  endDate: ICAL.Time,
  calendar: string | null
): RawEvent | null {
  if (!startDate) return null;

  const status = component.getFirstPropertyValue("status");
  if (typeof status === "string" && status.toUpperCase() === "CANCELLED") {
    return null;
  }

  // isDate distinguishes an all-day event (a bare date) from a timed one,
  // the same distinction Google draws with `date` vs `dateTime`. Keep the
  // wire format identical to Google's so formatting code stays shared.
  const allDay = Boolean(startDate.isDate);
  const start = allDay ? startDate.toString() : startDate.toJSDate().toISOString();
  const end = endDate
    ? allDay
      ? endDate.toString()
      : endDate.toJSDate().toISOString()
    : start;

  const uid = event.uid ?? null;
  const attendees = attendeeEmails(component);

  return {
    id: uid ?? `${start}-${event.summary ?? ""}`,
    summary: event.summary || "(no title)",
    start,
    end,
    allDay,
    location: event.location?.trim() || null,
    attendeeCount: attendees.length,
    hangoutLink: conferenceLink(component),
    source: "apple",
    calendarName: calendar,
    // CalDAV writes aren't implemented, so nothing addresses an Apple
    // event for a mutation. Null rather than a guess keeps the write
    // routes honest about what they can act on.
    calendarId: null,
    // Apple events can't be deleted here at all (no object URL through
    // the parse path), so the series-vs-occurrence question never comes
    // up for them.
    recurringEventId: null,
    uid,
    attendees,
  };
}

// ATTENDEE values arrive as CAL-ADDRESS URIs — "mailto:you@example.com".
// Strip the scheme so these compare against Gmail's plain addresses when
// we go looking for mail related to a meeting.
function attendeeEmails(component: ICAL.Component): string[] {
  return component
    .getAllProperties("attendee")
    .map((property) => {
      const value = property.getFirstValue();
      return typeof value === "string" ? value.replace(/^mailto:/i, "") : "";
    })
    .filter((email) => email.includes("@"))
    .slice(0, MAX_ATTENDEES);
}

// RFC 7986 CONFERENCE is the standard way an .ics carries a join link,
// and it's what Zoom, Teams, and Meet write when they put an event on an
// iCloud calendar. Anything else (a URL buried in the notes) we leave
// alone rather than guess at.
function conferenceLink(component: ICAL.Component): string | null {
  const value = component.getFirstPropertyValue("conference");
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  return null;
}
