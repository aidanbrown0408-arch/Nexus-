import Anthropic from "@anthropic-ai/sdk";

// Models used by each Claude-backed feature. Kept here so every caller
// agrees on them, and so one can move without dragging the other.
export const BRIEF_MODEL = "claude-sonnet-5";
export const CHAT_MODEL = "claude-sonnet-5";

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
