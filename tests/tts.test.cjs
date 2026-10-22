const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveOpenAIVoice,
  readBackCoverage,
  DEFAULT_OPENAI_VOICE,
  OPENAI_VOICES,
  DELIVERY,
} = require("../.test-build/lib/tts.js");
const {
  chunkForSpeech,
  FIRST_CHUNK_CHARS,
  HOSTED_CHUNK_CHARS,
} = require("../.test-build/lib/speech-text.js");

test("defaults to one of OpenAI's two best-sounding voices", () => {
  assert.ok(["cedar", "marin"].includes(DEFAULT_OPENAI_VOICE));
  assert.equal(resolveOpenAIVoice(null), DEFAULT_OPENAI_VOICE);
  assert.equal(resolveOpenAIVoice(""), DEFAULT_OPENAI_VOICE);
});

test("accepts a listed voice and rejects anything else", () => {
  assert.equal(resolveOpenAIVoice("Marin"), "marin");
  assert.equal(resolveOpenAIVoice(" ash "), "ash");
  // An unknown name would be a 400 from OpenAI and a drop to the browser voice.
  assert.equal(resolveOpenAIVoice("onyx; drop table"), DEFAULT_OPENAI_VOICE);
  assert.ok(OPENAI_VOICES.every((v) => v.id === v.id.toLowerCase()));
});

test("the delivery note asks for a person, not a narrator", () => {
  assert.doesNotMatch(DELIVERY, /no warmth|no smile/i);
  assert.match(DELIVERY, /warm/i);
  assert.match(DELIVERY, /conversation/i);
});

test("read-back coverage catches a reply instead of a reading", () => {
  const script = "Two things need you today. Sarah is waiting on the Q3 numbers.";
  assert.equal(readBackCoverage(script, script), 1);
  assert.ok(readBackCoverage(script, "two things need you today sarah is waiting on the q3 numbers") >= 0.99);
  assert.ok(readBackCoverage(script, "Sure! Here's a summary of your day.") < 0.5);
});

test("a hosted read has fewer seams than a browser read", () => {
  const brief = Array.from({ length: 50 }, (_, i) => `Sentence number ${i + 1} of the brief is here.`).join(" ");
  const hosted = chunkForSpeech(brief, FIRST_CHUNK_CHARS, HOSTED_CHUNK_CHARS);
  const local = chunkForSpeech(brief);
  assert.ok(hosted.length < local.length, `${hosted.length} vs ${local.length}`);
  assert.equal(hosted.join(" "), brief);
  assert.ok(hosted[0].length <= FIRST_CHUNK_CHARS);
});
