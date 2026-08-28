/**
 * Render the crew briefing for a finished case.
 *
 *   npx tsx scripts/brief.ts results/<runId> d05-halcyon [--out out/brief.html]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { GroundTruth } from "../lib/corpus/schema";
import type { SleepPlan } from "../lib/plan/schema";
import { buildBriefData } from "../lib/brief/data";
import { renderBrief } from "../lib/brief/render";

const [runDir, caseId] = process.argv.slice(2);
if (!runDir || !caseId) {
  console.error("usage: brief.ts results/<runId> <caseId> [--out path] [--set dev]");
  process.exit(1);
}
const oi = process.argv.indexOf("--out");
const out = oi >= 0 ? process.argv[oi + 1] : join("out", `${caseId}-brief.html`);
const si = process.argv.indexOf("--set");
const set = si >= 0 ? process.argv[si + 1] : "dev";

const truth: GroundTruth = JSON.parse(
  readFileSync(join("corpus", "truth", set, `${caseId}.json`), "utf8"),
);
const plan: SleepPlan = JSON.parse(readFileSync(join(runDir, caseId, "plan.json"), "utf8"));
const dutiesPath = join(runDir, caseId, "duties.json");
// Render what the system READ, not the answer key — a briefing built from ground truth
// would hide exactly the errors this is meant to make visible.
const duties = existsSync(dutiesPath)
  ? JSON.parse(readFileSync(dutiesPath, "utf8"))
  : truth.duties;

const data = buildBriefData(
  truth.operator, duties, truth.profile, plan,
  { from: truth.coveredFrom, to: truth.coveredTo },
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, renderBrief(data));
console.log(
  `${out}\n  ${data.days.length} days · ${data.stats.nights} nights planned · ` +
  `${data.conflicts.hard.length + data.conflicts.recommended.length + data.conflicts.preference.length} to decide · ` +
  `${data.derivations.length} derived values flagged`,
);
