/**
 * Render the agent trajectories the submission has to ship.
 *
 * One walk-through per agent, from its instructions to its result, showing what its
 * tools answered, what feedback changed its next step, and where a human was asked.
 * JSONL is the evidence; nobody reads newline-delimited JSON, so this is the exhibit.
 *
 *   npx tsx scripts/trajectories.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderTrajectoryMarkdown } from "../lib/trace/trajectory";

interface Pick {
  file: string;
  runId: string;
  caseId: string;
  arm: string;
  /** The agent itself. Deliverable 4 is indexed by agent, not by the arm that ran it. */
  agent: string;
  why: string;
}

/**
 * Chosen for what each one shows, not for being the best-behaved. A trajectory that
 * only shows a clean pass teaches a reader nothing about how the thing behaves when
 * the document fights back.
 */
const PICKS: Array<Omit<Pick, "file" | "runId"> & { set?: string }> = [
  {
    agent: "reader", arm: "nightstop", caseId: "d04-kestrel",
    why:
      "The reader on the roster that does not print report time. It has to be derived " +
      "from the offset table in the header, and the offset differs by haul — the one " +
      "case that failed before the reader was asked to declare its derivations.",
  },
  {
    agent: "reader", arm: "nightstop", caseId: "d07-cirrus",
    why:
      "A duty printed 23:30 → 05:25 on one dated row with nothing marking the day " +
      "change, and continuation rows carrying no date either. Watch it use to_utc " +
      "rather than doing the arithmetic itself.",
  },
  {
    agent: "reader", arm: "nightstop", caseId: "d08-nimbus",
    why:
      "A month spanning both the European and North American daylight-saving changes, " +
      "with transatlantic sectors whose offset changes mid-trip.",
  },
  {
    agent: "chatbot", arm: "b1-chatbot", caseId: "d01-aurora",
    why:
      "The baseline for comparison: one prompt, no tools, no rule pack. It reads the " +
      "roster well and then cites rules that do not exist.",
  },
  {
    agent: "steelman", arm: "b2-steelman", caseId: "d02-meridian",
    why:
      "The fairness arm, and the one that makes the case for taking the rule check away " +
      "from the model. Same model, same effort, handed the same rule pack — it finds real " +
      "collisions, and in the same breath cites limits nobody set.",
  },
  {
    agent: "rule-checker", arm: "a-model-checks", caseId: "d01-aurora",
    why:
      "The ablation's `rule-checker`. Identical to the full system except a model finds " +
      "the collisions instead of a function. It finds every real one on this roster, then " +
      "adds several that are not there — the failure a deterministic checker cannot have.",
  },
  {
    agent: "distiller", arm: "distill", caseId: ".", set: "-",
    why:
      "The `distiller`, run once per rules document rather than per roster. A 200-page " +
      "regulation becomes a compact rule pack, each rule carrying the clause it came from " +
      "so nothing in the plan is traceable to a rule nobody can look up.",
  },
  {
    agent: "repair", arm: "nightstop-repair", caseId: "d04-kestrel",
    why:
      "The removed experiment. The `revise` event is the moment a flagged uncertainty " +
      "gets resolved instead of surfaced — the behaviour this design refuses.",
  },
];

const runs = readdirSync("results").filter((d) => existsSync(join("results", d, "summary.json")));

/**
 * The distiller does not run per roster, so its run directory has no summary.json and no
 * case folders — the trajectory sits at the top of it. Deliverable 4 asks for every agent
 * used, and "it does not fit the folder shape the others use" is not a reason to omit one.
 */
const looseRun = (prefix: string): string | null => {
  const m = readdirSync("results")
    .filter((d) => d.startsWith(`${prefix}-`) && existsSync(join("results", d, "trajectory.jsonl")))
    .sort();
  return m.length ? m[m.length - 1] : null;
};
const latestFor = (arm: string, set = "dev"): string | null => {
  // Match the SET as well as the arm: the newest b1-chatbot run is a held-out one, and
  // asking it for a development case silently produced no trajectory at all.
  const matching = runs
    .filter((d) => {
      const s = JSON.parse(readFileSync(join("results", d, "summary.json"), "utf8"));
      return s.arm === arm && s.set === set;
    })
    .sort();
  return matching.length ? matching[matching.length - 1] : null;
};

mkdirSync("trajectories", { recursive: true });
const index: string[] = [
  "# Agent trajectories",
  "",
  "One walk-through per agent, rendered from the JSONL each run writes. Every event is",
  "here: what the agent was told, every turn it took, what its tools answered, and — where",
  "it happened — the feedback that sent it back and the human checkpoint that gated it.",
  "",
  "The raw JSONL sits beside each run at `results/<runId>/<case>/trajectory.jsonl`.",
  "",
  "| Agent | Where it ran | Why this one |",
  "|---|---|---|",
];

let written = 0;
for (const p of PICKS) {
  const loose = p.caseId === ".";
  const runId = loose ? looseRun(p.arm) : latestFor(p.arm, p.set ?? "dev");
  if (!runId) {
    console.log(`  skipped ${p.arm}/${p.caseId} — no run on disk`);
    continue;
  }
  const src = loose
    ? join("results", runId, "trajectory.jsonl")
    : join("results", runId, p.caseId, "trajectory.jsonl");
  if (!existsSync(src)) {
    console.log(`  skipped ${p.arm}/${p.caseId} — no trajectory in ${runId}`);
    continue;
  }
  const name = loose ? `${p.agent}.md` : `${p.agent}-${p.caseId}.md`;
  const body = renderTrajectoryMarkdown(src);
  writeFileSync(
    join("trajectories", name),
    `<!-- rendered from results/${runId}/${p.caseId}/trajectory.jsonl -->\n\n` +
      `> **Why this trajectory.** ${p.why}\n\n` +
      body,
  );
  index.push(
    `| [\`${p.agent}\`](${name}) | ` +
    `${loose ? "the rules document" : `\`${p.arm}\` on \`${p.caseId}\``} | ${p.why} |`,
  );
  written++;
  console.log(`  trajectories/${name}`);
}

writeFileSync("trajectories/README.md", index.join("\n") + "\n");
console.log(`\n${written} trajectories written`);
