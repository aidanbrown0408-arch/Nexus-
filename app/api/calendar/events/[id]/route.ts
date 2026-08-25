import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  CALENDAR_EVENTS_SCOPE,
} from "@/lib/google";
import {
  deleteEvent,
  snapshotEvent,
  updateEvent,
  validateEventTimes,
} from "@/lib/calendar-write";
import {
  deleteAppleEvent,
  getAppleCredentials,
  snapshotAppleEvent,
  updateAppleEvent,
} from "@/lib/apple";
import { logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

const MAX_SUMMARY = 200;
const MAX_TEXT = 2000;

// Delete one calendar event, Google or Apple.
//
// One event per request, deliberately — there is no batch endpoint and
// there shouldn't be. Cancelling a Google meeting can email its guests,
// and that mail is the part no undo reaches. The client has to pass
// `notifyGuests` explicitly to send it; the default is silence. Apple
// events here never carry guests (see lib/apple.ts), so that question
// doesn't come up for them.
//
// The event is snapshotted before removal so the action log can restore
// it. That restore brings the meeting back with a new id, not the old
// one — the log's summary says as much.
export async function DELETE(request: NextRequest, { params }: Context) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const source = url.searchParams.get("source") === "apple" ? "apple" : "google";
  const notifyGuests = url.searchParams.get("notifyGuests") === "true";

  // --- Apple --------------------------------------------------------------
  if (source === "apple") {
    const calendarUrl = url.searchParams.get("calendarId");
    const objectUrl = url.searchParams.get("objectUrl");
    if (!calendarUrl || !objectUrl) {
      return NextResponse.json(
        {
          error: "Nexus doesn't have enough to find that iCloud event.",
          code: "unsupported_source",
        },
        { status: 422 }
      );
    }

    try {
      const credentials = await getAppleCredentials(userId);
      if (!credentials) {
        return NextResponse.json(
          { error: "Apple Calendar not connected", code: "not_connected" },
          { status: 400 }
        );
      }

      const snapshot = await snapshotAppleEvent(credentials, calendarUrl, objectUrl);
      if (!snapshot) {
        // Gone already — usually the page was open a while. Nothing to do
        // and nothing to log.
        return NextResponse.json({ ok: true, alreadyGone: true });
      }

      await deleteAppleEvent(credentials, objectUrl);

      const action = await logAction(userId, {
        kind: "event_delete",
        summary: `Deleted "${snapshot.summary}" from your iCloud calendar`,
        target: { snapshot: JSON.stringify(snapshot), source: "apple" },
        undo: "restore_event",
      });

      return NextResponse.json({
        ok: true,
        actionId: action?.id ?? null,
        guestsNotified: false,
        deletedSeries: false,
        seriesId: null,
      });
    } catch (err) {
      console.error("Apple event delete failed", errorMessage(err));
      return NextResponse.json(
        { error: "Couldn't delete that event.", code: "delete_failed" },
        { status: 503 }
      );
    }
  }

  // --- Google ---------------------------------------------------------------
  const calendarId = url.searchParams.get("calendarId");
  // For a repeating event: which id to delete. `series` targets the
  // master event and takes every occurrence with it; anything else
  // targets the single instance the user clicked. There's no default
  // that's right for both, which is why the confirm dialog asks.
  const seriesId = url.searchParams.get("seriesId");
  const scope = url.searchParams.get("scope") === "series" ? "series" : "one";
  const targetId = scope === "series" && seriesId ? seriesId : params.id;

  if (!calendarId) {
    return NextResponse.json(
      {
        error: "Nexus can only delete Google Calendar events with a calendar id.",
        code: "unsupported_source",
      },
      { status: 422 }
    );
  }

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
          error: "Nexus needs permission to change your calendar.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const snapshot = await snapshotEvent(client, calendarId, targetId);
    if (!snapshot) {
      // Gone already — usually the page was open a while. Nothing to do
      // and nothing to log.
      return NextResponse.json({ ok: true, alreadyGone: true });
    }

    await deleteEvent(client, calendarId, targetId, notifyGuests);

    const guestCount = snapshot.attendees.length;
    // Named in the log because the two are very different acts. "Deleted
    // the whole series" is something someone will want to find later.
    const what =
      scope === "series" && seriesId
        ? `the whole "${snapshot.summary}" series`
        : `"${snapshot.summary}"`;

    const action = await logAction(userId, {
      kind: "event_delete",
      summary:
        guestCount > 0
          ? `Deleted ${what} (${guestCount} guest${
              guestCount === 1 ? "" : "s"
            }${notifyGuests ? ", notified" : ", not notified"})`
          : `Deleted ${what}`,
      // The whole snapshot rides in the log so the undo needs nothing
      // else. `target` is a flat string map, so it goes in as JSON.
      target: { snapshot: JSON.stringify(snapshot) },
      undo: "restore_event",
    });

    return NextResponse.json({
      ok: true,
      actionId: action?.id ?? null,
      guestsNotified: notifyGuests && guestCount > 0,
      // Lets the client drop every row of the series rather than just
      // the one that was clicked.
      deletedSeries: scope === "series" && Boolean(seriesId),
      seriesId: scope === "series" ? seriesId : null,
    });
  } catch (err) {
    console.error("Event delete failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't delete that event.", code: "delete_failed" },
      { status: 503 }
    );
  }
}

// Change an event's own fields — title, time, all-day, location,
// description. Guests and recurrence rules aren't editable here; see the
// comment on updateEvent (Google) and updateAppleEvent (Apple) for why.
//
// The target decides which service handles this, the same way create
// does: the client sends `source` alongside whatever addresses the event
// on that service, rather than Nexus guessing from the shape of an id.
export async function PATCH(request: NextRequest, { params }: Context) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let location: string | undefined;
  let description: string | undefined;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

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
  if (body.source !== "google" && body.source !== "apple") {
    return NextResponse.json(
      { error: "Unknown calendar type." },
      { status: 400 }
    );
  }
  const source = body.source;
  const summary = body.summary.trim().slice(0, MAX_SUMMARY);
  const start = body.start;
  const end = body.end;
  const allDay = body.allDay === true;
  if (typeof body.location === "string" && body.location.trim()) {
    location = body.location.trim().slice(0, MAX_TEXT);
  }
  if (typeof body.description === "string" && body.description.trim()) {
    description = body.description.trim().slice(0, MAX_TEXT);
  }

  const invalid = validateEventTimes(start, end, allDay);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 422 });
  }

  // --- Apple ----------------------------------------------------------------
  if (source === "apple") {
    const calendarUrl = typeof body.calendarId === "string" ? body.calendarId : "";
    const objectUrl = typeof body.objectUrl === "string" ? body.objectUrl : "";
    if (!calendarUrl || !objectUrl) {
      return NextResponse.json(
        {
          error: "Nexus doesn't have enough to find that iCloud event.",
          code: "unsupported_source",
        },
        { status: 422 }
      );
    }

    try {
      const credentials = await getAppleCredentials(userId);
      if (!credentials) {
        return NextResponse.json(
          { error: "Apple Calendar not connected", code: "not_connected" },
          { status: 400 }
        );
      }

      await updateAppleEvent(credentials, calendarUrl, objectUrl, {
        summary,
        start,
        end,
        allDay,
        location,
        description,
      });

      const action = await logAction(userId, {
        kind: "event_update",
        summary: `Updated "${summary}" on your iCloud calendar`,
        target: {},
        undo: "none",
      });

      return NextResponse.json({
        event: {
          id: params.id,
          calendarId: calendarUrl,
          summary,
          start,
          end,
          htmlLink: null,
        },
        actionId: action?.id ?? null,
      });
    } catch (err) {
      console.error("Apple event update failed", errorMessage(err));
      return NextResponse.json(
        {
          error:
            err instanceof Error && /read-only|no longer there/.test(err.message)
              ? err.message
              : "Couldn't update that iCloud event.",
          code: "update_failed",
        },
        { status: 503 }
      );
    }
  }

  // --- Google -----------------------------------------------------------
  const calendarId = typeof body.calendarId === "string" ? body.calendarId : "";
  if (!calendarId) {
    return NextResponse.json(
      { error: "Nexus doesn't know which calendar that event is on." },
      { status: 422 }
    );
  }

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
          error: "Nexus needs permission to change your calendar.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const event = await updateEvent(client, calendarId, params.id, {
      summary,
      start,
      end,
      allDay,
      location,
      description,
    });

    const action = await logAction(userId, {
      kind: "event_update",
      summary: `Updated "${event.summary}"`,
      target: { eventId: event.id, calendarId: event.calendarId, source: "google" },
      undo: "none",
    });

    return NextResponse.json({ event, actionId: action?.id ?? null });
  } catch (err) {
    console.error("Event update failed", errorMessage(err));
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 403) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to change your calendar.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }
    if (code === 404 || code === 410) {
      return NextResponse.json(
        { error: "That event is no longer there.", code: "not_found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Couldn't update that event.", code: "update_failed" },
      { status: 503 }
    );
  }
}
