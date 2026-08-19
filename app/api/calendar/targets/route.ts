import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  CALENDAR_EVENTS_SCOPE,
} from "@/lib/google";
import { listWritableCalendars } from "@/lib/calendar-write";
import { getAppleCredentials, listWritableAppleCalendars } from "@/lib/apple";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every calendar the user can actually put an event on, across both
// services.
//
// Writable, not readable. The Upcoming list is built from everything
// readable — subscribed holiday feeds, a colleague's shared calendar —
// and offering those as targets would mean a dropdown where half the
// choices fail on submit.
//
// Targets are addressed by an opaque string: a calendar id on Google, a
// CalDAV collection URL on Apple. Nothing upstream parses it, which is
// what lets one picker cover two very different services.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One service being unreachable shouldn't cost the user the other. A
  // picker listing only Google calendars is still useful; an error page
  // isn't.
  const [googleResult, appleResult] = await Promise.allSettled([
    (async () => {
      const client = await getAuthorizedClientForUser(userId);
      if (!client) return { calendars: [], status: "not_connected" as const };
      if (!hasScope(client.credentials.scope, CALENDAR_EVENTS_SCOPE)) {
        return { calendars: [], status: "scope_missing" as const };
      }
      return {
        calendars: await listWritableCalendars(client),
        status: "ok" as const,
      };
    })(),
    (async () => {
      const credentials = await getAppleCredentials(userId);
      if (!credentials) return { calendars: [], status: "not_connected" as const };
      const calendars = await listWritableAppleCalendars(credentials);
      return {
        calendars: calendars.map((c) => ({
          id: c.url,
          name: c.name,
          source: "apple" as const,
          primary: false,
        })),
        status: "ok" as const,
      };
    })(),
  ]);

  if (googleResult.status === "rejected") {
    console.error("Writable Google calendars failed", errorMessage(googleResult.reason));
  }
  if (appleResult.status === "rejected") {
    console.error("Writable Apple calendars failed", errorMessage(appleResult.reason));
  }

  const google =
    googleResult.status === "fulfilled"
      ? googleResult.value
      : { calendars: [], status: "error" as const };
  const apple =
    appleResult.status === "fulfilled"
      ? appleResult.value
      : { calendars: [], status: "error" as const };

  return NextResponse.json({
    calendars: [...google.calendars, ...apple.calendars],
    sources: { google: google.status, apple: apple.status },
  });
}
