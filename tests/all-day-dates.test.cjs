const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allDaySpan,
  shiftDayKey,
  toLocalDateInput,
} = require("../.test-build/lib/event-days.js");
const { allDayEnd } = require("../.test-build/lib/calendar-write.js");

// All-day events are bare dates with an exclusive end. Two bugs lived
// here: the edit form read "2026-10-22" through new Date(), which is the
// 21st anywhere west of UTC; and saving sent end == start, which Google
// reads as an empty range and which squashed multi-day events to one day.

test("a bare all-day date is read back unchanged, in any time zone", () => {
  assert.equal(toLocalDateInput("2026-10-22"), "2026-10-22");
  assert.equal(toLocalDateInput("2026-01-01"), "2026-01-01");
});

test("a timed event's date is the local day it falls on", () => {
  const local = new Date(2026, 9, 22, 23, 30); // 11:30pm on the 22nd, here
  assert.equal(toLocalDateInput(local.toISOString()), "2026-10-22");
});

test("span counts days from an exclusive end, never below one", () => {
  assert.equal(allDaySpan("2026-10-22", "2026-10-23"), 1);
  assert.equal(allDaySpan("2026-10-22", "2026-10-25"), 3);
  // Across the US DST change on Nov 1st.
  assert.equal(allDaySpan("2026-10-31", "2026-11-03"), 3);
  assert.equal(allDaySpan("2026-10-22", "2026-10-22"), 1);
  assert.equal(allDaySpan("2026-10-22", "garbage"), 1);
});

test("shifting a day key crosses month and year ends", () => {
  assert.equal(shiftDayKey("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDayKey("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDayKey("2026-10-22", 0), "2026-10-22");
});

test("Google gets the day after the last day", () => {
  assert.deepEqual(allDayEnd("2026-10-22", "2026-10-22"), { date: "2026-10-23" });
  assert.deepEqual(allDayEnd("2026-10-22", "2026-10-24"), { date: "2026-10-25" });
  assert.deepEqual(allDayEnd("2026-12-31", "2026-12-31"), { date: "2027-01-01" });
  // An end before the start is treated as a one-day event, not an error.
  assert.deepEqual(allDayEnd("2026-10-22", "2026-10-20"), { date: "2026-10-23" });
});

test("editing a three-day trip keeps it three days", () => {
  const event = { start: "2026-10-22", end: "2026-10-25" }; // Thu–Sat
  const span = allDaySpan(event.start, event.end);
  const newStart = "2026-10-29";
  const inclusiveEnd = shiftDayKey(newStart, span - 1);
  assert.equal(inclusiveEnd, "2026-10-31");
  assert.deepEqual(allDayEnd(newStart, inclusiveEnd), { date: "2026-11-01" });
});
