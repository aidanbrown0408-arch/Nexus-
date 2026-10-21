// Turning a chat reply into something worth hearing.
//
// Claude's answers are written to be *read*: bullets, bold, the odd
// backticked field name, sometimes a URL. A speech synthesiser reads all
// of that literally — "star star Sarah star star", "https colon slash
// slash" — which is the difference between a feature that sounds
// finished and one that sounds like a screen reader having a bad day.
//
// The subtler failure is rhythm. An earlier version of this ended every
// line with a full stop, which is correct markdown-to-text and terrible
// speech: three bullets became three stubby sentences with a hard stop
// between each, and the voice arrived in blocks. People don't say
// "Psychology at nine. Then the dentist. Then Sarah's review." — they
// say "Psychology at nine, then the dentist, and Sarah's review at two."
// So a run of list items is spoken as one sentence with commas and a
// final "and", a heading leads into what follows rather than standing
// alone, and the abbreviations nobody pronounces get spelled out.
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

// Written shorthand nobody says out loud, and the punctuation a
// synthesiser either mispronounces or races straight through. A dash
// between clauses is a pause in print and nothing at all in speech —
// a comma is what actually makes the voice breathe there.
const SPOKEN: [RegExp, string][] = [
  [/\s*&\s*/g, " and "],
  [/\be\.g\.,?\s*/gi, "for example, "],
  [/\bi\.e\.,?\s*/gi, "that is, "],
  [/\bvs\.?(?=\s|$)/gi, "versus"],
  [/\bw\/(?=\s)/gi, "with"],
  [/\bETA\b/g, "E T A"],
  // Em dash, en dash and the typed double hyphen, all doing the same job.
  [/\s+[—–]\s+|\s+--\s+/g, ", "],
  [/\.{3,}/g, ","],
  // "8:20AM" — the missing space makes some voices read it as one word.
  [/(\d)\s*(am|pm)\b/gi, "$1 $2"],
  // "2:00 PM" is a written form; out loud it's just "two PM".
  [/\b(\d{1,2}):00\b/g, "$1"],
];

// A line that already ends in punctuation shouldn't collect a second
// full stop; one that doesn't needs one, or consecutive thoughts run
// together into a single breathless sentence.
function terminate(line: string): string {
  return /[.!?:;,]$/.test(line) ? line : line + ".";
}

// Trailing punctuation has to come off an item before it can be joined
// to the next one with a comma.
function unterminate(line: string): string {
  return line.replace(/[.,;:]+$/, "");
}

// Past this, an item is a sentence in its own right and stringing it
// onto its neighbours with "and" makes one long unparseable clause.
const JOINABLE_ITEM_CHARS = 80;

// Several bullets, said the way a person says a list.
function joinItems(items: string[]): string {
  if (items.length === 1) return terminate(items[0]);

  const tooLong = items.some((item) => item.length > JOINABLE_ITEM_CHARS);
  // A question in the middle of a list can't be joined either — "did it
  // work, and yes" is not what was written.
  const hasOwnPunctuation = items.some((item) => /[?!]$/.test(item));
  if (tooLong || hasOwnPunctuation) {
    return items.map(terminate).join(" ");
  }

  const parts = items.map(unterminate).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return terminate(parts[0]);

  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1);
  return terminate(`${rest.join(", ")} and ${last}`);
}

type Line = { text: string; list: boolean; heading: boolean };

export function speakableText(input: unknown): string {
  if (typeof input !== "string") return "";

  let cleaned = input
    // Reading code aloud helps nobody. Say that there was some.
    .replace(FENCE, " (code block) ")
    .replace(MD_LINK, "$1")
    .replace(BARE_URL, "a link")
    .replace(INLINE_CODE, "$1");

  for (const [pattern, replacement] of SPOKEN) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  const lines: Line[] = cleaned
    .split("\n")
    .map((raw) => {
      const heading = HEADING.test(raw);
      const list = LIST_MARKER.test(raw);
      const text = raw
        .replace(HEADING, "")
        .replace(QUOTE, "")
        .replace(LIST_MARKER, "")
        .replace(EMPHASIS, "$2")
        .replace(/\s+/g, " ")
        .trim();
      return { text, list, heading };
    })
    .filter((line) => line.text);

  const spoken: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Consecutive bullets are one thought, not one each.
    if (line.list) {
      const run: string[] = [];
      while (i < lines.length && lines[i].list) {
        run.push(lines[i].text);
        i += 1;
      }
      i -= 1;
      spoken.push(joinItems(run));
      continue;
    }

    // "Today." on its own is a heading being read as a sentence. Said
    // aloud it's a lead-in, so it keeps the line under it company.
    if (line.heading && lines[i + 1]) {
      spoken.push(`${unterminate(line.text)}:`);
      continue;
    }

    spoken.push(terminate(line.text));
  }

  return spoken
    .join(" ")
    .replace(/\s+/g, " ")
    // A colon lead-in followed by a joined list can leave ": ," behind.
    .replace(/\s+([,.;:?!])/g, "$1")
    .trim();
}

// --- chunking -----------------------------------------------------------

// Why a minute of audio can't be one request.
//
// A hosted voice synthesises the whole input before it returns the first
// byte, so time-to-first-sound scales with how much there is to say. A
// chat reply is a sentence or two and comes back in about a second. The
// morning brief is around nine hundred characters — a full minute of
// speech — and the wait for it was long enough that the honest reading
// of the button was that it didn't work.
//
// So the text is cut into pieces that are synthesised and played in
// order, with the next one fetched while the current one plays. The
// first piece is deliberately the smallest: it's the only one whose
// latency anyone experiences, because every piece after it is being
// made during audio that is already playing.
//
// Cuts land on sentence ends. A cut mid-sentence is audible — the two
// halves get their own intonation contours and the seam sounds like a
// skip — and a cut mid-word is a different word.

/** Small enough to come back fast; long enough not to sound clipped. */
export const FIRST_CHUNK_CHARS = 220;
/** Later chunks are fetched during playback, so they trade latency for seams. */
export const CHUNK_CHARS = 600;

const SENTENCE_END = /(?<=[.!?])\s+/;
// Where to cut a sentence that is longer than a whole chunk on its own.
// Rare, and always a run-on: better a breath at a comma than a hard
// stop mid-clause.
const CLAUSE_END = /(?<=[,;:])\s+/;

function hardSplit(piece: string, limit: number): string[] {
  if (piece.length <= limit) return [piece];

  const out: string[] = [];
  let rest = piece;
  while (rest.length > limit) {
    // Back off to the last word boundary inside the limit, so a cut
    // never lands inside a word.
    const window = rest.slice(0, limit);
    const cut = window.lastIndexOf(" ");
    const at = cut > limit * 0.5 ? cut : limit;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Speech-sized pieces, cut at sentence ends, first one shortest.
 *
 * Joining the result back together with a space reproduces the input's
 * words in order — nothing is dropped, reordered or duplicated, which
 * is the one property that matters when the pieces are read aloud one
 * after another.
 */
export function chunkForSpeech(
  text: string,
  first: number = FIRST_CHUNK_CHARS,
  rest: number = CHUNK_CHARS
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= first) return [trimmed];

  // Sentences, and then any sentence too long to be a chunk broken at
  // its clauses — so the packing below never has to cut one itself.
  const pieces: string[] = [];
  for (const raw of trimmed.split(SENTENCE_END)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= rest) {
      pieces.push(sentence);
      continue;
    }
    for (const clause of sentence.split(CLAUSE_END)) {
      const part = clause.trim();
      if (part) pieces.push(...hardSplit(part, rest));
    }
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    // The first chunk is held short on purpose; every one after it is
    // being fetched while something else is already playing.
    const limit = chunks.length === 0 ? first : rest;
    if (!current) {
      current = piece;
      continue;
    }
    if (current.length + 1 + piece.length <= limit) {
      current = `${current} ${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}
