import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { forgetFact } from "@/lib/memory";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Forget one thing.
//
// A real delete, not a flag. "Every fact is visible and deletable by the
// user" is the rule that keeps a memory layer from feeling like
// surveillance, and it means nothing if the row survives the click.
//
// The user id is part of the match, not a check before it: one query that
// can only ever touch this user's rows beats two that could drift apart.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await forgetFact(userId, params.id);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Fact delete failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't forget that just now." },
      { status: 500 }
    );
  }
}
