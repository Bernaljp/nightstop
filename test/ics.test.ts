/**
 * The calendar file, which is the only artefact that leaves the project.
 *
 * RFC 5545 is unforgiving in exactly the places a generator gets lazy: long lines have to
 * be folded, commas and semicolons escaped, and every VEVENT closed. A file that opens in
 * one client and silently drops events in another is worse than no file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlan } from "../lib/plan/engine";
import { planToIcs } from "../lib/brief/ics";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import type { GroundTruth } from "../lib/corpus/schema";

const PACK = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);
const T: GroundTruth = JSON.parse(readFileSync("corpus/truth/dev/d07-cirrus.json", "utf8"));
const PLAN = buildPlan(T.caseId, T.duties, T.profile, PACK);
const ICS = planToIcs(PLAN, T.duties, { calendarName: "Nightstop test" });

test("it is a well-formed calendar", () => {
  const lines = ICS.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.filter((l) => l === "BEGIN:VEVENT").length,
    lines.filter((l) => l === "END:VEVENT").length, "unbalanced VEVENTs");
  assert.ok(ICS.trimEnd().endsWith("END:VCALENDAR"));
  assert.ok(ICS.includes("VERSION:2.0"));
});

test("every line is folded to 75 octets", () => {
  for (const line of ICS.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75,
      `line is ${Buffer.byteLength(line, "utf8")} octets: ${line.slice(0, 60)}…`);
  }
});

test("continuation lines start with a space, and nothing else does", () => {
  const lines = ICS.split("\r\n");
  for (const line of lines) {
    if (line.startsWith(" ")) continue;
    assert.ok(/^[A-Z][A-Z-]*[;:]/.test(line) || line === "",
      `line is neither a property nor a continuation: ${line.slice(0, 60)}`);
  }
});

test("a duty never blocks out the crew member's own diary", () => {
  // Duties come along for context. Marking them busy would make a pilot look unavailable
  // for their own life on days they are simply at work.
  assert.ok(ICS.includes("TRANSP:TRANSPARENT"), "duties are not marked free");
});

test("every sleep block brings its reasoning with it", () => {
  const descriptions = ICS.split("\r\n").filter((l) => l.startsWith("DESCRIPTION"));
  assert.ok(descriptions.length >= PLAN.blocks.length,
    `${descriptions.length} descriptions for ${PLAN.blocks.length} blocks`);
});

test("it survives model output with no sectors on a flight", () => {
  // This threw in production, after a plan had already rendered, and the catch around it
  // wiped a perfectly good result off the screen.
  const stripped = T.duties.map(({ sectors, ...rest }) => rest) as GroundTruth["duties"];
  assert.doesNotThrow(() => planToIcs(PLAN, stripped, { calendarName: "x" }));
});

test("it is deterministic apart from the stamp", () => {
  const strip = (s: string) => s.replace(/DTSTAMP:[0-9TZ]+/g, "DTSTAMP:X");
  assert.equal(
    strip(planToIcs(PLAN, T.duties, { calendarName: "Nightstop test" })),
    strip(ICS),
  );
});
