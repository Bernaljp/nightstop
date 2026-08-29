/**
 * Running an arm over the corpus.
 *
 * An "arm" is one way of getting from a roster PDF to a plan. They are compared on the
 * same cases with the same grader, and the only thing that differs is what each one is
 * given and how much machinery it is allowed.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { GroundTruth } from "../corpus/schema";
import type { RulePack } from "../rules/schema";
import type { SleepPlan } from "../plan/schema";
import { gradeCase, summarise, type CaseGrade, type RunOutcome } from "./grade";
import { UsageMeter, emptyUsage } from "../trace/usage";
import { TrajectoryWriter } from "../trace/trajectory";
import { buildPlan } from "../plan/engine";
import { MODEL } from "../agents/types";

export interface ArmContext {
  runId: string;
  arm: string;
  truth: GroundTruth;
  caseDir: string;
  pack: RulePack;
  meter: UsageMeter;
  traj: TrajectoryWriter;
}

/** What every arm must provide. */
export type Arm = {
  name: string;
  /** One line for the results table, describing what this arm is given. */
  describes: string;
  /** True if it calls the model, and therefore needs a key and costs money. */
  usesModel: boolean;
  run(ctx: ArmContext): Promise<{ duties?: GroundTruth["duties"]; plan?: SleepPlan; error?: string }>;
};

/**
 * The upper bound: a perfect read of the roster, planned deterministically.
 *
 * It is not a baseline and not a submission arm. It answers a question the other
 * numbers cannot — how much of any shortfall is the reading, and how much is the
 * planning — by removing the reading from the problem entirely.
 */
export const REFERENCE_ARM: Arm = {
  name: "reference",
  describes: "Ground-truth duties, deterministic engine. Upper bound, not a baseline.",
  usesModel: false,
  async run(ctx) {
    const plan = buildPlan(ctx.truth.caseId, ctx.truth.duties, ctx.truth.profile, ctx.pack);
    ctx.traj.note("engine", "deterministic engine, no model involved", {
      blocks: plan.blocks.length,
      conflicts: plan.conflicts.length,
    });
    ctx.traj.final("engine", { blocks: plan.blocks.length, conflicts: plan.conflicts.length });
    return { duties: ctx.truth.duties, plan };
  },
};

export function listCases(set: string): string[] {
  const dir = join(process.cwd(), "corpus", set);
  if (!existsSync(dir)) return [];
  // Read the directory rather than the generated README. Parsing prose for the list of
  // things to evaluate is how a case goes missing from a run without anyone noticing.
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "case.json")))
    .map((e) => e.name)
    .sort();
}

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * A hash of everything an agent reads: prompts, tool descriptions, rule text.
 *
 * The git SHA alone is not enough to identify a configuration, because a run started
 * with uncommitted changes records the SHA of the commit BEFORE them. That happened
 * here, and it made one run look like a different configuration than the one it
 * actually was. This hash does not care about commit hygiene.
 */
function agentInputsSha(): string {
  // Listed explicitly rather than by directory. Hashing all of lib/agents/ meant adding
  // an unrelated agent - the distiller, which the planning arms never call - changed the
  // hash and made two identical runs look like different configurations. An identity
  // that moves when something irrelevant changes is not an identity.
  const files = [
    "lib/agents/reader.ts",
    "lib/agents/pipeline.ts",
    "lib/agents/tools.ts",
    "lib/agents/sdk-runtime.ts",
    "lib/agents/baselines.ts",
    "lib/agents/prompts/output-contract.ts",
    "lib/rules/baseline-pack.ts",
    "lib/rules/operator-pack.ts",
    "lib/plan/engine.ts",
    "lib/plan/circadian.ts",
    "lib/eval/conflicts.ts",
  ];
  const h = createHash("sha256");
  for (const f of files) {
    if (existsSync(f)) h.update(f).update(readFileSync(f));
  }
  return h.digest("hex");
}

/** Whether the working tree had uncommitted changes when the run started. */
function treeDirty(): boolean {
  try {
    return execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

function manifestSha(set: string): string {
  const p = join(process.cwd(), "corpus", `manifest.${set}.sha256`);
  if (!existsSync(p)) return "missing";
  return execSync(`shasum -a 256 "${p}"`, { encoding: "utf8" }).split(" ")[0];
}

export interface RunResult {
  runId: string;
  arm: string;
  set: string;
  grades: CaseGrade[];
  summary: ReturnType<typeof summarise>;
}

export async function runArm(
  arm: Arm,
  set: string,
  pack: RulePack,
  opts: { runId?: string; only?: string[]; concurrency?: number } = {},
): Promise<RunResult> {
  const runId = opts.runId ?? `${arm.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const cases = listCases(set).filter((c) => !opts.only?.length || opts.only.includes(c));
  // Cases are independent, so they run together. Serially a single arm takes the better
  // part of an hour, which is long enough that it stops being run.
  const concurrency = Math.max(1, opts.concurrency ?? (arm.usesModel ? 4 : 1));
  const byCase = new Map<string, CaseGrade>();

  const runOne = async (caseId: string) => {
    const caseDir = join(process.cwd(), "corpus", set, caseId);
    const truth: GroundTruth = JSON.parse(
      readFileSync(join(process.cwd(), "corpus", "truth", set, `${caseId}.json`), "utf8"),
    );
    const meter = new UsageMeter();
    const trajPath = join(process.cwd(), "results", runId, caseId, "trajectory.jsonl");
    const traj = new TrajectoryWriter(trajPath, runId, arm.name, caseId);

    const started = Date.now();
    let outcome: RunOutcome;
    try {
      const r = await arm.run({ runId, arm: arm.name, truth, caseDir, pack, meter, traj });
      outcome = {
        caseId, arm: arm.name,
        duties: r.duties, plan: r.plan, error: r.error,
        usage: meter.total(), wallMs: Date.now() - started,
      };
    } catch (e) {
      traj.note("runner", `threw: ${(e as Error).message}`);
      outcome = {
        caseId, arm: arm.name,
        error: (e as Error).message,
        usage: meter.total(), wallMs: Date.now() - started,
      };
    }

    const grade = gradeCase(truth, pack, outcome);
    byCase.set(caseId, grade);

    const dir = join(process.cwd(), "results", runId, caseId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "grade.json"), JSON.stringify(grade, null, 2) + "\n");
    if (outcome.plan) {
      writeFileSync(join(dir, "plan.json"), JSON.stringify(outcome.plan, null, 2) + "\n");
    }
    // Keep what the run READ as well as what it produced. A grader fix should be
    // re-applicable to a finished run without paying to run the model again.
    if (outcome.duties) {
      writeFileSync(join(dir, "duties.json"), JSON.stringify(outcome.duties, null, 2) + "\n");
    }
    writeFileSync(
      join(dir, "usage.json"),
      JSON.stringify({ byAgent: meter.byAgent(), total: meter.total() }, null, 2) + "\n",
    );
    process.stdout.write(`  ${caseId} → ${grade.bucket}\n`);
  };

  const queue = [...cases];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await runOne(next);
    }),
  );

  // Report in corpus order regardless of the order they finished in.
  const grades = cases.map((c) => byCase.get(c)!).filter(Boolean);
  const summary = summarise(grades, arm.name);
  const dir = join(process.cwd(), "results", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "summary.json"),
    JSON.stringify(
      {
        runId, arm: arm.name, set,
        describes: arm.describes,
        at: new Date().toISOString(),
        gitSha: gitSha(),
        treeDirty: treeDirty(),
        agentInputsSha256: agentInputsSha(),
        corpusManifestSha256: manifestSha(set),
        model: arm.usesModel ? MODEL : null,
        rulePack: { id: pack.id, rules: pack.rules.length },
        summary,
        grades,
      },
      null, 2,
    ) + "\n",
  );
  return { runId, arm: arm.name, set, grades, summary };
}
