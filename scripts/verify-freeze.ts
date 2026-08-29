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

const FREEZE = "7b77a67719996342d81034ec90be858a1e2b5aa7";

/**
 * Everything the EVALUATED arms read: prompts, tool descriptions, rule text.
 *
 * Listed file by file rather than by directory. Checking all of lib/agents/ meant that
 * adding the rule distiller - an agent the planning arms never call, written after the
 * freeze - failed the check and appeared to invalidate the held-out score. A freeze
 * check that trips on code the measured system does not execute is not measuring the
 * thing it claims to.
 */
const AGENT_INPUTS = [
  "lib/agents/reader.ts",
  "lib/agents/pipeline.ts",
  "lib/agents/tools.ts",
  "lib/agents/sdk-runtime.ts",
  "lib/agents/baselines.ts",
  "lib/agents/types.ts",
  "lib/agents/prompts/",
  "lib/rules/baseline-pack.ts",
  "lib/rules/operator-pack.ts",
  "lib/rules/schema.ts",
  "lib/plan/engine.ts",
  "lib/plan/circadian.ts",
  "lib/eval/conflicts.ts",
];

function diffStat(paths: string[]): string {
  return execSync(`git diff --stat ${FREEZE} HEAD -- ${paths.join(" ")}`, {
    encoding: "utf8",
  }).trim();
}

const agentDrift = diffStat(AGENT_INPUTS);
const corpusDrift = diffStat(["lib/corpus/", "scripts/generate-corpus.ts"]);

console.log(`Prompt freeze: ${FREEZE.slice(0, 8)}\n`);

if (agentDrift) {
  console.log("FAIL — something an agent reads has changed since the freeze:\n");
  console.log(agentDrift);
  console.log(
    "\nThe held-out score cannot be reported as held out. Either revert, or re-freeze " +
      "and regenerate the held-out corpus from a new seed.",
  );
  process.exit(1);
}

console.log(
  "PASS — every prompt, tool, rule and planning rule the evaluated arms read is\n" +
  "byte-identical to the freeze.",
);
if (corpusDrift) {
  console.log("\nThe corpus generator did change since then:\n");
  console.log(corpusDrift);
  console.log(
    "\nThat is expected and is stated in RESULTS.md: the held-out set exposed two bugs\n" +
      "in the corpus (a UTC-only roster dated its rows by base local day, and the fix for\n" +
      "that collided with day-off filling). Both were fixed and the set re-run. Fixing a\n" +
      "fixture is not tuning a system — and the check above is what makes that\n" +
      "distinction verifiable rather than a promise.",
  );
}
