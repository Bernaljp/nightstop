/**
 * The corpus has to be the same corpus a judge regenerates.
 *
 * Every result file records the manifest hash it was graded against, so if the generator
 * drifts the claim "these are the rosters those numbers came from" quietly stops being
 * true. `shasum -c` proves it from a clean clone; this proves it in CI.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { GroundTruth } from "../lib/corpus/schema";
import { DUTY_BEARING_FIELDS } from "../lib/corpus/schema";

const SETS = ["dev", "heldout", "heldout2"];

test("every committed manifest matches the bytes on disk", () => {
  for (const set of SETS) {
    const manifest = `corpus/manifest.${set}.sha256`;
    assert.ok(existsSync(manifest), `${manifest} is missing`);
    for (const line of readFileSync(manifest, "utf8").trim().split("\n")) {
      const [want, file] = line.split(/\s+/);
      assert.ok(existsSync(file), `${file} is in the manifest and not on disk`);
      const got = createHash("sha256").update(readFileSync(file)).digest("hex");
      assert.equal(got, want, `${file} does not match its committed hash`);
    }
  }
});

test("every roster has a truth file and vice versa", () => {
  for (const set of SETS) {
    const rosters = readdirSync(`corpus/${set}`).filter((d) => !d.endsWith(".md")).sort();
    const truths = readdirSync(`corpus/truth/${set}`)
      .map((f) => f.replace(/\.json$/, "")).sort();
    assert.deepEqual(rosters, truths, `${set}: rosters and answer keys disagree`);
  }
});

test("the answer key is internally consistent", () => {
  for (const set of SETS) {
    for (const f of readdirSync(`corpus/truth/${set}`)) {
      const t: GroundTruth = JSON.parse(readFileSync(`corpus/truth/${set}/${f}`, "utf8"));
      assert.ok(t.duties.length > 0, `${t.caseId} has no duties`);
      for (const d of t.duties) {
        assert.ok(d.date >= t.coveredFrom && d.date <= t.coveredTo,
          `${t.caseId}: duty on ${d.date} is outside the covered range`);
        if (d.reportUtc && d.endUtc) {
          assert.ok(d.endUtc > d.reportUtc, `${t.caseId}: duty ${d.date} ends before it starts`);
        }
        if (d.kind === "off") {
          assert.equal(d.reportUtc, null, `${t.caseId}: a day off with a report time`);
        }
      }
      // Duties in date order, which everything downstream assumes.
      const dates = t.duties.map((d) => d.date);
      assert.deepEqual([...dates].sort(), dates, `${t.caseId}: duties are out of order`);
    }
  }
});

test("the graded field list is pre-registered and non-empty", () => {
  // The grader reads this list. If it shrinks, the accuracy number silently gets easier.
  assert.ok(DUTY_BEARING_FIELDS.length >= 11,
    `only ${DUTY_BEARING_FIELDS.length} fields are graded`);
  for (const f of ["date", "kind", "station", "endStation", "reportUtc", "endUtc"]) {
    assert.ok(DUTY_BEARING_FIELDS.includes(f as never), `${f} is not graded`);
  }
});

test("no roster contains anything that looks like a real person", () => {
  // Ground rule 7. Synthetic throughout, and cheap to keep proving.
  const banned = /\b(bernal|juan|pablo|crew-rest)\b/i;
  for (const set of SETS) {
    for (const f of readdirSync(`corpus/truth/${set}`)) {
      const raw = readFileSync(`corpus/truth/${set}/${f}`, "utf8");
      assert.equal(banned.test(raw), false, `${set}/${f} contains a real reference`);
    }
  }
});

test("the freeze hashes still describe the files a model reads", () => {
  // These are what proves the freeze claim when there is no repository — from the
  // submission archive, say, which deliberately ships without .git. A hash file that
  // quietly stops matching is worse than not having one.
  const lines = readFileSync("docs/freeze.sha256", "utf8").split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"));
  assert.ok(lines.length >= 6, `only ${lines.length} reader files are pinned`);
  for (const line of lines) {
    const [want, file] = line.split(/\s+/);
    assert.ok(existsSync(file), `${file} is pinned but missing`);
    const got = createHash("sha256").update(readFileSync(file)).digest("hex");
    assert.equal(got, want, `${file} has changed since the freeze`);
  }
});
