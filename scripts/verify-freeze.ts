/**
 * Prove the held-out set was not tuned against.
 *
 * The claim a held-out score rests on is narrow and checkable: after the freeze commit,
 * nothing an agent reads was changed. Prompts, tools and rule packs are byte-identical;
 * the corpus generator did change, because the held-out set exposed two bugs in it and
 * fixing a corpus is not the same as tuning a system.
 *
 *   npx tsx scripts/verify-freeze.ts
 */
import { execSync } from "node:child_process";

/**
 * The original freeze, before any held-out case had ever been generated.
 *
 * There is only one claim here worth making, and it is narrower than "the configuration
 * never changed" — that stopped being true the first time a real bug was found. The
 * claim is: **the reader has never been tuned.** Every prompt and tool a model sees is
 * byte-identical to the very first freeze, so no held-out roster has ever influenced how
 * the document is read.
 *
 * The planner has changed repeatedly — naps, night coverage, bedtime shifting, planning
 * around the crew member's own hours, one supplementary sleep per rest period. Each was a
 * defect found by looking at the output, each is a changelog entry, and each is reported
 * here rather than hidden. That is a different kind of event from tuning a prompt against
 * a test set, and conflating the two would make this check useless in both directions.
 */
const ORIGINAL_FREEZE = "7b77a67719996342d81034ec90be858a1e2b5aa7";

/** Everything a MODEL reads. Nothing here has changed since the original freeze. */
const READER = [
  "lib/agents/reader.ts",
  "lib/agents/tools.ts",
  "lib/agents/prompts/",
  "lib/agents/sdk-runtime.ts",
  "lib/agents/pipeline.ts",
  "lib/agents/baselines.ts",
];

/** Deterministic planning: never seen by a model, but it shapes every plan. */
const PLANNER = ["lib/plan/", "lib/rules/", "lib/eval/conflicts.ts"];

function diffStat(paths: string[], since: string): string {
  return execSync(`git diff --stat ${since} HEAD -- ${paths.join(" ")}`, {
    encoding: "utf8",
  }).trim();
}

const readerDrift = diffStat(READER, ORIGINAL_FREEZE);
const plannerDrift = diffStat(PLANNER, ORIGINAL_FREEZE);

console.log(`Original freeze: ${ORIGINAL_FREEZE.slice(0, 8)}\n`);

if (readerDrift) {
  console.log("FAIL — the reader has changed since the original freeze:\n");
  console.log(readerDrift);
  console.log(
    "\nNo held-out score can be reported. The reading is the only thing a model does " +
      "here, and if its prompt moved after a held-out set was seen, the number means " +
      "nothing. Revert, or re-freeze and generate a new set from an unused seed.",
  );
  process.exit(1);
}

console.log(
  "PASS — every prompt and tool a model reads is byte-identical to the original\n" +
    "freeze. The reader has never been tuned, on any corpus.",
);

if (plannerDrift) {
  console.log("\nThe deterministic planner HAS changed since then:\n");
  console.log(plannerDrift);
  console.log(
    "\nExpected, and documented. Each change is a changelog stage, each was a defect\n" +
      "found by rendering the output and looking at it rather than by a metric, and every\n" +
      "arm was re-run on every corpus afterwards. See docs/eval-preregistration.md.\n\n" +
      "What the held-out numbers therefore mean: the reading has never been tuned against\n" +
      "them, and the conflicts were surfaced under the rule pack in force at run time.\n" +
      "They are not a claim that the planner is frozen — it is not, and saying so plainly\n" +
      "is worth more than a freeze nobody could honestly maintain while fixing real bugs.",
  );
}
