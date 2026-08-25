import type { Brief, NewsHighlight } from "./brief";
import { speakableText } from "./speech-text";

// The brief, read aloud.
//
// This is not the chat path. `speakableText` cleans up one message that
// was written to be read; this assembles a whole brief — a structured
// object, not prose — into something a person would say. The difference
// that matters is coverage: the brief on screen has sections a user
// specifically asked for in the interview (markets, the situation
// paragraphs, headlines), and a spoken version that quietly stops after
// the priorities is the same bug as a ticked box that renders nothing.
// Everything on the card is spoken, in the order it appears there.
//
// Pure, and in lib/, for the reason the test config gives: the parts of
// the voice feature worth testing are the ones with no browser in them.

const SOURCE_PHRASE: Record<string, string> = {
  email: "from your email",
  calendar: "from your calendar",
  both: "from your email and your calendar",
};

// Up to five priorities come back from the model, so five ordinals is
// the whole range. Past that the list is spoken without one rather than
// inventing "sixthly".
const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth"];

const NEWS_CATEGORY_PHRASE: Record<NewsHighlight["category"], string> = {
  financial: "markets",
  industry: "industry",
  us: "U.S.",
  world: "world",
};

// A sentence the ear can find the end of. Speech engines pause on a full
// stop and run straight through a line break, so every fragment that is
// meant to land as its own thought gets terminated here.
function sentence(text: string): string {
  const trimmed = speakableText(text);
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// "$512.30" and "-1.2%" are written forms. Said out loud they want
// words, and the sign wants to be a direction rather than a hyphen the
// synthesiser may swallow.
function spokenQuote(quote: {
  label: string;
  price: number;
  changePercent: number;
}): string {
  const price =
    quote.price >= 1000
      ? Math.round(quote.price).toLocaleString("en-US")
      : quote.price.toFixed(2);

  const magnitude = Math.abs(quote.changePercent).toFixed(2);
  const direction =
    quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : "flat";

  const move =
    direction === "flat"
      ? "flat on the day"
      : `${direction} ${magnitude} percent`;

  return `${quote.label} is at ${price} dollars, ${move}.`;
}

export function briefToSpeech(brief: Brief | null | undefined): string {
  if (!brief) return "";

  const parts: string[] = [];

  const greeting = sentence(brief.greeting ?? "");
  const headline = sentence(brief.headline ?? "");
  if (greeting) parts.push(greeting);
  if (headline) parts.push(headline);

  // Said before the priorities rather than after, because it changes how
  // to hear everything that follows.
  if (brief.calendarUnavailable) {
    parts.push(
      "This is from your email only — your calendar wasn't available this morning."
    );
  }

  const priorities = Array.isArray(brief.priorities) ? brief.priorities : [];
  priorities.forEach((priority, i) => {
    const title = sentence(priority?.title ?? "");
    if (!title) return;
    const lead = ORDINALS[i] ? `${ORDINALS[i]}, ` : "";
    // The source is a small grey label on screen. Spoken, it needs to be
    // part of a sentence or it lands as a stray word — folded into the
    // title where the title is a statement, and left as its own short
    // sentence where it isn't, so a question keeps its question mark.
    const where = SOURCE_PHRASE[priority?.source] ?? "";
    if (!where) {
      parts.push(`${lead}${title}`);
    } else if (/[?!]$/.test(title)) {
      parts.push(`${lead}${title}`, `That's ${where}.`);
    } else {
      parts.push(`${lead}${title.replace(/\.$/, "")}, ${where}.`);
    }
    const reason = sentence(priority?.reason ?? "");
    if (reason) parts.push(reason);
  });

  const scheduleNote = sentence(brief.scheduleNote ?? "");
  if (scheduleNote) parts.push(scheduleNote);

  // Everything below here exists only because the user asked for it in
  // the interview. A section they ticked and can't hear reads as a
  // setting that didn't save, so each one either speaks its content or
  // says plainly why it has none.
  const quotes = brief.markets?.quotes ?? [];
  if (quotes.length) {
    parts.push("Markets.");
    for (const quote of quotes) parts.push(spokenQuote(quote));
  } else if (brief.marketsUnavailable === "not_configured") {
    parts.push("Market prices aren't set up yet, so there are no numbers today.");
  } else if (brief.marketsUnavailable === "fetch_failed") {
    parts.push("Market prices couldn't be reached this morning.");
  }

  if (brief.situation) {
    parts.push("Here's what's going on.");
    for (const paragraph of brief.situation
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)) {
      const spoken = sentence(paragraph);
      if (spoken) parts.push(spoken);
    }
  }

  const highlights = brief.newsHighlights ?? [];
  if (highlights.length) {
    parts.push("Headlines.");
    for (const item of highlights) {
      const title = sentence(item?.title ?? "").replace(/\.$/, "");
      if (!title) continue;
      const category = NEWS_CATEGORY_PHRASE[item?.category];
      // The link is on screen and useless in the ear; the source is what
      // tells you how much weight to give the headline.
      const attribution = [category, item?.source].filter(Boolean).join(", ");
      parts.push(attribution ? `${title}. ${attribution}.` : `${title}.`);
    }
  } else if (brief.newsUnavailable === "fetch_failed") {
    parts.push("The news feeds couldn't be reached this morning.");
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}
