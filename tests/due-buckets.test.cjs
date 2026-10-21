const test = require("node:test");
const assert = require("node:assert/strict");
const {
  dueBucket,
  effectiveDueDate,
  DUE_BUCKET_ORDER,
} = require("../.test-build/lib/event-days.js");

// The Reminders list is one flat list bucketed by date, so these
// boundaries are the whole feature. Every case below is one a user would
// notice immediately and never forgive: a deadline shown a day early, an
// overdue item filed under Later, a dateless reminder claiming to be due
// today.

// A fixed "now" so these don't drift with the wall clock: Wed 16 Sep 2026,
// mid-afternoon local.
const NOW = new Date(2026, 8, 16, 15, 0, 0);

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();

test("effectiveDueDate prefers the item's own date over its event's", () => {
  assert.equal(
    effectiveDueDate({ dueAt: "2026-09-20T12:00:00Z", eventStart: "2026-09-18T12:00:00Z" }),
    "2026-09-20T12:00:00Z"
  );
});

test("effectiveDueDate falls back to the event start", () => {
  assert.equal(
    effectiveDueDate({ dueAt: null, eventStart: "2026-09-18T12:00:00Z" }),
    "2026-09-18T12:00:00Z"
  );
});

test("effectiveDueDate is null when there is neither", () => {
  assert.equal(effectiveDueDate({ dueAt: null, eventStart: null }), null);
  assert.equal(effectiveDueDate({}), null);
});

test("no date means undated, not overdue", () => {
  // The bug worth guarding: a null read as epoch 0 would put every
  // dateless reminder at the top of the list, permanently overdue.
  assert.equal(dueBucket(null, NOW), "undated");
});

test("an unparseable date is undated rather than thrown away", () => {
  assert.equal(dueBucket("not a date", NOW), "undated");
});

test("yesterday is overdue", () => {
  assert.equal(dueBucket(at(2026, 9, 15), NOW), "overdue");
});

test("earlier the same day is still today, not overdue", () => {
  // 9am when it's 3pm. Overdue is about the day, not the hour — an item
  // for a meeting that finished an hour ago hasn't slipped a day.
  assert.equal(dueBucket(at(2026, 9, 16, 9), NOW), "today");
});

test("later today is today", () => {
  assert.equal(dueBucket(at(2026, 9, 16, 23), NOW), "today");
});

test("tomorrow is its own bucket", () => {
  assert.equal(dueBucket(at(2026, 9, 17), NOW), "tomorrow");
});

test("two days out lands in this week", () => {
  assert.equal(dueBucket(at(2026, 9, 18), NOW), "week");
});

test("the seventh day out is the last one in this week", () => {
  assert.equal(dueBucket(at(2026, 9, 22), NOW), "week");
});

test("the eighth day out is later", () => {
  // The boundary: today + 7 days, exclusive. Off by one here silently
  // moves a week's worth of work into the wrong heading.
  assert.equal(dueBucket(at(2026, 9, 23), NOW), "later");
});

test("overdue sorts above everything else", () => {
  assert.equal(DUE_BUCKET_ORDER[0], "overdue");
  assert.equal(DUE_BUCKET_ORDER[DUE_BUCKET_ORDER.length - 1], "undated");
});

test("every bucket dueBucket can return has a place in the order", () => {
  const produced = new Set([
    dueBucket(null, NOW),
    dueBucket(at(2026, 9, 15), NOW),
    dueBucket(at(2026, 9, 16), NOW),
    dueBucket(at(2026, 9, 17), NOW),
    dueBucket(at(2026, 9, 19), NOW),
    dueBucket(at(2026, 10, 30), NOW),
  ]);
  for (const bucket of produced) {
    assert.ok(
      DUE_BUCKET_ORDER.includes(bucket),
      `${bucket} is missing from DUE_BUCKET_ORDER, so it would render nowhere`
    );
  }
});
