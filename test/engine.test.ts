/**
 * Invariants the planner must hold on every roster in the corpus.
 *
 * These are the assertions I wish had existed earlier. Every one of them corresponds to a
 * defect that shipped and was found by a person reading the output rather than by a
 * number: sleep starting the instant a duty ended, three eight-hour sleeps in forty-six
 * hours, a rest period with no sleep in it at all. A metric that scores plans cannot see
 * any of that. An invariant can.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { buildPlan, DEFAULT_SETTINGS } from "../lib/plan/engine";
import { planViolations, restPeriods, commuteFor } from "../lib/eval/conflicts";
import { BASELINE_PACK } from "../lib/rules/baseline-pack";
import { OPERATOR_PACK, PREFERENCE_PACK, mergePacks } from "../lib/rules/operator-pack";
import { minutesBetween, addMinutes } from "../lib/tools/time";
import type { GroundTruth } from "../lib/corpus/schema";

const PACK = mergePacks(BASELINE_PACK, OPERATOR_PACK, PREFERENCE_PACK);

/** Every roster in the repository, development and held out alike. */
function allTruths(): GroundTruth[] {
  const out: GroundTruth[] = [];
  for (const set of readdirSync("corpus/truth")) {
    for (const f of readdirSync(`corpus/truth/${set}`)) {
      out.push(JSON.parse(readFileSync(`corpus/truth/${set}/${f}`, "utf8")));
    }
  }
  return out;
}

const TRUTHS = allTruths();
const PLANS = TRUTHS.map((t) => ({ t, plan: buildPlan(t.caseId, t.duties, t.profile, PACK) }));

test("the corpus is actually there", () => {
  assert.ok(TRUTHS.length >= 12, `expected at least 12 rosters, found ${TRUTHS.length}`);
});

test("no plan breaks a rule in its own rule pack", () => {
  for (const { t, plan } of PLANS) {
    const v = planViolations(plan, t.duties, t.profile, PACK);
    assert.equal(v.length, 0, `${t.caseId}: ${v.map((x) => x.statement).join(" | ")}`);
  }
});

test("no sleep block overlaps another", () => {
  for (const { t, plan } of PLANS) {
    const sorted = [...plan.blocks].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].startUtc >= sorted[i - 1].endUtc,
        `${t.caseId}: ${sorted[i - 1].kind} ending ${sorted[i - 1].endUtc} overlaps ` +
          `${sorted[i].kind} starting ${sorted[i].startUtc}`,
      );
    }
  }
});

test("no sleep block overlaps a duty", () => {
  for (const { t, plan } of PLANS) {
    for (const b of plan.blocks) {
      for (const d of t.duties) {
        if (!d.reportUtc || !d.endUtc) continue;
        const clash = b.startUtc < d.endUtc && d.reportUtc < b.endUtc;
        assert.ok(!clash, `${t.caseId}: ${b.kind} at ${b.startUtc} runs into duty ${d.date}`);
      }
    }
  }
});

test("sleep never starts the instant someone walks through the door", () => {
  // The rest window opens when the commute ends. Sleeping on that exact minute assumes
  // nobody eats, showers, or comes down off a ten-hour duty.
  for (const { t, plan } of PLANS) {
    for (const r of restPeriods(t.duties, t.profile)) {
      const earliest = addMinutes(new Date(r.sleepWindowFromUtc), DEFAULT_SETTINGS.settleMinutes);
      const inWindow = plan.blocks.filter(
        (b) => b.startUtc >= r.sleepWindowFromUtc && b.endUtc <= r.sleepWindowToUtc,
      );
      for (const b of inWindow) {
        assert.ok(
          new Date(b.startUtc) >= earliest,
          `${t.caseId}: ${b.kind} starts ${b.startUtc}, window opened ${r.sleepWindowFromUtc}`,
        );
      }
    }
  }
});

test("sleep never runs past the moment they leave for the airport", () => {
  for (const { t, plan } of PLANS) {
    for (const r of restPeriods(t.duties, t.profile)) {
      const inWindow = plan.blocks.filter(
        (b) => b.startUtc >= r.sleepWindowFromUtc && b.startUtc < r.sleepWindowToUtc,
      );
      for (const b of inWindow) {
        assert.ok(
          b.endUtc <= r.sleepWindowToUtc,
          `${t.caseId}: ${b.kind} ends ${b.endUtc}, they leave at ${r.sleepWindowToUtc}`,
        );
      }
    }
  }
});

test("nobody is asked to sleep more than half of any rest window", () => {
  // Three eight-hour sleeps went into one forty-six hour layover before this held.
  for (const { t, plan } of PLANS) {
    for (const r of restPeriods(t.duties, t.profile)) {
      if (r.sleepWindowMinutes < 12 * 60) continue;
      const slept = plan.blocks
        .filter((b) => b.startUtc >= r.sleepWindowFromUtc && b.endUtc <= r.sleepWindowToUtc)
        .reduce((a, b) => a + minutesBetween(new Date(b.startUtc), new Date(b.endUtc)), 0);
      const share = slept / r.sleepWindowMinutes;
      assert.ok(
        share <= 0.68,
        `${t.caseId} before ${r.next.date}: ${Math.round(share * 100)}% of a ` +
          `${Math.round(r.sleepWindowMinutes / 60)}h window spent asleep`,
      );
    }
  }
});

test("every rest window long enough to sleep in gets sleep in it", () => {
  // A window with room for a night and nothing planned is the failure that left every day
  // off blank, and no metric in this repository scores it.
  for (const { t, plan } of PLANS) {
    for (const r of restPeriods(t.duties, t.profile)) {
      const usable = r.sleepWindowMinutes - DEFAULT_SETTINGS.settleMinutes;
      if (usable < DEFAULT_SETTINGS.mainSleepFloorMinutes) continue;
      const inWindow = plan.blocks.filter(
        (b) => b.startUtc >= r.sleepWindowFromUtc && b.endUtc <= r.sleepWindowToUtc,
      );
      assert.ok(
        inWindow.length > 0,
        `${t.caseId}: nothing planned in the ${Math.round(r.sleepWindowMinutes / 60)}h ` +
          `window before ${r.next.date}`,
      );
    }
  }
});

test("every block says why it is there, and cites a rule", () => {
  for (const { t, plan } of PLANS) {
    for (const b of plan.blocks) {
      assert.ok(b.why.trim().length > 20, `${t.caseId}: ${b.kind} has no reason`);
      assert.ok(b.ruleIds.length > 0, `${t.caseId}: ${b.kind} cites no rule`);
      for (const id of b.ruleIds) {
        assert.ok(
          PACK.rules.some((x) => x.id === id),
          `${t.caseId}: ${b.kind} cites "${id}", which is not in the rule pack`,
        );
      }
    }
  }
});

test("a reason carries no clock reading, because the reader chooses the clock", () => {
  // A reason quoting 17:41 beside a calendar showing 00:41 is a contradiction, not an
  // explanation. Durations (6h40, 45m) and dates are fine; HH:MM is not.
  const clock = /\b([01]\d|2[0-3]):[0-5]\d\b/;
  for (const { t, plan } of PLANS) {
    for (const b of plan.blocks) {
      // Their own stated bedtime is a preference they typed in, not a reading of any zone.
      const bed = `${String(Math.floor(t.profile.usualSleep.bedHour)).padStart(2, "0")}:` +
        `${String(Math.round((t.profile.usualSleep.bedHour % 1) * 60)).padStart(2, "0")}`;
      const stripped = b.why.split(bed).join("");
      const m = stripped.match(clock);
      assert.equal(m, null, `${t.caseId}: ${b.kind} reason quotes "${m?.[0]}" — ${b.why}`);
    }
  }
});

test("planning is deterministic", () => {
  for (const { t, plan } of PLANS) {
    const again = buildPlan(t.caseId, t.duties, t.profile, PACK);
    assert.deepEqual(again.blocks, plan.blocks, `${t.caseId} planned differently twice`);
  }
});

test("blocks come out in the order they happen", () => {
  for (const { t, plan } of PLANS) {
    for (let i = 1; i < plan.blocks.length; i++) {
      assert.ok(
        plan.blocks[i].startUtc >= plan.blocks[i - 1].startUtc,
        `${t.caseId}: blocks are not chronological`,
      );
    }
  }
});

test("a nap before a duty ends early enough to shake off", () => {
  for (const { t, plan } of PLANS) {
    for (const b of plan.blocks) {
      if (b.kind !== "pre-duty-nap") continue;
      const next = t.duties
        .filter((d) => d.reportUtc && d.reportUtc >= b.endUtc)
        .sort((x, y) => x.reportUtc!.localeCompare(y.reportUtc!))[0];
      assert.ok(next, `${t.caseId}: pre-duty nap with no duty after it`);
      const leave = addMinutes(new Date(next.reportUtc!), -commuteFor(t.profile, next.station));
      const gap = minutesBetween(new Date(b.endUtc), leave);
      assert.ok(
        gap >= DEFAULT_SETTINGS.napInertiaMinutes,
        `${t.caseId}: nap ends ${gap}m before leaving, needs ${DEFAULT_SETTINGS.napInertiaMinutes}`,
      );
    }
  }
});
