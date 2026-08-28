/**
 * Run one arm over a corpus set and print the scoreboard.
 *
 *   npx tsx scripts/run-eval.ts --arm reference --set dev
 */
import { REFERENCE_ARM, runArm, type Arm } from "../lib/eval/run";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import { BUCKET_SEVERITY } from "../lib/eval/grade";

const ARMS: Record<string, Arm> = { reference: REFERENCE_ARM };

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const armName = arg("arm", "reference");
  const set = arg("set", "dev");
  const arm = ARMS[armName];
  if (!arm) {
    console.error(`unknown arm "${armName}". known: ${Object.keys(ARMS).join(", ")}`);
    process.exit(1);
  }

  const pack = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);
  const { runId, grades, summary } = await runArm(arm, set, pack);

  console.log(`\n${arm.name} — ${arm.describes}`);
  console.log(`corpus ${set}, ${grades.length} cases, run ${runId}\n`);
  console.log(
    "case".padEnd(15) + "bucket".padEnd(13) + "fields".padEnd(12) +
    "conflicts".padEnd(12) + "false".padEnd(7) + "cost",
  );
  for (const g of grades) {
    const acc = g.fieldsTotal ? ((g.fieldsCorrect / g.fieldsTotal) * 100).toFixed(0) + "%" : "-";
    console.log(
      g.caseId.padEnd(15) +
      g.bucket.padEnd(13) +
      `${acc}`.padEnd(12) +
      `${g.surfacedCount}/${g.mandatoryTotal}`.padEnd(12) +
      String(g.falseAlarms.length).padEnd(7) +
      `$${g.costUsd.toFixed(4)}`,
    );
  }
  console.log(
    `\nPRIMARY    trustworthy runs      ${summary.trustworthy}/${summary.cases}`,
  );
  console.log(
    `CO-PRIMARY silently wrong         ${summary.silentlyWrong}/${summary.cases}   (target 0)`,
  );
  console.log(`\nbuckets    ` +
    BUCKET_SEVERITY.map((b) => `${b}=${summary.buckets[b]}`).join("  "));
  console.log(
    `secondary  field accuracy ${(summary.fieldAccuracy * 100).toFixed(1)}%   ` +
    `conflict recall ${(summary.conflictRecall * 100).toFixed(1)}%   ` +
    `false alarms ${summary.falseAlarmCount}   ` +
    `cost $${summary.totalCostUsd.toFixed(4)}   ` +
    `wall ${(summary.totalWallMs / 1000).toFixed(1)}s`,
  );
  console.log(`\nresults/${runId}/summary.json`);
}
main().catch((e) => { console.error(e); process.exit(1); });
