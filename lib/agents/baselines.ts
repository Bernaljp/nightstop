/**
 * The two baselines.
 *
 * b1-chatbot is the honest state of the art: a crew member pastes their roster into a
 * chatbot and asks when to sleep. It gets the document and their own settings, and
 * nothing else — no rule pack, no tools, no second pass. Its conflict recall is
 * expected to be near zero, and that is the finding rather than a rigged result: it
 * cannot surface a collision with an operator manual nobody showed it. That gap is the
 * argument for letting a crew member supply their own rules.
 *
 * b2-steelman removes that excuse. Same model, same effort, handed the rule pack and
 * everything else the full pipeline sees — but one shot, no tools, no review loop. The
 * distance from b2 to the final system is the orchestration's contribution, and it is
 * the number the improvement claim actually rests on.
 */
import { join } from "node:path";
import type { Arm } from "../eval/run";
import type { Duty } from "../corpus/schema";
import type { SleepPlan, SleepBlock, Conflict } from "../plan/schema";
import type { RulePack } from "../rules/schema";
import { runAgentSdk } from "./sdk-runtime";
import { extractJson } from "./types";
import { OUTPUT_CONTRACT } from "./prompts/output-contract";

interface RawAnswer {
  duties?: Duty[];
  blocks?: Omit<SleepBlock, "id" | "ruleIds">[];
  conflicts?: Omit<Conflict, "hardness" | "where">[];
}

function describePack(pack: RulePack): string {
  return pack.rules
    .map(
      (r) =>
        `- id: ${r.id}\n  ${r.statement}\n  hardness: ${r.hardness}\n  source: ${r.source}`,
    )
    .join("\n");
}

function toPlan(caseId: string, raw: RawAnswer, pack: RulePack): SleepPlan {
  const byId = new Map(pack.rules.map((r) => [r.id, r]));
  return {
    caseId,
    blocks: (raw.blocks ?? []).map((b, i) => ({
      ...b,
      id: `b${i}`,
      ruleIds: [],
    })) as SleepBlock[],
    conflicts: (raw.conflicts ?? []).map((c) => ({
      ...c,
      where: c.date,
      // A conflict citing a rule that is not in the pack is a rule it invented.
      hardness: byId.get(c.ruleId)?.hardness ?? "recommendation",
    })) as Conflict[],
  };
}

function taskFor(caseDir: string, truth: { coveredFrom: string; coveredTo: string; profile: { base: string; commuteMinutes: Record<string, number>; defaultCommuteMinutes: number } }): string {
  const p = truth.profile;
  return `
Here is my roster: ${join(caseDir, "roster.pdf")}

Read it, then plan my sleep for the whole period.

About me:
- Home base: ${p.base}
- Door-to-report commute at ${p.base}: ${p.commuteMinutes[p.base]} minutes each way
- Commute at any other station (hotel to airport): ${p.defaultCommuteMinutes} minutes each way
- The roster covers ${truth.coveredFrom} to ${truth.coveredTo}

${OUTPUT_CONTRACT}
`.trim();
}

const B1_SYSTEM = `
You are helping an airline pilot work out when to sleep during their next roster period.

You know what pilots know about fatigue: sleep before an early start is hard to get, the
body clock does not move as fast as an aircraft does, and the hours around 02:00 to 06:00
body time are when alertness is worst. Use that.

You are advisory. You do not rule on whether any duty is legal — the operator owns that.
`.trim();

export const B1_CHATBOT: Arm = {
  name: "b1-chatbot",
  describes:
    "One prompt, the roster PDF, the crew member's own settings. No rule pack, no tools, no second pass. What a pilot gets today.",
  usesModel: true,
  async run(ctx) {
    const run = await runAgentSdk({
      agent: "chatbot",
      system: B1_SYSTEM,
      user: taskFor(ctx.caseDir, ctx.truth),
      readableFiles: [join(ctx.caseDir, "roster.pdf")],
      traj: ctx.traj,
      meter: ctx.meter,
      maxTurns: 20,
    });
    try {
      const raw = extractJson<RawAnswer>(run.text);
      return { duties: raw.duties ?? [], plan: toPlan(ctx.truth.caseId, raw, ctx.pack) };
    } catch (e) {
      return { error: `could not read an answer back: ${(e as Error).message}` };
    }
  },
};

export const B2_STEELMAN: Arm = {
  name: "b2-steelman",
  describes:
    "Same model and effort as the full pipeline, handed the same rule pack and settings — but one shot, no tools, no review loop.",
  usesModel: true,
  async run(ctx) {
    const system = `${B1_SYSTEM}

These are the rules that apply to this crew member. They come from three different
places and they are not the same kind of thing:

${describePack(ctx.pack)}

A **hard-limit** must not be broken. A **recommendation** is fatigue guidance or company
policy. A **preference** is the crew member's own line, and only they can move it.

Where the roster makes a collision with one of these unavoidable, say so — cite the rule
id, name the date, and offer them something they could actually do about it. Do not
decide for them and do not refuse to plan. Always produce the schedule.`;

    const run = await runAgentSdk({
      agent: "steelman",
      system,
      user: taskFor(ctx.caseDir, ctx.truth),
      readableFiles: [join(ctx.caseDir, "roster.pdf")],
      traj: ctx.traj,
      meter: ctx.meter,
      maxTurns: 20,
    });
    try {
      const raw = extractJson<RawAnswer>(run.text);
      return { duties: raw.duties ?? [], plan: toPlan(ctx.truth.caseId, raw, ctx.pack) };
    } catch (e) {
      return { error: `could not read an answer back: ${(e as Error).message}` };
    }
  },
};
