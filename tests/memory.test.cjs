const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeExtractedFacts,
  selectFacts,
  liveFacts,
  normalizeFact,
  factsToPromptContext,
} = require("../.test-build/lib/memory.js");

// The memory layer writes things about the user that the user never said.
// Everything here guards the same worry: a wrong fact in a prompt doesn't
// look wrong, it looks confident.

const NOW = new Date("2026-03-01T12:00:00Z");
const sources = new Map([
  ["msg-1", { kind: "email", label: "Q3 budget" }],
  ["evt-1", { kind: "calendar", label: "Board sync" }],
]);
const take = (raw, existing = []) =>
  sanitizeExtractedFacts(raw, { sources, existing, now: NOW });

const fact = (over) => ({
  fact: "Marcus is their co-founder.",
  category: "person",
  sourceId: "msg-1",
  ...over,
});

test("keeps a well-formed fact and snapshots its source", () => {
  const [kept] = take([fact()]);
  assert.equal(kept.fact, "Marcus is their co-founder.");
  assert.equal(kept.sourceKind, "email");
  assert.equal(kept.sourceLabel, "Q3 budget");
  assert.equal(kept.expiresAt, null);
});

test("drops a fact citing something the model was never shown", () => {
  // The whole point of requiring a source: a model that invented the
  // citation invented the fact.
  assert.deepEqual(take([fact({ sourceId: "msg-99" })]), []);
  assert.deepEqual(take([fact({ sourceId: "" })]), []);
  assert.deepEqual(take([fact({ sourceId: undefined })]), []);
});

test("drops a category outside the enum rather than guessing one", () => {
  assert.deepEqual(take([fact({ category: "vibes" })]), []);
  assert.deepEqual(take([fact({ category: undefined })]), []);
});

test("drops junk entries without taking the good ones with them", () => {
  const kept = take([null, "a string", fact(), fact({ fact: "short" })]);
  assert.equal(kept.length, 1);
});

test("does not re-learn something already remembered", () => {
  const existing = [normalizeFact("marcus is their CO-FOUNDER")];
  assert.deepEqual(take([fact()], existing), []);
});

test("does not learn the same thing twice in one batch", () => {
  const kept = take([fact(), fact({ fact: "Marcus is their co-founder!" })]);
  assert.equal(kept.length, 1);
});

test("caps how much can be learned in a single run", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    fact({ fact: `Fact number ${i} about this user.` })
  );
  assert.equal(take(many).length, 6);
});

test("gives an undated deadline an expiry anyway", () => {
  // Otherwise "the deck is due Friday" outlives the Friday and keeps
  // being asserted every morning after.
  const [kept] = take([fact({ category: "deadline", expiresAt: undefined })]);
  assert.ok(kept.expiresAt);
  assert.ok(new Date(kept.expiresAt).getTime() > NOW.getTime());
});

test("ignores an expiry that has already passed or is nonsense", () => {
  const [past] = take([
    fact({ category: "deadline", expiresAt: "2020-01-01T00:00:00Z" }),
  ]);
  assert.ok(new Date(past.expiresAt).getTime() > NOW.getTime());

  const [bogus] = take([fact({ expiresAt: "next Tuesday-ish" })]);
  assert.equal(bogus.expiresAt, null);
});

test("nothing is remembered for more than a year", () => {
  const [kept] = take([fact({ expiresAt: "2099-01-01T00:00:00Z" })]);
  const days = (new Date(kept.expiresAt) - NOW) / 86400000;
  assert.ok(days <= 366, `expiry was ${days} days out`);
});

test("handles a model that skipped the field entirely", () => {
  assert.deepEqual(take(undefined), []);
  assert.deepEqual(take(null), []);
  assert.deepEqual(take("no facts today"), []);
});

// --- reading back -------------------------------------------------------

const stored = (over) => ({
  id: "x",
  category: "person",
  fact: "Marcus is their co-founder.",
  sourceId: "msg-1",
  sourceLabel: null,
  sourceKind: "email",
  expiresAt: null,
  createdAt: "2026-02-01T00:00:00Z",
  ...over,
});

test("expired facts are not read back", () => {
  const facts = [
    stored({ id: "live", expiresAt: "2026-06-01T00:00:00Z" }),
    stored({ id: "dead", expiresAt: "2026-02-01T00:00:00Z" }),
    stored({ id: "forever" }),
  ];
  assert.deepEqual(
    liveFacts(facts, NOW).map((f) => f.id),
    ["live", "forever"]
  );
});

test("picks the facts the day is actually about", () => {
  const facts = [
    stored({ id: "marcus", fact: "Marcus is their co-founder." }),
    stored({ id: "landlord", fact: "Their landlord is Peterson Realty." }),
  ];
  const picked = selectFacts(facts, "Marcus sent a note about the raise", 5);
  assert.deepEqual(picked.map((f) => f.id), ["marcus"]);
});

test("preferences come along even when the words don't match", () => {
  // A scheduling question shares no vocabulary with "no meetings before
  // 10", which is exactly the case a pure keyword score gets backwards.
  const facts = [
    stored({
      id: "hours",
      category: "preference",
      fact: "They do not take meetings before 10am.",
    }),
    stored({ id: "landlord", fact: "Their landlord is Peterson Realty." }),
  ];
  const picked = selectFacts(facts, "when can I see Dana this week", 5);
  assert.deepEqual(picked.map((f) => f.id), ["hours"]);
});

test("with nothing to match on, the newest win", () => {
  const facts = [
    stored({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
    stored({ id: "new", createdAt: "2026-02-20T00:00:00Z" }),
  ];
  assert.deepEqual(
    selectFacts(facts, "", 1).map((f) => f.id),
    ["new"]
  );
});

test("stopwords don't make everything relevant", () => {
  const facts = [stored({ id: "landlord", fact: "Their landlord is Peterson Realty." })];
  assert.deepEqual(selectFacts(facts, "what is on their plate", 5), []);
});

test("an empty memory produces no prompt block at all", () => {
  assert.equal(factsToPromptContext([]), "");
  assert.match(factsToPromptContext([stored({})]), /Marcus is their co-founder/);
});
