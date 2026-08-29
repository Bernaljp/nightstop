/**
 * ABLATION — the same system, with the rule check given back to the model.
 *
 * The submission's load-bearing claim is that moving the rule check out of the model and
 * into a deterministic function is what takes invented rules to zero. Three arms cannot
 * prove that: `nightstop` changed the tools AND the checker in one step, so the gain
 * could belong to either.
 *
 * This holds everything else identical — the same reader, the same tools, the same
 * prompt, the same engine placing the sleep — and only asks the model to find the rule
 * collisions instead of computing them. Whatever separates this from `nightstop` is what
 * the deterministic checker is worth.
 */
import { join } from "node:path";
import type { Arm } from "../eval/run";
import type { Conflict, SleepPlan } from "../plan/schema";
import type { RulePack } from "../rules/schema";
import { readRoster } from "./reader";
import { runAgentSdk } from "./sdk-runtime";
import { extractJson } from "./types";
import { buildPlan } from "../plan/engine";

function describePack(pack: RulePack): string {
  return pack.rules
    .map((r) => `- id: ${r.id}\n  ${r.statement}\n  hardness: ${r.hardness}\n  check: ${JSON.stringify(r.check)}`)
    .join("\n");
}

export const ABLATION_MODEL_CHECKS: Arm = {
  name: "a-model-checks",
  describes:
    "ABLATION. Identical to nightstop — same reader, same tools, same engine placing the " +
    "sleep — except the model finds the rule collisions instead of a deterministic function.",
  usesModel: true,
  async run(ctx) {
    const read = await readRoster(
      ctx.caseDir,
      { from: ctx.truth.coveredFrom, to: ctx.truth.coveredTo },
      ctx.truth.profile.base,
      ctx,
    );

    // The engine still places sleep, so only the checking differs.
    const engine = buildPlan(ctx.truth.caseId, read.duties, ctx.truth.profile, ctx.pack);

    const run = await runAgentSdk({
      agent: "rule-checker",
      system: `
You check a crew member's roster against the rules that apply to them, and report every
collision. You are advisory: you never rule on whether a duty is legal.

Report a collision only where the ROSTER forces it — where no arrangement of sleep could
avoid it. Do not report a rule that is satisfied. Cite the rule id exactly as given; never
invent an id, and never report a rule that is not in the list.
`.trim(),
      user: `
These are the rules that apply:

${describePack(ctx.pack)}

The crew member is based at ${ctx.truth.profile.base}, with a
${ctx.truth.profile.commuteMinutes[ctx.truth.profile.base]} minute commute there and
${ctx.truth.profile.defaultCommuteMinutes} minutes at any other station. The commute comes
out of the rest period at both ends.

Here is the roster as read:

\`\`\`json
${JSON.stringify(read.duties, null, 2)}
\`\`\`

Return a single fenced JSON block and nothing after it:

\`\`\`json
{ "conflicts": [ { "ruleId": "exact id from the list above", "date": "YYYY-MM-DD",
  "statement": "what collides, in plain language", "options": ["what they could do"] } ] }
\`\`\`
`.trim(),
      traj: ctx.traj,
      meter: ctx.meter,
      maxTurns: 20,
    });

    let conflicts: Conflict[] = [];
    try {
      const raw = extractJson<{ conflicts?: Omit<Conflict, "hardness" | "where">[] }>(run.text);
      const byId = new Map(ctx.pack.rules.map((r) => [r.id, r]));
      conflicts = (raw.conflicts ?? []).map((c) => ({
        ...c,
        where: c.date,
        hardness: byId.get(c.ruleId)?.hardness ?? "recommendation",
      })) as Conflict[];
    } catch {
      ctx.traj.note("rule-checker", "could not read a conflict list back; none recorded");
    }

    const plan: SleepPlan = {
      caseId: ctx.truth.caseId,
      blocks: engine.blocks,
      conflicts,
      readingUncertainties: read.uncertainties,
      derivations: read.derivations,
    };
    ctx.traj.final("rule-checker", { conflicts: conflicts.length });
    return { duties: read.duties, plan };
  },
};
