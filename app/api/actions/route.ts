import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { listActions } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A page's worth. The log is read as "what just happened", so a long tail
// is less useful than a fast first screen.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Everything Nexus has done to this account.
//
// The undo route has existed since the action log was built; this is the
// half that lets anyone see what there is to undo. Until now the log was
// a table with no window onto it — the trust it was meant to buy was
// sitting in Supabase where nobody could look at it.
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = Number(request.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    const actions = await listActions(userId, limit);
    return NextResponse.json({
      // `target` is deliberately not sent. It holds Gmail ids and draft
      // ids — everything needed to act on someone's mailbox — and the
      // page only needs to name what happened and offer the undo.
      actions: actions.map((action) => ({
        id: action.id,
        kind: action.kind,
        summary: action.summary,
        undoable: action.undo !== "none",
        undoneAt: action.undoneAt,
        createdAt: action.createdAt,
      })),
    });
  } catch (err) {
    console.error("Action log fetch failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't load your activity.", code: "activity_unavailable" },
      { status: 503 }
    );
  }
}
