/**
 * The deterministic sleep engine.
 *
 * Given duties, the crew member's settings and a rule pack, it lays sleep into every
 * rest period and reports every collision it could not avoid. No model is involved:
 * placing a block of sleep in a window is arithmetic, and arithmetic done by a language
 * model is arithmetic you have to check.
 *
 * What the model IS for, elsewhere in the pipeline, is reading an unfamiliar roster,
 * turning a regulation into a rule pack, and explaining a collision to a person in
 * words they would use themselves. This file does none of those things.
 */
import type { Duty, CrewProfile } from "../corpus/schema";
import type { RulePack } from "../rules/schema";
import type { SleepPlan, SleepBlock, Conflict } from "./schema";
import { restPeriods, mandatoryConflicts, commuteFor } from "../eval/conflicts";
import { phaseTrace, woclCoverageMinutes } from "./circadian";
import { tzOf } from "../corpus/network";
import {
  addMinutes, minutesBetween, localHHmm, localDate, formatDuration, utcOffsetMinutes, HOUR,
} from "../tools/time";

export interface EngineSettings {
  /** Target length of a main sleep. A soft cap, not a limit. */
  mainSleepTargetMinutes: number;
  /** Below this a main sleep stops being worth the name. */
  mainSleepFloorMinutes: number;
  /** Longest pre-duty nap the engine will place. */
  napCapMinutes: number;
  /** A nap must end this long before the crew member leaves for the airport. */
  napInertiaMinutes: number;
  /**
   * Fallback bedtime, used only when a crew member has told us nothing. Their own hours
   * from `CrewProfile.usualSleep` take precedence — a plan anchored to a house default is
   * planning a stranger's sleep.
   */
  preferredBodyBedHour: number;
  preferredBodyWakeHour: number;
  /**
   * How much of their usual sleep window a duty has to eat before recovery sleep is
   * offered afterwards.
   */
  disruptionMinutes: number;
  /**
   * Minimum gap between the end of a main sleep and the start of any nap. Sleeping again
   * an hour after waking is not a nap, it is a fragmented night.
   */
  napSeparationMinutes: number;
  /**
   * Time between reaching the hotel or the front door and actually being asleep.
   *
   * The rest window opens the moment the commute ends, and the planner was placing sleep
   * on that exact instant — asleep the second you walk in, having not eaten, showered or
   * come down off a ten-hour duty. Nobody does that, and a plan that assumes it overstates
   * every night it touches.
   *
   * This is a planning realism allowance, deliberately NOT subtracted from the sleep
   * opportunity the regulation measures — 14 CFR 117.25(e) defines that window, and
   * narrowing it here would be reinterpreting the regulation rather than planning inside it.
   */
  settleMinutes: number;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  mainSleepTargetMinutes: 8 * 60,
  mainSleepFloorMinutes: 6 * 60,
  napCapMinutes: 120,
  napInertiaMinutes: 45,
  preferredBodyBedHour: 23,
  preferredBodyWakeHour: 7,
  disruptionMinutes: 90,
  napSeparationMinutes: 4 * 60,
  settleMinutes: 45,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Place a main sleep on every night a window contains — not one per window.
 *
 * The first version placed exactly one sleep per rest period, which is correct only when
 * the rest period is a single night. It usually is not: four of the six rest periods on
 * the first Aurora roster span two nights, and a block of days off spans several. Every
 * one of those extra nights went unplanned, so a crew member on three days off was shown
 * one night of sleep and nothing else. For a tool whose entire job is telling you when to
 * sleep, that is most of the job missing.
 *
 * The ideal is the crew member's own night on their BODY clock. Where a candidate night
 * falls partly outside the window it is clipped rather than dropped, because a short
 * night that is flagged beats a night nobody planned.
 */
function placeMainSleeps(
  windowFrom: Date,
  windowTo: Date,
  bodyOffsetFromUtc: number,
  s: EngineSettings,
  bedHour: number,
): Array<{ from: Date; to: Date }> {
  if (minutesBetween(windowFrom, windowTo) <= 0) return [];

  // Body-clock midnight of the day the window opens, as a real instant.
  const bodyFrom = new Date(windowFrom.getTime() + bodyOffsetFromUtc * 60_000);
  const bodyDayStart = Date.UTC(
    bodyFrom.getUTCFullYear(), bodyFrom.getUTCMonth(), bodyFrom.getUTCDate(),
  );

  const out: Array<{ from: Date; to: Date }> = [];
  // A rest period longer than a fortnight is not a rest period; the bound is a guard.
  for (let day = -1; day <= 15; day++) {
    const bedBody = bodyDayStart + day * 24 * HOUR + bedHour * HOUR;
    const bed = new Date(bedBody - bodyOffsetFromUtc * 60_000);
    let from = bed;
    let to = addMinutes(bed, s.mainSleepTargetMinutes);

    if (to <= windowFrom || from >= windowTo) continue;

    const prev = out[out.length - 1];
    const floor = prev
      ? Math.max(windowFrom.getTime(), prev.to.getTime() + s.napSeparationMinutes * 60_000)
      : windowFrom.getTime();

    // Before an early report, go to bed EARLIER rather than getting up short. Clipping
    // the end instead produced 5h45 nights before 05:40 reports and then flagged them as
    // the planner's own fault — when shifting bedtime back is precisely the advice a
    // fatigue tool exists to give.
    if (to > windowTo) {
      const shifted = windowTo.getTime() - s.mainSleepTargetMinutes * 60_000;
      from = new Date(Math.max(floor, shifted));
      to = windowTo;
    }
    // And the mirror: land at 02:35 after a night duty and the answer is not to wake at
    // the usual hour having slept four hours. If the night is cut short at the START,
    // extend the END to keep the length, up to the window and the next night's bedtime.
    if (from.getTime() < floor) {
      from = new Date(floor);
      const wanted = addMinutes(from, s.mainSleepTargetMinutes);
      // Stop short of crowding the following night. Extending right up to the next
      // bedtime produced two main sleeps an hour apart, which is one fragmented night
      // rather than two.
      const ceiling = Math.min(
        windowTo.getTime(),
        bedBody + 24 * HOUR - bodyOffsetFromUtc * 60_000 - s.napSeparationMinutes * 60_000,
      );
      if (wanted.getTime() > to.getTime()) to = new Date(Math.min(wanted.getTime(), ceiling));
    }
    if (to <= from) continue;

    // A sliver at the edge of a window is not a night's sleep. Below four hours it is
    // left out rather than dressed up as one.
    if (minutesBetween(from, to) < 4 * 60) continue;
    out.push({ from, to });
  }
  return out;
}

/**
 * Minutes a duty overlaps the hours this crew member normally sleeps.
 *
 * Handles the usual case of a window that crosses midnight, which almost all of them do.
 */
function usualWindowOverlap(
  from: Date, to: Date, tz: string, bedHour: number, wakeHour: number,
): number {
  let total = 0;
  // Walk the duty in ten-minute steps; exact enough for a threshold, and immune to the
  // off-by-one errors that midnight-crossing interval arithmetic invites.
  for (let t = from.getTime(); t < to.getTime(); t += 10 * 60_000) {
    const hhmm = localHHmm(new Date(t), tz);
    const h = Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3)) / 60;
    const inWindow = bedHour < wakeHour
      ? h >= bedHour && h < wakeHour
      : h >= bedHour || h < wakeHour;
    if (inWindow) total += 10;
  }
  return total;
}

export function buildPlan(
  caseId: string,
  duties: Duty[],
  profile: CrewProfile,
  pack: RulePack,
  settings: EngineSettings = DEFAULT_SETTINGS,
): SleepPlan {
  const rests = restPeriods(duties, profile);
  const phases = phaseTrace(duties, profile);
  const blocks: SleepBlock[] = [];

  // Their hours, not the house default.
  const usualBed = profile.usualSleep?.bedHour ?? settings.preferredBodyBedHour;
  const usualWake = profile.usualSleep?.wakeHour ?? settings.preferredBodyWakeHour;

  /** How far a night sits from the hour they normally go to bed, in minutes. */
  const displacementFrom = (start: Date, tz: string): number => {
    const hhmm = localHHmm(start, tz);
    const hour = Number(hhmm.slice(0, 2)) + Number(hhmm.slice(3)) / 60;
    let diff = hour - usualBed;
    while (diff > 12) diff -= 24;
    while (diff < -12) diff += 24;
    return Math.round(diff * 60);
  };

  rests.forEach((r, i) => {
    // Sleep cannot begin the instant the commute ends; allow time to settle.
    const from = addMinutes(new Date(r.sleepWindowFromUtc), settings.settleMinutes);
    const to = new Date(r.sleepWindowToUtc);
    if (minutesBetween(from, to) <= 0) return;

    // Body clock at the end of the duty that opened this window.
    const phase = phases[i];
    const stationTz = tzOf(r.prev.endStation);
    const localOffset = utcOffsetMinutes(from, stationTz);
    const bodyOffsetFromUtc = localOffset + (phase?.offsetFromLocalMinutes ?? 0);

    const nights = placeMainSleeps(from, to, bodyOffsetFromUtc, settings, usualBed);
    if (!nights.length) return;

    // The nights themselves.
    nights.forEach((night) => {
      const len = minutesBetween(night.from, night.to);
      const inWocl = woclCoverageMinutes(night.from, night.to, bodyOffsetFromUtc);
      const localBed = localHHmm(night.from, stationTz);
      const localWake = localHHmm(night.to, stationTz);
      const drift = Math.round(phase?.offsetFromLocalMinutes ?? 0);
      const off = displacementFrom(night.from, stationTz);
      const usual = `${String(Math.floor(usualBed)).padStart(2, "0")}:${String(Math.round((usualBed % 1) * 60)).padStart(2, "0")}`;

      // If they were still on duty at their usual bedtime, say that rather than leaving
      // "the roster leaves no room" to be taken on trust.
      const onDutyThen = r.prev.reportUtc && r.prev.endUtc
        ? usualWindowOverlap(
            new Date(r.prev.reportUtc), new Date(r.prev.endUtc),
            tzOf(r.prev.endStation), usualBed, usualWake,
          ) >= 60
        : false;

      const why =
        Math.abs(off) >= 60
          ? `${localBed} to ${localWake} at ${r.prev.endStation} — about ` +
            `${formatDuration(Math.abs(off))} ${off > 0 ? "later" : "earlier"} than your ` +
            `usual ${usual}. ` +
            (onDutyThen
              ? `You were still on duty at ${usual}; this is the first chance you get.`
              : `The roster leaves no room to keep your normal hours here.`)
          : Math.abs(drift) >= 60
            ? `${localBed} to ${localWake} local at ${r.prev.endStation} — close to your ` +
              `usual ${usual}, but about ${formatDuration(Math.abs(drift))} ` +
              `${drift > 0 ? "later" : "earlier"} on your body clock, which has not caught ` +
              `up with where you are.`
            : `${localBed} to ${localWake} at ${r.prev.endStation}, your usual hours, ` +
              `covering ${formatDuration(inWocl)} of your circadian low.`;

      blocks.push({
        id: `main-${night.from.toISOString().slice(0, 16)}`,
        kind: "main",
        startUtc: night.from.toISOString(),
        endUtc: night.to.toISOString(),
        station: r.prev.endStation,
        why,
        ruleIds: ["far117-sleep-opportunity-8h"],
      });
    });

    // Then AT MOST ONE supplementary block for the whole rest period.
    //
    // The first version placed a recovery nap an hour after waking and a pre-duty nap
    // five minutes after that, giving eight hours of sleep followed by two more and then
    // two more again. Nobody sleeps like that, and being told to is worse than being told
    // nothing. Three rules fix it: only one extra block per rest period; it must sit at
    // least four hours clear of any night; and it is only offered when there is something
    // for it to do.
    const slept = nights.reduce((a, x) => a + minutesBetween(x.from, x.to), 0);
    const lastNight = nights[nights.length - 1];
    const pickup = addMinutes(
      new Date(r.next.reportUtc!), -commuteFor(profile, r.next.station),
    );
    const napEnd = addMinutes(pickup, -settings.napInertiaMinutes);
    const earliest = addMinutes(lastNight.to, settings.napSeparationMinutes);

    const dutyWocl = woclCoverageMinutes(
      new Date(r.next.reportUtc!), new Date(r.next.endUtc!), bodyOffsetFromUtc,
    );
    const prevAte = r.prev.reportUtc && r.prev.endUtc
      ? usualWindowOverlap(
          new Date(r.prev.reportUtc), new Date(r.prev.endUtc),
          tzOf(r.prev.endStation), usualBed, usualWake,
        )
      : 0;

    // A pre-duty nap is time-critical and wins where both would apply: it has to be taken
    // before this particular duty, where recovery could be taken on any of several days.
    const wantPreDuty = dutyWocl >= 60 || slept < settings.mainSleepFloorMinutes;
    // Recovery repays a debt. If the nights in this window already got them to target,
    // there is no debt and nothing to repay.
    const wantRecovery = prevAte >= settings.disruptionMinutes
      && slept < settings.mainSleepTargetMinutes;

    if (wantPreDuty || wantRecovery) {
      const room = minutesBetween(earliest, napEnd);
      if (room >= 45) {
        const napLen = Math.min(settings.napCapMinutes, room);
        const napStart = addMinutes(napEnd, -napLen);
        const kind = wantPreDuty ? "pre-duty-nap" : "recovery-nap";
        blocks.push({
          id: `${kind}-${napStart.toISOString().slice(0, 16)}`,
          kind,
          startUtc: napStart.toISOString(),
          endUtc: napEnd.toISOString(),
          station: r.next.station,
          why: wantPreDuty
            ? (slept < settings.mainSleepFloorMinutes
                ? `Only ${formatDuration(slept)} of sleep fits before ${r.next.date}, so ` +
                  `this ${formatDuration(napLen)} takes the edge off. It ends ` +
                  `${formatDuration(settings.napInertiaMinutes)} before you leave, so you ` +
                  `are not driving on sleep inertia.`
                : `${r.next.date} runs ${formatDuration(dutyWocl)} through your circadian ` +
                  `low. Take this ${formatDuration(napLen)} beforehand, while you can still ` +
                  `sleep — it ends ${formatDuration(settings.napInertiaMinutes)} before you leave.`)
            : `${r.prev.date} took ${formatDuration(prevAte)} out of the hours you normally ` +
              `sleep, and this window only gets you ${formatDuration(slept)}. This ` +
              `${formatDuration(napLen)} pays some of it back rather than carrying it into ` +
              `the week.`,
          ruleIds: wantPreDuty
            ? ["nap-inertia-gap-45m", "nap-cap-2h"]
            : ["sleep-per-24h-7h"],
        });
      }
    }
  });

  const conflicts: Conflict[] = mandatoryConflicts(duties, profile, pack);

  return { caseId, blocks, conflicts };
}
