const test = require("node:test");
const assert = require("node:assert/strict");
const { speakableText } = require("../.test-build/lib/speech-text.js");

// Chat replies are written to be read. Handed to a speech synthesiser
// unchanged, the markdown gets read out literally — "star star Sarah star
// star", every character of a URL — which is the whole difference between
// a voice feature that sounds finished and one that doesn't.

test("drops emphasis markers but keeps the words", () => {
  assert.equal(speakableText("**Sarah** replied"), "Sarah replied.");
  assert.equal(speakableText("that was _urgent_"), "that was urgent.");
});

test("leaves stray markers and snake_case alone", () => {
  assert.equal(speakableText("the 2 * 3 case"), "the 2 * 3 case.");
  assert.equal(speakableText("field morning_time is set"), "field morning_time is set.");
});

test("turns bullets into separate sentences", () => {
  assert.equal(
    speakableText("- one thing\n- another thing"),
    "one thing. another thing."
  );
  assert.equal(speakableText("1. first\n2. second"), "first. second.");
});

test("does not double up punctuation that is already there", () => {
  assert.equal(speakableText("- Did it work?\n- Yes."), "Did it work? Yes.");
});

test("says there was a link instead of spelling one out", () => {
  assert.equal(
    speakableText("see https://mail.google.com/mail/u/0/#inbox now"),
    "see a link now."
  );
  assert.equal(speakableText("[the thread](https://example.com/x)"), "the thread.");
});

test("mentions code rather than reading it", () => {
  // The fence sat on its own lines, so it stays its own spoken sentence.
  assert.equal(
    speakableText("run\n```\nnpm test\n```\nafter"),
    "run. (code block). after."
  );
  assert.equal(speakableText("the `morning_time` column"), "the morning_time column.");
});

test("strips headings and quote markers", () => {
  assert.equal(speakableText("## Today\n> she wrote"), "Today. she wrote.");
});

test("collapses blank lines and stray whitespace", () => {
  assert.equal(speakableText("one\n\n\n   two  "), "one. two.");
});

test("handles nothing worth saying", () => {
  assert.equal(speakableText(""), "");
  assert.equal(speakableText("   \n\n "), "");
  assert.equal(speakableText(null), "");
  assert.equal(speakableText(undefined), "");
});
