import { getAnthropicClient, TRIAGE_MODEL } from "./anthropic";
import { nowLines, resolveTimezone } from "./clock";
import {
  matchesVip,
  profileToPromptContext,
  vipTerms,
  type UserProfileRow,
} from "./profile";
import type { EmailSummary } from "./gmail";

// "These 14 look like noise."
//
// The whole feature is one judgement call made 30 times, and the failure
// modes aren't symmetric. Archiving a newsletter the user would have
// skimmed costs them nothing — it's still there, one search away. Missing
// a real message because it was archived unread costs them a reply they
// owed someone. So the prompt is biased toward keeping, and the UI lets
// the user uncheck anything before it runs.
//
// Nothing here writes. It proposes, and the caller decides.
//
// The user's profile enters twice, and the difference between the two is
// the point. Their noise list is *advice* — it goes in the prompt and the
// model weighs it. Their VIP list is a *rule* — it is enforced in code
// after the model answers, because "never bury this person" is exactly
// the promise that can't be left to a judgement call. A model that
// misreads a co-founder's terse one-liner as a notification would break
// the one guarantee the interview made.

export type TriageProposal = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  unread: boolean;
  // Why this looked like noise. Shown next to the checkbox — a list of
  // 14 messages with no reasoning is a list the user either trusts
  // blindly or ignores, and neither is what this is for.
  reason: string;
};

export type TriageResult = {
  proposals: TriageProposal[];
  // How many picks were dropped for coming from someone on the VIP list.
  // Surfaced rather than swallowed: a user who is told "I left two of
  // your people alone" learns the list is real, which is the whole
  // reason they filled it in.
  vipProtected: number;
};

const SYSTEM_PROMPT = [
  "You are triaging an inbox. Pick out the messages that were never",
  "going to need the user: newsletters, marketing, receipts for things",
  "already received, automated notifications, social media digests,",
  "shipping updates for delivered orders, calendar invite confirmations.",
  "",
  "Be conservative. Getting this wrong in one direction costs the user",
  "nothing — an archived newsletter is one search away. Getting it wrong",
  "in the other direction means they miss a message someone is waiting",
  "on. When you're unsure, leave it in the inbox.",
  "",
  "Never propose archiving:",
  "- anything from a real person writing directly to the user",
  "- anything that asks a question or requests something",
  "- security alerts, password resets, two-factor codes, billing",
  "  failures, or anything about account access",
  "- invoices or receipts for something not yet delivered or paid",
  "- anything where a human is plainly waiting on a reply",
  "",
  "The `bulk` flag means the message carries a List-Unsubscribe header.",
  "It's evidence of a mailing list, not proof of noise — plenty of mail",
  "people care about is sent that way. Weigh it, don't obey it.",
  "",
  "Give each pick a short, specific reason: 'Weekly Medium digest', not",
  "'looks like a newsletter'. If nothing qualifies, return an empty list.",
].join("\n");

const TRIAGE_TOOL = {
  name: "propose_archive",
  description: "List the inbox messages that look like noise.",
  input_schema: {
    type: "object" as const,
    properties: {
      archive: {
        type: "array",
        description:
          "Messages to propose archiving. May be empty. Two correct " +
          "picks beat ten uncertain ones.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The message id exactly as given.",
            },
            reason: {
              type: "string",
              description:
                "Short, specific reason this is noise, e.g. 'Weekly " +
                "Medium digest' or 'Amazon delivery confirmation'.",
            },
          },
          required: ["id", "reason"],
        },
      },
    },
    required: ["archive"],
  },
};

type ToolResult = { archive: { id: string; reason: string }[] };

function isTriageResult(value: unknown): value is ToolResult {
  if (!value || typeof value !== "object") return false;
  const v = value as { archive?: unknown };
  return (
    Array.isArray(v.archive) &&
    v.archive.every(
      (a) =>
        a &&
        typeof a === "object" &&
        typeof (a as { id?: unknown }).id === "string" &&
        typeof (a as { reason?: unknown }).reason === "string"
    )
  );
}

export async function proposeArchive(
  messages: EmailSummary[],
  profile: UserProfileRow | null = null
): Promise<TriageResult> {
  if (!messages.length) return { proposals: [], vipProtected: 0 };

  const anthropic = getAnthropicClient();
  const timeZone = resolveTimezone(profile?.timezone);
  const vips = vipTerms(profile);

  // Two extra instructions on top of the general profile block, because
  // triage acts on these lists rather than merely reading them.
  const rules: string[] = [];
  if (profile?.vips?.length) {
    rules.push(
      "Never propose archiving anything from these people, whatever it " +
        `looks like: ${profile.vips.join(", ")}.`
    );
  }
  if (profile?.noise_filters?.length) {
    rules.push(
      "They have told you these categories are noise. Treat mail that " +
        "plainly falls into one as a strong candidate, while still " +
        "applying every rule above about questions, security and money: " +
        `${profile.noise_filters.join(", ")}.`
    );
  }
  const profileRules = rules.length
    ? "\n\nRules from this specific user:\n" +
      rules.map((rule) => `- ${rule}`).join("\n")
    : "";

  const response = await anthropic.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT + profileRules + profileToPromptContext(profile),
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: "propose_archive" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              ...nowLines(timeZone),
              "",
              "Inbox:",
              JSON.stringify(
                messages.map((m) => ({
                  id: m.id,
                  from: m.from,
                  fromEmail: m.fromEmail,
                  subject: m.subject,
                  snippet: m.snippet.slice(0, 200),
                  date: m.date,
                  unread: m.unread,
                  bulk: Boolean(m.bulk),
                })),
                null,
                2
              ),
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || !isTriageResult(toolUse.input)) {
    throw new Error("Claude did not return a triage list matching the schema");
  }

  // Join back against the real messages rather than trusting the model's
  // copy of them. A hallucinated id matches nothing and drops out, and
  // the sender and subject shown to the user come from Gmail.
  const byId = new Map(messages.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const proposals: TriageProposal[] = [];
  let vipProtected = 0;

  for (const pick of toolUse.input.archive) {
    const message = byId.get(pick.id);
    if (!message || seen.has(pick.id)) continue;
    seen.add(pick.id);

    // The rule, enforced. The prompt already asked for this; asking is
    // not the same as guaranteeing, and this is the one place where a
    // single wrong call costs the user a message they were waiting for.
    if (matchesVip(message.from, message.fromEmail, vips)) {
      vipProtected += 1;
      continue;
    }

    proposals.push({
      id: message.id,
      from: message.from,
      fromEmail: message.fromEmail,
      subject: message.subject,
      date: message.date,
      unread: message.unread,
      reason: pick.reason.trim().slice(0, 120),
    });
  }

  return { proposals, vipProtected };
}
