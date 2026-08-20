import type { OAuth2Client } from "google-auth-library";
import {
  applyLabel,
  archiveMessages,
  createReplyDraft,
  ensureLabel,
  fetchOwnEmail,
  fetchThread,
  replyRecipient,
} from "./gmail";
import { draftReply } from "./drafts";
import { actionTarget, logAction, type ActionRecord } from "./actions";
import { hasScope, GMAIL_COMPOSE_SCOPE, GMAIL_MODIFY_SCOPE } from "./google";
import type { UserProfileRow } from "./profile";
import { errorMessage } from "./supabase";

// What the chat box is allowed to do.
//
// Nexus has a dozen working action routes and, until now, a chat box that
// could only describe them. This is the layer that lets it act — and the
// rule that shapes which actions are here is the one in ROADMAP.md:
//
//   Reversible actions can be batched. Irreversible actions are always
//   individual, always explicit, and always previewed in full.
//
// Chat is a conversation, not a preview. So only the reversible half is
// exposed: draft, archive, label. Every one of them writes to the action
// log with the operation that undoes it, so anything done in a sentence
// can be undone in a click.
//
// Deliberately absent, and not by oversight:
//
//   - Sending mail. Nexus has never had the scope and this is not the
//     feature that should introduce it.
//   - Deleting or trashing anything.
//   - Creating calendar events. They notify other people, which makes
//     them irreversible in the way that matters — the invitation has
//     already arrived.
//
// Those belong behind an explicit confirm, which is a UI, not a tool.

export type ToolContext = {
  userId: string;
  client: OAuth2Client;
  profile: UserProfileRow | null;
};

export type ToolOutcome = {
  // What the model is told happened. Plain prose, because it has to
  // report it to the user in its own words.
  result: string;
  // What actually changed, for the UI to show and offer to undo.
  action?: ActionRecord | null;
};

export const CHAT_TOOLS = [
  {
    name: "draft_reply",
    description:
      "Write a reply to an email thread and save it to the user's Gmail " +
      "drafts. Nothing is sent — the draft waits for them to review. Use " +
      "this whenever the user asks you to reply to, answer, decline or " +
      "follow up on a message.",
    input_schema: {
      type: "object" as const,
      properties: {
        messageId: {
          type: "string",
          description:
            "The id of a message in the thread, taken exactly from the " +
            "email list you were given.",
        },
        instruction: {
          type: "string",
          description:
            "How the reply should go, in the user's words — 'decline " +
            "politely', 'ask for the deck', 'say yes to Thursday'. Omit " +
            "to let the reply be inferred from the thread.",
        },
      },
      required: ["messageId"],
    },
  },
  {
    name: "archive_messages",
    description:
      "Move messages out of the inbox. Reversible — archived mail is " +
      "still searchable and can be restored from the activity log. Use " +
      "for newsletters, receipts and notifications the user is done with.",
    input_schema: {
      type: "object" as const,
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Message ids, taken exactly from the email list.",
        },
        summary: {
          type: "string",
          description:
            "One short phrase naming what these are, for the activity " +
            "log — e.g. 'four newsletters' or 'Amazon shipping updates'.",
        },
      },
      required: ["messageIds", "summary"],
    },
  },
  {
    name: "label_messages",
    description:
      "Put a Gmail label on messages, creating the label if it doesn't " +
      "exist. Reversible. Does not archive them — combine with " +
      "archive_messages if the user wants both.",
    input_schema: {
      type: "object" as const,
      properties: {
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Message ids, taken exactly from the email list.",
        },
        label: { type: "string", description: "The label name." },
      },
      required: ["messageIds", "label"],
    },
  },
];

// Ids come from a model that was handed a list of them. It can still
// invent one, and Gmail answers a bad id with a 400 for the whole batch,
// so anything not in the list the model was given is dropped first.
function knownIds(requested: unknown, known: Set<string>): string[] {
  if (!Array.isArray(requested)) return [];
  const ids: string[] = [];
  for (const id of requested) {
    if (typeof id === "string" && known.has(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

export async function runChatTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
  visibleIds: Set<string>
): Promise<ToolOutcome> {
  const { userId, client, profile } = context;

  try {
    if (name === "draft_reply") {
      const messageId = String(input.messageId ?? "");
      if (!visibleIds.has(messageId)) {
        return { result: "No such message in the list you were given." };
      }
      if (!hasScope(client.credentials.scope, GMAIL_COMPOSE_SCOPE)) {
        return {
          result:
            "Nexus doesn't have permission to create drafts yet — the " +
            "user needs to reconnect Google.",
        };
      }

      const thread = await fetchThread(client, messageId);
      let selfEmail: string | null = null;
      try {
        selfEmail = await fetchOwnEmail(client);
      } catch {
        // A draft addressed to the last sender is right most of the time.
      }

      const instruction =
        typeof input.instruction === "string" ? input.instruction : undefined;
      const { body } = await draftReply(thread, selfEmail, instruction, profile);
      const to = replyRecipient(thread, selfEmail);
      const draft = await createReplyDraft(client, thread, to, body);

      const action = await logAction(userId, {
        kind: "draft_reply",
        summary: `Drafted a reply to ${to} about "${thread.subject}"`,
        target: actionTarget.draft(draft.draftId, draft.threadId),
        undo: "delete_draft",
      });

      return {
        // The draft's text goes back to the model so it can show the user
        // what it wrote rather than claiming a draft exists and leaving
        // them to go find it.
        result: `Draft saved to Gmail, addressed to ${to}. The text is:\n\n${body}`,
        action,
      };
    }

    if (name === "archive_messages") {
      const ids = knownIds(input.messageIds, visibleIds);
      if (!ids.length) return { result: "None of those ids are in the list." };
      if (!hasScope(client.credentials.scope, GMAIL_MODIFY_SCOPE)) {
        return {
          result:
            "Nexus doesn't have permission to archive yet — the user " +
            "needs to reconnect Google.",
        };
      }

      await archiveMessages(client, ids);
      const what = String(input.summary ?? "messages").slice(0, 80);
      const action = await logAction(userId, {
        kind: "archive",
        summary: `Archived ${ids.length} message${ids.length === 1 ? "" : "s"} — ${what}`,
        target: actionTarget.messages(ids),
        undo: "unarchive",
      });

      return { result: `Archived ${ids.length}. Undoable.`, action };
    }

    if (name === "label_messages") {
      const ids = knownIds(input.messageIds, visibleIds);
      const labelName = String(input.label ?? "").trim();
      if (!ids.length) return { result: "None of those ids are in the list." };
      if (!labelName) return { result: "No label name given." };
      if (!hasScope(client.credentials.scope, GMAIL_MODIFY_SCOPE)) {
        return {
          result:
            "Nexus doesn't have permission to label yet — the user needs " +
            "to reconnect Google.",
        };
      }

      const label = await ensureLabel(client, labelName);
      await applyLabel(client, ids, label.id);
      const action = await logAction(userId, {
        kind: "label",
        summary: `Labelled ${ids.length} message${ids.length === 1 ? "" : "s"} "${label.name}"`,
        target: actionTarget.messages(ids, label.id),
        undo: "remove_label",
      });

      return { result: `Labelled ${ids.length} as "${label.name}".`, action };
    }

    return { result: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`Chat tool ${name} failed`, errorMessage(err));
    // Handed back to the model rather than thrown, so it can tell the
    // user what didn't work instead of the whole turn failing.
    return { result: `That didn't work: ${errorMessage(err)}` };
  }
}
