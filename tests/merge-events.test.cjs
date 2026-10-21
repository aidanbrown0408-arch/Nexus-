const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeEvents } = require("../.test-build/lib/events.js");

// Someone with their iCloud calendars also subscribed into Google has
// two copies of every event, and Google's copy of a subscribed calendar
// is read-only. Preferring Google unconditionally handed the UI the one
// copy that couldn't be deleted.

const ev = (over) => ({
  id: "x",
  summary: "Aidan PT",
  start: "2026-08-26T17:00:00.000Z",
  end: "2026-08-26T18:00:00.000Z",
  allDay: false,
  location: null,
  attendeeCount: 0,
  hangoutLink: null,
  source: "google",
  calendarName: null,
  calendarId: "cal",
  canWrite: true,
  objectUrl: null,
  recurringEventId: null,
  uid: "shared-uid",
  attendees: [],
  ...over,
});

test("the richer Google copy still wins when both are writable", () => {
  const google = ev({ source: "google", attendeeCount: 3, hangoutLink: "meet" });
  const apple = ev({ source: "apple", objectUrl: "https://caldav/x.ics" });

  const merged = mergeEvents([[google], [apple]], 50);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "google");
  assert.equal(merged[0].attendeeCount, 3);
});

test("a writable copy displaces a read-only one", () => {
  const google = ev({ source: "google", canWrite: false, calendarName: "Life" });
  const apple = ev({
    source: "apple",
    canWrite: true,
    calendarName: "Life",
    objectUrl: "https://caldav/x.ics",
  });

  const merged = mergeEvents([[google], [apple]], 50);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "apple");
  assert.equal(merged[0].canWrite, true);
  assert.equal(merged[0].objectUrl, "https://caldav/x.ics");
});

test("swapping copies keeps the identity prep checklists hang off", () => {
  const google = ev({ source: "google", canWrite: false });
  const apple = ev({ source: "apple", canWrite: true });

  const keptGoogleOnly = mergeEvents([[google]], 50)[0].key;
  const merged = mergeEvents([[google], [apple]], 50);
  assert.equal(merged[0].key, keptGoogleOnly);
});

test("a read-only copy never displaces a writable one", () => {
  const apple = ev({ source: "apple", canWrite: true });
  const google = ev({ source: "google", canWrite: false });

  const merged = mergeEvents([[apple], [google]], 50);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "apple");
});

test("genuinely different events are not collapsed", () => {
  const a = ev({ uid: "one", summary: "PT" });
  const b = ev({ uid: "two", summary: "Dentist" });

  const merged = mergeEvents([[a, b]], 50);
  assert.equal(merged.length, 2);
});
