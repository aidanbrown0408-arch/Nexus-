import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createPrepItem, MAX_TITLE_LENGTH } from "@/lib/prep";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Add one item by hand. Unlike generation, this doesn't re-fetch the
// event: the user is typing against a row already on screen, and making
// them wait on two calendar APIs to add "bring the charger" would be a
// worse trade than trusting the title they can see.
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
    };

    const eventKey =
      typeof body.eventKey === "string" ? body.eventKey.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!eventKey || !title) {
      return NextResponse.json(
        { error: "eventKey and title are required" },
        { status: 400 }
      );
    }

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
  } catch (err) {
    console.error("Prep item create failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't add that item" },
      { status: 500 }
    );
  }
}
