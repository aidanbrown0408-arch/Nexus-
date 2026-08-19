import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { toGoogleRecurrence, type Recurrence } from "./recurrence";

// Creating and deleting calendar events.
//
// This is the first thing Nexus does that other people find out about.
// Trashing an email is private and reversible; cancelling a meeting emails
// everyone on it, and no undo un-sends that mail. Three things follow:
//
//   - Deletion is never batched. One event, one confirmation, with the
//     attendee count in front of the user before they commit.
//   - Guests are not notified by default. `sendUpdates: "none"` unless the
//     caller explicitly asks otherwise, so a mistake stays quiet enough
//     to fix.
//   - Every deletion snapshots the event first. "Undo" recreates it from
//     that snapshot, which is an honest restore of the details but a new
//     event id — see restoreEvent for what that does and doesn't get back.

// A calendar the user can actually put an event on.
//
// Read access and write access aren't the same thing, and the Upcoming
// list is built from everything readable — a subscribed holiday feed, a
// colleague's shared calendar. Offering those as targets would produce a
// dropdown where half the options fail on submit, so this list is
// filtered to what Google says the user owns or can write to.
export type WritableCalendar = {
  id: string;
  name: string;
  source: "google" | "apple";
  primary: boolean;
};

export async function listWritableCalendars(
  client: OAuth2Client
): Promise<WritableCalendar[]> {
  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.calendarList.list({ maxResults: 250 });

  return (res.data.items ?? [])
    .filter(
      (c) =>
        !c.deleted &&
        c.id &&
        (c.accessRole === "owner" || c.accessRole === "writer")
    )
    .map((c) => ({
      id: c.id as string,
      name: c.summaryOverride ?? c.summary ?? "(unnamed)",
      source: "google" as const,
      primary: c.primary === true,
    }))
    // Primary first, then alphabetical — the common target shouldn't
    // require hunting for it.
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export type NewEvent = {
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  attendees?: string[];
  calendarId?: string;
  recurrence?: Recurrence;
};

// Everything needed to put a deleted event back. Stored in the action log
// as JSON, so it has to stay small and free of anything Google would
// reject on the way back in.
export type EventSnapshot = {
  calendarId: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  attendees: string[];
  // Google's own RRULE strings, kept verbatim rather than parsed back
  // into a Recurrence. A rule we can't fully model — BYSETPOS, EXDATE on
  // a series someone edited by hand — would be lost by a round trip, and
  // restoring a weekly standup as a one-off is a bad way to find that
  // out.
  recurrence?: string[];
};

export type WrittenEvent = {
  id: string;
  calendarId: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string | null;
};

const MAX_ATTENDEES = 50;

// All-day events take `date` (YYYY-MM-DD); timed ones take `dateTime`.
// Sending the wrong one is the single most common way a calendar write
// fails, so both paths are built in one place.
function toEventDate(value: string, allDay: boolean) {
  if (allDay) {
    // Tolerate a full ISO timestamp for an all-day event by taking the
    // date half — the UI's date input gives a bare date, but the undo
    // path replays whatever was stored.
    return { date: value.slice(0, 10) };
  }
  return { dateTime: new Date(value).toISOString() };
}

export async function createEvent(
  client: OAuth2Client,
  event: NewEvent
): Promise<WrittenEvent> {
  const calendar = google.calendar({ version: "v3", auth: client });
  const calendarId = event.calendarId || "primary";

  const attendees = (event.attendees ?? [])
    .map((email) => email.trim())
    .filter(Boolean)
    .slice(0, MAX_ATTENDEES)
    .map((email) => ({ email }));

  const res = await calendar.events.insert({
    calendarId,
    // Invites are the one part of creation that reaches other people, so
    // they only go out when there are actually guests to send them to.
    sendUpdates: attendees.length ? "all" : "none",
    requestBody: {
      summary: event.summary,
      location: event.location || undefined,
      description: event.description || undefined,
      start: toEventDate(event.start, event.allDay),
      end: toEventDate(event.end, event.allDay),
      attendees: attendees.length ? attendees : undefined,
      // The start/end above describe the first occurrence; the rule says
      // when it happens again. Google expands the series itself, so
      // nothing downstream has to.
      recurrence: event.recurrence
        ? toGoogleRecurrence(event.recurrence)
        : undefined,
    },
  });

  return {
    id: res.data.id ?? "",
    calendarId,
    summary: res.data.summary ?? event.summary,
    start: res.data.start?.dateTime ?? res.data.start?.date ?? event.start,
    end: res.data.end?.dateTime ?? res.data.end?.date ?? event.end,
    htmlLink: res.data.htmlLink ?? null,
  };
}

// Read an event back before deleting it, so there's something to restore
// from. Returns null when the event is already gone — which makes the
// delete a no-op rather than an error.
export async function snapshotEvent(
  client: OAuth2Client,
  calendarId: string,
  eventId: string
): Promise<EventSnapshot | null> {
  const calendar = google.calendar({ version: "v3", auth: client });

  try {
    const res = await calendar.events.get({ calendarId, eventId });
    const e = res.data;
    const allDay = Boolean(e.start?.date);

    return {
      calendarId,
      summary: e.summary ?? "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? "",
      end: e.end?.dateTime ?? e.end?.date ?? "",
      allDay,
      location: e.location ?? null,
      description: e.description ?? null,
      attendees: (e.attendees ?? [])
        .map((a) => a.email)
        .filter((email): email is string => Boolean(email))
        .slice(0, MAX_ATTENDEES),
      recurrence: e.recurrence ?? undefined,
    };
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 404 || code === 410) return null;
    throw err;
  }
}

// Delete one event.
//
// `notifyGuests` defaults to false and the caller has to opt in. A
// cancellation notice is the part of this that can't be taken back, so
// it's a decision the user makes rather than a default they discover.
export async function deleteEvent(
  client: OAuth2Client,
  calendarId: string,
  eventId: string,
  notifyGuests = false
): Promise<void> {
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: notifyGuests ? "all" : "none",
    });
  } catch (err) {
    // Already deleted is the state we wanted.
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code !== 404 && code !== 410) throw err;
  }
}

// Put a deleted event back from its snapshot.
//
// Worth being precise about what this is: the event returns with the same
// title, time, location, description, and guest list, but a *new* id.
// Anything that referenced the old id — a prep checklist keyed to it, an
// attendee's own copy — doesn't reattach. It's a real restore of the
// meeting, not a rollback of history, and the UI says so.
export async function restoreEvent(
  client: OAuth2Client,
  snapshot: EventSnapshot
): Promise<WrittenEvent> {
  const calendar = google.calendar({ version: "v3", auth: client });
  const calendarId = snapshot.calendarId;

  const attendees = snapshot.attendees
    .slice(0, MAX_ATTENDEES)
    .map((email) => ({ email }));

  // Goes through the API directly rather than createEvent so the stored
  // RRULE strings can be replayed verbatim. Parsing them back into a
  // Recurrence just to re-serialise would quietly drop anything the
  // model doesn't cover.
  const res = await calendar.events.insert({
    calendarId,
    sendUpdates: attendees.length ? "all" : "none",
    requestBody: {
      summary: snapshot.summary,
      location: snapshot.location ?? undefined,
      description: snapshot.description ?? undefined,
      start: toEventDate(snapshot.start, snapshot.allDay),
      end: toEventDate(snapshot.end, snapshot.allDay),
      attendees: attendees.length ? attendees : undefined,
      recurrence: snapshot.recurrence?.length ? snapshot.recurrence : undefined,
    },
  });

  return {
    id: res.data.id ?? "",
    calendarId,
    summary: res.data.summary ?? snapshot.summary,
    start: res.data.start?.dateTime ?? res.data.start?.date ?? snapshot.start,
    end: res.data.end?.dateTime ?? res.data.end?.date ?? snapshot.end,
    htmlLink: res.data.htmlLink ?? null,
  };
}

// Reject a create that would land in the past or run backwards. Google
// accepts both, and both are almost always a UI slip rather than intent.
export function validateEventTimes(
  start: string,
  end: string,
  allDay: boolean
): string | null {
  const startMs = new Date(allDay ? `${start.slice(0, 10)}T00:00:00` : start).getTime();
  const endMs = new Date(allDay ? `${end.slice(0, 10)}T23:59:59` : end).getTime();

  if (Number.isNaN(startMs)) return "That start time isn't a real date.";
  if (Number.isNaN(endMs)) return "That end time isn't a real date.";
  if (endMs <= startMs) return "The event ends before it starts.";

  return null;
}
