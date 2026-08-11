import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { google } from "googleapis";
import {
  CALENDAR_READONLY_SCOPE,
  getAuthorizedClientForUser,
  hasScope,
} from "@/lib/google";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS_AHEAD = 7;

type EventSummary = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  attendeeCount: number;
  hangoutLink: string | null;
};

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

    const now = new Date();
    const timeMax = new Date(now);
    timeMax.setDate(timeMax.getDate() + DAYS_AHEAD);

    const calendar = google.calendar({ version: "v3", auth: client });
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      // Expand recurring events into individual instances; orderBy
      // requires it.
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 20,
    });

    const events: EventSummary[] = (res.data.items ?? [])
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
