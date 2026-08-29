/**
 * Assembles the demo page.
 *
 * Two things a viewer can do, and both use real material rather than mock-ups:
 *
 *   Recorded   Pick any of the twelve rosters and switch between the first version and
 *              the last. The outputs are the ones from the runs in `results/`, checked
 *              against the same ground truth the evaluation used.
 *
 *   Live       Paste a roster and watch it run. The page calls Claude with the ACTUAL
 *              reader prompt from lib/agents/reader.ts, then plans it with the ACTUAL
 *              deterministic engine, bundled from lib/plan/. Same code that produced the
 *              measured numbers — not a re-implementation that could quietly differ.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { READER_SYSTEM } from "../lib/agents/reader";

// Bundle the real engine for the browser.
const entry = "demo-entry.ts";
writeFileSync(
  entry,
  `import { buildPlan } from "./lib/plan/engine";
import { mandatoryConflicts, restPeriods } from "./lib/eval/conflicts";
import { BASELINE_PACK } from "./lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "./lib/rules/operator-pack";
import { AIRPORTS } from "./lib/corpus/network";
(globalThis as Record<string, unknown>).NightstopEngine = {
  buildPlan, mandatoryConflicts, restPeriods,
  PACK: mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK),
  AIRPORTS,
};
`,
);
execSync(
  `npx esbuild ${entry} --bundle --format=iife --minify --target=es2022 --outfile=.demo-engine.js`,
  { stdio: "pipe" },
);
const engineJs = readFileSync(".demo-engine.js", "utf8");
rmSync(entry);
rmSync(".demo-engine.js");

const data = readFileSync("site/demo-data.json", "utf8");
const template = readFileSync("site/demo-template.html", "utf8");

const page = template
  .replace("/*{{ENGINE}}*/", engineJs)
  .replace('"{{DATA}}"', data)
  .replace('"{{READER_PROMPT}}"', JSON.stringify(READER_SYSTEM));

if (page.includes("{{")) throw new Error(`unreplaced: ${page.match(/\{\{[A-Z_]+\}\}/)?.[0]}`);

mkdirSync("site", { recursive: true });
writeFileSync("site/demo.html", page);
// Artifact host supplies the document skeleton.
const artifact = page
  .slice(page.indexOf("<title>"), page.lastIndexOf("</body>"))
  .replace(/<\/head>\s*<body>/, "");
writeFileSync("site/demo-artifact.html", artifact);

console.log(
  `site/demo.html          ${(page.length / 1024).toFixed(0)} KB\n` +
  `site/demo-artifact.html ${(artifact.length / 1024).toFixed(0)} KB\n` +
  `  engine bundle ${(engineJs.length / 1024).toFixed(0)} KB · data ${(data.length / 1024).toFixed(0)} KB`,
);
