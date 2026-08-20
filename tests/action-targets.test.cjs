const test = require("node:test");
const assert = require("node:assert/strict");
const {
  actionTarget,
  readMessageIds,
  readDraftId,
  readLabelId,
} = require("../.test-build/lib/actions.js");

// An action's `target` is a Record<string, string>, so the compiler can't
// tell `ids` from `messageIds`. That gap was real: chat's archive tool
// wrote `ids`, the undo route read `messageIds`, and every Undo button it
// offered answered 422 while reporting nothing to the user.
//
// Writers and readers now share these helpers, and this is what holds
// them together.

test("round-trips archived message ids", () => {
  const ids = ["abc", "def", "ghi"];
  assert.deepEqual(readMessageIds(actionTarget.messages(ids)), ids);
});

test("round-trips a label alongside the messages", () => {
  const target = actionTarget.messages(["a", "b"], "Label_42");
  assert.deepEqual(readMessageIds(target), ["a", "b"]);
  assert.equal(readLabelId(target), "Label_42");
});

test("round-trips a draft", () => {
  const target = actionTarget.draft("draft-1", "thread-9");
  assert.equal(readDraftId(target), "draft-1");
  assert.equal(target.threadId, "thread-9");
});

test("a target with no label reports none rather than empty string", () => {
  assert.equal(readLabelId(actionTarget.messages(["a"])), null);
  assert.equal(readDraftId({}), null);
});

test("reading a malformed target yields nothing, not junk ids", () => {
  assert.deepEqual(readMessageIds({}), []);
  assert.deepEqual(readMessageIds({ messageIds: "" }), []);
  assert.deepEqual(readMessageIds({ messageIds: " a , , b " }), ["a", "b"]);
  // The old, wrong key must not silently resolve.
  assert.deepEqual(readMessageIds({ ids: "a,b" }), []);
});
