/**
 * Timezone arithmetic, which is the one place a wrong answer looks completely reasonable.
 *
 * Every case here is a real hour that exists (or does not) in a real IANA zone, so these
 * assertions fail if the platform's database moves under us — which is the point. The
 * planner is only as correct as this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  utcOffsetMinutes, localToUtc, localHHmm, localDate, formatDuration, addDays, dateRange,
  addMinutes, minutesBetween,
} from "../lib/tools/time";

test("offsets follow the zone, not the machine", () => {
  // Madrid: CET in January, CEST in July.
  assert.equal(utcOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Europe/Madrid"), 60);
  assert.equal(utcOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Europe/Madrid"), 120);
  // Chicago: CST then CDT.
  assert.equal(utcOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/Chicago"), -360);
  assert.equal(utcOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/Chicago"), -300);
  // Singapore has no DST at all.
  assert.equal(utcOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Asia/Singapore"), 480);
  assert.equal(utcOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Asia/Singapore"), 480);
});

test("an hour that never happens is reported, not silently moved", () => {
  // Europe/Madrid springs forward 2026-03-29 02:00 -> 03:00. 02:30 does not exist.
  const gap = localToUtc("2026-03-29T02:30", "Europe/Madrid");
  assert.equal(gap.nonexistent, true, "02:30 on the spring-forward date names no instant");
  assert.equal(gap.ambiguous, false);
});

test("an hour that happens twice is reported, and resolved to the earlier one", () => {
  // Europe/Madrid falls back 2026-10-25 03:00 -> 02:00. 02:30 happens twice.
  const dup = localToUtc("2026-10-25T02:30", "Europe/Madrid");
  assert.equal(dup.ambiguous, true, "02:30 on the fall-back date names two instants");
  assert.equal(dup.nonexistent, false);
  // The earlier of the two is CEST (+2), so 00:30Z.
  assert.equal(dup.utc.toISOString(), "2026-10-25T00:30:00.000Z");
});

test("ordinary readings round-trip", () => {
  for (const [local, tz, iso] of [
    ["2026-09-01T17:00", "Europe/Madrid", "2026-09-01T15:00:00.000Z"],
    ["2026-09-01T21:00", "America/Chicago", "2026-09-02T02:00:00.000Z"],
    ["2026-09-27T08:40", "Asia/Singapore", "2026-09-27T00:40:00.000Z"],
  ] as const) {
    const r = localToUtc(local, tz);
    assert.equal(r.ambiguous, false);
    assert.equal(r.nonexistent, false);
    assert.equal(r.utc.toISOString(), iso, `${local} ${tz}`);
    assert.equal(localHHmm(r.utc, tz), local.slice(11), "reads back as it went in");
    assert.equal(localDate(r.utc, tz), local.slice(0, 10));
  }
});

test("durations read as lengths, never as clock times", () => {
  // "0h45" was shipped for forty-five minutes and reads as a malformed time.
  assert.equal(formatDuration(45), "45m");
  assert.equal(formatDuration(59), "59m");
  assert.equal(formatDuration(60), "1h00");
  assert.equal(formatDuration(400), "6h40");
  assert.equal(formatDuration(-90), "-1h30");
  assert.equal(formatDuration(0), "0m");
});

test("date walking does not touch timezones", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01", "2026 is not a leap year");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30", "spans the European DST change");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(dateRange("2026-09-01", "2026-09-03"),
    ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.equal(dateRange("2026-09-01", "2026-09-30").length, 30);
});

test("minute arithmetic is symmetric", () => {
  const t = new Date("2026-09-01T12:00:00Z");
  assert.equal(minutesBetween(t, addMinutes(t, 137)), 137);
  assert.equal(minutesBetween(addMinutes(t, 137), t), -137);
});
