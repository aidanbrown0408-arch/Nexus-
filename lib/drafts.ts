import { getAnthropicClient, DRAFT_MODEL } from "./anthropic";
import { nowLines, resolveTimezone } from "./clock";
import { profileToDraftContext, type UserProfileRow } from "./profile";
import type { EmailThread } from "./gmail";

// Drafting replies.
//
// This is the first thing Nexus does *to* an account rather than with a
// copy of it, and it was chosen to go first because it's impossible to
// regret: the draft sits in Gmail until the user opens it. Nothing is
// sent. A bad draft costs one click to delete.
//
// The model gets the thread and, optionally, a short instruction from the
// user ("decline politely", "ask for the deck"). With no instruction it
// infers what the reply owes the thread.
//
// It also gets the user's profile. The onboarding interview asks outright
// how they want replies to sound, and a draft written in a voice they
// already said isn't theirs is a draft they rewrite — which costs more
// than writing it themselves would have.

export const MAX_INSTRUCTION_LENGTH = 500;
// A reply long enough to need scrolling is one the user will rewrite
// anyway. The cap is a guard against runaway output, not a target.
const MAX_BODY_CHARS = 4000;

const SYSTEM_PROMPT = [
  "You are Nexus, drafting a reply on behalf of the user. Write only the",
  "body of the reply — no subject line, no quoted thread, no placeholder",
  "in square brackets.",
  "",
  "Write the way a competent person actually writes email: plain, direct,",
  "and no longer than the message requires. Two sentences is a fine",
  "reply. Answer what was asked, and only that.",
  "",
  "Do not invent facts, dates, numbers, attachments, or commitments that",
  "aren't in the thread. If the right reply depends on something you",
  "don't know, write the reply so the user can fill in that one detail —",
  "don't guess and don't leave a bracketed blank.",
  "",
  "Avoid throat-clearing openers ('I hope this email finds you well'),",
  "and don't restate what the other person said back to them. Match the",
  "register of the thread: a terse thread gets a terse reply.",
  "",
  "Sign off the way the user signs off if the thread shows it. If it",
  "doesn't, end with the message — no sign-off at all is better than the",
  "wrong one.",
].join("\n");

const DRAFT_TOOL = {
  name: "write_reply",
  description: "Record the drafted reply body.",
  input_schema: {
    type: "object" as const,
    properties: {
      body: {
        type: "string",
        description:
          "The reply body, ready to send. Plain text, no subject line, " +
          "no quoted original.",
      },
      note: {
        type: "string",
        description:
          "Optional one-line flag for the user about something the draft " +
          "assumes or leaves open — e.g. 'I didn't have the deadline, so " +
          "I left that vague.' Omit if there's nothing worth flagging.",
      },
    },
    required: ["body"],
  },
};

export type DraftedReply = {
  body: string;
  note: string | null;
};

function isDraftResult(value: unknown): value is { body: string; note?: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as { body?: unknown; note?: unknown };
  return (
    typeof v.body === "string" &&
    (v.note === undefined || typeof v.note === "string")
  );
}

// Format a thread the way the model reads it best: oldest first, each
// message labelled with who sent it and whether that was the user. The
// "(you)" marker is what lets it tell a reply from an incoming message
// without guessing from the addresses.
function renderThread(
  thread: EmailThread,
  selfEmail: string | null,
  timeZone: string
): string {
  const self = selfEmail?.toLowerCase();
  const parts = thread.messages.map((message, index) => {
    const isSelf = self && message.fromEmail.toLowerCase() === self;
    const who = isSelf ? `${message.from} (you)` : message.from;
    // In the user's zone, not the server's. "She asked this morning"
    // has to mean their morning for the reply to read right.
    const when = new Date(message.date).toLocaleString("en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    return [
      `--- Message ${index + 1} of ${thread.messages.length} ---`,
      `From: ${who} <${message.fromEmail}>`,
      `Date: ${when}`,
      "",
      message.body || "(no readable body)",
    ].join("\n");
  });

  return [`Subject: ${thread.subject}`, "", ...parts].join("\n\n");
}

// Ask Claude for a reply. Returns the text only — saving it to Gmail is
// the caller's job, so a model failure can't leave a half-written draft
// sitting in someone's account.
export async function draftReply(
  thread: EmailThread,
  selfEmail: string | null,
  instruction?: string,
  profile: UserProfileRow | null = null
): Promise<DraftedReply> {
  const anthropic = getAnthropicClient();

  const trimmed = instruction?.trim().slice(0, MAX_INSTRUCTION_LENGTH);
  const timeZone = resolveTimezone(profile?.timezone);

  const response = await anthropic.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT + profileToDraftContext(profile),
    tools: [DRAFT_TOOL],
    tool_choice: { type: "tool", name: "write_reply" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              ...nowLines(timeZone),
              selfEmail ? `You are writing as ${selfEmail}.` : "",
              "",
              "Thread:",
              renderThread(thread, selfEmail, timeZone),
              "",
              trimmed
                ? `The user's instruction for this reply: ${trimmed}`
                : "The user gave no instruction — infer what this reply " +
                  "needs to do from the thread.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || !isDraftResult(toolUse.input)) {
    throw new Error("Claude did not return a reply matching the schema");
  }

  const body = toolUse.input.body.trim().slice(0, MAX_BODY_CHARS);
  if (!body) throw new Error("Claude returned an empty reply");

  const note = toolUse.input.note?.trim();

  return { body, note: note || null };
}
