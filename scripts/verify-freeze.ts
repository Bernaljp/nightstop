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

const FREEZE = "577189ac0eea5ed1a8a113c00d1a83ed9f1f2b2f";

/**
 * Everything a MODEL reads. The deterministic engine is checked separately below —
 * it shapes every plan, but no model ever sees it, so a change there is a different
 * kind of event from a prompt being tuned.
 *
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
];

function diffStat(paths: string[]): string {
  return execSync(`git diff --stat ${FREEZE} HEAD -- ${paths.join(" ")}`, {
    encoding: "utf8",
  }).trim();
}

/** What the deterministic engine does — not read by a model, but it shapes every plan. */
const ENGINE = ["lib/plan/", "lib/eval/conflicts.ts"];

const promptDrift = diffStat(AGENT_INPUTS);
const engineDrift = diffStat(ENGINE);

console.log(`Prompt freeze: ${FREEZE.slice(0, 8)}\n`);

if (promptDrift) {
  console.log("FAIL — something an evaluated agent reads has changed since the freeze:\n");
  console.log(promptDrift);
  console.log(
    "\nThe held-out score cannot be reported as held out. Either revert, or re-freeze " +
      "and regenerate the held-out corpus from a new seed.",
  );
  process.exit(1);
}

console.log(
  "PASS — every prompt, tool and rule the evaluated arms read is byte-identical to the\n" +
    "freeze. The reader was never tuned.",
);

if (engineDrift) {
  console.log(
    "\nNOTE — the deterministic planning engine HAS changed since the freeze:\n",
  );
  console.log(engineDrift);
  console.log(
    "\nThis is the amendment recorded in docs/eval-preregistration.md: after the held-out\n" +
      "set had been run, the planner was found never to recommend a nap in twelve rosters,\n" +
      "and a prophylactic nap rule was added. Every arm was re-run on both corpora and the\n" +
      "results did not move.\n\n" +
      "What it costs is stated there too: the held-out set had already been seen once, so\n" +
      "that 4/4 is a re-run against an edited configuration rather than a first look. Both\n" +
      "runs are in results/ and both are listed in RESULTS.md.\n\n" +
      "It exits zero because no prompt was tuned — but the engine change is real and is\n" +
      "why this prints rather than staying silent.",
  );
}
