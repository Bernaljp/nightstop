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
interface Night {
  from: Date;
  to: Date;
  /** The end was pulled back to fit before the next report — an early night, on purpose. */
  clippedEnd: boolean;
  /** The start was pushed out because the window opened late, or a night came before it. */
  clippedStart: boolean;
  /** True when what pushed it was the window opening, not a night already placed. */
  floorWasWindow: boolean;
  /** Set when the length was cut back because they will not have been up long. */
  trimmedAwake?: number;
  /** Set on the sleep that exists to get them through a night duty. */
  preDuty?: boolean;
}

function placeMainSleeps(
  windowFrom: Date,
  windowTo: Date,
  bodyOffsetFromUtc: number,
  s: EngineSettings,
  bedHour: number,
): Night[] {
  if (minutesBetween(windowFrom, windowTo) <= 0) return [];

  // Body-clock midnight of the day the window opens, as a real instant.
  const bodyFrom = new Date(windowFrom.getTime() + bodyOffsetFromUtc * 60_000);
  const bodyDayStart = Date.UTC(
    bodyFrom.getUTCFullYear(), bodyFrom.getUTCMonth(), bodyFrom.getUTCDate(),
  );

  const out: Night[] = [];
  // A rest period longer than a fortnight is not a rest period; the bound is a guard.
  for (let day = -1; day <= 15; day++) {
    const bedBody = bodyDayStart + day * 24 * HOUR + bedHour * HOUR;
    const bed = new Date(bedBody - bodyOffsetFromUtc * 60_000);
    let from = bed;
    let to = addMinutes(bed, s.mainSleepTargetMinutes);
    let clippedEnd = false;
    let clippedStart = false;

    if (to <= windowFrom || from >= windowTo) continue;

    const prev = out[out.length - 1];
    let floorWasWindow = false;
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
      clippedEnd = true;
    }
    // And the mirror: land at 02:35 after a night duty and the answer is not to wake at
    // the usual hour having slept four hours. If the night is cut short at the START,
    // extend the END to keep the length, up to the window and the next night's bedtime.
    if (from.getTime() < floor) {
      from = new Date(floor);
      clippedStart = true;
      floorWasWindow = !prev;
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
    out.push({ from, to, clippedEnd, clippedStart, floorWasWindow });
  }
  return out;
}

/**
 * Nobody sleeps eight hours twice in the same day.
 *
 * On a long layover the loop above finds a body-clock night at each edge of the window as
 * well as in the middle, and gave every one of them the full eight hours. On a 46-hour
 * Chicago layover that came out as twenty-four hours of sleep — a plan asking a person to
 * spend more than half the window unconscious, in three separate goes. It read as broken
 * because it was.
 *
 * Sleep is bought with time awake, at roughly two hours up for every hour down. So a night
 * that follows eleven hours of wakefulness is a five-and-a-half hour night, not an eight.
 *
 * The ratio holds even for the sleep taken before a night duty. What makes that one a
 * pre-duty sleep is where it sits — late, ending at report — not how long it is; a crew
 * member who woke at half past three cannot bank eight hours at three in the afternoon
 * however much they would like to. It is floored at the rule pack's own six hours, so the
 * planner never proposes a main sleep it would then have to flag as too short.
 */
function trimForTimeAwake(nights: Night[], preDutyIndex: number, floorMinutes: number): void {
  if (preDutyIndex >= 0 && nights[preDutyIndex]) nights[preDutyIndex].preDuty = true;
  for (let i = 1; i < nights.length; i++) {
    const woke = nights[i - 1].to.getTime();

    if (nights[i].clippedEnd) {
      // An early night ends when it has to — the report fixes that end — so the bedtime
      // is what moves. Moving it lengthens the day before it, which in turn earns more
      // sleep, so the two have to be solved together rather than in sequence: with the
      // end E pinned and waking at W, the bedtime that makes sleep exactly half the time
      // awake is (2E + W)/3. Trimming against the untouched bedtime instead left the plan
      // and the checker measuring different days, and the checker won.
      const end = nights[i].to.getTime();
      // Rounded to the minute: a third of a duration lands on odd seconds, and a plan
      // that tells someone to go to bed at 13:00:20 has stopped sounding like advice.
      let from = new Date(Math.round((2 * end + woke) / 3 / 60_000) * 60_000);
      if (minutesBetween(from, nights[i].to) < floorMinutes) {
        from = addMinutes(nights[i].to, -floorMinutes);
      }
      if (from.getTime() <= nights[i].from.getTime()) continue;
      nights[i].trimmedAwake = minutesBetween(nights[i - 1].to, from);
      nights[i].from = from;
      continue;
    }

    // Any other night keeps the bedtime the body asked for; they simply wake earlier.
    const awake = minutesBetween(nights[i - 1].to, nights[i].from);
    const allowed = Math.max(floorMinutes, Math.round(awake / 2));
    if (minutesBetween(nights[i].from, nights[i].to) <= allowed) continue;
    nights[i].to = addMinutes(nights[i].from, allowed);
    nights[i].trimmedAwake = awake;
  }
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

/**
 * Where a block falls in the day at the station, said in words rather than in digits.
 *
 * A reason has to survive being read next to a calendar the crew member may have switched
 * to a different clock, so it names the time of day instead of quoting one.
 */
function partOfDay(instant: Date, tz: string): string {
  const hour = Number(localHHmm(instant, tz).slice(0, 2));
  if (hour < 5) return "the early hours";
  if (hour < 12) return "the morning";
  if (hour < 17) return "the afternoon";
  if (hour < 21) return "the evening";
  return "the late evening";
}

/** How long after waking they set off, or that they set off straight away. */
function leaveText(minutes: number): string {
  return minutes <= 5 ? "the moment this ends" : `${formatDuration(minutes)} after this ends`;
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

    // How much of the NEXT duty sits in the circadian low. Computed here rather than with
    // the naps below because it decides something first: whether the last sleep in this
    // window is an ordinary night or the sleep that has to get them through a night duty.
    const dutyWocl = woclCoverageMinutes(
      new Date(r.next.reportUtc!), new Date(r.next.endUtc!), bodyOffsetFromUtc,
    );
    trimForTimeAwake(nights, dutyWocl >= 60 ? nights.length - 1 : -1, settings.mainSleepFloorMinutes);

    const usual = `${String(Math.floor(usualBed)).padStart(2, "0")}:${String(Math.round((usualBed % 1) * 60)).padStart(2, "0")}`;
    const leaveFor = addMinutes(
      new Date(r.next.reportUtc!), -commuteFor(profile, r.next.station),
    );

    // If they were still on duty at their usual bedtime, say that rather than leaving
    // "the roster leaves no room" to be taken on trust.
    const onDutyThen = r.prev.reportUtc && r.prev.endUtc
      ? usualWindowOverlap(
          new Date(r.prev.reportUtc), new Date(r.prev.endUtc),
          tzOf(r.prev.endStation), usualBed, usualWake,
        ) >= 60
      : false;

    // The nights themselves.
    nights.forEach((night) => {
      const len = minutesBetween(night.from, night.to);
      const inWocl = woclCoverageMinutes(night.from, night.to, bodyOffsetFromUtc);
      const drift = Math.round(phase?.offsetFromLocalMinutes ?? 0);
      const off = displacementFrom(night.from, stationTz);
      const at = r.prev.endStation;
      const beforeReport = minutesBetween(night.to, leaveFor);

      // The explanation is built from WHY the block landed where it did, not guessed at
      // from where it ended up. The version that guessed printed "the roster leaves no
      // room to keep your normal hours" onto a forty-six hour layover, which is not a
      // small wording problem: it told a crew member the roster was to blame for a bedtime
      // their own body clock had chosen, and there was no way to tell from the plan that
      // it was wrong.
      //
      // It also carries NO clock readings. The times are printed once, by whatever is
      // displaying the block, on whatever clock the reader has chosen. A reason that
      // quotes 17:41 while the calendar beside it shows 00:41 is the same timezone
      // mixing in prose, and it reads as a contradiction rather than an explanation.
      // What survives here are durations, which mean the same thing in every zone, and
      // station names, which are places rather than times.
      let why: string;
      if (night.preDuty) {
        why =
          `Late on purpose, so you are rested for a duty that runs ` +
          `${formatDuration(dutyWocl)} through your circadian low. You leave for the ` +
          `airport ${leaveText(beforeReport)}.`;
      } else if (night.clippedEnd) {
        why = `An early night: you leave for the airport ${leaveText(beforeReport)}.`;
      } else if (night.clippedStart && night.floorWasWindow) {
        why = onDutyThen
          ? `You were still on duty at your usual ${usual}, so this is the first chance ` +
            `you get.`
          : `The earliest you could be asleep — the rest window opens ` +
            `${formatDuration(settings.settleMinutes)} before this, which is the time it ` +
            `takes to get through the door.`;
      } else if (Math.abs(drift) >= 60) {
        why = Math.abs(off) >= 60
          ? `Your body is still ${formatDuration(Math.abs(drift))} ` +
            `${drift > 0 ? "ahead of" : "behind"} the clock at ${at}, so this IS your usual ` +
            `${usual} — at ${at} it falls in ${partOfDay(night.from, stationTz)}.`
          : `Close to your usual ${usual}, but about ` +
            `${formatDuration(Math.abs(drift))} ${drift > 0 ? "later" : "earlier"} on your ` +
            `body clock, which has not caught up with where you are.`;
      } else if (Math.abs(off) >= 60) {
        why =
          `About ${formatDuration(Math.abs(off))} ` +
          `${off > 0 ? "later" : "earlier"} than your usual ${usual}.`;
      } else {
        why = `Your usual hours, covering ${formatDuration(inWocl)} of your circadian low.`;
      }
      if (night.trimmedAwake) {
        why +=
          ` ${formatDuration(len)} rather than a full night — you will only have been up ` +
          `${formatDuration(night.trimmedAwake)} by then.`;
      }

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

    // Then the supplementary sleep: a nap before a duty, a nap after one, or both.
    //
    // The first version placed a recovery nap an hour after waking and a pre-duty nap five
    // minutes after that, giving eight hours of sleep followed by two more and then two
    // more again. The fix for that was to allow only ONE extra block per rest period,
    // which stopped the stacking and quietly created a second problem: land at 14:20 off
    // an overnight sector that ate half your night, and the plan offered nothing at all
    // until midnight. Nine hours awake, straight off a red-eye, and no nap.
    //
    // The stacking was never really about the count. It was about placement. So the two
    // naps now have their own slots and cannot collide: recovery goes in the gap BEFORE
    // the first night, a pre-duty nap in the gap AFTER the last one, each of them four
    // hours clear of the sleep it sits beside, and neither offered unless its slot is
    // genuinely open. A window can now hold both, separated by a night, which is what a
    // long layover after a disruptive duty actually calls for.
    const slept = nights.reduce((a, x) => a + minutesBetween(x.from, x.to), 0);
    const firstNight = nights[0];
    const lastNight = nights[nights.length - 1];
    const pickup = addMinutes(
      new Date(r.next.reportUtc!), -commuteFor(profile, r.next.station),
    );

    const prevAte = r.prev.reportUtc && r.prev.endUtc
      ? usualWindowOverlap(
          new Date(r.prev.reportUtc), new Date(r.prev.endUtc),
          tzOf(r.prev.endStation), usualBed, usualWake,
        )
      : 0;

    const addNap = (
      kind: "pre-duty-nap" | "recovery-nap",
      napStart: Date, napEnd: Date, station: string, why: string, ruleIds: string[],
    ) => {
      blocks.push({
        id: `${kind}-${napStart.toISOString().slice(0, 16)}`,
        kind,
        startUtc: napStart.toISOString(),
        endUtc: napEnd.toISOString(),
        station,
        why,
        ruleIds,
      });
    };

    // Recovery, in the gap between getting in and the first night.
    //
    // The debt was run up BEFORE this window opened, so the old test — offer recovery only
    // if the nights here fall short of target — had it backwards. A full eight hours
    // tonight does not give back the four the duty took out of last night, and it is no
    // help at all during the nine hours before it starts.
    if (prevAte >= settings.disruptionMinutes) {
      const from = addMinutes(new Date(r.sleepWindowFromUtc), settings.settleMinutes);
      const until = addMinutes(firstNight.from, -settings.napSeparationMinutes);
      const room = minutesBetween(from, until);
      if (room >= 45) {
        // Taken as soon as they are through the door, and kept short: sleep now is what
        // repays the debt, and a nap that drifts towards the evening starts costing the
        // night it is meant to protect.
        const len = Math.min(settings.napCapMinutes, room);
        addNap(
          "recovery-nap", from, addMinutes(from, len), r.prev.endStation,
          `${r.prev.date} took ${formatDuration(prevAte)} out of the hours you normally ` +
            `sleep, and you are ${formatDuration(minutesBetween(from, firstNight.from))} ` +
            `from your next proper night. Take this ${formatDuration(len)} now, while the ` +
            `pressure is still there — it is short on purpose, so it does not cost you ` +
            `tonight.`,
          ["sleep-per-24h-7h", "nap-cap-2h"],
        );
      }
    }

    // Pre-duty, in the gap between the last night and leaving for the airport.
    const wantPreDuty = dutyWocl >= 60 || slept < settings.mainSleepFloorMinutes;
    if (wantPreDuty) {
      const napEnd = addMinutes(pickup, -settings.napInertiaMinutes);
      const earliest = addMinutes(lastNight.to, settings.napSeparationMinutes);
      const room = minutesBetween(earliest, napEnd);
      if (room >= 45) {
        const len = Math.min(settings.napCapMinutes, room);
        addNap(
          "pre-duty-nap", addMinutes(napEnd, -len), napEnd, r.next.station,
          slept < settings.mainSleepFloorMinutes
            ? `Only ${formatDuration(slept)} of sleep fits before ${r.next.date}, so ` +
              `this ${formatDuration(len)} takes the edge off. It ends ` +
              `${formatDuration(settings.napInertiaMinutes)} before you leave, so you ` +
              `are not driving on sleep inertia.`
            : `${r.next.date} runs ${formatDuration(dutyWocl)} through your circadian ` +
              `low. Take this ${formatDuration(len)} beforehand, while you can still ` +
              `sleep — it ends ${formatDuration(settings.napInertiaMinutes)} before you leave.`,
          ["nap-inertia-gap-45m", "nap-cap-2h"],
        );
      }
    }
  });

  const conflicts: Conflict[] = mandatoryConflicts(duties, profile, pack);

  // Chronological. Naps are appended after the nights of their own rest period, so the
  // raw order is neither the order they happen in nor the order anything downstream
  // wants to read them in.
  blocks.sort((a, b) => a.startUtc.localeCompare(b.startUtc));

  return { caseId, blocks, conflicts };
}
