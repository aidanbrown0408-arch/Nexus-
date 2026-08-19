import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  CALENDAR_EVENTS_SCOPE,
} from "@/lib/google";
import { deleteEvent, snapshotEvent } from "@/lib/calendar-write";
import { logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

// Delete one calendar event.
//
// One event per request, deliberately — there is no batch endpoint and
// there shouldn't be. Cancelling a meeting can email its guests, and
// that mail is the part no undo reaches. The client has to pass
// `notifyGuests` explicitly to send it; the default is silence.
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
  const calendarId = url.searchParams.get("calendarId");
  const notifyGuests = url.searchParams.get("notifyGuests") === "true";
  // For a repeating event: which id to delete. `series` targets the
  // master event and takes every occurrence with it; anything else
  // targets the single instance the user clicked. There's no default
  // that's right for both, which is why the confirm dialog asks.
  const seriesId = url.searchParams.get("seriesId");
  const scope = url.searchParams.get("scope") === "series" ? "series" : "one";
  const targetId = scope === "series" && seriesId ? seriesId : params.id;

  // Apple events arrive with a null calendarId because there's no CalDAV
  // write path. Saying so beats failing against Google with an id that
  // was never Google's.
  if (!calendarId) {
    return NextResponse.json(
      {
        error:
          "Nexus can only delete Google Calendar events. Remove this one in the Calendar app.",
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
