/**
 * Scoring one run of one case.
 *
 * Every case lands in exactly one bucket, and the buckets are ordered by how much harm
 * the outcome could do rather than by how far from correct it is:
 *
 *   clean        no conflicts existed, none raised. Nothing to tell them.
 *   surfaced     conflicts existed and every one was put in front of them.
 *   false_alarm  everything real was surfaced, plus something that was not. Costs
 *                trust, and a system nobody trusts gets ignored.
 *   missed       a real collision was not surfaced. They fly the month not knowing.
 *   misread      a plan was produced from a roster that was read wrong. Worse than
 *                missed: the conflicts it did surface were about a month that does
 *                not exist.
 *   unusable     nothing came out.
 *
 * The primary metric counts clean + surfaced. The co-primary counts misread + missed,
 * and it is reported at the same size, because a binary alone hides the difference
 * between "refused" and "confidently wrong".
 */
import type { Duty, GroundTruth } from "../corpus/schema";
import { DUTY_BEARING_FIELDS } from "../corpus/schema";
import type { RulePack } from "../rules/schema";
import type { SleepPlan } from "../plan/schema";
import { mandatoryConflicts, planViolations } from "./conflicts";
import { costUsd, type UsageTotals } from "../trace/usage";

export type Bucket =
  | "clean"
  | "surfaced"
  | "false_alarm"
  | "missed"
  | "misread"
  | "unusable";

/** Worst first. A case takes the worst bucket it qualifies for. */
export const BUCKET_SEVERITY: Bucket[] = [
  "unusable",
  "misread",
  "missed",
  "false_alarm",
  "surfaced",
  "clean",
];

export interface RunOutcome {
  caseId: string;
  arm: string;
  /** What the system read the roster as. Absent if it never got that far. */
  duties?: Duty[];
  plan?: SleepPlan;
  error?: string;
  usage: UsageTotals;
  wallMs: number;
  /** Minutes of human attention the run needed. Zero for the automated arms. */
  humanSeconds?: number;
}

export interface CaseGrade {
  caseId: string;
  arm: string;
  bucket: Bucket;
  /** The primary metric, per case. */
  trustworthy: boolean;
  fieldsTotal: number;
  fieldsCorrect: number;
  fieldsExact: boolean;
  mismatches: string[];
  mandatoryTotal: number;
  surfacedCount: number;
  missed: string[];
  falseAlarms: string[];
  planViolationCount: number;
  costUsd: number;
  wallMs: number;
  humanSeconds: number;
}

function sectorField(d: Duty, f: string): string {
  switch (f) {
    case "sectorCount": return String(d.sectors.length);
    case "sectorOrigins": return d.sectors.map((s) => s.origin).join(",");
    case "sectorDests": return d.sectors.map((s) => s.dest).join(",");
    case "sectorDepUtc": return d.sectors.map((s) => s.depUtc).join(",");
    case "sectorArrUtc": return d.sectors.map((s) => s.arrUtc).join(",");
    default: return "";
  }
}

function fieldValue(d: Duty, f: string): string {
  if (f.startsWith("sector")) return sectorField(d, f);
  const v = (d as unknown as Record<string, unknown>)[f];
  return v === null || v === undefined ? "" : String(v);
}

/**
 * Compare what the system read against the answer key.
 *
 * Duties are aligned by date and then by order within the date, because that is the
 * only correspondence a reader could be expected to reproduce — it has never seen our
 * identifiers. A duty the system did not find counts every field against it, and a
 * duty it invented counts as a whole duty's worth of error, so neither dropping rows
 * nor hallucinating them can improve the score.
 */
export function compareDuties(expected: Duty[], actual: Duty[]) {
  const byDate = (ds: Duty[]) => {
    const m = new Map<string, Duty[]>();
    for (const d of ds) {
      if (!m.has(d.date)) m.set(d.date, []);
      m.get(d.date)!.push(d);
    }
    return m;
  };
  const exp = byDate(expected);
  const act = byDate(actual);
  const perDuty = DUTY_BEARING_FIELDS.length;

  let total = 0;
  let correct = 0;
  const mismatches: string[] = [];

  for (const [date, eds] of exp) {
    const ads = act.get(date) ?? [];
    for (let i = 0; i < eds.length; i++) {
      const e = eds[i];
      const a = ads[i];
      total += perDuty;
      if (!a) {
        mismatches.push(`${date}[${i}] not read at all`);
        continue;
      }
      for (const f of DUTY_BEARING_FIELDS) {
        const ev = fieldValue(e, f);
        const av = fieldValue(a, f);
        if (ev === av) correct++;
        else mismatches.push(`${date}[${i}] ${f}: expected ${ev || "(empty)"}, read ${av || "(empty)"}`);
      }
    }
    if (ads.length > eds.length) {
      const extra = ads.length - eds.length;
      total += extra * perDuty;
      mismatches.push(`${date} has ${extra} duty row(s) that are not in the roster`);
    }
  }
  for (const [date, ads] of act) {
    if (!exp.has(date)) {
      total += ads.length * perDuty;
      mismatches.push(`${date} is not in the covered period at all`);
    }
  }
  return { total, correct, mismatches };
}

/** A conflict is the same conflict if it cites the same rule on the same date. */
const key = (c: { ruleId: string; date: string }) => `${c.ruleId}@${c.date}`;

export function gradeCase(
  truth: GroundTruth,
  pack: RulePack,
  outcome: RunOutcome,
): CaseGrade {
  const base = {
    caseId: truth.caseId,
    arm: outcome.arm,
    costUsd: costUsd(outcome.usage),
    wallMs: outcome.wallMs,
    humanSeconds: outcome.humanSeconds ?? 0,
  };

  const mandatory = mandatoryConflicts(truth.duties, truth.profile, pack);

  if (!outcome.plan || outcome.error) {
    return {
      ...base,
      bucket: "unusable",
      trustworthy: false,
      fieldsTotal: truth.duties.length * DUTY_BEARING_FIELDS.length,
      fieldsCorrect: 0,
      fieldsExact: false,
      mismatches: [outcome.error ?? "no plan produced"],
      mandatoryTotal: mandatory.length,
      surfacedCount: 0,
      missed: mandatory.map(key),
      falseAlarms: [],
      planViolationCount: 0,
    };
  }

  const cmp = compareDuties(truth.duties, outcome.duties ?? []);
  const fieldsExact = cmp.total > 0 && cmp.correct === cmp.total;

  const raised = new Set(outcome.plan.conflicts.map(key));
  const expected = new Set(mandatory.map(key));

  // A conflict the plan raises is legitimate if the roster forces it, or if the plan
  // it produced really does break that rule on that date.
  const violations = planViolations(outcome.plan, truth.duties, truth.profile, pack);
  const legitimate = new Set([...expected, ...violations.map(key)]);

  const missed = [...expected].filter((k) => !raised.has(k));
  const falseAlarms = [...raised].filter((k) => !legitimate.has(k));

  let bucket: Bucket;
  if (!fieldsExact) bucket = "misread";
  else if (missed.length) bucket = "missed";
  else if (falseAlarms.length) bucket = "false_alarm";
  else if (mandatory.length) bucket = "surfaced";
  else bucket = "clean";

  return {
    ...base,
    bucket,
    trustworthy: bucket === "clean" || bucket === "surfaced",
    fieldsTotal: cmp.total,
    fieldsCorrect: cmp.correct,
    fieldsExact,
    mismatches: cmp.mismatches,
    mandatoryTotal: mandatory.length,
    surfacedCount: expected.size - missed.length,
    missed,
    falseAlarms,
    planViolationCount: violations.length,
  };
}

export interface EvalSummary {
  arm: string;
  cases: number;
  trustworthy: number;
  /** The co-primary: plans delivered off a wrong roster, or hiding a real collision. */
  silentlyWrong: number;
  buckets: Record<Bucket, number>;
  fieldAccuracy: number;
  conflictRecall: number;
  falseAlarmCount: number;
  totalCostUsd: number;
  totalWallMs: number;
  totalHumanSeconds: number;
}

export function summarise(grades: CaseGrade[], arm: string): EvalSummary {
  const buckets = Object.fromEntries(
    BUCKET_SEVERITY.map((b) => [b, 0]),
  ) as Record<Bucket, number>;
  for (const g of grades) buckets[g.bucket]++;

  const fieldsTotal = grades.reduce((a, g) => a + g.fieldsTotal, 0);
  const fieldsCorrect = grades.reduce((a, g) => a + g.fieldsCorrect, 0);
  const mandatoryTotal = grades.reduce((a, g) => a + g.mandatoryTotal, 0);
  const surfaced = grades.reduce((a, g) => a + g.surfacedCount, 0);

  return {
    arm,
    cases: grades.length,
    trustworthy: grades.filter((g) => g.trustworthy).length,
    silentlyWrong: buckets.misread + buckets.missed,
    buckets,
    fieldAccuracy: fieldsTotal ? fieldsCorrect / fieldsTotal : 0,
    conflictRecall: mandatoryTotal ? surfaced / mandatoryTotal : 1,
    falseAlarmCount: grades.reduce((a, g) => a + g.falseAlarms.length, 0),
    totalCostUsd: grades.reduce((a, g) => a + g.costUsd, 0),
    totalWallMs: grades.reduce((a, g) => a + g.wallMs, 0),
    totalHumanSeconds: grades.reduce((a, g) => a + g.humanSeconds, 0),
  };
}
