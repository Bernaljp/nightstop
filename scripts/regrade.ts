/**
 * Re-grade a finished run against the current ground truth and grader.
 *
 * Runs keep the duties they read alongside the plan they produced, so fixing the grader
 * or correcting the corpus does not mean paying to run the model again. It also keeps
 * the arms comparable: every number in the report comes from one grader over one
 * corpus, whenever each arm happened to run.
 *
 *   npx tsx scripts/regrade.ts results/<runId> [--set dev]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { GroundTruth } from "../lib/corpus/schema";
import { gradeCase, summarise, BUCKET_SEVERITY, type CaseGrade } from "../lib/eval/grade";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import { emptyUsage, type UsageTotals } from "../lib/trace/usage";

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: regrade.ts results/<runId> [--set dev]");
  process.exit(1);
}
const si = process.argv.indexOf("--set");
const set = si >= 0 ? process.argv[si + 1] : "dev";
const pack = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);

const prior = existsSync(join(runDir, "summary.json"))
  ? JSON.parse(readFileSync(join(runDir, "summary.json"), "utf8"))
  : null;
const arm = prior?.arm ?? basename(runDir).replace(/-\d{4}-.*$/, "");

const grades: CaseGrade[] = [];
for (const caseId of readdirSync(runDir).filter((d) => d.startsWith("d")).sort()) {
  const dir = join(runDir, caseId);
  const truthPath = join("corpus", "truth", set, `${caseId}.json`);
  if (!existsSync(truthPath)) continue;
  const truth: GroundTruth = JSON.parse(readFileSync(truthPath, "utf8"));

  const read = (f: string) =>
    existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : undefined;
  const usage: UsageTotals = read("usage.json")?.total ?? emptyUsage();
  const before = read("grade.json");

  grades.push(
    gradeCase(truth, pack, {
      caseId, arm,
      duties: read("duties.json"),
      plan: read("plan.json"),
      usage,
      wallMs: before?.wallMs ?? 0,
      humanSeconds: before?.humanSeconds ?? 0,
    }),
  );
}

const summary = summarise(grades, arm);
console.log(`\n${arm} — re-graded over ${grades.length} cases\n`);
console.log("case".padEnd(15) + "bucket".padEnd(13) + "fields".padEnd(10) + "conflicts".padEnd(12) + "false");
for (const g of grades) {
  const acc = g.fieldsTotal ? ((g.fieldsCorrect / g.fieldsTotal) * 100).toFixed(1) + "%" : "-";
  console.log(
    g.caseId.padEnd(15) + g.bucket.padEnd(13) + acc.padEnd(10) +
    `${g.surfacedCount}/${g.mandatoryTotal}`.padEnd(12) + String(g.falseAlarms.length),
  );
}
console.log(`\nPRIMARY    trustworthy      ${summary.trustworthy}/${summary.cases}`);
console.log(`CO-PRIMARY silently wrong   ${summary.silentlyWrong}/${summary.cases}`);
console.log(`buckets    ` + BUCKET_SEVERITY.map((b) => `${b}=${summary.buckets[b]}`).join("  "));
console.log(
  `secondary  field ${(summary.fieldAccuracy * 100).toFixed(1)}%  ` +
  `recall ${(summary.conflictRecall * 100).toFixed(1)}%  ` +
  `falseAlarms ${summary.falseAlarmCount}  $${summary.totalCostUsd.toFixed(2)}`,
);
if (prior) {
  writeFileSync(
    join(runDir, "summary.json"),
    JSON.stringify({ ...prior, regradedAt: new Date().toISOString(), summary, grades }, null, 2) + "\n",
  );
  console.log(`\nupdated ${runDir}/summary.json`);
}
