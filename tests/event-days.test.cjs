const test = require("node:test");
const assert = require("node:assert/strict");
const {
  eventDayKeys,
  bucketByDay,
  parseDayKey,
  toDayKey,
} = require("../.test-build/lib/event-days.js");

// These ran wrong for anything lasting more than a day: the grids keyed
// an event by its start alone, so a week of travel was one chip on its
// first day and blank cells for the rest of it, and a trip already in
// progress had no cell in the grid at all.

const ev = (over) => ({
  id: "x",
  summary: "e",
  start: "",
  end: "",
  allDay: false,
  location: null,
  attendeeCount: 0,
  hangoutLink: null,
  source: "google",
  calendarName: null,
  calendarId: null,
  objectUrl: null,
  recurringEventId: null,
  uid: null,
  attendees: [],
  key: "k",
  ...over,
});

// A wall-clock moment on this machine, as the ISO instant a calendar API
// would have sent for it.
//
// These used to be written with a literal Eastern offset on them, which
// quietly made the suite a New York suite: run anywhere else, midnight
// Eastern is a different calendar day than the test claims, and the two
// midnight-boundary cases below failed for a reason that had nothing to
// do with the code. Building the instant from local parts asks the real
// question instead — given a moment that is 10pm *here*, which day does
// it land on *here* — and that has the same answer everywhere.
const localIso = (y, m, d, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).toISOString();

test("a bare date is read as a local day, not UTC midnight", () => {
  // new Date("2026-08-29") is 8pm on the 28th in New York. That off-by-one
  // is what had the month header starting on Saturday.
  assert.equal(toDayKey(parseDayKey("2026-08-29")), "2026-08-29");
});

test("a one-day all-day event covers exactly its own day", () => {
  // iCalendar and Google both make the end date exclusive.
  assert.deepEqual(
    eventDayKeys(ev({ allDay: true, start: "2026-08-29", end: "2026-08-30" })),
    ["2026-08-29"]
  );
});

test("a multi-day trip covers every day of it", () => {
  // Sept 1 through Sept 4, since the 5th is the exclusive end.
  assert.deepEqual(
    eventDayKeys(ev({ allDay: true, start: "2026-09-01", end: "2026-09-05" })),
    ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]
  );
});

test("a timed appointment covers one day", () => {
  assert.deepEqual(
    eventDayKeys(
      ev({ start: localIso(2026, 8, 29, 14), end: localIso(2026, 8, 29, 15) })
    ),
    ["2026-08-29"]
  );
});

test("an event ending at midnight does not claim the next day", () => {
  assert.deepEqual(
    eventDayKeys(
      ev({ start: localIso(2026, 8, 29, 22), end: localIso(2026, 8, 30, 0) })
    ),
    ["2026-08-29"]
  );
});

test("a red-eye covers both the night it leaves and the morning it lands", () => {
  assert.deepEqual(
    eventDayKeys(
      ev({ start: localIso(2026, 8, 29, 23), end: localIso(2026, 8, 30, 6) })
    ),
    ["2026-08-29", "2026-08-30"]
  );
});

test("a missing end time still yields the day it starts on", () => {
  assert.deepEqual(eventDayKeys(ev({ start: localIso(2026, 8, 29, 9), end: "" })), [
    "2026-08-29",
  ]);
  assert.deepEqual(eventDayKeys(ev({ allDay: true, start: "2026-08-29", end: "" })), [
    "2026-08-29",
  ]);
});

test("bucketing marks the first and last day of a span", () => {
  const trip = ev({
    key: "trip",
    allDay: true,
    start: "2026-09-01",
    end: "2026-09-04",
  });
  const byDay = bucketByDay([trip]);
  assert.deepEqual(
    Array.from(byDay.keys()),
    ["2026-09-01", "2026-09-02", "2026-09-03"]
  );
  assert.deepEqual(
    Array.from(byDay.values()).map((list) => [list[0].first, list[0].last]),
    [
      [true, false],
      [false, false],
      [false, true],
    ]
  );
});
