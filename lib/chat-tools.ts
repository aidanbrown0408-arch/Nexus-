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
import {
  hasScope,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_MODIFY_SCOPE,
  CALENDAR_EVENTS_SCOPE,
} from "./google";
import {
  createEvent,
  listWritableCalendars,
  validateEventTimes,
} from "./calendar-write";
import {
  createAppleEvent,
  getAppleCredentials,
  listWritableAppleCalendars,
  type AppleCredentials,
} from "./apple";
import {
  describeRecurrence,
  parseRecurrence,
  type Recurrence,
} from "./recurrence";
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
// exposed: draft, archive, label, and — as of create_event — adding an
// event with nobody invited to it. A guest-free create is a clean
// reversal (deleteEvent on an event nobody else has touched yet, the
// same undo every dashboard create already gets), which is why it
// belongs here even though creating an event sounds like the sort of
// thing that should need a preview.
//
// Deliberately absent, and not by oversight:
//
//   - Sending mail. Nexus has never had the scope and this is not the
//     feature that should introduce it.
//   - Deleting or trashing anything.
//   - Inviting guests to an event. That notifies other people, which
//     makes it irreversible in the way that matters — the invitation
//     has already arrived. create_event has no attendees field at all,
//     not a validated one, so there's no path for the model to invite
//     anyone even by accident.
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
  {
    name: "create_event",
    description:
      "Add an event to the user's Google or iCloud calendar. Never " +
      "invites anyone — there is no way to pass guests to this tool, so " +
      "use it freely for personal appointments, classes, blocked time, " +
      "reminders, anything with nobody else on it. If the user wants " +
      "guests invited, tell them to add it from the dashboard instead of " +
      "using this tool. When the event repeats on a regular pattern " +
      "(a class that meets certain weekdays, 'every Monday', 'daily " +
      "until the 20th'), pass recurrence so it's created as one series " +
      "rather than asking you to create each date separately.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string", description: "The event's title." },
        start: {
          type: "string",
          description:
            "Start of the first (or only) occurrence, as a local " +
            "date-time like '2026-08-26T08:20:00'. A bare date " +
            "('2026-08-26') for an all-day event.",
        },
        end: {
          type: "string",
          description: "End of the first occurrence, same format as start.",
        },
        allDay: {
          type: "boolean",
          description: "True for an all-day event. Defaults to false.",
        },
        location: {
          type: "string",
          description: "Where it is, if known. Optional.",
        },
        calendar: {
          type: "string",
          description:
            "Which calendar to put it on, matching the `calendar` name " +
            "shown on one of the user's existing events (e.g. 'School', " +
            "'Work'). Omit to use their default calendar.",
        },
        recurrence: {
          type: "object",
          description:
            "Omit for a one-off event. Otherwise describes the repeat " +
            "rule for a series starting at `start`.",
          properties: {
            frequency: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "yearly"],
            },
            interval: {
              type: "number",
              description: "Every N units — 2 for 'every other week'. Defaults to 1.",
            },
            byDay: {
              type: "array",
              items: {
                type: "string",
                enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"],
              },
              description:
                "For a weekly rule that meets specific weekdays, e.g. a " +
                "class on Wed/Thu/Fri: ['WE','TH','FR'].",
            },
            count: {
              type: "number",
              description: "Number of occurrences. Use this or `until`, not both.",
            },
            until: {
              type: "string",
              description: "Last possible date, YYYY-MM-DD, inclusive.",
            },
          },
        },
      },
      required: ["summary", "start", "end"],
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

// Pick which calendar create_event lands on. `wanted` is whatever name
// the model passed (possibly empty); matched case-insensitively against
// both services rather than just Google, since a user's "School"
// calendar is just as likely to be the iCloud one. No match, or no name
// given at all, falls back to the user's primary Google calendar — the
// same default the dashboard form refuses to guess, but a chat tool
// with no calendar picker in front of it has to land somewhere.
async function pickCalendar(
  userId: string,
  client: OAuth2Client,
  wanted: string
): Promise<
  | { source: "google"; id: string; name: string }
  | { source: "apple"; id: string; name: string; credentials: AppleCredentials }
  | null
> {
  const googleCalendars = await listWritableCalendars(client).catch(() => []);

  let appleCredentials: AppleCredentials | null = null;
  try {
    appleCredentials = await getAppleCredentials(userId);
  } catch {
    // Apple simply isn't in play for this pick.
  }
  const appleCalendars = appleCredentials
    ? await listWritableAppleCalendars(appleCredentials).catch(() => [])
    : [];

  if (wanted) {
    const needle = wanted.toLowerCase();
    const google = googleCalendars.find((c) => c.name.toLowerCase() === needle);
    if (google) return { source: "google", id: google.id, name: google.name };
    const apple = appleCalendars.find((c) => c.name.toLowerCase() === needle);
    if (apple && appleCredentials) {
      return {
        source: "apple",
        id: apple.url,
        name: apple.name,
        credentials: appleCredentials,
      };
    }
  }

  const primary = googleCalendars.find((c) => c.primary) ?? googleCalendars[0];
  if (primary) return { source: "google", id: primary.id, name: primary.name };

  const fallbackApple = appleCalendars[0];
  if (fallbackApple && appleCredentials) {
    return {
      source: "apple",
      id: fallbackApple.url,
      name: fallbackApple.name,
      credentials: appleCredentials,
    };
  }

  return null;
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

    if (name === "create_event") {
      const summary = String(input.summary ?? "").trim().slice(0, 200);
      if (!summary) return { result: "No event title given." };

      const start = typeof input.start === "string" ? input.start : "";
      const end = typeof input.end === "string" ? input.end : "";
      if (!start || !end) {
        return { result: "Need both a start and an end time." };
      }

      const allDay = input.allDay === true;
      const invalidTimes = validateEventTimes(start, end, allDay);
      if (invalidTimes) return { result: invalidTimes };

      const location =
        typeof input.location === "string" && input.location.trim()
          ? input.location.trim().slice(0, 2000)
          : undefined;

      let recurrence: Recurrence | null = null;
      if (input.recurrence) {
        recurrence = parseRecurrence(input.recurrence);
        if (!recurrence) {
          return {
            result:
              "That repeat rule didn't parse — describe it more simply " +
              "(e.g. weekly on specific weekdays, with a count or an end " +
              "date), or ask the user to set it up from the dashboard.",
          };
        }
      }

      const wanted =
        typeof input.calendar === "string" ? input.calendar.trim() : "";
      const target = await pickCalendar(userId, client, wanted);
      if (!target) {
        if (!hasScope(client.credentials.scope, CALENDAR_EVENTS_SCOPE)) {
          return {
            result:
              "Nexus doesn't have permission to add calendar events yet " +
              "— the user needs to reconnect Google.",
          };
        }
        return {
          result:
            "No writable calendar found — the user needs to connect " +
            "Google or iCloud Calendar first.",
        };
      }

      const repeatsSuffix = recurrence
        ? ` — ${describeRecurrence(recurrence).toLowerCase()}`
        : "";

      if (target.source === "google") {
        if (!hasScope(client.credentials.scope, CALENDAR_EVENTS_SCOPE)) {
          return {
            result:
              "Nexus doesn't have permission to add calendar events yet " +
              "— the user needs to reconnect Google.",
          };
        }
        const event = await createEvent(client, {
          summary,
          start,
          end,
          allDay,
          location,
          calendarId: target.id,
          recurrence: recurrence ?? undefined,
        });
        const action = await logAction(userId, {
          kind: "event_create",
          summary: `Added "${event.summary}" to ${target.name}${repeatsSuffix}`,
          target: {
            eventId: event.id,
            calendarId: event.calendarId,
            source: "google",
          },
          undo: "delete_event",
        });
        return {
          result: `Added "${event.summary}" to ${target.name}${repeatsSuffix}.`,
          action,
        };
      }

      const created = await createAppleEvent(target.credentials, {
        calendarUrl: target.id,
        summary,
        start,
        end,
        allDay,
        location,
        recurrence: recurrence ?? undefined,
      });
      const action = await logAction(userId, {
        kind: "event_create",
        summary: `Added "${summary}" to ${target.name}${repeatsSuffix}`,
        target: { objectUrl: created.objectUrl, source: "apple" },
        undo: "delete_event",
      });
      return {
        result: `Added "${summary}" to ${target.name}${repeatsSuffix}.`,
        action,
      };
    }

    return { result: `Unknown tool: ${name}` };
  } catch (err) {
    console.error(`Chat tool ${name} failed`, errorMessage(err));
    // Handed back to the model rather than thrown, so it can tell the
    // user what didn't work instead of the whole turn failing.
    return { result: `That didn't work: ${errorMessage(err)}` };
  }
}
