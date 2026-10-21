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

test("says a run of bullets as one sentence, the way a person would", () => {
  assert.equal(
    speakableText("- one thing\n- another thing"),
    "one thing and another thing."
  );
  assert.equal(
    speakableText("- a\n- b\n- c"),
    "a, b and c."
  );
  assert.equal(speakableText("1. first\n2. second"), "first and second."); 
});

test("leaves long bullets as their own sentences", () => {
  // Strung together with "and" these would be one unfollowable clause.
  const long = "x".repeat(90);
  assert.equal(
    speakableText(`- ${long}\n- ${long}`),
    `${long}. ${long}.`
  );
});

test("does not double up punctuation that is already there", () => {
  assert.equal(speakableText("- Did it work?\n- Yes."), "Did it work? Yes.");
});

test("a heading leads into the line under it rather than standing alone", () => {
  assert.equal(speakableText("## Today\nthree meetings"), "Today: three meetings.");
});

test("spells out what nobody pronounces, and pauses where a dash does", () => {
  assert.equal(speakableText("Sarah & Marcus"), "Sarah and Marcus.");
  assert.equal(speakableText("late — again"), "late, again.");
  assert.equal(speakableText("at 2:00 PM"), "at 2 PM.");
  assert.equal(speakableText("at 8:20AM"), "at 8:20 AM.");
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

test("strips heading and quote markers", () => {
  assert.equal(speakableText("## Today\n> she wrote"), "Today: she wrote.");
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

// --- chunking -----------------------------------------------------------

const { chunkForSpeech, FIRST_CHUNK_CHARS, CHUNK_CHARS } =
  require("../.test-build/lib/speech-text.js");

// A hosted voice renders its whole input before returning any of it, so
// the brief is spoken in pieces: a short one first, the rest fetched
// while it plays. The property that matters is that the pieces still
// add up to what was written — a chunker that drops or reorders a
// sentence is a brief that lies, quietly.

const BRIEF =
  "Good morning. Three things need you today: Sarah is waiting on the Q3 budget " +
  "before your 2 pm. Starting with the one that matters, Send Sarah the Q3 numbers " +
  "— from your email and your calendar. She asked Monday and your review is at 2 pm. " +
  "Next, Confirm the vendor call — from your email. Still unanswered since Thursday. " +
  "On your schedule, four meetings, back to back from 1 pm. Stepping back for a " +
  "moment. Talks in Vienna continued for a third day. On the news, Fed holds rates " +
  "steady, from Reuters on markets. That's your morning.";

test("puts the words back together exactly", () => {
  const chunks = chunkForSpeech(BRIEF);
  assert.ok(chunks.length > 1, "a whole brief should not be one chunk");
  assert.equal(chunks.join(" "), BRIEF);
});

test("gets talking quickly, then takes longer pieces", () => {
  const chunks = chunkForSpeech(BRIEF);
  // The only wait the user experiences is the first piece.
  assert.ok(
    chunks[0].length <= FIRST_CHUNK_CHARS,
    `first chunk was ${chunks[0].length} chars`
  );
  for (const chunk of chunks.slice(1)) {
    assert.ok(chunk.length <= CHUNK_CHARS, `chunk was ${chunk.length} chars`);
  }
});

test("cuts at sentence ends, never mid-sentence", () => {
  for (const chunk of chunkForSpeech(BRIEF)) {
    assert.match(chunk, /[.!?]$/, `chunk did not end a sentence: ${chunk}`);
  }
});

test("leaves a short reply alone", () => {
  assert.deepEqual(chunkForSpeech("Done — I archived them."), [
    "Done — I archived them.",
  ]);
  assert.deepEqual(chunkForSpeech("   "), []);
});

test("breaks up a run-on rather than handing it over whole", () => {
  const runOn =
    "It went " + "on and on, and then further, ".repeat(40) + "and eventually stopped.";
  const chunks = chunkForSpeech(runOn);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= CHUNK_CHARS, `chunk was ${chunk.length} chars`);
  }
  // Still every word, in order, with no word split down the middle.
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), runOn.replace(/\s+/g, " "));
});
