import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_READONLY_SCOPE,
  getAuthorizedClientForUser,
  hasScope,
  isGoogleAuthFailure,
} from "./google";
import { fetchUpcomingEvents, GOOGLE_MAX_EVENTS } from "./calendar";
import { isPast } from "./calendar-window";
import {
  APPLE_MAX_EVENTS,
  AppleAuthError,
  fetchAppleEvents,
  getAppleCredentials,
} from "./apple";
import { mergeEvents, type EventSummary, type RawEvent } from "./events";
import { errorMessage } from "./supabase";
import { getProfile } from "./profile";

// One place that knows how many calendar services exist. Routes ask for
// "the user's events" and get a single merged list back, plus a per-source
// status so the UI can say *which* half is missing when one is.
//
// Both sources are optional and independent: Google can be connected and
// Apple not, either can fail on its own, and neither failing should take
// the other's events down with it.

export type SourceStatus =
  | "ok"
  // No credentials stored for this service at all.
  | "not_connected"
  // Google only: connected, but the token predates the Calendar scope.
  | "scope_missing"
  // Google only: the grant itself is dead — revoked, or expired the way
  // a Testing-mode consent screen expires refresh tokens after a week.
  // Not "error": retrying never fixes it, reconnecting always does.
  | "auth_expired"
  // Apple only: the app-specific password was wrong or has been revoked.
  | "auth_failed"
  | "error";

export type GatheredEvents = {
  events: EventSummary[];
  google: SourceStatus;
  apple: SourceStatus;
  // Whether Google granted the *write* scope, not just the read one.
  // They're separate consents on the same screen, so an account can list
  // events perfectly and refuse every edit and delete. The card needs to
  // know up front: finding out by clicking Delete and getting a 403 is
  // how this reads as a broken button rather than a missing permission.
  googleCanWrite: boolean;
  // True when there were more events in the window than the limit
  // allowed. A truncated list looks exactly like a complete one, and a
  // calendar app that quietly hides your last three weeks is worse than
  // one that admits it's showing a slice.
  truncated: boolean;
};

// A week's worth fits comfortably in 50. Longer windows need more room,
// but not unbounded room — this is what one card renders and what one
// prompt carries.
function defaultLimitFor(days: number): number {
  if (days <= 7) return 50;
  if (days <= 30) return 150;
  return 300;
}

async function gatherGoogle(
  userId: string,
  days: number,
  timeZone: string | null
): Promise<{ events: RawEvent[]; status: SourceStatus; canWrite: boolean }> {
  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) return { events: [], status: "not_connected", canWrite: false };

    // Calendar was added after Gmail, so an account connected earlier
    // holds a token that predates the scope. The API would answer with a
    // bare 403; naming it here lets the UI offer a reconnect.
    if (!hasScope(client.credentials.scope, CALENDAR_READONLY_SCOPE)) {
      return { events: [], status: "scope_missing", canWrite: false };
    }

    return {
      events: await fetchUpcomingEvents(client, days, timeZone),
      status: "ok",
      canWrite: hasScope(client.credentials.scope, CALENDAR_EVENTS_SCOPE),
    };
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 403) {
      return { events: [], status: "scope_missing", canWrite: false };
    }
    if (isGoogleAuthFailure(err)) {
      return { events: [], status: "auth_expired", canWrite: false };
    }
    console.error("Google Calendar fetch failed", errorMessage(err));
    return { events: [], status: "error", canWrite: false };
  }
}

async function gatherApple(
  userId: string,
  days: number,
  timeZone: string | null
): Promise<{ events: RawEvent[]; status: SourceStatus }> {
  try {
    const credentials = await getAppleCredentials(userId);
    if (!credentials) return { events: [], status: "not_connected" };

    return {
      events: await fetchAppleEvents(credentials, days, timeZone),
      status: "ok",
    };
  } catch (err: unknown) {
    // App-specific passwords don't expire, but users do revoke them —
    // and unlike OAuth there's no refresh to attempt, so this always
    // means "ask for a new one".
    if (err instanceof AppleAuthError) {
      return { events: [], status: "auth_failed" };
    }
    console.error("Apple Calendar fetch failed", errorMessage(err));
    return { events: [], status: "error" };
  }
}

// Events across every connected calendar service, merged into one sorted
// list.
//
// Both sources now fetch from local midnight rather than from `now`, so
// that the calendar board can show what already happened today instead of
// announcing "nothing scheduled" at 6pm. Everything else that reads this
// — the brief, chat, prep — wants what's still ahead, so finished events
// are filtered back out here unless the caller asks for them.
export async function gatherEvents(
  userId: string,
  days: number,
  limit: number = defaultLimitFor(days),
  options: { includePast?: boolean; timeZone?: string | null } = {}
): Promise<GatheredEvents> {
  // Which midnight the window starts at depends on whose calendar this
  // is — see lib/calendar-window.ts for what went wrong when it didn't.
  // Callers that already hold the profile pass the zone in; the rest
  // pay one read for it rather than silently getting the host's.
  let timeZone = options.timeZone ?? null;
  if (!timeZone) {
    try {
      timeZone = (await getProfile(userId))?.timezone ?? null;
    } catch (err) {
      // A profile that can't be read is not a reason to show no
      // calendar. resolveTimezone falls back to the host.
      console.error("Calendar: timezone unavailable", errorMessage(err));
    }
  }

  // Sequential would mean waiting on a slow CalDAV round-trip before
  // Google even starts. Neither call depends on the other.
  const [google, apple] = await Promise.all([
    gatherGoogle(userId, days, timeZone),
    gatherApple(userId, days, timeZone),
  ]);

  // Merged without a cap first, so the count is known before anything is
  // discarded. Merging straight to `limit` would make a truncated list
  // indistinguishable from a complete one.
  const mergedAll = mergeEvents(
    [google.events, apple.events],
    Number.MAX_SAFE_INTEGER
  );

  const merged = options.includePast
    ? mergedAll
    : mergedAll.filter((event) => !isPast(event));

  // Truncation can happen twice: here, and inside each source, which
  // clips its own fetch before the merge ever sees it. Checking only the
  // merge missed the worse case — one busy Google calendar with 400
  // events in 90 days returns exactly 250, the merge is under its limit,
  // and the card asserts a complete list with 150 events silently gone.
  const clippedUpstream =
    google.events.length >= GOOGLE_MAX_EVENTS ||
    apple.events.length >= APPLE_MAX_EVENTS;

  return {
    // Google first on purpose: where the same meeting exists on both
    // services, its record carries the attendee count and Meet link the
    // iCloud copy usually lacks, and mergeEvents keeps the first one.
    events: merged.slice(0, limit),
    google: google.status,
    apple: apple.status,
    googleCanWrite: google.canWrite,
    truncated: merged.length > limit || clippedUpstream,
  };
}

// True when the user has no calendar service connected at all — the one
// case where a route should answer with an error rather than an empty
// list, because there's an action for the user to take.
export function noCalendarConnected(result: GatheredEvents): boolean {
  return result.google === "not_connected" && result.apple === "not_connected";
}
