import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedClientForUser, hasScope, GMAIL_SETTINGS_SCOPE } from "@/lib/google";
import { deleteFilter } from "@/lib/filters";
import { logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { id: string } };

// Turn a rule off. Applies to future mail only — anything already
// trashed stays trashed, and the sweep that moved it has its own undo in
// the action log. Saying so plainly beats implying this is a full revert.
export async function DELETE(_request: NextRequest, { params }: Context) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Gmail not connected", code: "not_connected" },
        { status: 400 }
      );
    }
    if (!hasScope(client.credentials.scope, GMAIL_SETTINGS_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to manage your Gmail filters.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    await deleteFilter(client, params.id);

    // Logged like anything else: removing a rule changes what happens to
    // the user's mail, so it belongs in the same history as creating one.
    await logAction(userId, {
      kind: "filter",
      summary: "Turned off a Gmail filter",
      target: { filterId: params.id },
      undo: "none",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Filter delete failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't remove that rule." },
      { status: 503 }
    );
  }
}
