/**
 * REMOVED EXPERIMENT — kept in the repository as evidence, not shipped.
 *
 * When the reader flags a value as uncertain, hand it back to the model on its own and
 * ask it to work out what the document says. It targets exactly the cases that fail, it
 * is about forty lines, and it raises the primary metric.
 *
 * It is not in the pipeline because of what it does to the KIND of error. Before it, an
 * unreadable row is flagged and put in front of the crew member. After it, the row is
 * filled in confidently and the flag is gone. Most guesses are right, so the metric goes
 * up; the wrong ones are now invisible, having been turned from "I could not read this,
 * please check" into an assertion of fact.
 *
 * That is the trade this product exists to refuse. See docs/removed-experiments.md.
 *
 * Run it with `--arm nightstop-repair` to reproduce the result.
 */
import { join } from "node:path";
import type { Arm } from "../eval/run";
import { readRoster } from "./reader";
import { runAgentSdk } from "./sdk-runtime";
import { extractJson } from "./types";
import { buildPlan } from "../plan/engine";
import { READER_TOOLS } from "./tools";
import type { Duty } from "../corpus/schema";

const REPAIR_SYSTEM = `
You resolve single uncertain values on an airline roster that has already been read once.

You are given the roster, what the first pass read, and what it was unsure about. Work
out the most likely correct value and commit to it. Use to_utc for any conversion.
`.trim();

export const NIGHTSTOP_REPAIR_ARM: Arm = {
  name: "nightstop-repair",
  describes:
    "REMOVED. The full pipeline plus a repair pass that resolves flagged uncertainties " +
    "instead of surfacing them. Raises the primary metric; cut anyway.",
  usesModel: true,
  async run(ctx) {
    const read = await readRoster(
      ctx.caseDir,
      { from: ctx.truth.coveredFrom, to: ctx.truth.coveredTo },
      ctx.truth.profile.base,
      ctx,
    );

    let duties = read.duties;
    const flagged = [
      ...read.uncertainties,
      ...read.derivations
        .filter((d) => d.confidence !== "high")
        .map((d) => `${d.date} ${d.field}: worked out by ${d.method} (${d.confidence})`),
    ];

    if (flagged.length) {
      ctx.traj.revise("repair", 1, "resolving what the reader flagged rather than showing it", flagged);
      const run = await runAgentSdk({
        agent: "repair",
        system: REPAIR_SYSTEM,
        user: `
Roster: ${join(ctx.caseDir, "roster.pdf")}

The first pass was unsure about these:
${flagged.map((f) => `- ${f}`).join("\n")}

Here is what it read:
\`\`\`json
${JSON.stringify(duties, null, 2)}
\`\`\`

Resolve every uncertainty and return the COMPLETE corrected duty list, in the same shape,
as a single fenced JSON block: \`{ "duties": [...] }\`. Commit to a value for each.
`.trim(),
        tools: READER_TOOLS,
        readableFiles: [join(ctx.caseDir, "roster.pdf")],
        traj: ctx.traj,
        meter: ctx.meter,
        maxTurns: 30,
      });
      try {
        const raw = extractJson<{ duties?: Duty[] }>(run.text);
        if (raw.duties?.length) duties = raw.duties;
      } catch {
        ctx.traj.note("repair", "could not read a repaired list back; keeping the first pass");
      }
    }

    const plan = buildPlan(ctx.truth.caseId, duties, ctx.truth.profile, ctx.pack);
    // The point of the experiment: what was flagged is now resolved, so nothing is
    // carried through to the crew member. This line is the harm.
    plan.readingUncertainties = [];
    plan.derivations = [];

    ctx.traj.note("repair", "flags cleared", {
      resolved: flagged.length,
      shownToCrew: 0,
    });
    return { duties, plan };
  },
};
