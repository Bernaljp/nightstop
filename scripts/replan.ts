/**
 * Rebuild the sleep blocks of a finished run, without paying to read the rosters again.
 *
 * The reader is the expensive half and the frozen half; the planner is neither. When a
 * planning defect gets fixed — and every one of them so far has been found by looking at
 * the output rather than at a metric — the runs on disk still hold the duties that were
 * read, and the engine is deterministic, so the plans can simply be built again.
 *
 * Only the BLOCKS are replaced. Conflicts, derivations and reading uncertainties stay
 * exactly as the run produced them: on the ablation arm the conflicts came from a model,
 * and quietly overwriting them with the engine's would erase the very comparison that arm
 * exists to make.
 *
 *   npx tsx scripts/replan.ts results/<runId> [--set dev]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { GroundTruth } from "../lib/corpus/schema";
import type { SleepPlan } from "../lib/plan/schema";
import { buildPlan } from "../lib/plan/engine";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";

/** Arms whose blocks come from the engine. Anywhere else the blocks are a model's work. */
const ENGINE_ARMS = new Set(["reference", "nightstop", "a-model-checks", "repair"]);

const runDir = process.argv[2];
if (!runDir) {
  console.error("usage: replan.ts results/<runId> [--set dev]");
  process.exit(1);
}
const si = process.argv.indexOf("--set");
const set = si >= 0 ? process.argv[si + 1] : "dev";
const pack = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);

const summaryPath = join(runDir, "summary.json");
const prior = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : null;
const arm: string = prior?.arm ?? basename(runDir).replace(/-\d{4}-.*$/, "");

if (!ENGINE_ARMS.has(arm)) {
  console.error(
    `refusing: "${arm}" plans with a model, so its blocks are not the engine's to rebuild.`,
  );
  process.exit(1);
}

let touched = 0;
for (const caseId of readdirSync(runDir).filter((d) => /^[dh]\d/.test(d)).sort()) {
  const dir = join(runDir, caseId);
  const planPath = join(dir, "plan.json");
  const dutiesPath = join(dir, "duties.json");
  const truthPath = join("corpus", "truth", set, `${caseId}.json`);
  if (!existsSync(planPath) || !existsSync(dutiesPath) || !existsSync(truthPath)) continue;

  const truth: GroundTruth = JSON.parse(readFileSync(truthPath, "utf8"));
  const duties = JSON.parse(readFileSync(dutiesPath, "utf8"));
  const plan: SleepPlan = JSON.parse(readFileSync(planPath, "utf8"));

  const rebuilt = buildPlan(truth.caseId, duties, truth.profile, pack);
  const before = plan.blocks.length;
  plan.blocks = rebuilt.blocks;
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
  touched++;
  console.log(
    `${caseId.padEnd(14)} blocks ${String(before).padStart(3)} → ${String(plan.blocks.length).padStart(3)}`,
  );
}

console.log(`\nreplanned ${touched} case(s) in ${runDir} (arm ${arm}, set ${set}).`);
console.log("Conflicts left untouched. Re-grade next if any number depends on them.");
