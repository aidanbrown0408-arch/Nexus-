import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  CALENDAR_EVENTS_SCOPE,
} from "@/lib/google";
import { createEvent, validateEventTimes } from "@/lib/calendar-write";
import { createAppleEvent, getAppleCredentials } from "@/lib/apple";
import {
  describeRecurrence,
  parseRecurrence,
  type Recurrence,
} from "@/lib/recurrence";
import { logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUMMARY = 200;
const MAX_TEXT = 2000;

// Put something on a calendar the user picked.
//
// Creating is the safe half of this pair — the undo is a clean delete of
// an event nobody else has acted on yet. The one part that reaches other
// people is the guest list, so invites only go out when the user actually
// named guests.
//
// The target decides which service handles this. Google ids and CalDAV
// URLs are both just opaque strings by the time they get here, so the
// only thing that branches is `source`, which the picker sends alongside
// the id rather than being inferred from its shape.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let summary: string;
  let start: string;
  let end: string;
  let allDay = false;
  let location: string | undefined;
  let description: string | undefined;
  let attendees: string[] = [];
  let calendarId: string;
  let source: "google" | "apple";
  let recurrence: Recurrence | null = null;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.summary !== "string" || !body.summary.trim()) {
      return NextResponse.json(
        { error: "Give the event a title." },
        { status: 400 }
      );
    }
    if (typeof body.start !== "string" || typeof body.end !== "string") {
      return NextResponse.json(
        { error: "start and end are required" },
        { status: 400 }
      );
    }
    // No fallback to "primary". The user is asked to choose, so a
    // missing target is a bug worth surfacing rather than quietly
    // filing the event somewhere they didn't pick.
    if (typeof body.calendarId !== "string" || !body.calendarId.trim()) {
      return NextResponse.json(
        { error: "Choose which calendar this goes on." },
        { status: 400 }
      );
    }
    if (body.source !== "google" && body.source !== "apple") {
      return NextResponse.json(
        { error: "Unknown calendar type." },
        { status: 400 }
      );
    }
    calendarId = body.calendarId.trim();
    source = body.source;
    // parseRecurrence clamps the interval and count and returns null for
    // anything it can't make sense of, so a malformed rule creates a
    // one-off rather than something that fires 10,000 times.
    if (body.recurrence) {
      recurrence = parseRecurrence(body.recurrence);
      if (!recurrence) {
        return NextResponse.json(
          { error: "That repeat rule doesn't make sense." },
          { status: 422 }
        );
      }
    }

    summary = body.summary.trim().slice(0, MAX_SUMMARY);
    start = body.start;
    end = body.end;
    allDay = body.allDay === true;
    if (typeof body.location === "string" && body.location.trim()) {
      location = body.location.trim().slice(0, MAX_TEXT);
    }
    if (typeof body.description === "string" && body.description.trim()) {
      description = body.description.trim().slice(0, MAX_TEXT);
    }
    if (Array.isArray(body.attendees)) {
      attendees = body.attendees
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.trim())
        .filter((a) => a.includes("@"));
    }
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const invalid = validateEventTimes(start, end, allDay);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 422 });
  }

  // Sending invitations over CalDAV means iTIP scheduling, which iCloud
  // handles inconsistently from a third-party client. Refusing is better
  // than dropping the guests silently and leaving the user thinking
  // invites went out.
  if (source === "apple" && attendees.length) {
    return NextResponse.json(
      {
        error:
          "Nexus can't invite guests to an iCloud calendar. Put it on a Google calendar, or add it without guests.",
        code: "guests_unsupported",
      },
      { status: 422 }
    );
  }

  // --- Apple ------------------------------------------------------------
  if (source === "apple") {
    try {
      const credentials = await getAppleCredentials(userId);
      if (!credentials) {
        return NextResponse.json(
          { error: "Apple Calendar not connected", code: "not_connected" },
          { status: 400 }
        );
      }

      const created = await createAppleEvent(credentials, {
        calendarUrl: calendarId,
        summary,
        start,
        end,
        allDay,
        location,
        description,
        recurrence: recurrence ?? undefined,
      });

      const action = await logAction(userId, {
        kind: "event_create",
        summary: recurrence
          ? `Added "${summary}" to your iCloud calendar — ${describeRecurrence(
              recurrence
            ).toLowerCase()}`
          : `Added "${summary}" to your iCloud calendar`,
        // The object URL is what addresses the delete, and it only
        // exists because Nexus created this event — which is why undo
        // works here but deleting an arbitrary iCloud event doesn't.
        target: { objectUrl: created.objectUrl, source: "apple" },
        undo: "delete_event",
      });

      return NextResponse.json({
        event: {
          id: created.uid,
          calendarId: created.calendarUrl,
          summary,
          start,
          end,
          htmlLink: null,
        },
        actionId: action?.id ?? null,
      });
    } catch (err) {
      console.error("Apple event create failed", errorMessage(err));
      return NextResponse.json(
        {
          error:
            err instanceof Error && /read-only|no longer there/.test(err.message)
              ? err.message
              : "Couldn't add that to iCloud.",
          code: "create_failed",
        },
        { status: 503 }
      );
    }
  }

  // --- Google -----------------------------------------------------------
  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Calendar not connected", code: "not_connected" },
        { status: 400 }
      );
    }
    if (!hasScope(client.credentials.scope, CALENDAR_EVENTS_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to add events to your calendar.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const event = await createEvent(client, {
      summary,
      start,
      end,
      allDay,
      location,
      description,
      attendees,
      calendarId,
      recurrence: recurrence ?? undefined,
    });

    const repeats = recurrence
      ? ` — ${describeRecurrence(recurrence).toLowerCase()}`
      : "";

    const action = await logAction(userId, {
      kind: "event_create",
      summary: attendees.length
        ? `Added "${event.summary}"${repeats} and invited ${
            attendees.length
          } guest${attendees.length === 1 ? "" : "s"}`
        : `Added "${event.summary}" to your calendar${repeats}`,
      target: {
        eventId: event.id,
        calendarId: event.calendarId,
        source: "google",
      },
      undo: "delete_event",
    });

    return NextResponse.json({ event, actionId: action?.id ?? null });
  } catch (err) {
    console.error("Event create failed", errorMessage(err));
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 403) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to add events to your calendar.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't add that event.", code: "create_failed" },
      { status: 503 }
    );
  }
}
