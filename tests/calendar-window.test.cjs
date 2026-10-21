const test = require("node:test");
const assert = require("node:assert/strict");
const {
  zonedDayStart,
  zonedWindow,
} = require("../.test-build/lib/clock.js");
const { calendarWindow } = require("../.test-build/lib/calendar-window.js");

// The window every calendar fetch asks for. This used to be built with
// `setHours(0, 0, 0, 0)` on the server, which is midnight in the host's
// zone — and the host is UTC. The symptom was the board losing this
// morning's meetings from early evening onwards in the Americas, which
// is the exact failure lib/calendar-window.ts exists to prevent.

const at = (iso) => new Date(iso);

test("a day starts at that day's local midnight, as an absolute instant", () => {
  // 2026-08-19 00:00 in New York (EDT, UTC-4) is 04:00 UTC.
  assert.equal(
    zonedDayStart("2026-08-19", "America/New_York").toISOString(),
    "2026-08-19T04:00:00.000Z"
  );
  // Tokyo is UTC+9 year round, so local midnight is the previous 15:00Z.
  assert.equal(
    zonedDayStart("2026-08-19", "Asia/Tokyo").toISOString(),
    "2026-08-18T15:00:00.000Z"
  );
  assert.equal(
    zonedDayStart("2026-08-19", "UTC").toISOString(),
    "2026-08-19T00:00:00.000Z"
  );
});

test("standard time and daylight time get their own offsets", () => {
  // January: New York is EST, UTC-5.
  assert.equal(
    zonedDayStart("2026-01-15", "America/New_York").toISOString(),
    "2026-01-15T05:00:00.000Z"
  );
  // July: EDT, UTC-4.
  assert.equal(
    zonedDayStart("2026-07-15", "America/New_York").toISOString(),
    "2026-07-15T04:00:00.000Z"
  );
});

test("the window starts at today's midnight where the user is", () => {
  // 03:00 UTC on Oct 1 is still 11pm on Sep 30 in New York. The window
  // has to begin at Sep 30 00:00 local — this is the case that was
  // broken: the old code started it at Oct 1 00:00 UTC, which is 8pm on
  // Sep 30 local, so that morning's 9am meeting fell outside it.
  const { start, end } = zonedWindow(7, "America/New_York", at("2026-10-01T03:00:00Z"));
  assert.equal(start.toISOString(), "2026-09-30T04:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-07T04:00:00.000Z");
});

test("a morning east of UTC gets its own day, not yesterday's", () => {
  // 23:00 UTC Sep 30 is 08:00 Oct 1 in Tokyo.
  const { start } = zonedWindow(7, "Asia/Tokyo", at("2026-09-30T23:00:00Z"));
  assert.equal(start.toISOString(), "2026-09-30T15:00:00.000Z"); // Oct 1 00:00 JST
});

test("`days` counts calendar days, so DST can't shorten the far edge", () => {
  // US DST ends Nov 1 2026. Nov 1 is a 25-hour day in New York, so
  // adding 7×24h would land the end an hour before midnight.
  const { start, end } = zonedWindow(7, "America/New_York", at("2026-10-29T16:00:00Z"));
  assert.equal(start.toISOString(), "2026-10-29T04:00:00.000Z"); // EDT
  assert.equal(end.toISOString(), "2026-11-05T05:00:00.000Z");   // EST
  // Still exactly seven calendar days, despite being 169 hours apart.
  assert.equal((end - start) / 3_600_000, 169);
});

test("spring forward is the same story in the other direction", () => {
  // US DST begins Mar 8 2026.
  const { start, end } = zonedWindow(7, "America/New_York", at("2026-03-05T17:00:00Z"));
  assert.equal(start.toISOString(), "2026-03-05T05:00:00.000Z"); // EST
  assert.equal(end.toISOString(), "2026-03-12T04:00:00.000Z");   // EDT
  assert.equal((end - start) / 3_600_000, 167);
});

test("a missing or unusable zone falls back rather than throwing", () => {
  // The host answers instead. Nothing is asserted about *which* day that
  // is — the point is that a null zone is a fallback, not a crash.
  for (const zone of [null, undefined, "", "Not/AZone"]) {
    const { start, end } = calendarWindow(7, zone);
    assert.ok(!Number.isNaN(start.getTime()), `start for ${zone}`);
    assert.ok(!Number.isNaN(end.getTime()), `end for ${zone}`);
    assert.ok(end > start, `end after start for ${zone}`);
  }
});

test("a one-day window is one calendar day", () => {
  const { start, end } = zonedWindow(1, "America/New_York", at("2026-10-01T03:00:00Z"));
  assert.equal(start.toISOString(), "2026-09-30T04:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-01T04:00:00.000Z");
});

test("a malformed day key reports itself rather than silently sliding", () => {
  assert.ok(Number.isNaN(zonedDayStart("not-a-date", "UTC").getTime()));
});
