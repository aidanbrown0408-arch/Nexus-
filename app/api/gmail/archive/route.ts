import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getAuthorizedClientForUser,
  hasScope,
  GMAIL_MODIFY_SCOPE,
} from "@/lib/google";
import { applyLabel, archiveMessages, ensureLabel } from "@/lib/gmail";
import { logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 100;

// Archive an approved batch, optionally labelling it on the way out.
//
// This is the batchable action, and it's allowed to be because archiving
// is a complete no-op on the message itself — Gmail's INBOX is just a
// label, so removing it loses nothing and putting it back restores
// everything. Compare the trash sweep, which is capped and previewed.
//
// The ids come from the client, which is fine here: the user ticked these
// boxes, and the worst a forged id could do is archive a message the same
// user already had access to.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let ids: string[];
  let labelName: string | undefined;
  let labelId: string | undefined;
  try {
    const body = (await request.json()) as {
      ids?: unknown;
      labelName?: unknown;
      labelId?: unknown;
    };
    if (!Array.isArray(body.ids) || !body.ids.length) {
      return NextResponse.json(
        { error: "Nothing selected to archive." },
        { status: 400 }
      );
    }
    ids = body.ids
      .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      .slice(0, MAX_IDS);
    if (typeof body.labelName === "string" && body.labelName.trim()) {
      labelName = body.labelName.trim().slice(0, 100);
    }
    if (typeof body.labelId === "string" && body.labelId.trim()) {
      labelId = body.labelId.trim();
    }
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  if (!ids.length) {
    return NextResponse.json(
      { error: "Nothing selected to archive." },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Gmail not connected", code: "not_connected" },
        { status: 400 }
      );
    }
    if (!hasScope(client.credentials.scope, GMAIL_MODIFY_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to archive your mail.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    // Label first, archive second. If the label fails the mail is still
    // in the inbox and the user can retry the whole thing; the other
    // order would leave messages archived and unlabelled, which is
    // harder to notice and harder to find again.
    let appliedLabel: { id: string; name: string } | null = null;
    if (labelName || labelId) {
      const label = labelName
        ? await ensureLabel(client, labelName)
        : { id: labelId as string, name: labelId as string, system: false };
      await applyLabel(client, ids, label.id);
      appliedLabel = { id: label.id, name: label.name };

      // Logged separately from the archive so each can be undone on its
      // own — un-archiving without stripping the label is a reasonable
      // thing to want.
      await logAction(userId, {
        kind: "label",
        summary: `Labelled ${ids.length} message${
          ids.length === 1 ? "" : "s"
        } "${appliedLabel.name}"`,
        target: { messageIds: ids.join(","), labelId: appliedLabel.id },
        undo: "remove_label",
      });
    }

    await archiveMessages(client, ids);

    const action = await logAction(userId, {
      kind: "archive",
      summary: `Archived ${ids.length} message${ids.length === 1 ? "" : "s"}`,
      target: { messageIds: ids.join(",") },
      undo: "unarchive",
    });

    return NextResponse.json({
      archived: ids.length,
      label: appliedLabel,
      actionId: action?.id ?? null,
    });
  } catch (err) {
    console.error("Archive failed", errorMessage(err));
    return NextResponse.json(
      { error: "Couldn't archive those.", code: "archive_failed" },
      { status: 503 }
    );
  }
}
