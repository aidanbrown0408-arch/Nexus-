import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export type EventSummary = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendeeCount: number;
  hangoutLink: string | null;
};

// Most events a person cares about don't live on the primary calendar —
// they're on secondary or subscribed ones (work, school, family). Querying
// only "primary" silently drops those, so we fan out across every calendar
// the user has switched on.
const MAX_EVENTS = 50;

// Fetch events from now through `days` ahead across all of the user's
// visible calendars, in start order. Assumes the caller has already
// confirmed the token carries the Calendar scope — the scope check stays
// with the route so it can answer with its own code. Throws whatever the
// Calendar API throws when the calendar list itself can't be read.
export async function fetchUpcomingEvents(
  client: OAuth2Client,
  days: number
): Promise<EventSummary[]> {
  const now = new Date();
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + days);

  const calendar = google.calendar({ version: "v3", auth: client });

  const calendarList = await calendar.calendarList.list({ maxResults: 250 });
  // `selected` is what the checkbox in Google Calendar controls, and the API
  // omits it entirely when off — so match on `=== true` and let the primary
  // through regardless. This keeps holiday feeds and stale subscriptions out
  // unless the user actually displays them.
  const calendarIds = (calendarList.data.items ?? [])
    .filter((c) => !c.deleted && (c.selected === true || c.primary === true))
    .map((c) => c.id)
    .filter((id): id is string => Boolean(id));

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
    if (result.status === "fulfilled") return result.value.data.items ?? [];
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
  const unique = items.filter((e) => {
    const key = e.iCalUID ?? e.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const events: EventSummary[] = unique
    .filter((e) => e.status !== "cancelled")
    .map((e) => {
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
      };
    })
    .filter((e) => e.start);

  // Each calendar came back sorted on its own; the merged list isn't. Sort on
  // the parsed instant rather than the raw string, since all-day events carry
  // a bare YYYY-MM-DD that doesn't compare correctly against a full timestamp.
  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return events.slice(0, MAX_EVENTS);
}
