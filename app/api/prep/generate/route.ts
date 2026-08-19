import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { gatherEvents } from "@/lib/calendar-sources";
import { getAuthorizedClientForUser } from "@/lib/google";
import { fetchRecentMessages } from "@/lib/gmail";
import { findRelatedEmails, generatePrepItems } from "@/lib/prep";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How far ahead to look when resolving the event being asked about.
// Matches the calendar card's window — you can't click Draft prep on an
// event you can't see.
// Wide enough to cover the longest window the Upcoming card offers. This
// route looks up one event the user clicked "draft prep" on, so a short
// horizon meant the button silently failed for anything past next week —
// the event was on screen but not in the list this route searched.
const DAYS_AHEAD = 90;
const MESSAGE_LIMIT = 30;

// Asks Claude what needs doing before one event, and saves the answer.
//
// The client sends only an event key. The event itself is re-fetched
// here rather than posted up, so nobody can generate a checklist against
// a made-up event, and the model sees the calendar's own wording rather
// than whatever the browser last rendered.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let eventKey: string;
  try {
    const body = (await request.json()) as { eventKey?: unknown };
    if (typeof body.eventKey !== "string" || !body.eventKey.trim()) {
      return NextResponse.json({ error: "eventKey is required" }, { status: 400 });
    }
    eventKey = body.eventKey;
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  try {
    const { events } = await gatherEvents(userId, DAYS_AHEAD);
    const event = events.find((e) => e.key === eventKey);

    if (!event) {
      // Usually means the event moved or was deleted since the page
      // loaded, so the useful advice is "refresh", not "try again".
      return NextResponse.json(
        {
          error: "That event isn't on your calendar anymore.",
          code: "event_not_found",
        },
        { status: 404 }
      );
    }

    // Mail is context, not a requirement — a prep list from the event
    // alone is still worth having, so a Gmail failure doesn't fail this.
    let relatedEmails: ReturnType<typeof findRelatedEmails> = [];
    try {
      const client = await getAuthorizedClientForUser(userId);
      if (client) {
        const messages = await fetchRecentMessages(client, MESSAGE_LIMIT);
        relatedEmails = findRelatedEmails(event, messages);
      }
    } catch (err) {
      console.error("Prep: related mail unavailable", errorMessage(err));
    }

    const items = await generatePrepItems(userId, event, relatedEmails);

    return NextResponse.json({ items });
  } catch (err: unknown) {
    console.error("Prep generation failed", errorMessage(err));
    return NextResponse.json(
      {
        error: "Couldn't draft a prep list just now.",
        code: "prep_unavailable",
      },
      { status: 503 }
    );
  }
}
