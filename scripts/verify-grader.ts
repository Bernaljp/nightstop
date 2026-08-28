/**
 * Proves the scoreboard works before any agent is allowed near it.
 *
 * A grader nobody has tested is just a way of laundering an opinion into a number.
 * This constructs answers whose correct grade is known by construction — a perfect
 * one, then one perturbation at a time — and asserts each lands in the bucket it
 * should. It needs no API key, so a judge can run it from a clean clone.
 *
 *   npx tsx scripts/verify-grader.ts
 */
import { readFileSync } from "node:fs";
import { DEV_CASES } from "../lib/corpus/cases";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import { mandatoryConflicts } from "../lib/eval/conflicts";
import { gradeCase, summarise, type Bucket, type RunOutcome } from "../lib/eval/grade";
import { emptyUsage } from "../lib/trace/usage";
import type { GroundTruth } from "../lib/corpus/schema";
import type { SleepPlan } from "../lib/plan/schema";

const PACK = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);

function truthFor(caseId: string): GroundTruth {
  return JSON.parse(readFileSync(`corpus/truth/dev/${caseId}.json`, "utf8"));
}

function outcome(truth: GroundTruth, plan: SleepPlan | undefined, arm: string): RunOutcome {
  return {
    caseId: truth.caseId,
    arm,
    duties: truth.duties,
    plan,
    usage: emptyUsage(),
    wallMs: 0,
  };
}

function perfectPlan(truth: GroundTruth): SleepPlan {
  return {
    caseId: truth.caseId,
    blocks: [],
    conflicts: mandatoryConflicts(truth.duties, truth.profile, PACK),
  };
}

let failures = 0;
const check = (name: string, got: Bucket, want: Bucket) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(46)} got=${got} want=${want}`);
};

console.log("Grader verification — every expectation is known by construction.\n");

for (const spec of DEV_CASES) {
  const truth = truthFor(spec.caseId);
  const mandatory = mandatoryConflicts(truth.duties, truth.profile, PACK);
  console.log(`${spec.caseId}  (${mandatory.length} mandatory conflicts)`);

  // 1. A perfect answer.
  const perfect = gradeCase(truth, PACK, outcome(truth, perfectPlan(truth), "perfect"));
  check("perfect answer", perfect.bucket, mandatory.length ? "surfaced" : "clean");
  if (!perfect.trustworthy) { failures++; console.log("  FAIL perfect answer is not trustworthy"); }

  // 2. Drop one real conflict -> missed.
  if (mandatory.length) {
    const p = perfectPlan(truth);
    p.conflicts = p.conflicts.slice(1);
    const g = gradeCase(truth, PACK, outcome(truth, p, "dropped-conflict"));
    check("one real conflict withheld", g.bucket, "missed");
  }

  // 3. Invent a conflict -> false_alarm.
  {
    const p = perfectPlan(truth);
    p.conflicts = [
      ...p.conflicts,
      {
        ruleId: "far117-rest-10h",
        hardness: "hard-limit",
        date: truth.coveredTo,
        where: "invented",
        statement: "A collision that is not there.",
        options: ["nothing to do"],
      },
    ];
    const g = gradeCase(truth, PACK, outcome(truth, p, "invented-conflict"));
    check("a conflict that is not real", g.bucket, "false_alarm");
  }

  // 4. Misread one report time by an hour -> misread, whatever else is right.
  {
    const duties = structuredClone(truth.duties);
    const target = duties.find((d) => d.reportUtc);
    if (target) {
      target.reportUtc = new Date(new Date(target.reportUtc!).getTime() + 3600_000).toISOString();
    }
    const g = gradeCase(truth, PACK, {
      ...outcome(truth, perfectPlan(truth), "misread"),
      duties,
    });
    check("one report time an hour out", g.bucket, "misread");
  }

  // 5. Nothing produced -> unusable.
  {
    const g = gradeCase(truth, PACK, {
      caseId: truth.caseId, arm: "crashed", usage: emptyUsage(), wallMs: 0,
      error: "reader threw",
    });
    check("no plan at all", g.bucket, "unusable");
  }
}

// An instant written without milliseconds is the same instant. This is a regression
// test for a real grader bug: it marked a correct read wrong on almost every duty of
// the first baseline run, purely on ISO-8601 formatting.
{
  const truth = truthFor("d01-aurora");
  const restyled = structuredClone(truth.duties).map((d) => ({
    ...d,
    reportUtc: d.reportUtc?.replace(".000Z", "Z") ?? null,
    endUtc: d.endUtc?.replace(".000Z", "Z") ?? null,
    sectors: d.sectors.map((sec) => ({
      ...sec,
      depUtc: sec.depUtc.replace(".000Z", "Z"),
      arrUtc: sec.arrUtc.replace(".000Z", "Z"),
    })),
  }));
  const g = gradeCase(truth, PACK, {
    ...outcome(truth, perfectPlan(truth), "iso-formatting"),
    duties: restyled,
  });
  console.log("\nISO-8601 formatting must not count as a misread");
  check("same instants, no milliseconds", g.bucket, "surfaced");
  if (!g.fieldsExact) {
    failures++;
    console.log(`  FAIL field accuracy ${g.fieldsCorrect}/${g.fieldsTotal} on identical instants`);
  }
}

// The summary must aggregate the way the report claims it does.
const truth = truthFor("d05-halcyon");
const grades = [
  gradeCase(truth, PACK, outcome(truth, perfectPlan(truth), "x")),
  gradeCase(truth, PACK, { caseId: truth.caseId, arm: "x", usage: emptyUsage(), wallMs: 0, error: "boom" }),
];
const s = summarise(grades, "x");
console.log(`\nsummary aggregation: trustworthy=${s.trustworthy}/2 silentlyWrong=${s.silentlyWrong} ` +
  `fieldAccuracy=${(s.fieldAccuracy * 100).toFixed(1)}% conflictRecall=${(s.conflictRecall * 100).toFixed(1)}%`);
if (s.trustworthy !== 1) { failures++; console.log("FAIL expected exactly one trustworthy case"); }

console.log(failures === 0
  ? "\nAll grader expectations hold."
  : `\n${failures} GRADER EXPECTATIONS FAILED`);
process.exit(failures === 0 ? 0 : 1);
