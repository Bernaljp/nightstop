/**
 * Builds the submission page from the run files.
 *
 * Every number on the page is read out of `results/`, the same way RESULTS.md is, so
 * the page cannot quietly disagree with the evaluation it describes.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EvalSummary } from "../lib/eval/grade";
import { buildBriefData } from "../lib/brief/data";
import type { GroundTruth } from "../lib/corpus/schema";
import type { SleepPlan } from "../lib/plan/schema";

interface RunFile { arm: string; set: string; runId: string; summary: EvalSummary }

const runs: RunFile[] = readdirSync("results")
  .map((d) => join("results", d, "summary.json"))
  .filter(existsSync)
  .map((p) => JSON.parse(readFileSync(p, "utf8")));

const pick = (arm: string, set: string): EvalSummary => {
  const m = runs.filter((r) => r.arm === arm && r.set === set).sort((a, b) => a.runId.localeCompare(b.runId));
  if (!m.length) throw new Error(`no run for ${arm}/${set}`);
  return m[m.length - 1].summary;
};

const dev = {
  b1: pick("b1-chatbot", "dev"),
  b2: pick("b2-steelman", "dev"),
  abl: pick("a-model-checks", "dev"),
  ns: pick("nightstop", "dev"),
};
// The clean held-out claim is the SECOND set, generated after the re-freeze.
const ho = { b1: pick("b1-chatbot", "heldout2"), ns: pick("nightstop", "heldout2") };

/* ---- the hero ribbon, from a real month ------------------------------------ */
const truth: GroundTruth = JSON.parse(readFileSync("corpus/truth/dev/d05-halcyon.json", "utf8"));
const nsRun = runs.filter((r) => r.arm === "nightstop" && r.set === "dev").sort((a, b) => a.runId.localeCompare(b.runId)).pop()!;
const plan: SleepPlan = JSON.parse(readFileSync(join("results", nsRun.runId, "d05-halcyon", "plan.json"), "utf8"));
const brief = buildBriefData(truth.operator, truth.duties, truth.profile, plan, {
  from: truth.coveredFrom, to: truth.coveredTo,
});

const ribbon = brief.days
  .map((r) => {
    const bars = r.spans
      .map((s) => {
        const l = (s.from * 100).toFixed(2);
        const w = Math.max(0.5, (s.to - s.from) * 100).toFixed(2);
        return `<i class="${s.kind}${s.away ? " away" : ""}" style="left:${l}%;width:${w}%"></i>`;
      })
      .join("");
    return `<div class="rw"><span>${r.date.slice(8)}</span><b>${r.station}</b><div class="rt">${bars}</div></div>`;
  })
  .join("\n      ");

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const page = readFileSync("site/template.html", "utf8")
  .replace(/\{\{DEMO_URL\}\}/g, process.env.DEMO_URL ??
      "https://claude.ai/code/artifact/379e642f-93fb-456f-9226-51f0b57b2567")
  .replace(/\{\{RIBBON\}\}/g, ribbon)
  .replace(/\{\{B1_TRUST\}\}/g, `${dev.b1.trustworthy}/${dev.b1.cases}`)
  .replace(/\{\{B1_WRONG\}\}/g, `${dev.b1.silentlyWrong}/${dev.b1.cases}`)
  .replace(/\{\{B1_RECALL\}\}/g, pct(dev.b1.conflictRecall))
  .replace(/\{\{B1_FALSE\}\}/g, String(dev.b1.falseAlarmCount))
  .replace(/\{\{B1_FIELDS\}\}/g, `${(dev.b1.fieldAccuracy * 100).toFixed(1)}%`)
  .replace(/\{\{B2_TRUST\}\}/g, `${dev.b2.trustworthy}/${dev.b2.cases}`)
  .replace(/\{\{B2_WRONG\}\}/g, `${dev.b2.silentlyWrong}/${dev.b2.cases}`)
  .replace(/\{\{B2_RECALL\}\}/g, pct(dev.b2.conflictRecall))
  .replace(/\{\{B2_FALSE\}\}/g, String(dev.b2.falseAlarmCount))
  .replace(/\{\{AB_TRUST\}\}/g, `${dev.abl.trustworthy}/${dev.abl.cases}`)
  .replace(/\{\{AB_WRONG\}\}/g, `${dev.abl.silentlyWrong}/${dev.abl.cases}`)
  .replace(/\{\{AB_RECALL\}\}/g, pct(dev.abl.conflictRecall))
  .replace(/\{\{AB_FALSE\}\}/g, String(dev.abl.falseAlarmCount))
  .replace(/\{\{AB_FIELDS\}\}/g, `${(dev.abl.fieldAccuracy * 100).toFixed(1)}%`)
  .replace(/\{\{AB_COST\}\}/g, `$${(dev.abl.totalCostUsd / dev.abl.cases).toFixed(2)}`)
  .replace(/\{\{B1_COST\}\}/g, `$${(dev.b1.totalCostUsd / dev.b1.cases).toFixed(2)}`)
  .replace(/\{\{B2_COST\}\}/g, `$${(dev.b2.totalCostUsd / dev.b2.cases).toFixed(2)}`)
  .replace(/\{\{NS_TRUST\}\}/g, `${dev.ns.trustworthy}/${dev.ns.cases}`)
  .replace(/\{\{NS_WRONG\}\}/g, `${dev.ns.silentlyWrong}/${dev.ns.cases}`)
  .replace(/\{\{NS_RECALL\}\}/g, pct(dev.ns.conflictRecall))
  .replace(/\{\{NS_FALSE\}\}/g, String(dev.ns.falseAlarmCount))
  .replace(/\{\{NS_COST\}\}/g, `$${(dev.ns.totalCostUsd / dev.ns.cases).toFixed(2)}`)
  .replace(/\{\{HO_NS_TRUST\}\}/g, `${ho.ns.trustworthy}/${ho.ns.cases}`)
  .replace(/\{\{HO_NS_WRONG\}\}/g, `${ho.ns.silentlyWrong}/${ho.ns.cases}`)
  .replace(/\{\{HO_B1_TRUST\}\}/g, `${ho.b1.trustworthy}/${ho.b1.cases}`)
  .replace(/\{\{HO_B1_WRONG\}\}/g, `${ho.b1.silentlyWrong}/${ho.b1.cases}`)
  .replace(/\{\{HO_B1_FALSE\}\}/g, String(ho.b1.falseAlarmCount));

if (page.includes("{{")) {
  throw new Error(`unreplaced placeholder: ${page.match(/\{\{[A-Z_]+\}\}/)?.[0]}`);
}
writeFileSync("site/index.html", page);

// A second build for the Artifact host, which supplies its own document skeleton and
// wants the page content only. Same template, so the two cannot drift.
const artifact = page
  .slice(page.indexOf("<title>"), page.lastIndexOf("</body>"))
  .replace(/<\/head>\s*<body>/, "");
writeFileSync("site/artifact.html", artifact);

console.log(
  `site/index.html   ${(page.length / 1024).toFixed(0)} KB — full document, deploy anywhere\n` +
  `site/artifact.html ${(artifact.length / 1024).toFixed(0)} KB — page content only, for the Artifact host\n` +
  `${brief.days.length} ribbon rows from ${nsRun.runId}`,
);
