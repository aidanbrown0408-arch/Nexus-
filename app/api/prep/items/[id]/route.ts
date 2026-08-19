import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { deletePrepItem, updatePrepItem } from "@/lib/prep";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

// Tick an item off, or rename it. Both write paths in lib/prep filter on
// the Clerk user id as well as the row id — an id guessed from another
// account matches nothing rather than updating it.
export async function PATCH(request: NextRequest, { params }: Context) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { done?: unknown; title?: unknown };

    const patch: { done?: boolean; title?: string } = {};
    if (typeof body.done === "boolean") patch.done = body.done;
    if (typeof body.title === "string" && body.title.trim()) {
      patch.title = body.title.trim();
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { error: "Nothing to update" },
        { status: 400 }
      );
    }

    const item = await updatePrepItem(userId, params.id, patch);
    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (err) {
    console.error("Prep item update failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't update that item" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await deletePrepItem(userId, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Prep item delete failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't remove that item" },
      { status: 500 }
    );
  }
}
