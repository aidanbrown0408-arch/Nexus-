const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GOOGLE_SCOPES,
  GMAIL_MODIFY_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_READONLY_SCOPE,
  canDraft,
} = require("../.test-build/lib/google.js");

// Every restricted Gmail scope is one more thing Google's verification has
// to approve, and a heavier security assessment. gmail.modify covers
// reading and drafting, so the list stays at these two.
const RESTRICTED = /\/auth\/gmail\./;

test("asks for exactly two restricted Gmail scopes", () => {
  const gmail = GOOGLE_SCOPES.filter((s) => RESTRICTED.test(s)).sort();
  assert.deepEqual(gmail, [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
  ]);
});

test("never asks for full mail access or a send-only scope", () => {
  assert.ok(!GOOGLE_SCOPES.includes("https://mail.google.com/"));
  assert.ok(!GOOGLE_SCOPES.some((s) => s.endsWith("/gmail.send")));
  assert.ok(!GOOGLE_SCOPES.includes(GMAIL_COMPOSE_SCOPE));
  assert.ok(!GOOGLE_SCOPES.includes(GMAIL_READONLY_SCOPE));
});

test("drafting works on new grants and on grants from before the change", () => {
  assert.equal(canDraft(GMAIL_MODIFY_SCOPE), true);
  assert.equal(canDraft(`${GMAIL_READONLY_SCOPE} ${GMAIL_COMPOSE_SCOPE}`), true);
  assert.equal(canDraft(GMAIL_READONLY_SCOPE), false);
  assert.equal(canDraft(null), false);
});
