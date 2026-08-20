const test = require("node:test");
const assert = require("node:assert/strict");
const { vipTerms, matchesVip } = require("../.test-build/lib/profile.js");

// The VIP list is the one promise triage makes that can't be left to a
// model: "never bury this person". Every case here is a way that promise
// was broken in practice, in one direction or the other.
const terms = (vips) => vipTerms({ vips });

test("protects a VIP written the way onboarding suggests", () => {
  // The interview's own help text says "my co-founder Marcus". Whole-string
  // matching never found him.
  const t = terms(["my co-founder Marcus"]);
  assert.equal(matchesVip("Marcus Lee", "marcus@acme.com", t), true);
  assert.equal(matchesVip("Founders Fund", "founders@vc.com", t), false);
});

test("finds a name inside a structured address", () => {
  const t = terms(["Sarah Chen"]);
  assert.equal(matchesVip("Sarah Chen", "sarah.chen@acme.com", t), true);
  assert.equal(matchesVip("S. Chen", "sarah.chen@acme.com", t), true);
});

test("matches a listed address exactly, never as a substring", () => {
  const t = terms(["dana@acme.com"]);
  assert.equal(matchesVip("Dana Rae", "dana@acme.com", t), true);
  // A forwarding alias that merely contains the address is not the person.
  assert.equal(matchesVip("Dana Digest", "dana@newsletter.acme.com", t), false);
});

test("handles the Name <address> form by either half", () => {
  const t = terms(["Priya Raman <priya.raman@corp.io>"]);
  assert.equal(matchesVip("Priya Raman", "priya.raman@corp.io", t), true);
  assert.equal(matchesVip("P. Raman", "praman@corp.io", t), true);
});

test("a short name does not protect every bulk sender that contains it", () => {
  // These three were all real false positives: substring matching on the
  // raw address meant the noisiest senders got permanently exempted.
  const t = terms(["Ann", "Sam", "Lee"]);
  assert.equal(matchesVip("Stripe", "announcements@stripe.com", t), false);
  assert.equal(matchesVip("Samsung", "news@samsung.com", t), false);
  assert.equal(matchesVip("Fleet Ops", "fleet@cars.com", t), false);
  assert.equal(matchesVip("Ann Peterson", "ann@corp.com", t), true);
});

test("one person at a company does not protect the whole domain", () => {
  const t = terms(["Chen"]);
  assert.equal(matchesVip("Billing", "billing@chen-industries.com", t), false);
});

test("an empty list protects nobody, and initials are ignored", () => {
  assert.equal(matchesVip("Anyone", "a@b.com", terms([])), false);
  assert.equal(terms(["a"]).names.length, 0);
});
