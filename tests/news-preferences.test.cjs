const test = require("node:test");
const assert = require("node:assert/strict");
const { newsSelections } = require("../.test-build/lib/profile.js");

// "General headlines" was split into "U.S." and "World". Profiles written
// before the split still hold the old value, and newsSelections drops
// anything it doesn't recognise — so without the migration, splitting the
// option would have silently switched off news for existing users who had
// changed no setting.
const of = (news_preferences) => newsSelections({ news_preferences });

test("expands the retired option instead of dropping it", () => {
  assert.deepEqual(of(["general"]), ["us", "world"]);
});

test("mixes old and new values without duplicating", () => {
  assert.deepEqual(of(["financial", "general"]), ["financial", "us", "world"]);
  assert.deepEqual(of(["general", "us"]), ["us", "world"]);
});

test("returns a stable order regardless of how they were stored", () => {
  assert.deepEqual(of(["world", "financial"]), ["financial", "world"]);
});

test("ignores unknown values and empty lists", () => {
  assert.deepEqual(of(["bogus"]), []);
  assert.deepEqual(of([]), []);
  assert.deepEqual(of(["constructor"]), []);
});
