// Turning a chat reply into something worth hearing.
//
// Claude's answers are written to be *read*: bullets, bold, the odd
// backticked field name, sometimes a URL. A speech synthesiser reads all
// of that literally — "star star Sarah star star", "https colon slash
// slash" — which is the difference between a feature that sounds
// finished and one that sounds like a screen reader having a bad day.
//
// This lives in lib/ rather than next to the component for the reason
// the test config gives: it's the only part of the voice feature that is
// pure logic, so it's the only part worth testing.

const FENCE = /```[\s\S]*?```/g;
const MD_LINK = /\[([^\]]+)\]\((?:[^)]*)\)/g;
const BARE_URL = /\bhttps?:\/\/\S+/gi;
const INLINE_CODE = /`([^`]*)`/g;
// Emphasis markers only where they're actually wrapping something, so a
// snake_case word or a lone asterisk in prose survives intact.
const EMPHASIS = /(\*\*|__|\*|_)(?=\S)([\s\S]*?\S)\1/g;
const LIST_MARKER = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;
const QUOTE = /^\s*>\s?/;

// A line that already ends in punctuation shouldn't collect a second
// full stop; one that doesn't needs one, or consecutive bullets run
// together into a single breathless sentence.
function terminate(line: string): string {
  return /[.!?:;,]$/.test(line) ? line : line + ".";
}

export function speakableText(input: unknown): string {
  if (typeof input !== "string") return "";

  const cleaned = input
    // Reading code aloud helps nobody. Say that there was some.
    .replace(FENCE, " (code block) ")
    .replace(MD_LINK, "$1")
    .replace(BARE_URL, "a link")
    .replace(INLINE_CODE, "$1");

  const lines = cleaned
    .split("\n")
    .map((line) =>
      line
        .replace(HEADING, "")
        .replace(QUOTE, "")
        .replace(LIST_MARKER, "")
        .replace(EMPHASIS, "$2")
        .trim()
    )
    .filter(Boolean)
    .map(terminate);

  return lines.join(" ").replace(/\s+/g, " ").trim();
}
