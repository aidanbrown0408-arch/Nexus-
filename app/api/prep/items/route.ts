import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  createPrepItem,
  createTask,
  listTodoItems,
  MAX_TITLE_LENGTH,
} from "@/lib/prep";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every reminder across every event, for the to-do list view. Pass ?done=1
// to include ticked-off items; by default only what's still outstanding
// comes back, since that's what the list is for.
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const items = await listTodoItems(userId, {
      includeDone: request.nextUrl.searchParams.get("done") === "1",
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("Prep todo list failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't load your reminders" },
      { status: 500 }
    );
  }
}

// Add one item by hand.
//
// Two shapes go through here. With an `eventKey`, it's a prep item on a
// meeting's checklist — unchanged, and deliberately not re-fetching the
// event: the user is typing against a row already on screen, and making
// them wait on two calendar APIs to add "bring the charger" would be a
// worse trade than trusting the title they can see.
//
// Without one, it's a standalone reminder with its own optional due date.
// One route rather than two because they are one list to everyone who
// isn't this file — same rows, same checkbox, same delete.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      eventKey?: unknown;
      title?: unknown;
      eventSummary?: unknown;
      eventStart?: unknown;
      dueAt?: unknown;
      source?: unknown;
      sourceRef?: unknown;
    };

    const eventKey =
      typeof body.eventKey === "string" ? body.eventKey.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title) {
      return NextResponse.json(
        { error: "A title is required" },
        { status: 400 }
      );
    }

    if (eventKey) {
      const start =
        typeof body.eventStart === "string" ? new Date(body.eventStart) : null;

      const item = await createPrepItem(
        userId,
        {
          key: eventKey,
          summary:
            typeof body.eventSummary === "string" ? body.eventSummary : "",
          start:
            start && !Number.isNaN(start.getTime())
              ? start.toISOString()
              : new Date().toISOString(),
        },
        title.slice(0, MAX_TITLE_LENGTH),
        "user"
      );

      return NextResponse.json({ item }, { status: 201 });
    }

    // A date that didn't parse is rejected rather than dropped. Silently
    // filing "Friday" as undated is the failure the user is least likely
    // to notice and most likely to be hurt by.
    let dueAt: string | null = null;
    if (typeof body.dueAt === "string" && body.dueAt.trim()) {
      const due = new Date(body.dueAt);
      if (Number.isNaN(due.getTime())) {
        return NextResponse.json(
          { error: "That date didn't parse" },
          { status: 400 }
        );
      }
      dueAt = due.toISOString();
    }

    // Only the sources a client is allowed to claim. "event" isn't one of
    // them — that shape goes down the branch above — and "chat" is set
    // server-side by the tool handler, never taken from a request body.
    const source =
      body.source === "email" ? ("email" as const) : ("manual" as const);

    const sourceRef =
      body.sourceRef && typeof body.sourceRef === "object"
        ? Object.fromEntries(
            Object.entries(body.sourceRef as Record<string, unknown>)
              .filter(([, v]) => typeof v === "string")
              .slice(0, 10)
              .map(([k, v]) => [k, String(v).slice(0, 200)])
          )
        : null;

    const item = await createTask(userId, {
      title: title.slice(0, MAX_TITLE_LENGTH),
      dueAt,
      source,
      sourceRef,
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    console.error("Prep item create failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't add that item" },
      { status: 500 }
    );
  }
}
