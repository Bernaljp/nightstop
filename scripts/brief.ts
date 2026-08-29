/**
 * Render the crew briefing for a finished case.
 *
 *   npx tsx scripts/brief.ts results/<runId> d05-halcyon [--out out/brief.html]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import type { GroundTruth } from "../lib/corpus/schema";
import type { SleepPlan } from "../lib/plan/schema";
import { buildBriefData } from "../lib/brief/data";
import { renderBrief } from "../lib/brief/render";
import { planToIcs } from "../lib/brief/ics";

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
const planPath = join(runDir, caseId, "plan.json");
if (!existsSync(planPath)) {
  const had = existsSync(runDir)
    ? readdirSync(runDir).filter((d) => /^[dh]\d/.test(d)).join(", ")
    : "(no such run)";
  console.error(
    `${runDir} has no ${caseId}.\n` +
      `That run covers: ${had}\n` +
      `Held-out and development runs live in separate directories — pick one that has ` +
      `the case you want.`,
  );
  process.exit(1);
}
const plan: SleepPlan = JSON.parse(readFileSync(planPath, "utf8"));
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
const icsName = basename(out).replace(/\.html$/, ".ics");
writeFileSync(out, renderBrief(data, undefined, icsName));

const ics = out.replace(/\.html$/, ".ics");
writeFileSync(ics, planToIcs(plan, duties));
const events = (planToIcs(plan, duties).match(/BEGIN:VEVENT/g) ?? []).length;

console.log(
  `${out}\n  ${data.days.length} days · ${data.stats.nights} nights planned · ` +
  `${data.conflicts.hard.length + data.conflicts.recommended.length + data.conflicts.preference.length} to decide · ` +
  `${data.derivations.length} derived values flagged\n` +
  `${ics}\n  ${events} events — import into Google Calendar, Apple Calendar or Outlook`,
);
