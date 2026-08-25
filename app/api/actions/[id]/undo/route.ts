import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  claimUndo,
  getAction,
  releaseUndo,
  readDraftId,
  readLabelId,
  readMessageIds,
} from "@/lib/actions";
import { getAuthorizedClientForUser } from "@/lib/google";
import { deleteDraft, removeLabel, unarchiveMessages } from "@/lib/gmail";
import { deleteFilter, untrashMessages } from "@/lib/filters";
import {
  deleteEvent,
  restoreEvent,
  type EventSnapshot,
} from "@/lib/calendar-write";
import {
  createAppleEvent,
  deleteAppleEvent,
  getAppleCredentials,
  type AppleEventSnapshot,
} from "@/lib/apple";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

// Undo one logged action.
//
// The log records *how* to reverse each action rather than leaving that
// to be worked out here, so adding archive or label later means adding a
// case below and nothing else. An action whose undo is "none" was never
// reversible and says so plainly instead of failing halfway.
export async function POST(_request: NextRequest, { params }: Context) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Tracked so the catch below only releases a claim this request
  // actually took. An unconditional release there would clear the mark on
  // an action undone yesterday if `getAction` merely hiccuped — making it
  // undoable a second time, which for a restored event means a second
  // meeting and a second invitation to every guest.
  let claimed = false;

  try {
    const action = await getAction(userId, params.id);
    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }
    // Undoing twice should be a no-op, not an error — the second click is
    // usually an impatient user, not a bug.
    if (action.undoneAt) {
      return NextResponse.json({ ok: true, alreadyUndone: true });
    }

    // Claimed before the reversal runs, not after. The read above and the
    // work below are not atomic, so two clicks on a slow undo both saw
    // undoneAt null and both reversed — and restore_event run twice means
    // two calendar events and a second invitation to every guest. The
    // claim is released if the reversal fails, so a real failure stays
    // retryable.
    const claim = await claimUndo(userId, action.id);
    if (claim === "error") {
      // Distinct from losing the race. Reporting a database failure as
      // "already undone" tells the user it worked and greys the row out,
      // leaving them no way to retry.
      return NextResponse.json(
        { error: "Couldn't undo that just now.", code: "undo_failed" },
        { status: 503 }
      );
    }
    if (claim === "lost") {
      return NextResponse.json({ ok: true, alreadyUndone: true });
    }
    claimed = true;

    // One wrapper rather than a release beside each of the dozen 422s
    // below: any exit that isn't a success hands the claim back, so a
    // reversal that couldn't run stays retryable and the row doesn't sit
    // marked undone.
    const response = await reverse(action, userId);
    if (!response.ok) await releaseUndo(userId, action.id);
    return response;
  } catch (err) {
    console.error("Undo failed", errorMessage(err));
    if (claimed) await releaseUndo(userId, params.id).catch(() => {});
    return NextResponse.json(
      { error: "Couldn't undo that just now.", code: "undo_failed" },
      { status: 503 }
    );
  }
}

async function reverse(
  action: NonNullable<Awaited<ReturnType<typeof getAction>>>,
  userId: string
): Promise<NextResponse> {
  {

    switch (action.undo) {
      case "delete_draft": {
        const draftId = readDraftId(action.target);
        if (!draftId) {
          return NextResponse.json(
            { error: "That action didn't record a draft to remove." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Gmail not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        try {
          await deleteDraft(client, draftId);
        } catch (err) {
          // A draft the user already deleted by hand is the outcome we
          // wanted anyway, so 404 counts as success rather than an error
          // they can't do anything about.
          const code =
            typeof err === "object" && err && "code" in err
              ? (err as { code: number }).code
              : null;
          if (code !== 404) throw err;
        }
        break;
      }
      case "unarchive": {
        const ids = readMessageIds(action.target);
        if (!ids.length) {
          return NextResponse.json(
            { error: "That action didn't record any messages to restore." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Gmail not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        await unarchiveMessages(client, ids);
        break;
      }
      case "remove_label": {
        const ids = readMessageIds(action.target);
        const labelId = readLabelId(action.target);
        if (!ids.length || !labelId) {
          return NextResponse.json(
            { error: "That action didn't record a label to remove." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Gmail not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        // Strips the label from the messages. The label itself stays —
        // deleting it would take it off anything else that carries it,
        // which is well beyond undoing this one action.
        await removeLabel(client, ids, labelId);
        break;
      }
      case "remove_filter": {
        const filterId = action.target.filterId;
        if (!filterId) {
          return NextResponse.json(
            { error: "That action didn't record a filter to remove." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Gmail not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        try {
          await deleteFilter(client, filterId);
        } catch (err) {
          // Already gone is the state we were after.
          const code =
            typeof err === "object" && err && "code" in err
              ? (err as { code: number }).code
              : null;
          if (code !== 404) throw err;
        }
        break;
      }
      case "untrash": {
        // Stored as a comma-joined string so `target` stays a flat
        // string map and no action type needs its own column.
        const ids = readMessageIds(action.target);
        if (!ids.length) {
          return NextResponse.json(
            { error: "That action didn't record any messages to restore." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Gmail not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        await untrashMessages(client, ids);
        break;
      }
      case "delete_event": {
        // An Apple event Nexus created is addressed by the CalDAV object
        // URL it got back at creation, not by an id and a calendar.
        if (action.target.source === "apple") {
          const objectUrl = action.target.objectUrl;
          if (!objectUrl) {
            return NextResponse.json(
              { error: "That action didn't record an event to remove." },
              { status: 422 }
            );
          }
          const credentials = await getAppleCredentials(userId);
          if (!credentials) {
            return NextResponse.json(
              { error: "Apple Calendar not connected", code: "not_connected" },
              { status: 400 }
            );
          }
          await deleteAppleEvent(credentials, objectUrl);
          break;
        }

        const { eventId, calendarId } = action.target;
        if (!eventId || !calendarId) {
          return NextResponse.json(
            { error: "That action didn't record an event to remove." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Calendar not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        // Undoing an event Nexus created: nobody else has acted on it
        // yet, so this is the one calendar operation that's a clean
        // reversal. Guests do get the cancellation, since they got the
        // invite.
        await deleteEvent(client, calendarId, eventId, true);
        break;
      }
      case "restore_event": {
        const raw = action.target.snapshot;
        if (!raw) {
          return NextResponse.json(
            { error: "That action didn't record enough to restore." },
            { status: 422 }
          );
        }

        // An Apple deletion snapshots the .ics fields rather than a
        // Google-shaped EventSnapshot (no attendees, no recurrence — see
        // snapshotAppleEvent), so it gets its own restore path back
        // through createAppleEvent rather than restoreEvent.
        if (action.target.source === "apple") {
          let snapshot: AppleEventSnapshot;
          try {
            snapshot = JSON.parse(raw) as AppleEventSnapshot;
          } catch {
            return NextResponse.json(
              { error: "That action's saved copy of the event is unreadable." },
              { status: 422 }
            );
          }
          const credentials = await getAppleCredentials(userId);
          if (!credentials) {
            return NextResponse.json(
              { error: "Apple Calendar not connected", code: "not_connected" },
              { status: 400 }
            );
          }
          const restored = await createAppleEvent(credentials, {
            calendarUrl: snapshot.calendarUrl,
            summary: snapshot.summary,
            start: snapshot.start,
            end: snapshot.end,
            allDay: snapshot.allDay,
            location: snapshot.location ?? undefined,
            description: snapshot.description ?? undefined,
          });
          return NextResponse.json({
            ok: true,
            recreated: true,
            eventId: restored.uid,
          });
        }

        let snapshot: EventSnapshot;
        try {
          snapshot = JSON.parse(raw) as EventSnapshot;
        } catch {
          return NextResponse.json(
            { error: "That action's saved copy of the event is unreadable." },
            { status: 422 }
          );
        }
        const client = await getAuthorizedClientForUser(userId);
        if (!client) {
          return NextResponse.json(
            { error: "Calendar not connected", code: "not_connected" },
            { status: 400 }
          );
        }
        const restored = await restoreEvent(client, snapshot);
        // Flagged so the UI can be straight about it: the meeting is
        // back, but it's a new event, and anything keyed to the old id
        // (a prep checklist, a guest's own copy) didn't come with it.
        return NextResponse.json({
          ok: true,
          recreated: true,
          eventId: restored.id,
        });
      }
      case "none":
        return NextResponse.json(
          { error: "That action can't be undone." },
          { status: 422 }
        );
      default:
        return NextResponse.json(
          { error: "Nexus doesn't know how to undo that yet." },
          { status: 422 }
        );
    }
  }

  return NextResponse.json({ ok: true });
}
