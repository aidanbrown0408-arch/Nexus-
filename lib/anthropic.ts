import Anthropic from "@anthropic-ai/sdk";

// Models used by each Claude-backed feature. Kept here so every caller
// agrees on them, and so one can move without dragging the other.
export const BRIEF_MODEL = "claude-sonnet-5";
export const CHAT_MODEL = "claude-sonnet-5";
// Drafting a prep checklist is a small, structured job, but it runs while
// the user watches a spinner on one event — same model, low effort.
export const PREP_MODEL = "claude-sonnet-5";
// Drafting a reply is the output the user judges Nexus by most directly —
// they either send it or rewrite it. Worth the same model as the brief.
export const DRAFT_MODEL = "claude-sonnet-5";
// Reading intent out of one sentence, into a rule that will delete mail
// unsupervised. Small job, but the cost of getting it slightly wrong is
// higher than anywhere else in the app — not the place to save a cent.
export const FILTER_MODEL = "claude-sonnet-5";
// One judgement call made thirty times over, where the expensive
// mistake is missing a real message rather than keeping a newsletter.
export const TRIAGE_MODEL = "claude-sonnet-5";

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

  cached = new Anthropic({ apiKey });
  return cached;
}
