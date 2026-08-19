import {
  CALENDAR_READONLY_SCOPE,
  getAuthorizedClientForUser,
  hasScope,
} from "./google";
import { fetchUpcomingEvents } from "./calendar";
import { AppleAuthError, fetchAppleEvents, getAppleCredentials } from "./apple";
import { mergeEvents, type EventSummary, type RawEvent } from "./events";
import { errorMessage } from "./supabase";

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
  // Apple only: the app-specific password was wrong or has been revoked.
  | "auth_failed"
  | "error";

export type GatheredEvents = {
  events: EventSummary[];
  google: SourceStatus;
  apple: SourceStatus;
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
  days: number
): Promise<{ events: RawEvent[]; status: SourceStatus }> {
  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) return { events: [], status: "not_connected" };

    // Calendar was added after Gmail, so an account connected earlier
    // holds a token that predates the scope. The API would answer with a
    // bare 403; naming it here lets the UI offer a reconnect.
    if (!hasScope(client.credentials.scope, CALENDAR_READONLY_SCOPE)) {
      return { events: [], status: "scope_missing" };
    }

    return { events: await fetchUpcomingEvents(client, days), status: "ok" };
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 403) return { events: [], status: "scope_missing" };
    console.error("Google Calendar fetch failed", errorMessage(err));
    return { events: [], status: "error" };
  }
}

async function gatherApple(
  userId: string,
  days: number
): Promise<{ events: RawEvent[]; status: SourceStatus }> {
  try {
    const credentials = await getAppleCredentials(userId);
    if (!credentials) return { events: [], status: "not_connected" };

    return { events: await fetchAppleEvents(credentials, days), status: "ok" };
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

// Events from now through `days` ahead, across every connected calendar
// service, merged into one sorted list.
export async function gatherEvents(
  userId: string,
  days: number,
  limit: number = defaultLimitFor(days)
): Promise<GatheredEvents> {
  // Sequential would mean waiting on a slow CalDAV round-trip before
  // Google even starts. Neither call depends on the other.
  const [google, apple] = await Promise.all([
    gatherGoogle(userId, days),
    gatherApple(userId, days),
  ]);

  // Merged without a cap first, so the count is known before anything is
  // discarded. Merging straight to `limit` would make a truncated list
  // indistinguishable from a complete one.
  //
  // Note this only sees truncation at the merge step; each source also
  // caps its own fetch, so a calendar with more than a few hundred
  // events in the window can still be clipped upstream without a flag.
  const merged = mergeEvents(
    [google.events, apple.events],
    Number.MAX_SAFE_INTEGER
  );

  return {
    // Google first on purpose: where the same meeting exists on both
    // services, its record carries the attendee count and Meet link the
    // iCloud copy usually lacks, and mergeEvents keeps the first one.
    events: merged.slice(0, limit),
    google: google.status,
    apple: apple.status,
    truncated: merged.length > limit,
  };
}

// True when the user has no calendar service connected at all — the one
// case where a route should answer with an error rather than an empty
// list, because there's an action for the user to take.
export function noCalendarConnected(result: GatheredEvents): boolean {
  return result.google === "not_connected" && result.apple === "not_connected";
}
