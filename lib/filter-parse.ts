import { getAnthropicClient, FILTER_MODEL } from "./anthropic";
import type { FilterCriteria } from "./filters";

// Turning "bin the Medium newsletters" into Gmail filter criteria.
//
// The reason this exists rather than a form with a From box: people know
// what they want gone, not how to phrase it in Gmail's query language.
// The reason it's still followed by a mandatory preview: a model reading
// intent from one sentence will sometimes read it too broadly, and the
// preview is what catches that before anything is deleted.
//
// The prompt is biased toward narrow. A filter that misses some junk gets
// widened next week; a filter that trashes a client's mail costs the user
// something they can't get back from a 30-day Trash window they didn't
// know to check.

export const MAX_DESCRIPTION_LENGTH = 300;

const SYSTEM_PROMPT = [
  "You translate a plain-English description of unwanted email into",
  "Gmail filter criteria. The filter you produce will send matching mail",
  "to Trash automatically, without a human reviewing each message.",
  "",
  "Be conservative. When a description could be read narrowly or",
  "broadly, choose the narrow reading. Prefer matching on a specific",
  "sender address or domain over matching on subject words, because",
  "subject words appear in mail the user actually wants.",
  "",
  "Never produce criteria that would match all mail, mail from a whole",
  "public domain like gmail.com, or anything defined only by being old.",
  "If the description is too vague to turn into something specific, say",
  "so in `concern` and still give your best narrow attempt.",
  "",
  "Use `query` for Gmail search syntax the structured fields can't",
  "express — list:, category:promotions, has:attachment, older_than:.",
  "Use `negatedQuery` to carve out exceptions the user implied.",
  "",
  "Set `concern` whenever the filter might catch wanted mail, when the",
  "description was ambiguous, or when you had to guess an address. Leave",
  "it out only when the criteria are unambiguous and tightly scoped.",
].join("\n");

const FILTER_TOOL = {
  name: "write_filter_criteria",
  description: "Record Gmail filter criteria for mail to send to Trash.",
  input_schema: {
    type: "object" as const,
    properties: {
      from: {
        type: "string",
        description:
          "Sender address or domain, e.g. 'noreply@medium.com' or " +
          "'medium.com'. Prefer this field over subject matching.",
      },
      to: {
        type: "string",
        description: "Recipient address, for mail sent to an alias.",
      },
      subject: {
        type: "string",
        description: "Words that must appear in the subject line.",
      },
      query: {
        type: "string",
        description:
          "Additional Gmail search syntax, e.g. 'category:promotions' or " +
          "'list:announcements.example.com'.",
      },
      negatedQuery: {
        type: "string",
        description:
          "Gmail search syntax for mail to exclude, e.g. 'from:boss@work.com'.",
      },
      hasAttachment: {
        type: "boolean",
        description: "Only match mail carrying an attachment.",
      },
      label: {
        type: "string",
        description:
          "A short human label for this rule, e.g. 'Medium newsletters'. " +
          "Shown in the filter list.",
      },
      concern: {
        type: "string",
        description:
          "One line on what this might wrongly catch, or what you had to " +
          "guess. Omit only if there is genuinely nothing to flag.",
      },
    },
    required: ["label"],
  },
};

export type ParsedFilter = {
  criteria: FilterCriteria;
  label: string;
  concern: string | null;
};

type ToolInput = {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  label?: string;
  concern?: string;
};

function isToolInput(value: unknown): value is ToolInput {
  return Boolean(value && typeof value === "object");
}

// Criteria broad enough to be dangerous regardless of what the model
// intended. Checked here rather than trusting the prompt: a system
// instruction is guidance, and this is the thing that must not happen.
const FORBIDDEN_FROM = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
]);

export function rejectDangerousCriteria(
  criteria: FilterCriteria
): string | null {
  const from = criteria.from?.trim().toLowerCase();
  if (from) {
    const domain = from.includes("@") ? from.split("@").pop()! : from;
    if (FORBIDDEN_FROM.has(domain)) {
      return `Matching everyone at ${domain} would catch personal mail. Narrow it to a specific address.`;
    }
  }

  // "Everything older than X" is the classic filter that quietly eats an
  // archive. Age can narrow a rule; it can't be the whole rule.
  const onlyAge =
    !criteria.from &&
    !criteria.to &&
    !criteria.subject &&
    !criteria.hasAttachment &&
    /older_than|newer_than/.test(criteria.query ?? "");
  if (onlyAge) {
    return "A rule based only on age would catch everything eventually. Add a sender or subject.";
  }

  return null;
}

export async function parseFilterDescription(
  description: string
): Promise<ParsedFilter> {
  const anthropic = getAnthropicClient();
  const trimmed = description.trim().slice(0, MAX_DESCRIPTION_LENGTH);

  const response = await anthropic.messages.create({
    model: FILTER_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [FILTER_TOOL],
    tool_choice: { type: "tool", name: "write_filter_criteria" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `The user wants this mail sent to Trash automatically:\n\n${trimmed}`,
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || !isToolInput(toolUse.input)) {
    throw new Error("Claude did not return filter criteria matching the schema");
  }

  const input = toolUse.input;
  const criteria: FilterCriteria = {
    from: input.from?.trim() || undefined,
    to: input.to?.trim() || undefined,
    subject: input.subject?.trim() || undefined,
    query: input.query?.trim() || undefined,
    negatedQuery: input.negatedQuery?.trim() || undefined,
    hasAttachment: input.hasAttachment || undefined,
  };

  return {
    criteria,
    label: input.label?.trim() || "Untitled rule",
    concern: input.concern?.trim() || null,
  };
}
