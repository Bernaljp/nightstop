/**
 * The calendar must not draw a lie.
 *
 * This is the regression test for the bug a reader found twice. The first version placed
 * every span in its own station's timezone, so a Madrid–New York sector was drawn ending
 * at 21:10 and the sleep after it starting at 19:56: a crew member asleep an hour and a
 * half before they landed. The fix moved the geometry to one clock and left the LABELS in
 * station time, which is the same contradiction moved into the text.
 *
 * So both halves are asserted, in every zone the picker offers: nothing overlaps on the
 * page that did not overlap in the air, and the hours written on a block are the hours it
 * is drawn at.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildPlan } from "../lib/plan/engine";
import { buildBriefData } from "../lib/brief/data";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import type { GroundTruth } from "../lib/corpus/schema";

const PACK = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);
const TRUTHS: GroundTruth[] = readdirSync("corpus/truth/dev").map((f) =>
  JSON.parse(readFileSync(`corpus/truth/dev/${f}`, "utf8")),
);

function build(t: GroundTruth, tz?: string) {
  const plan = buildPlan(t.caseId, t.duties, t.profile, PACK);
  return buildBriefData(t.operator, t.duties, t.profile, plan, {
    from: t.coveredFrom, to: t.coveredTo,
  }, tz);
}

test("the picker offers base first, every station visited, then UTC", () => {
  for (const t of TRUTHS) {
    const d = build(t);
    assert.ok(d.zones[0].label.startsWith(t.profile.base), `${t.caseId}: base is not first`);
    assert.equal(d.zone.tz, d.zones[0].tz, `${t.caseId}: default zone is not home`);
    assert.equal(d.zones[d.zones.length - 1].label, "UTC");
    const stations = new Set(t.duties.flatMap((x) => [x.station, x.endStation]).filter(Boolean));
    for (const st of stations) {
      assert.ok(
        d.zones.some((z) => z.label.split(" / ").includes(st!)),
        `${t.caseId}: ${st} is on the roster but not findable in the clock picker`,
      );
    }
    // No zone listed twice, or the picker shows two identical options.
    assert.equal(new Set(d.zones.map((z) => z.tz)).size, d.zones.length);
  }
});

test("nothing is drawn overlapping that did not overlap in time", () => {
  for (const t of TRUTHS) {
    for (const zone of build(t).zones) {
      const d = build(t, zone.tz);
      for (const day of d.days) {
        const solid = day.spans.filter((s) => s.kind !== "wocl")
          .sort((a, b) => a.from - b.from);
        for (let i = 1; i < solid.length; i++) {
          assert.ok(
            solid[i].from >= solid[i - 1].to - 1e-9,
            `${t.caseId} in ${zone.label} on ${day.date}: ${solid[i - 1].kind} ` +
              `and ${solid[i].kind} overlap on the page`,
          );
        }
      }
    }
  }
});

test("the hours written on a block are the hours it is drawn at", () => {
  for (const t of TRUTHS) {
    for (const zone of build(t).zones) {
      const d = build(t, zone.tz);
      for (const day of d.days) {
        for (const s of day.spans) {
          // Only the first row of a block that crosses midnight starts where it is labelled.
          const m = s.label.match(/^(\d\d):(\d\d)–/);
          if (!m || s.from === 0) continue;
          const drawn = s.from * 1440;
          const said = Number(m[1]) * 60 + Number(m[2]);
          assert.ok(
            Math.abs(drawn - said) < 1.5,
            `${t.caseId} in ${zone.label} on ${day.date}: labelled ${s.label} ` +
              `but drawn at ${Math.round(drawn / 60)}:${String(Math.round(drawn % 60)).padStart(2, "0")}`,
          );
        }
      }
    }
  }
});

test("no label carries a station's own clock alongside the view's", () => {
  // "ORD 17:41" on a block sitting at 00:41 was shipped once. A label is hours, or it is
  // a place, and it is never both.
  for (const t of TRUTHS) {
    for (const zone of build(t).zones) {
      for (const day of build(t, zone.tz).days) {
        for (const s of day.spans) {
          if (s.kind === "wocl" || s.kind === "duty") continue;
          assert.ok(
            /^\d\d:\d\d–\d\d:\d\d$/.test(s.label),
            `${t.caseId} in ${zone.label}: sleep labelled "${s.label}"`,
          );
        }
      }
    }
  }
});

test("sleep away from base is flagged for the eye, and only sleep", () => {
  for (const t of TRUTHS) {
    const d = build(t);
    const away = d.days.flatMap((x) => x.spans).filter((s) => s.away);
    for (const s of away) assert.equal(s.kind, "main", "only main sleep carries the away flag");
    const layover = t.duties.some((x) => x.endStation !== t.profile.base);
    if (layover) {
      assert.ok(away.length > 0, `${t.caseId} has layovers but no night marked away from base`);
    }
  }
});

test("every day in the covered range gets a row", () => {
  for (const t of TRUTHS) {
    const d = build(t);
    assert.equal(d.days[0].date, t.coveredFrom);
    assert.equal(d.days[d.days.length - 1].date, t.coveredTo);
  }
});
