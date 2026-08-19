import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { gatherEvents, noCalendarConnected } from "@/lib/calendar-sources";
import { listGeneratedKeys, listPrepItems } from "@/lib/prep";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How far ahead the card can look. A week is the default because it's
// the horizon most people actually plan against; the longer ranges exist
// for "when am I free next month" questions.
//
// Whitelisted rather than free-form: `days` reaches a Google API call and
// an iCloud time-range query, and an arbitrary number is an invitation to
// ask for ten years of events and time the request out.
const ALLOWED_DAYS = [7, 30, 90] as const;
const DEFAULT_DAYS = 7;

function daysFrom(request: NextRequest): number {
  const raw = Number(request.nextUrl.searchParams.get("days"));
  return (ALLOWED_DAYS as readonly number[]).includes(raw) ? raw : DEFAULT_DAYS;
}

// Returns one merged list from every calendar service the user has
// connected, plus a status per service. The list is the answer; the
// statuses only exist so the UI can explain a gap ("Apple Calendar needs
// a new password") instead of quietly showing half a week.
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const days = daysFrom(request);
    const result = await gatherEvents(userId, days);

    // Nothing connected is the one case with a clear next step, so it
    // stays an error the UI can key off rather than an empty list.
    if (noCalendarConnected(result)) {
      return NextResponse.json(
        { error: "No calendar connected", code: "not_connected" },
        { status: 400 }
      );
    }

    // Prep checklists ride along with the events rather than sitting
    // behind their own request per event — the card needs both to render
    // a single row, and one query covers every event on screen.
    const keys = result.events.map((event) => event.key);
    const [prep, generated] = await Promise.all([
      listPrepItems(userId, keys),
      listGeneratedKeys(userId, keys),
    ]);

    return NextResponse.json({
      events: result.events,
      sources: { google: result.google, apple: result.apple },
      // Echoed back so the card's copy describes the window it actually
      // got, not the one it asked for.
      days,
      truncated: result.truncated,
      prep,
      // Lets the UI tell "never drafted" apart from "drafted, and the
      // answer was nothing" — the second shouldn't nag for a redraft.
      generated,
    });
  } catch (err: unknown) {
    // gatherEvents catches per-source failures itself, so anything
    // reaching here is infrastructure — Supabase down, no encryption key.
    console.error("Calendar events fetch failed", errorMessage(err));
    return NextResponse.json(
      { error: "Failed to load your calendar" },
      { status: 500 }
    );
  }
}
