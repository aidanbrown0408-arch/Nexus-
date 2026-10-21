import Anthropic from "@anthropic-ai/sdk";

// Models used by each Claude-backed feature. Kept here so every caller
// agrees on them, and so one can move without dragging the other.
//
// All on Claude Sonnet 5.5. Two things changed with it that the callers
// below depend on: forcing a particular tool (`tool_choice: "tool"` /
// `"any"`) now returns a 400, so structured results come back through
// `output_config.format` instead (see `generateStructured`); and effort
// levels were recalibrated, so `low` here is not identical to `low` on
// Sonnet 5.
export const BRIEF_MODEL = "claude-sonnet-5-5";
export const CHAT_MODEL = "claude-sonnet-5-5";
// Drafting a prep checklist is a small, structured job, but it runs while
// the user watches a spinner on one event — same model, low effort.
export const PREP_MODEL = "claude-sonnet-5-5";
// Drafting a reply is the output the user judges Nexus by most directly —
// they either send it or rewrite it. Worth the same model as the brief.
export const DRAFT_MODEL = "claude-sonnet-5-5";
// Reading intent out of one sentence, into a rule that will delete mail
// unsupervised. Small job, but the cost of getting it slightly wrong is
// higher than anywhere else in the app — not the place to save a cent.
export const FILTER_MODEL = "claude-sonnet-5-5";
// One judgement call made thirty times over, where the expensive
// mistake is missing a real message rather than keeping a newsletter.
export const TRIAGE_MODEL = "claude-sonnet-5-5";

// Server-only Anthropic client. The API key is never exposed to the browser —
// never import this from a client component.

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Anthropic is not configured. Set ANTHROPIC_API_KEY in .env.local (get one from console.anthropic.com)."
    );
  }

  // Two retries with backoff on 429/5xx is the SDK default; a minute is
  // plenty for any single call here and keeps a hung upstream from
  // holding a serverless function open to its platform limit.
  cached = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return cached;
}

type JsonSchema = Record<string, unknown>;

// Structured outputs accept a subset of JSON Schema. Rather than keep two
// copies of every schema, the descriptive one is written once (with the
// limits a reader wants to see, like `maxItems: 5`) and narrowed here:
// every object gets `additionalProperties: false`, and any keyword the
// API would reject is folded into the description so the model still
// reads it. Callers re-check those limits on the parsed result, which
// they already did when this came back as tool input.
//
// The SDK ships a similar transform, but it also demotes `enum` into a
// description — and `enum` *is* supported, and is the one constraint
// here worth having enforced rather than requested.
const UNSUPPORTED_KEYS = [
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "uniqueItems",
];

export function toStructuredSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {};
  const notes: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYS.includes(key)) {
      notes.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    if (key === "minItems" && typeof value === "number" && value > 1) {
      notes.push(`minItems: ${value}`);
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [
          k,
          toStructuredSchema(v),
        ])
      );
      continue;
    }
    if (key === "items" && value && typeof value === "object") {
      out.items = toStructuredSchema(value as JsonSchema);
      continue;
    }
    if ((key === "anyOf" || key === "allOf") && Array.isArray(value)) {
      out[key] = value.map((v) => toStructuredSchema(v as JsonSchema));
      continue;
    }
    if (key === "additionalProperties") continue;
    out[key] = value;
  }

  if (out.type === "object") out.additionalProperties = false;
  if (notes.length) {
    const base = typeof out.description === "string" ? `${out.description} ` : "";
    out.description = `${base}(${notes.join(", ")})`;
  }
  return out;
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly stopReason: string | null
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

type StructuredRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: JsonSchema;
  effort?: "low" | "medium" | "high";
};

// One model call whose answer is a JSON object matching `schema`.
//
// Returns the parsed object as `unknown` on purpose: the schema shapes
// what the model writes, but every caller still runs its own type guard
// before trusting a field, exactly as it did with tool input.
export async function generateStructured({
  model,
  max_tokens,
  system,
  messages,
  schema,
  effort,
}: StructuredRequest): Promise<unknown> {
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens,
    system,
    messages,
    output_config: {
      ...(effort ? { effort } : {}),
      format: { type: "json_schema", schema: toStructuredSchema(schema) },
    },
  });

  // A refusal can come back as a 200 whose text doesn't match the
  // schema, and `max_tokens` truncates the JSON mid-value. Both are a
  // failed generation, not something to parse.
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    throw new StructuredOutputError(
      `Claude stopped before finishing (${response.stop_reason})`,
      response.stop_reason
    );
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) {
    throw new StructuredOutputError("Claude returned no content", response.stop_reason);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new StructuredOutputError(
      "Claude returned output that is not valid JSON",
      response.stop_reason
    );
  }
}
