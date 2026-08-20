const test = require("node:test");
const assert = require("node:assert/strict");
const { morningHour, deliveryWindow } = require("../.test-build/lib/schedule.js");

// This decides who gets an unrequested email and when. The bar for
// getting it wrong is high in both directions: a missed brief is a
// disappointment, a duplicate is why people mute an assistant.
const at = (iso) => new Date(iso);
const who = (morning_time, timezone, weekend_contact = null) => ({
  morning_time,
  timezone,
  weekend_contact,
});

test("parses the time formats the settings control produces", () => {
  assert.equal(morningHour("07:00"), 7);
  assert.equal(morningHour("7:00"), 7);
  assert.equal(morningHour("07:00:00"), 7);
});

test("an unset time is never midnight", () => {
  // Number("") is 0, so a loose parse would email everyone who skipped
  // the question at 00:00.
  assert.equal(morningHour(""), null);
  assert.equal(morningHour(null), null);
  assert.equal(morningHour("7"), null);
  assert.equal(morningHour("25:00"), null);
});

test("fires in the user's own morning, not the server's", () => {
  // 14:00 UTC is 07:00 in Los Angeles.
  const user = who("07:00", "America/Los_Angeles");
  assert.ok(deliveryWindow(user, at("2026-08-19T14:00:00Z")));
  assert.equal(deliveryWindow(user, at("2026-08-19T13:00:00Z")), null);
});

test("stays open for three hours so one blip isn't a lost day", () => {
  const user = who("07:00", "America/Los_Angeles");
  assert.ok(deliveryWindow(user, at("2026-08-19T17:00:00Z")));   // +3h
  assert.equal(deliveryWindow(user, at("2026-08-19T18:00:00Z")), null); // +4h
});

test("a late morning keeps one key across midnight", () => {
  // The bug: the window wraps past midnight but the duplicate guard is
  // keyed on a date, so 22:00 sent under day D and 00:00 sent again
  // under D+1 — a second brief an hour later, every night.
  const user = who("22:00", "UTC");
  const nights = [
    "2026-08-19T22:00:00Z",
    "2026-08-19T23:00:00Z",
    "2026-08-20T00:00:00Z",
    "2026-08-20T01:00:00Z",
  ].map((iso) => deliveryWindow(user, at(iso)));

  assert.ok(nights.every(Boolean));
  for (const window of nights) assert.equal(window.day, "2026-08-19");
  assert.equal(deliveryWindow(user, at("2026-08-20T02:00:00Z")), null);
});

test("serves a 2am user on the day 2am does not exist", () => {
  // US spring-forward: local 02:00 is skipped entirely, so exact-hour
  // matching meant no brief at all that day.
  const user = who("02:00", "America/New_York");
  assert.ok(deliveryWindow(user, at("2026-03-08T07:00:00Z"))); // 03:00 EDT
});

test("weekend rules judge the morning, not the retry", () => {
  const user = who("22:00", "UTC", "never");
  // Friday night sends...
  assert.ok(deliveryWindow(user, at("2026-08-21T22:00:00Z")));
  // ...and a retry after midnight is still that Friday, not a Saturday.
  const late = deliveryWindow(user, at("2026-08-22T00:00:00Z"));
  assert.ok(late);
  assert.equal(late.day, "2026-08-21");
  // A genuine Saturday morning is still suppressed.
  assert.equal(
    deliveryWindow(who("07:00", "UTC", "never"), at("2026-08-22T07:00:00Z")),
    null
  );
});

test("no timezone means no delivery", () => {
  // Guessing means emailing a Los Angeles user at midnight on a UTC host
  // and calling it their morning.
  assert.equal(deliveryWindow(who("07:00", null), at("2026-08-19T07:00:00Z")), null);
});
