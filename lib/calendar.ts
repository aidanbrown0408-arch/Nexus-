import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { EventSummary, RawEvent } from "./events";

// EventSummary lives in ./events now that Apple Calendar produces it too.
// Re-exported here so existing imports from "@/lib/calendar" keep working.
export type { EventSummary };

// Most events a person cares about don't live on the primary calendar —
// they're on secondary or subscribed ones (work, school, family). Querying
// only "primary" silently drops those, so we fan out across every calendar
// the user has switched on.
// Matches the maxResults already asked of the API. Sized for a week, a
// cap of 50 silently swallowed most of a 90-day window.
const MAX_EVENTS = 250;
// Enough to tell who a meeting is with when drafting its prep list.
// A 200-person all-hands doesn't need every address carried around.
const MAX_ATTENDEES = 20;

// Fetch events from now through `days` ahead across all of the user's
// visible calendars, in start order. Assumes the caller has already
// confirmed the token carries the Calendar scope — the scope check stays
// with the route so it can answer with its own code. Throws whatever the
// Calendar API throws when the calendar list itself can't be read.
export async function fetchUpcomingEvents(
  client: OAuth2Client,
  days: number
): Promise<RawEvent[]> {
  const now = new Date();
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + days);

  const calendar = google.calendar({ version: "v3", auth: client });

  const calendarList = await calendar.calendarList.list({ maxResults: 250 });
  // `selected` is what the checkbox in Google Calendar controls, and the API
  // omits it entirely when off — so match on `=== true` and let the primary
  // through regardless. This keeps holiday feeds and stale subscriptions out
  // unless the user actually displays them.
  const visible = (calendarList.data.items ?? []).filter(
    (c) => !c.deleted && (c.selected === true || c.primary === true) && c.id
  );
  const calendarIds = visible.map((c) => c.id as string);
  // Kept alongside the ids so each event can carry the name of the
  // calendar it came from, the way the Apple side does.
  const calendarNames = new Map(
    visible.map((c) => [c.id as string, c.summaryOverride ?? c.summary ?? null])
  );

  const results = await Promise.allSettled(
    calendarIds.map((calendarId) =>
      calendar.events.list({
        calendarId,
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        // Expand recurring events into individual instances; orderBy
        // requires it.
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      })
    )
  );

  const items = results.flatMap((result, i) => {
    if (result.status === "fulfilled") {
      // Carry the calendar id alongside each event — the response items
      // don't name the calendar they came from, and the flatten below
      // would otherwise lose it.
      return (result.value.data.items ?? []).map((item) => ({
        item,
        calendarId: calendarIds[i],
      }));
    }
    // One unreadable calendar shouldn't cost the user every other event.
    console.error(
      `Calendar fetch failed for ${calendarIds[i]}`,
      result.reason instanceof Error ? result.reason.message : result.reason
    );
    return [];
  });

  // The same meeting can sit on two calendars the user has switched on (an
  // invite on the primary that a shared calendar also carries). Google gives
  // those copies different event ids but the same iCalUID, so dedupe on that.
  const seen = new Set<string>();
  const unique = items.filter(({ item: e }) => {
    const key = e.iCalUID ?? e.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const events: RawEvent[] = unique
    .filter(({ item: e }) => e.status !== "cancelled")
    .map(({ item: e, calendarId }) => {
      // All-day events carry `date` (YYYY-MM-DD); timed events carry
      // `dateTime`. Which one is set is the only signal for all-day.
      const allDay = Boolean(e.start?.date);
      const start = e.start?.dateTime ?? e.start?.date ?? "";
      const end = e.end?.dateTime ?? e.end?.date ?? "";

      return {
        id: e.id ?? "",
        summary: e.summary || "(no title)",
        start,
        end,
        allDay,
        location: e.location ?? null,
        attendeeCount: e.attendees?.length ?? 0,
        hangoutLink: e.hangoutLink ?? null,
        source: "google" as const,
        calendarName: calendarNames.get(calendarId) ?? null,
        calendarId,
        recurringEventId: e.recurringEventId ?? null,
        uid: e.iCalUID ?? null,
        attendees: (e.attendees ?? [])
          .map((a) => a.email)
          .filter((email): email is string => Boolean(email))
          .slice(0, MAX_ATTENDEES),
      };
    })
    .filter((e) => e.start);

  // Each calendar came back sorted on its own; the merged list isn't. Sort on
  // the parsed instant rather than the raw string, since all-day events carry
  // a bare YYYY-MM-DD that doesn't compare correctly against a full timestamp.
  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return events.slice(0, MAX_EVENTS);
}
