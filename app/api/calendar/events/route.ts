import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  CALENDAR_READONLY_SCOPE,
  getAuthorizedClientForUser,
  hasScope,
} from "@/lib/google";
import { fetchUpcomingEvents } from "@/lib/calendar";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS_AHEAD = 7;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Google not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    // Calendar was added after Gmail, so anyone who connected earlier
    // holds a token that predates the scope. The API would reject the
    // call with a bare 403; catching it here lets the UI ask for a
    // reconnect instead of showing a dead end.
    if (!hasScope(client.credentials.scope, CALENDAR_READONLY_SCOPE)) {
      return NextResponse.json(
        {
          error: "Calendar access was not granted",
          code: "scope_missing",
        },
        { status: 400 }
      );
    }

    const events = await fetchUpcomingEvents(client, DAYS_AHEAD);

    return NextResponse.json({ events });
  } catch (err: unknown) {
    console.error("Calendar events fetch failed", errorMessage(err));
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    // A 403 here means the token predates the scope in a way the check
    // above missed — treat it the same way rather than as a hard error.
    if (code === 403) {
      return NextResponse.json(
        { error: "Calendar access was not granted", code: "scope_missing" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch events from Google Calendar" },
      { status: code === 401 ? 401 : 500 }
    );
  }
}
