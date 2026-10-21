const test = require("node:test");
const assert = require("node:assert/strict");
const { briefToSpeech } = require("../.test-build/lib/brief-speech.js");

// Two things are being tested here, and they pull against each other.
//
// Coverage: the brief on screen carries sections the user asked for in
// the onboarding interview, and the version read aloud has to carry the
// same ones — a ticked box you can't hear is indistinguishable from a
// setting that didn't save.
//
// Voice: it must not be the card read out. So the assertions below are
// deliberately about *content* rather than exact wording — anything
// that could be wrong if it were rephrased (figures, headline titles,
// priority titles) is pinned exactly, and everything else is checked
// for presence, not phrasing. That leaves the connective language free
// to change without a test rewrite.

const base = {
  greeting: "Two things need you today.",
  headline: "Sarah is waiting on the Q3 budget before your 2pm.",
  priorities: [],
  scheduleNote: "Four meetings, back to back from 1pm.",
};

test("opens with the greeting and the headline, and closes off", () => {
  const spoken = briefToSpeech(base);
  assert.match(spoken, /Two things need you today/);
  assert.match(spoken, /Sarah is waiting on the Q3 budget/);
  // "1pm" is written shorthand; speakableText spaces it so the voice
  // says "one PM" rather than running it into one word.
  assert.match(spoken, /1 pm/);
  // A spoken brief that just stops sounds like it was cut off.
  assert.match(spoken, /That's (everything|the lot|your morning)\.$/);
});

test("does not simply read the card back", () => {
  const spoken = briefToSpeech({
    ...base,
    priorities: [
      { title: "Reply to Sarah", reason: "She asked yesterday.", source: "email" },
      { title: "Confirm the vendor call", reason: "Still unanswered.", source: "both" },
    ],
  });
  // Numbered like a document, or announced with bare section headers,
  // is the failure this module exists to avoid.
  assert.doesNotMatch(spoken, /\bFirstly\b|\bSecondly\b|\bFirst,\s|\bSecond,\s/);
  assert.doesNotMatch(spoken, /(^|\.\s)(Markets|Headlines|Schedule)\.\s/);
});

test("walks the priorities in order and names where each came from", () => {
  const spoken = briefToSpeech({
    ...base,
    priorities: [
      { title: "Reply to Sarah", reason: "She asked yesterday.", source: "email" },
      { title: "Book the flights", reason: "Prices climb after Friday.", source: "calendar" },
      { title: "Confirm the vendor call", reason: "Still unanswered.", source: "both" },
    ],
  });

  // Titles and reasons are passed through exactly — they are content,
  // not phrasing.
  for (const text of [
    "Reply to Sarah",
    "She asked yesterday.",
    "Book the flights",
    "Prices climb after Friday.",
    "Confirm the vendor call",
    "Still unanswered.",
  ]) {
    assert.ok(spoken.includes(text), `missing: ${text}`);
  }

  assert.match(spoken, /from your email/);
  assert.match(spoken, /from your calendar/);
  assert.match(spoken, /from your email and your calendar/);

  // Spoken order matches the card's order.
  assert.ok(spoken.indexOf("Reply to Sarah") < spoken.indexOf("Book the flights"));
  assert.ok(spoken.indexOf("Book the flights") < spoken.indexOf("Confirm the vendor call"));
});

test("doesn't count off a list of one", () => {
  const spoken = briefToSpeech({
    ...base,
    priorities: [
      { title: "Reply to Sarah", reason: "She asked yesterday.", source: "email" },
    ],
  });
  assert.match(spoken, /Reply to Sarah — from your email\./);
  assert.doesNotMatch(spoken, /Top of the list|First thing|And last/);
});

test("keeps a question mark instead of swallowing it into the source", () => {
  const spoken = briefToSpeech({
    ...base,
    priorities: [
      { title: "Did the vendor ever reply?", reason: "No answer since Monday.", source: "email" },
    ],
  });
  assert.match(spoken, /Did the vendor ever reply\? That's from your email\./);
});

test("speaks market quotes as words, not symbols", () => {
  const spoken = briefToSpeech({
    ...base,
    markets: {
      fetchedAt: "2026-08-21T11:00:00.000Z",
      quotes: [
        { symbol: "SPY", label: "S&P 500", price: 512.4, change: 2, changePercent: 0.41 },
        { symbol: "BTC", label: "Bitcoin", price: 61234.5, change: -900, changePercent: -1.2 },
        { symbol: "QQQ", label: "Nasdaq", price: 430, change: 0, changePercent: 0 },
      ],
    },
  });
  // Figures exactly as given; only their pronunciation is ours.
  assert.match(spoken, /S&P 500 is at 512\.40 dollars, up 0\.41 percent/);
  assert.match(spoken, /Bitcoin is at 61,235 dollars, down 1\.2 percent/);
  assert.match(spoken, /Nasdaq is at 430 dollars, flat on the day/);
  assert.doesNotMatch(spoken, /[$%]/);
  // Read in one breath rather than three stubby sentences.
  assert.match(spoken, /while/);
});

test("reads the situation paragraphs and the headlines with their source", () => {
  const spoken = briefToSpeech({
    ...base,
    situation: "Markets rose.\n\nTalks continued in Vienna.",
    newsHighlights: [
      {
        title: "Fed holds rates steady",
        source: "Reuters",
        url: "https://example.com/a",
        category: "financial",
      },
      {
        title: "Port strike enters a second week",
        source: "AP",
        url: "https://example.com/b",
        category: "us",
      },
    ],
  });
  assert.match(spoken, /Markets rose\. Talks continued in Vienna\./);
  // Titles copied exactly — a paraphrased headline is a misquote.
  assert.match(spoken, /Fed holds rates steady, from Reuters on markets/);
  assert.match(spoken, /Port strike enters a second week, from AP on U\.S\./);
  // A URL read character by character is the thing this whole module exists to avoid.
  assert.doesNotMatch(spoken, /example\.com|https/);
});

test("doesn't read the quote row and the markets paragraph both", () => {
  const markets = {
    fetchedAt: "2026-08-21T11:00:00.000Z",
    quotes: [
      { symbol: "SPY", label: "S&P 500", price: 512.4, change: 2, changePercent: 0.41 },
      { symbol: "BTC", label: "Bitcoin", price: 61234.5, change: -900, changePercent: -1.2 },
    ],
  };
  const situation =
    "The S&P 500 rose 0.41 percent after the Fed held rates steady, while Bitcoin gave up 1.2 percent.\n\nTalks in Vienna continued for a third day.";

  const withRead = briefToSpeech({ ...base, markets, situation });
  // The written read covers the same moves, so the tiles aren't spoken
  // on top of it — the figures appear once, in the paragraph.
  // "&" is spoken as "and" by speakableText — the paragraph is prose, so
  // it goes through the same cleanup a chat reply does.
  assert.match(withRead, /The S and P 500 rose 0\.41 percent/);
  assert.doesNotMatch(withRead, /is at 512\.40 dollars/);
  assert.doesNotMatch(withRead, /is at 61,235 dollars/);
  assert.equal(withRead.match(/0\.41/g).length, 1);
  assert.equal(withRead.match(/1\.2\b/g).length, 1);

  // With no paragraph to carry them, the numbers are spoken as before —
  // silence there would be a section the user asked for and can't hear.
  const withoutRead = briefToSpeech({ ...base, markets });
  assert.match(withoutRead, /S&P 500 is at 512\.40 dollars, up 0\.41 percent/);
  assert.match(withoutRead, /Bitcoin is at 61,235 dollars, down 1\.2 percent/);
});

test("says why an asked-for section is empty rather than skipping it", () => {
  const markets = briefToSpeech({ ...base, marketsUnavailable: "not_configured" });
  assert.match(markets, /Market prices aren't set up yet/);

  const fetchFailed = briefToSpeech({ ...base, marketsUnavailable: "fetch_failed" });
  assert.match(fetchFailed, /Market prices couldn't be reached/);

  const news = briefToSpeech({ ...base, newsUnavailable: "fetch_failed" });
  assert.match(news, /news feeds couldn't be reached/);
});

test("leads with a data caveat, before anything it changes", () => {
  const noCalendar = briefToSpeech({
    ...base,
    calendarUnavailable: true,
    priorities: [{ title: "Reply to Sarah", reason: "She asked yesterday.", source: "email" }],
  });
  assert.ok(noCalendar.indexOf("email only") < noCalendar.indexOf("Reply to Sarah"));

  // The card shows this one too, so the voice has to.
  const noMail = briefToSpeech({ ...base, mailUnavailable: true });
  assert.match(noMail, /calendar only/);
});

test("phrasing varies between briefs but is stable for one brief", () => {
  const once = briefToSpeech(base);
  const again = briefToSpeech(base);
  assert.equal(once, again);

  // Different mornings shouldn't sound like the same recording. Sampled
  // across a spread of greetings so the check doesn't hinge on one hash.
  const openings = new Set(
    ["A quiet one.", "Three things today.", "Busy morning.", "Nothing urgent.", "One thing."].map(
      (greeting) => briefToSpeech({ ...base, greeting }).split(" ").slice(0, 3).join(" ")
    )
  );
  assert.ok(openings.size > 1, "every brief opened identically");
});

test("survives a brief with nothing in it", () => {
  assert.equal(briefToSpeech(null), "");
  assert.equal(briefToSpeech({ greeting: "", headline: "", priorities: [], scheduleNote: "" }), "");
});
