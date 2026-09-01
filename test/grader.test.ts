/**
 * The scoreboard, tested before anything is allowed to score against it.
 *
 * `npm run verify:grader` builds answers whose correct grade is known by construction and
 * asserts each lands in the right bucket — 42 assertions across eight rosters. It is the
 * substance; this wires it into the test runner so `npm test` covers it too, and adds the
 * regressions for the two grader bugs that actually shipped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gradeCase } from "../lib/eval/grade";
import { mandatoryConflicts } from "../lib/eval/conflicts";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import { emptyUsage } from "../lib/trace/usage";
import type { GroundTruth } from "../lib/corpus/schema";

const PACK = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);
const T: GroundTruth = JSON.parse(readFileSync("corpus/truth/dev/d01-aurora.json", "utf8"));

const outcome = (duties: GroundTruth["duties"]) => ({
  caseId: T.caseId,
  arm: "test",
  duties,
  plan: { caseId: T.caseId, blocks: [], conflicts: mandatoryConflicts(T.duties, T.profile, PACK) },
  usage: emptyUsage(),
  wallMs: 0,
});

test("the full grader verification passes", () => {
  // Runs the 42 constructed-answer assertions. Throws on a non-zero exit.
  const out = execFileSync("npx", ["tsx", "scripts/verify-grader.ts"], { encoding: "utf8" });
  assert.ok(out.includes("All grader expectations hold"), out.slice(-500));
});

test("the same instant written differently is not a misread", () => {
  // `08:00:00.000Z` versus `08:00:00Z` was scored as a wrong field. It reported 78%
  // accuracy on a roster read perfectly, and would have manufactured an improvement.
  const reformatted = T.duties.map((d) => ({
    ...d,
    reportUtc: d.reportUtc ? d.reportUtc.replace(".000Z", "Z") : d.reportUtc,
    endUtc: d.endUtc ? d.endUtc.replace(".000Z", "Z") : d.endUtc,
  }));
  const g = gradeCase(T, PACK, outcome(reformatted));
  assert.equal(g.fieldsCorrect, g.fieldsTotal, `${g.mismatches.length} spurious mismatches`);
  assert.equal(g.bucket, "surfaced");
});

test("a genuinely wrong time is still caught", () => {
  const broken = T.duties.map((d, i) =>
    i === 0 && d.reportUtc
      ? { ...d, reportUtc: new Date(new Date(d.reportUtc).getTime() + 30 * 60000).toISOString() }
      : d,
  );
  const g = gradeCase(T, PACK, outcome(broken));
  assert.ok(g.fieldsCorrect < g.fieldsTotal, "a half-hour error slipped through");
  assert.equal(g.bucket, "misread");
});

test("a perfect read that hides a real collision is the dangerous bucket", () => {
  const mandatory = mandatoryConflicts(T.duties, T.profile, PACK);
  assert.ok(mandatory.length > 0, "this roster should force at least one collision");
  const g = gradeCase(T, PACK, {
    ...outcome(T.duties),
    plan: { caseId: T.caseId, blocks: [], conflicts: mandatory.slice(1) },
  });
  assert.equal(g.bucket, "missed");
  assert.equal(g.trustworthy, false);
});

test("an invented collision costs trust", () => {
  const g = gradeCase(T, PACK, {
    ...outcome(T.duties),
    plan: {
      caseId: T.caseId,
      blocks: [],
      conflicts: [
        ...mandatoryConflicts(T.duties, T.profile, PACK),
        {
          ruleId: "far117-rest-10h", hardness: "hard-limit" as const, date: T.coveredTo,
          where: "invented", statement: "not real", options: ["none"],
        },
      ],
    },
  });
  assert.equal(g.bucket, "false_alarm");
  assert.equal(g.trustworthy, false);
});

test("no plan at all is unusable, not merely imperfect", () => {
  const g = gradeCase(T, PACK, { ...outcome(T.duties), plan: undefined });
  assert.equal(g.bucket, "unusable");
  assert.equal(g.trustworthy, false);
});
