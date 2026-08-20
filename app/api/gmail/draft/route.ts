import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAuthorizedClientForUser, hasScope, GMAIL_COMPOSE_SCOPE } from "@/lib/google";
import {
  createReplyDraft,
  fetchOwnEmail,
  fetchThread,
  replyRecipient,
} from "@/lib/gmail";
import { draftReply, MAX_INSTRUCTION_LENGTH } from "@/lib/drafts";
import { getProfile, type UserProfileRow } from "@/lib/profile";
import { actionTarget, logAction } from "@/lib/actions";
import { errorMessage } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Draft a reply to one thread and save it to the user's Gmail drafts.
//
// The first action Nexus takes on an account, and the safest one it
// could: nothing is sent, and the worst outcome is a draft the user
// deletes. That's why it ships before archive, label, or anything on the
// calendar — it establishes the propose-then-approve shape without
// putting anything at risk while the shape is still being proven.
//
// The client posts a message id and nothing else. The thread is re-fetched
// here rather than accepted from the browser, so a reply can't be drafted
// against text the user never received.
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let messageId: string;
  let instruction: string | undefined;
  try {
    const body = (await request.json()) as {
      messageId?: unknown;
      instruction?: unknown;
    };
    if (typeof body.messageId !== "string" || !body.messageId.trim()) {
      return NextResponse.json(
        { error: "messageId is required" },
        { status: 400 }
      );
    }
    messageId = body.messageId.trim();
    if (typeof body.instruction === "string" && body.instruction.trim()) {
      instruction = body.instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH);
    }
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return NextResponse.json(
        { error: "Gmail not connected", code: "not_connected" },
        { status: 400 }
      );
    }

    // gmail.compose arrived after gmail.readonly, so anyone who connected
    // before this feature has a token that can read mail but not write a
    // draft. Checking up front turns a 403 from Google into a prompt the
    // UI can act on.
    if (!hasScope(client.credentials.scope, GMAIL_COMPOSE_SCOPE)) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to create drafts in your Gmail.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    const thread = await fetchThread(client, messageId);

    // Knowing which messages are the user's own changes both who the
    // reply is addressed to and how the model reads the thread. Not fatal
    // if it fails — a draft addressed to the last sender is still right
    // most of the time.
    let selfEmail: string | null = null;
    try {
      selfEmail = await fetchOwnEmail(client);
    } catch (err) {
      console.error("Draft: own address unavailable", errorMessage(err));
    }

    // How they said they want replies to sound. A missing or unreadable
    // profile degrades the voice, not the feature — the draft is still
    // worth having, so this never fails the request.
    let profile: UserProfileRow | null = null;
    try {
      profile = await getProfile(userId);
    } catch (err) {
      console.error("Draft: profile unavailable", errorMessage(err));
    }

    const { body, note } = await draftReply(
      thread,
      selfEmail,
      instruction,
      profile
    );
    const to = replyRecipient(thread, selfEmail);

    const draft = await createReplyDraft(client, thread, to, body);

    // Logged after the write, with what it takes to undo it. An action
    // the user can't see in the log is an action they can't trust.
    const action = await logAction(userId, {
      kind: "draft_reply",
      summary: `Drafted a reply to ${to} about "${thread.subject}"`,
      target: actionTarget.draft(draft.draftId, draft.threadId),
      undo: "delete_draft",
    });

    return NextResponse.json({
      draft: {
        id: draft.draftId,
        threadId: draft.threadId,
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        // Opens the draft itself in Gmail rather than the inbox, so
        // "review it" is one click and not a search.
        url: `https://mail.google.com/mail/u/0/#drafts?compose=${draft.draftId}`,
      },
      note,
      actionId: action?.id ?? null,
    });
  } catch (err: unknown) {
    console.error("Draft reply failed", errorMessage(err));

    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    if (code === 401) {
      return NextResponse.json(
        { error: "Gmail needs reconnecting.", code: "not_connected" },
        { status: 401 }
      );
    }
    if (code === 403) {
      return NextResponse.json(
        {
          error: "Nexus needs permission to create drafts in your Gmail.",
          code: "scope_missing",
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Couldn't draft a reply just now.", code: "draft_unavailable" },
      { status: 503 }
    );
  }
}
