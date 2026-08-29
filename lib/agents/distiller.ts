/**
 * The rule distiller.
 *
 * A flight crew operations manual is three hundred pages of uniform standards, expense
 * claims and security procedures, with about four paragraphs that bear on when someone
 * should sleep. Part 117 is a real regulation with the same shape. Putting either in
 * front of the planner every month would be absurd — and putting the whole thing in
 * context is exactly what a naive design does.
 *
 * So it is read ONCE per document and reduced to a rule pack: a handful of statements,
 * each with the paragraph it came from and how hard a constraint it is. The planner
 * never sees the source. That is the entire answer to "regulations are enormous and
 * mostly not about sleep".
 *
 * The hardness classification is the part that cannot be automated away. A regulator's
 * limit, an operator's stricter policy and a crew member's own preference are three
 * different kinds of thing, and a system that flattens them decides on the crew
 * member's behalf which one to break.
 */
import { readFileSync } from "node:fs";
import { runAgentSdk } from "./sdk-runtime";
import { extractJson, type AgentRunOptions } from "./types";
import type { Rule, RulePack, RuleCheck } from "../rules/schema";

const CHECK_VOCABULARY = `
- min_rest_between_duties   { minutes }  end of one duty to report of the next
- min_sleep_opportunity     { minutes }  sleep available after commuting both ways
- max_duty_minutes          { minutes }  report to off-duty, one duty
- min_sleep_per_24h         { minutes }  total sleep in any rolling 24 hours
- nap_ends_before_pickup    { minutes }  gap between waking and leaving
- max_nap_minutes           { minutes }  length of a pre-duty nap
- min_main_sleep_minutes    { minutes }  length of one main sleep
- no_sleep_during_duty      { }          sleep may not be scheduled inside a duty
- max_consecutive_early_starts { count, beforeLocalHour }
`.trim();

export const DISTILLER_SYSTEM = `
You reduce a long document to the rules that bear on when a crew member should sleep.

Almost none of the document is about that. Uniform standards, expense claims, security
procedures, training syllabi — skip all of it without comment. You are looking for
statements about rest periods, duty length, report times, days off, standby, and
anything that constrains when someone can sleep.

For each rule you find:

1. **Quote where it came from.** A section number and enough of the wording that someone
   can go and check you. A rule without a source is not usable — a crew member shown a
   limit needs to be able to look it up.

2. **Classify how hard it is**, which is the judgement that matters most:
   - \`hard-limit\` — the document says it must not happen. Look for "shall not", "no
     crew member may", "the maximum is".
   - \`recommendation\` — the document advises it, or it is an operator standard exceeding
     a regulatory floor. "Should", "company policy is", "not planned beyond".
   - \`preference\` — only ever used for something a crew member said about themselves.
     A document cannot produce one of these.

   When a document sets a stricter standard than a regulation, that is the operator's
   own policy: a \`recommendation\`, not a \`hard-limit\`, unless the document says it is
   mandatory.

3. **Express it as a check the system can actually evaluate**, from this closed list:

${CHECK_VOCABULARY}

A rule you cannot express as one of these is a rule that would silently do nothing, so
leave it out and say so in \`skipped\` instead. Being honest about what you could not
encode is more useful than a pack that looks complete.

Two things to be careful about:

- **Do not invent a number.** If the document sets limits by a table keyed on report time
  and sector count, you cannot collapse that into one figure — say so in \`skipped\`.
  A limit attributed to a regulator that the regulator did not set is worse than a
  missing rule.
- **Do not restate the same rule twice** in different words.
`.trim();

export interface DistillationResult {
  pack: RulePack;
  skipped: string[];
  sourceChars: number;
}

export async function distill(
  documentPath: string,
  packId: string,
  ctx: Pick<AgentRunOptions, "traj" | "meter">,
): Promise<DistillationResult> {
  const text = readFileSync(documentPath, "utf8");

  const run = await runAgentSdk({
    agent: "distiller",
    system: DISTILLER_SYSTEM,
    user: `
Reduce this document to the rules that bear on sleep.

--- BEGIN DOCUMENT (${documentPath}) ---
${text}
--- END DOCUMENT ---

Return a single fenced JSON block and nothing after it:

\`\`\`json
{
  "rules": [
    {
      "id": "short-kebab-id",
      "statement": "the rule in the words a crew member would use, one sentence",
      "source": "section number and enough wording to check it",
      "hardness": "hard-limit" | "recommendation",
      "check": { "kind": "one of the kinds listed", "minutes": 720 }
    }
  ],
  "skipped": ["rules you found but could not express as a check, and why"]
}
\`\`\`
`.trim(),
    traj: ctx.traj,
    meter: ctx.meter,
    maxTurns: 8,
  });

  const raw = extractJson<{ rules?: Rule[]; skipped?: string[] }>(run.text);
  const rules = (raw.rules ?? []).filter((r) => r.check && r.id && r.statement);

  return {
    pack: {
      id: packId,
      origin: documentPath,
      rules: rules.map((r) => ({ ...r, check: r.check as RuleCheck })),
    },
    skipped: raw.skipped ?? [],
    sourceChars: text.length,
  };
}
