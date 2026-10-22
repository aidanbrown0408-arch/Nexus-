import type { Brief } from "./brief";
import { speakableText } from "./speech-text";

// The brief, said out loud.
//
// This is not the chat path. `speakableText` cleans up one message that
// was written to be read; this assembles a whole brief — a structured
// object, not prose — into something a person would say.
//
// Two rules, and they pull against each other.
//
// Coverage first: everything on the card is spoken. The brief has
// sections the user specifically asked for in the interview (markets,
// the situation paragraphs, headlines), and a spoken version that
// quietly stops after the priorities is the same bug as a ticked box
// that renders nothing. A section with no content says why it's empty
// rather than vanishing.
//
// But not the card read aloud. An earlier version of this narrated the
// screen in order — header, item, item, header — and it sounded like
// one: every priority the same shape, every quote its own stubby
// sentence, "Markets." arriving as a block. Spoken English doesn't
// work like that. A person says "top of the list", then "after that",
// then "and last"; they run two numbers into one breath with a
// "while"; they close with "that's everything" so you know they're
// done. So the structure here is deliberately not the card's: the same
// facts, re-narrated.
//
// What is *not* rephrased is anything that could be wrong if it were.
// Priority titles, the situation paragraphs, headline titles and every
// market figure are passed through exactly as they arrived — the same
// guarantee the card makes (see the comments on NewsHighlight and
// `markets` in brief.ts). Only the connective tissue is ours to write.
//
// Pure, and in lib/, for the reason the test config gives: the parts of
// the voice feature worth testing are the ones with no browser in them.

// Where each item came from (email, calendar) is shown on the card and
// left out of the read. Said after every item — "from your email" — it
// was the single most robotic thing about the spoken brief: a person
// briefing you doesn't cite the inbox each time, the reason already
// makes it obvious.

// A different-sounding brief every morning, without a model call and
// without a coin flip. The variant is chosen from the brief's own text,
// so two different mornings phrase things differently and the same
// brief phrased twice is identical — which is what makes this testable
// at all, and what stops a re-render from re-narrating mid-sentence.
function seedFrom(brief: Brief): number {
  const source = `${brief.greeting ?? ""}|${brief.headline ?? ""}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick<T>(options: readonly T[], seed: number, salt: number): T {
  return options[(seed + salt) % options.length];
}

// A sentence the ear can find the end of. Speech engines pause on a full
// stop and run straight through a line break, so every fragment that is
// meant to land as its own thought gets terminated here.
function sentence(text: string): string {
  const trimmed = speakableText(text);
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

// The same, minus the stop — for a fragment about to be joined to
// something else with a comma or a dash.
function clause(text: string): string {
  return speakableText(text).replace(/[.]+$/, "").trim();
}

// "$512.30" and "-1.2%" are written forms. Said out loud they want
// words, and the sign wants to be a direction rather than a hyphen the
// synthesiser may swallow. The figures themselves are untouched: this
// changes how a number is pronounced, never what it is.
function spokenQuote(quote: {
  label: string;
  price: number;
  changePercent: number;
}): string {
  const price =
    quote.price >= 1000
      ? Math.round(quote.price).toLocaleString("en-US")
      : // A trailing ".00" is two syllables nobody says. The cents stay
        // wherever there are any.
        quote.price.toFixed(2).replace(/\.00$/, "");

  // "down 1.20 percent" is written precision read as a stutter; "down
  // 1.2 percent" is the same number said the way it's said.
  const magnitude = String(parseFloat(Math.abs(quote.changePercent).toFixed(2)));
  const direction =
    quote.changePercent > 0 ? "up" : quote.changePercent < 0 ? "down" : "flat";

  const move =
    direction === "flat" ? "flat on the day" : `${direction} ${magnitude} percent`;

  return `${quote.label} is at ${price} dollars, ${move}`;
}

// Two numbers in one breath is how a person reads a row of them; six
// stubby sentences is a screen reader. So quote clauses go out in pairs.
function pairUp(clauses: string[], joiner: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < clauses.length; i += 2) {
    out.push(`${clauses.slice(i, i + 2).join(joiner)}.`);
  }
  return out;
}

// Headlines are too long to pair — two of them in one sentence is a
// clause nobody can hold. They get a connector each instead, which is
// the difference between a list being recited and one being told.
const NEWS_CONNECTORS = ["Also,", "Meanwhile,", "And", "Elsewhere,"] as const;

const OPENERS = ["Good morning.", "Morning.", "Right — good morning."] as const;

// Ordinals are how a document numbers a list. These are how someone
// talks through one.
const FIRST_STEP = ["Top of the list,", "First thing,", "First up,"] as const;
const MIDDLE_STEPS = ["After that,", "Then,", "Next,", "Also,"] as const;
const LAST_STEP = ["And last,", "And finally,", "And then,"] as const;
const SECOND_OF_TWO = ["And then,", "After that,", "Then,"] as const;

const PRIORITY_LEAD_IN = [
  "Here's what wants you today.",
  "A few things need you.",
  "This is what I'd look at first.",
] as const;
const SCHEDULE_LEAD_IN = ["As for the day itself,", "On your schedule,", "For the rest of the day,"] as const;
const MARKETS_LEAD_IN = ["On the markets,", "Markets, briefly:", "Quick look at the markets:"] as const;
const SITUATION_LEAD_IN = [
  "A bit of wider context.",
  "The bigger picture:",
  "Some background worth having.",
] as const;
const NEWS_LEAD_IN = ["In the headlines,", "In the news,", "Worth knowing,"] as const;
const SIGN_OFF = ["That's everything.", "That's the lot.", "That's your morning."] as const;

export function briefToSpeech(brief: Brief | null | undefined): string {
  if (!brief) return "";

  const seed = seedFrom(brief);
  const parts: string[] = [];

  const greeting = clause(brief.greeting ?? "");
  const headline = clause(brief.headline ?? "");

  if (greeting) {
    // The card's greeting is a statement of the day's shape, not a
    // hello — so one gets put in front of it, unless the model already
    // wrote one and two would be odd.
    const alreadyGreets = /\b(morning|hello|hi|good afternoon|good evening)\b/i.test(
      greeting
    );
    if (!alreadyGreets) parts.push(pick(OPENERS, seed, 0));
    // Greeting and headline are one thought said aloud — "Two things
    // need you today: Sarah's waiting on the Q3 budget" — where on
    // screen they're two lines because two lines look better.
    parts.push(headline ? `${greeting}: ${headline}.` : `${greeting}.`);
  } else if (headline) {
    parts.push(pick(OPENERS, seed, 0), `${headline}.`);
  }

  // Said before the priorities rather than after, because a gap in the
  // source data changes how to hear everything that follows.
  if (brief.calendarUnavailable) {
    parts.push(
      "One caveat: this is from your email only — your calendar wasn't available this morning."
    );
  }
  // The card shows this one too, and a spoken brief that silently drops
  // it is a brief that sounds complete while being half the picture.
  if (brief.mailUnavailable) {
    parts.push(
      "One caveat: this is from your calendar only — your mail wasn't available this morning."
    );
  }

  const priorities = (Array.isArray(brief.priorities) ? brief.priorities : []).filter(
    (p) => clause(p?.title ?? "")
  );

  // Only where nothing has introduced them yet. After a greeting like
  // "Three things need you today", a lead-in says it a second time.
  if (priorities.length > 1 && !greeting && !headline) {
    parts.push(pick(PRIORITY_LEAD_IN, seed, 1));
  }

  priorities.forEach((priority, i) => {
    const title = clause(priority.title);
    const last = i === priorities.length - 1;
    // A single priority doesn't get counted off — "top of the list" for
    // a list of one is a tell that a template wrote it.
    const lead =
      priorities.length === 1
        ? ""
        : i === 0
          ? `${pick(FIRST_STEP, seed, 2)} `
          : last
            ? // "And last" only sounds right after a middle item.
              priorities.length === 2
              ? `${pick(SECOND_OF_TWO, seed, 3)} `
              : `${pick(LAST_STEP, seed, 3)} `
            : `${pick(MIDDLE_STEPS, seed, i)} `;

    // The source is a small grey label on screen. Spoken, it has to be
    // part of a sentence or it lands as a stray word — hung off the
    // title with a dash where the title is a statement, and left as its
    // own short remark where it isn't, so a question keeps its mark.
    const isQuestion = /[?!]$/.test(speakableText(priority.title).trim());
    if (isQuestion) {
      parts.push(`${lead}${speakableText(priority.title).trim()}`);
    } else {
      parts.push(`${lead}${title}.`);
    }
    const reason = sentence(priority.reason ?? "");
    if (reason) parts.push(reason);
  });

  const scheduleNote = clause(brief.scheduleNote ?? "");
  if (scheduleNote) {
    // Lower-case the first letter only where it's safe to: a note that
    // starts with a name or an initialism keeps it.
    const runsOn = /^[A-Z][a-z]/.test(scheduleNote)
      ? scheduleNote[0].toLowerCase() + scheduleNote.slice(1)
      : scheduleNote;
    parts.push(`${pick(SCHEDULE_LEAD_IN, seed, 4)} ${runsOn}.`);
  }

  // Everything below here exists only because the user asked for it in
  // the interview. A section they ticked and can't hear reads as a
  // setting that didn't save, so each one either speaks its content or
  // says plainly why it has none.
  const quotes = brief.markets?.quotes ?? [];
  // The situation opens with a paragraph on markets, written from these
  // exact figures — so on screen the row of tiles and that paragraph sit
  // next to each other and the eye takes both in at a glance. In the ear
  // they arrive one after the other, and the second one is the first one
  // again: the quote row said what moved, then the paragraph says what
  // moved and what it means. So where there's a written read, it does
  // the talking and the tiles stay on screen where they belong.
  const situationCoversMarkets = Boolean(brief.situation?.trim());
  if (quotes.length && !situationCoversMarkets) {
    const clauses = quotes.map(spokenQuote);
    // The section announces itself inside the first number rather than
    // ahead of it, so there's no header to hear.
    const [first, ...rest] = pairUp(clauses, ", while ");
    parts.push(`${pick(MARKETS_LEAD_IN, seed, 5)} ${first}`);
    parts.push(...rest);
  } else if (!quotes.length && brief.marketsUnavailable === "not_configured") {
    parts.push("Market prices aren't set up yet, so there are no numbers today.");
  } else if (!quotes.length && brief.marketsUnavailable === "fetch_failed") {
    parts.push("Market prices couldn't be reached this morning.");
  }

  if (brief.situation) {
    const paragraphs = brief.situation
      .split(/\n\s*\n/)
      .map((p) => sentence(p.trim()))
      .filter(Boolean);
    if (paragraphs.length) {
      parts.push(pick(SITUATION_LEAD_IN, seed, 6));
      parts.push(...paragraphs);
    }
  }

  const highlights = (brief.newsHighlights ?? []).filter((item) =>
    clause(item?.title ?? "")
  );
  if (highlights.length) {
    // The link is on screen and useless in the ear; the source is what
    // tells you how much weight to give the headline. Spoken as a
    // clause hanging off the headline rather than as its own stub
    // sentence — "Fed holds rates steady. markets, Reuters." is two
    // blocks where one sentence was meant. Titles are copied exactly,
    // capital letters mid-sentence and all: a synthesiser doesn't
    // pronounce case, and lowercasing mangles names and tickers.
    // "Reuters reports: Fed holds rates steady" is how a headline is
    // said out loud. The earlier "Fed holds rates steady, from Reuters on
    // markets" read like a database row. Titles stay verbatim — a
    // paraphrased headline is a misquote.
    highlights.forEach((item, i) => {
      const title = clause(item.title);
      const said = item.source ? `${item.source} reports: ${title}` : title;
      const lead =
        i === 0 ? pick(NEWS_LEAD_IN, seed, 7) : pick(NEWS_CONNECTORS, seed, i);
      const joiner = i === 0 && !item.source ? ":" : "";
      parts.push(`${lead}${joiner} ${said}.`);
    });
  } else if (brief.newsUnavailable === "fetch_failed") {
    parts.push("The news feeds couldn't be reached this morning.");
  }

  // Nothing to say is said by saying nothing — an opener and a sign-off
  // wrapped around silence is worse than silence.
  if (!parts.length) return "";
  parts.push(pick(SIGN_OFF, seed, 8));

  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:?!])/g, "$1")
    // "on U.S.." — an abbreviation already ending in a stop doesn't need
    // the sentence's one on top of it.
    .replace(/\.\.+/g, ".")
    .trim();
}
