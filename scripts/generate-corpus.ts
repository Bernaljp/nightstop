/**
 * Regenerates the evaluation corpus from a seed.
 *
 * Output must be byte-identical across runs on any machine: the corpus is hashed and
 * committed before the first agent run, and every result file records the manifest
 * hash, so a later change to the fixtures shows up in a diff rather than quietly
 * moving the numbers.
 *
 *   npx tsx scripts/generate-corpus.ts --set dev --seed 20260828
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Rng, seedFrom } from "../lib/corpus/rng";
import { generateMonth } from "../lib/corpus/months";
import { toPrintRows, computeTotals } from "../lib/corpus/rows";
import { renderRoster } from "../lib/corpus/render";
import { DEV_CASES, HELDOUT_CASES } from "../lib/corpus/cases";
import type { FormatSpec } from "../lib/corpus/format";
import type { GroundTruth, CrewProfile } from "../lib/corpus/schema";
import { tzOf } from "../lib/corpus/network";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const set = arg("set", "dev");
  const seed = Number(arg("seed", "20260828"));
  const cases: FormatSpec[] =
    set === "dev" ? DEV_CASES : set === "heldout" ? HELDOUT_CASES : [];
  if (!cases.length) {
    console.error(`no cases defined for set "${set}"`);
    process.exit(1);
  }

  const root = join(process.cwd(), "corpus", set);
  // The answer key lives OUTSIDE the case directory. An agent given a roster path will
  // list the directory it sits in - the first baseline run did exactly that - and a
  // ground truth file sitting next to the input is an accident waiting to happen.
  const truthRoot = join(process.cwd(), "corpus", "truth", set);
  for (const d of [root, truthRoot]) {
    if (existsSync(d)) rmSync(d, { recursive: true });
    mkdirSync(d, { recursive: true });
  }

  /**
   * Commute times are a crew member's own setting, not something a roster states, and
   * they vary a lot: plenty of crew live an hour and a half from their base. That
   * matters more than it looks — the commute comes out of the rest period at both
   * ends, so a long one can turn a legal 10-hour rest into a sleep window too short
   * to be worth much. Varied per case, deterministically.
   */
  function profileFor(spec: FormatSpec): CrewProfile {
    const r = new Rng(seedFrom(spec.caseId, seed ^ 0x5eed));
    const homeCommute = r.pick([40, 55, 70, 85, 95]);
    return {
      base: spec.operator.base,
      baseTz: tzOf(spec.operator.base),
      commuteMinutes: { [spec.operator.base]: homeCommute },
      defaultCommuteMinutes: r.pick([25, 30, 40]),
    };
  }

  const manifest: string[] = [];
  const summary: string[] = [];

  for (const spec of cases) {
    const rng = new Rng(seedFrom(spec.caseId, seed));
    const duties = generateMonth(
      spec.operator,
      spec.coveredFrom,
      spec.coveredTo,
      rng,
      0.35,
      spec.timeConvention === "utc" ? "utc" : "local",
    );
    const rows = toPrintRows(duties, spec);
    const totals = computeTotals(duties, spec.operator.base);
    const pdf = await renderRoster(spec, rows, totals);

    const dir = join(root, spec.caseId);
    mkdirSync(dir, { recursive: true });

    const truth: GroundTruth = {
      caseId: spec.caseId,
      operator: spec.operator.name,
      coveredFrom: spec.coveredFrom,
      coveredTo: spec.coveredTo,
      profile: profileFor(spec),
      duties,
      quirks: spec.quirks,
      intent: spec.intent,
    };

    // What a run is allowed to see: the document, and the crew member's own settings.
    const caseFile = {
      caseId: spec.caseId,
      operator: spec.operator.name,
      coveredFrom: spec.coveredFrom,
      coveredTo: spec.coveredTo,
      profile: truth.profile,
      roster: "roster.pdf",
    };

    const truthJson = JSON.stringify(truth, null, 2) + "\n";
    writeFileSync(join(dir, "roster.pdf"), pdf);
    writeFileSync(join(dir, "case.json"), JSON.stringify(caseFile, null, 2) + "\n");
    writeFileSync(join(truthRoot, `${spec.caseId}.json`), truthJson);

    for (const [file, buf] of [
      [`corpus/${set}/${spec.caseId}/roster.pdf`, pdf],
      [`corpus/truth/${set}/${spec.caseId}.json`, Buffer.from(truthJson)],
    ] as const) {
      manifest.push(`${createHash("sha256").update(buf).digest("hex")}  ${file}`);
    }

    const flying = duties.filter((d) => d.reportUtc);
    summary.push(
      `| \`${spec.caseId}\` | ${spec.operator.name} | ${duties.length} | ${flying.length} | ` +
        `${rows.length} | ${spec.quirks.join(", ")} |`,
    );
    console.log(
      `${spec.caseId.padEnd(14)} duties=${String(duties.length).padStart(2)} ` +
        `flying=${String(flying.length).padStart(2)} rows=${String(rows.length).padStart(3)} ` +
        `pdf=${String(pdf.length).padStart(6)}B  ${spec.quirks.join(", ")}`,
    );
  }

  // Paths are relative to the REPO ROOT, so `shasum -c corpus/manifest.dev.sha256`
  // works from where the reproduction guide says to run it.
  writeFileSync(join(process.cwd(), "corpus", `manifest.${set}.sha256`), manifest.join("\n") + "\n");

  const readme = `# Nightstop evaluation corpus — \`${set}\`

  Generated by \`npx tsx scripts/generate-corpus.ts --set ${set} --seed ${seed}\`.
  Regenerating with the same seed reproduces these files byte for byte; the hashes are in
  \`corpus/manifest.${set}.sha256\`.

  **Every airline, crew reference and roster in here is invented.** No real operator's
  document is reproduced and no real person's schedule appears. What *is* modelled from
  the real world is the set of presentational differences between crew-planning system
  outputs — which columns appear, whether times are local or UTC, whether report time is
  printed or derived, whether continuation rows repeat the date — because those are the
  differences a reader actually has to survive.

  | Case | Operator | Rows | Flying duties | Printed lines | Quirks |
  |---|---|---|---|---|---|
  ${summary.join("\n")}

  Each case directory holds:

  - \`roster.pdf\` — the document, and the only roster input a run is given
  - \`case.json\` — what a run may see: the covered period and the crew member's own
    commute settings
  The answer key is deliberately **not** in the case directory — it lives in
\`corpus/truth/${set}/<case>.json\`, so an agent that lists the folder its roster sits in
cannot stumble into it.
  `;
  writeFileSync(join(root, "README.md"), readme);
  console.log(`\nwrote ${cases.length} cases to corpus/${set}/ and corpus/manifest.${set}.sha256`);

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
