/**
 * Bakes the recorded runs into the data the demo page replays.
 *
 * The demo shows real outputs from the runs in `results/`, not mock-ups. For each case a
 * viewer can see the roster that went in, what each version read, what each planned, and
 * which collisions each surfaced, missed or invented — checked against the same ground
 * truth the evaluation used.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { GroundTruth } from "../lib/corpus/schema";
import type { SleepPlan } from "../lib/plan/schema";
import type { CaseGrade } from "../lib/eval/grade";
import { DEV_CASES, HELDOUT_CASES } from "../lib/corpus/cases";
import { mandatoryConflicts } from "../lib/eval/conflicts";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";

const PACK = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);

const latestRun = (arm: string, set: string): string | null => {
  const m = readdirSync("results")
    .filter((d) => existsSync(join("results", d, "summary.json")))
    .filter((d) => {
      const s = JSON.parse(readFileSync(join("results", d, "summary.json"), "utf8"));
      return s.arm === arm && s.set === set;
    })
    .sort();
  return m.length ? m[m.length - 1] : null;
};

const key = (c: { ruleId: string; date: string }) => `${c.ruleId}@${c.date}`;

interface ArmView {
  bucket: string;
  fieldsCorrect: number;
  fieldsTotal: number;
  misreads: string[];
  blocks: number;
  /** Every collision it raised, marked against the truth. */
  raised: { date: string; hardness: string; statement: string; real: boolean }[];
  missed: { date: string; hardness: string; statement: string }[];
  costUsd: number;
}

function armView(runId: string | null, caseId: string, truth: GroundTruth): ArmView | null {
  if (!runId) return null;
  const dir = join("results", runId, caseId);
  if (!existsSync(join(dir, "grade.json"))) return null;
  const grade: CaseGrade = JSON.parse(readFileSync(join(dir, "grade.json"), "utf8"));
  const plan: SleepPlan | null = existsSync(join(dir, "plan.json"))
    ? JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"))
    : null;

  const mandatory = mandatoryConflicts(truth.duties, truth.profile, PACK);
  const realKeys = new Set(mandatory.map(key));
  const raisedKeys = new Set((plan?.conflicts ?? []).map(key));

  return {
    bucket: grade.bucket,
    fieldsCorrect: grade.fieldsCorrect,
    fieldsTotal: grade.fieldsTotal,
    misreads: grade.mismatches.slice(0, 6),
    blocks: plan?.blocks.length ?? 0,
    raised: (plan?.conflicts ?? []).map((c) => ({
      date: c.date,
      hardness: c.hardness,
      statement: c.statement,
      real: realKeys.has(key(c)),
    })),
    missed: mandatory
      .filter((c) => !raisedKeys.has(key(c)))
      .map((c) => ({ date: c.date, hardness: c.hardness, statement: c.statement })),
    costUsd: grade.costUsd,
  };
}

const cases = [
  ...DEV_CASES.map((c) => ({ spec: c, set: "dev" })),
  ...HELDOUT_CASES.map((c) => ({ spec: c, set: "heldout" })),
];

const baked = cases
  .map(({ spec, set }) => {
    const truthPath = join("corpus", "truth", set, `${spec.caseId}.json`);
    if (!existsSync(truthPath)) return null;
    const truth: GroundTruth = JSON.parse(readFileSync(truthPath, "utf8"));
    const rosterText = execSync(
      `pdftotext -layout "corpus/${set}/${spec.caseId}/roster.pdf" -`,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ).replace(/\f/g, "\n");

    const chatbot = armView(latestRun("b1-chatbot", set), spec.caseId, truth);
    const nightstop = armView(latestRun("nightstop", set), spec.caseId, truth);
    if (!chatbot || !nightstop) return null;

    return {
      id: spec.caseId,
      set,
      operator: spec.operator.name,
      quirks: spec.quirks,
      intent: spec.intent,
      base: truth.profile.base,
      commute: truth.profile.commuteMinutes[truth.profile.base],
      from: truth.coveredFrom,
      to: truth.coveredTo,
      rosterText,
      realConflicts: mandatoryConflicts(truth.duties, truth.profile, PACK).length,
      chatbot,
      nightstop,
    };
  })
  .filter(Boolean);

const out = { generatedAt: new Date().toISOString(), pack: PACK.rules.length, cases: baked };
writeFileSync("site/demo-data.json", JSON.stringify(out));
const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`site/demo-data.json — ${baked.length} cases, ${kb} KB`);
for (const c of baked as NonNullable<(typeof baked)[number]>[]) {
  console.log(
    `  ${c.id.padEnd(13)} ${c.set.padEnd(8)} real=${String(c.realConflicts).padStart(2)}  ` +
    `chatbot ${c.chatbot.bucket.padEnd(12)} nightstop ${c.nightstop.bucket}`,
  );
}
