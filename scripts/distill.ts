/**
 * Distil a rules document into a pack, and measure the result.
 *
 * Two things are measured, because the interesting claim has two halves:
 *
 *   the saving   how much smaller the pack is than the document it came from. This is
 *                what the planner stops carrying every month.
 *   the recall   whether the rules that matter actually survived. A pack that is 98%
 *                smaller and lost the duty limit is not a saving, it is a hole.
 *
 * Recall is measured against `lib/rules/operator-pack.ts`, the hand-written reference
 * distillation of the synthetic manual — written before the distiller existed.
 *
 *   npx tsx scripts/distill.ts docs/sources/operator-manual.md
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { distill } from "../lib/agents/distiller";
import { OPERATOR_PACK } from "../lib/rules/operator-pack";
import { UsageMeter, totalInputTokens } from "../lib/trace/usage";
import { TrajectoryWriter } from "../lib/trace/trajectory";
import type { RuleCheck } from "../lib/rules/schema";

const doc = process.argv[2] ?? "docs/sources/operator-manual.md";
const runId = `distill-${new Date().toISOString().replace(/[:.]/g, "-")}`;

/** Two checks are the same rule if they constrain the same thing to the same number. */
const checkKey = (c: RuleCheck): string =>
  JSON.stringify(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));

async function main() {
  const meter = new UsageMeter();
  const traj = new TrajectoryWriter(
    join("results", runId, "trajectory.jsonl"), runId, "distill", doc,
  );

  const t0 = Date.now();
  const { pack, skipped, sourceChars } = await distill(doc, `distilled-${runId}`, { traj, meter });
  const wall = Date.now() - t0;

  const packJson = JSON.stringify(pack, null, 2);
  // A rough but honest token proxy: the ratio is what matters, and it is measured the
  // same way on both sides.
  const approx = (chars: number) => Math.round(chars / 4);

  console.log(`\n${doc} -> ${pack.rules.length} rules\n`);
  for (const r of pack.rules) {
    console.log(`  [${r.hardness}] ${r.id}`);
    console.log(`     ${r.statement}`);
    console.log(`     ${JSON.stringify(r.check)}  ·  ${r.source.slice(0, 90)}`);
  }
  if (skipped.length) {
    console.log(`\n  could not encode:`);
    for (const s of skipped) console.log(`   - ${s.slice(0, 160)}`);
  }

  console.log(`\nSIZE`);
  console.log(`  document      ${sourceChars.toLocaleString()} chars  (~${approx(sourceChars).toLocaleString()} tokens)`);
  console.log(`  rule pack     ${packJson.length.toLocaleString()} chars  (~${approx(packJson.length).toLocaleString()} tokens)`);
  console.log(`  the planner carries ${(100 - (packJson.length / sourceChars) * 100).toFixed(1)}% less, every month`);

  // Recall, only where there is a reference to measure against.
  if (doc.includes("operator-manual")) {
    const want = new Map(OPERATOR_PACK.rules.map((r) => [checkKey(r.check), r]));
    const got = new Set(pack.rules.map((r) => checkKey(r.check)));
    const found = [...want].filter(([k]) => got.has(k));
    const missing = [...want].filter(([k]) => !got.has(k));
    console.log(`\nRECALL against the hand-written reference distillation`);
    console.log(`  ${found.length}/${want.size} rules recovered`);
    for (const [, r] of found) console.log(`    found   ${r.id} — ${r.statement.slice(0, 70)}`);
    for (const [, r] of missing) console.log(`    MISSED  ${r.id} — ${r.statement.slice(0, 70)}`);
    const extra = pack.rules.filter((r) => !want.has(checkKey(r.check)));
    for (const r of extra) console.log(`    extra   ${r.id} — ${r.statement.slice(0, 70)}`);
  }

  const u = meter.total();
  console.log(`\nCOST  ~${totalInputTokens(u).toLocaleString()} input tokens, ${(wall / 1000).toFixed(0)}s`);

  mkdirSync(join("results", runId), { recursive: true });
  writeFileSync(join("results", runId, "pack.json"), packJson + "\n");
  writeFileSync(
    join("results", runId, "distillation.json"),
    JSON.stringify(
      { doc, sourceChars, packChars: packJson.length, rules: pack.rules.length,
        skipped, usage: u, wallMs: wall }, null, 2,
    ) + "\n",
  );
  console.log(`results/${runId}/`);
}
main().catch((e) => { console.error(e); process.exit(1); });
