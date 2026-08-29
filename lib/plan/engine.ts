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
  /** Preferred bedtime and wake time, in BODY-clock hours. */
  preferredBodyBedHour: number;
  preferredBodyWakeHour: number;
}

export const DEFAULT_SETTINGS: EngineSettings = {
  mainSleepTargetMinutes: 8 * 60,
  mainSleepFloorMinutes: 6 * 60,
  napCapMinutes: 120,
  napInertiaMinutes: 45,
  preferredBodyBedHour: 23,
  preferredBodyWakeHour: 7,
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
    const bedBody = bodyDayStart + day * 24 * HOUR + s.preferredBodyBedHour * HOUR;
    const bed = new Date(bedBody - bodyOffsetFromUtc * 60_000);
    let from = bed;
    let to = addMinutes(bed, s.mainSleepTargetMinutes);

    if (to <= windowFrom || from >= windowTo) continue;

    const prev = out[out.length - 1];
    const floor = prev ? Math.max(windowFrom.getTime(), prev.to.getTime()) : windowFrom.getTime();

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
      const ceiling = Math.min(
        windowTo.getTime(),
        bedBody + 24 * HOUR - bodyOffsetFromUtc * 60_000,
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

  rests.forEach((r, i) => {
    const from = new Date(r.sleepWindowFromUtc);
    const to = new Date(r.sleepWindowToUtc);
    if (minutesBetween(from, to) <= 0) return;

    // Body clock at the end of the duty that opened this window.
    const phase = phases[i];
    const stationTz = tzOf(r.prev.endStation);
    const localOffset = utcOffsetMinutes(from, stationTz);
    const bodyOffsetFromUtc = localOffset + (phase?.offsetFromLocalMinutes ?? 0);

    const nights = placeMainSleeps(from, to, bodyOffsetFromUtc, settings);
    if (!nights.length) return;

    nights.forEach((night, n) => {
      const isLast = n === nights.length - 1;
      const len = minutesBetween(night.from, night.to);
      const main = night;
    const inWocl = woclCoverageMinutes(main.from, main.to, bodyOffsetFromUtc);
    const localBed = localHHmm(main.from, stationTz);
    const localWake = localHHmm(main.to, stationTz);
    const drift = Math.round(phase?.offsetFromLocalMinutes ?? 0);

    const why =
      Math.abs(drift) >= 60
        ? `${localBed} to ${localWake} local at ${r.prev.endStation} — which is about ` +
          `${formatDuration(Math.abs(drift))} ${drift > 0 ? "later" : "earlier"} on your body ` +
          `clock, because it has not caught up with where you are yet.`
        : `${localBed} to ${localWake} at ${r.prev.endStation}, covering ` +
          `${formatDuration(inWocl)} of your circadian low.`;

      blocks.push({
      id: `main-${localDate(night.from, stationTz)}`,
      kind: "main",
      startUtc: main.from.toISOString(),
      endUtc: main.to.toISOString(),
      station: r.prev.endStation,
      why,
      ruleIds: ["far117-sleep-opportunity-8h"],
    });

    // A pre-duty nap, on the two occasions crew actually take one.
    //
    // The first version only offered a nap when the main sleep came in under the
    // six-hour floor, which never once happened across twelve rosters - the tightest
    // window in the corpus is 6h50. The rule was dead code, and a fatigue planner that
    // never suggests a nap is missing the tool crew reach for most.
    //
    // The one that matters is prophylactic: a nap before a duty that runs through the
    // circadian low, taken while you can still sleep, so you are not meeting 03:00 body
    // time on whatever you managed the night before (UK CAA Paper 2003/8).
    const pickup = addMinutes(
      new Date(r.next.reportUtc!), -commuteFor(profile, r.next.station),
    );
    const napEnd = addMinutes(pickup, -settings.napInertiaMinutes);
    const room = minutesBetween(main.to, napEnd);

    // How much of the coming duty runs through the body's own night?
    const dutyWocl = woclCoverageMinutes(
      new Date(r.next.reportUtc!),
      new Date(r.next.endUtc!),
      bodyOffsetFromUtc,
    );

      const short = len < settings.mainSleepFloorMinutes;
      const nightDuty = dutyWocl >= 60;

      // Only the last night of a rest period sits before the duty; a nap after any
      // earlier one would be a nap in the middle of a day off.
      if (isLast && (short || nightDuty) && room >= 90) {
        const napLen = Math.min(settings.napCapMinutes, room - 60);
        const napStart = addMinutes(napEnd, -napLen);
        if (napLen >= 30) {
          blocks.push({
          id: `nap-${r.next.date}`,
          kind: "pre-duty-nap",
          startUtc: napStart.toISOString(),
          endUtc: napEnd.toISOString(),
          station: r.next.station,
          why: short
            ? `Only ${formatDuration(len)} of main sleep fits before ${r.next.date}, so this ` +
              `${formatDuration(napLen)} nap takes the edge off. It ends ` +
              `${formatDuration(settings.napInertiaMinutes)} before you leave, so you are not ` +
              `driving on sleep inertia.`
            : `${r.next.date} runs ${formatDuration(dutyWocl)} through your circadian low. ` +
              `Take this ${formatDuration(napLen)} now, while you can still sleep — it ends ` +
              `${formatDuration(settings.napInertiaMinutes)} before you leave.`,
            ruleIds: ["nap-inertia-gap-45m", "nap-cap-2h"],
          });
        }
      }
    });
  });

  const conflicts: Conflict[] = mandatoryConflicts(duties, profile, pack);

  return { caseId, blocks, conflicts };
}
