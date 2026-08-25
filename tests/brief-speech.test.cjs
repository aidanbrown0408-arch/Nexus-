const test = require("node:test");
const assert = require("node:assert/strict");
const { briefToSpeech } = require("../.test-build/lib/brief-speech.js");

// The brief on screen carries sections the user asked for in the
// onboarding interview. The version read aloud has to carry the same
// ones — a ticked box you can't hear is indistinguishable from a setting
// that didn't save.

const base = {
  greeting: "Two things need you today.",
  headline: "Sarah is waiting on the Q3 budget before your 2pm.",
  priorities: [],
  scheduleNote: "Four meetings, back to back from 1pm.",
};

test("speaks the greeting, the headline and the schedule note", () => {
  const spoken = briefToSpeech(base);
  assert.match(spoken, /^Two things need you today\. Sarah is waiting/);
  assert.match(spoken, /Four meetings, back to back from 1pm\.$/);
});

test("numbers the priorities and names where each came from", () => {
  const spoken = briefToSpeech({
    ...base,
    priorities: [
      { title: "Reply to Sarah", reason: "She asked yesterday.", source: "email" },
      { title: "Confirm the vendor call", reason: "Still unanswered.", source: "both" },
    ],
  });
  assert.match(spoken, /First, Reply to Sarah, from your email\. She asked yesterday\./);
  assert.match(
    spoken,
    /Second, Confirm the vendor call, from your email and your calendar\./
  );
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
  assert.match(spoken, /Markets\./);
  assert.match(spoken, /S&P 500 is at 512\.40 dollars, up 0\.41 percent\./);
  assert.match(spoken, /Bitcoin is at 61,235 dollars, down 1\.20 percent\./);
  assert.match(spoken, /Nasdaq is at 430\.00 dollars, flat on the day\./);
  assert.doesNotMatch(spoken, /[$%]/);
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
    ],
  });
  assert.match(spoken, /Here's what's going on\. Markets rose\. Talks continued in Vienna\./);
  assert.match(spoken, /Headlines\. Fed holds rates steady\. markets, Reuters\./);
  // A URL read character by character is the thing this whole module exists to avoid.
  assert.doesNotMatch(spoken, /example\.com|https/);
});

test("says why an asked-for section is empty rather than skipping it", () => {
  const markets = briefToSpeech({ ...base, marketsUnavailable: "not_configured" });
  assert.match(markets, /Market prices aren't set up yet/);

  const news = briefToSpeech({ ...base, newsUnavailable: "fetch_failed" });
  assert.match(news, /news feeds couldn't be reached/);
});

test("leads with the calendar caveat, before anything it changes", () => {
  const spoken = briefToSpeech({
    ...base,
    calendarUnavailable: true,
    priorities: [{ title: "Reply to Sarah", reason: "She asked yesterday.", source: "email" }],
  });
  assert.ok(spoken.indexOf("email only") < spoken.indexOf("First,"));
});

test("survives a brief with nothing in it", () => {
  assert.equal(briefToSpeech(null), "");
  assert.equal(briefToSpeech({ greeting: "", headline: "", priorities: [], scheduleNote: "" }), "");
});
