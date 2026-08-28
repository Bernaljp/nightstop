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
  addMinutes, minutesBetween, localHHmm, formatDuration, utcOffsetMinutes,
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
 * Place a main sleep inside a window.
 *
 * The ideal is the crew member's own night on their BODY clock. Where the window
 * cannot hold it, the block slides to sit inside the window rather than being trimmed
 * from one end — a sleep that starts at the right hour and is cut short is worth more
 * than one shifted onto the wrong side of the clock.
 */
function placeMainSleep(
  windowFrom: Date,
  windowTo: Date,
  bodyOffsetFromUtc: number,
  s: EngineSettings,
): { from: Date; to: Date } | null {
  const windowMinutes = minutesBetween(windowFrom, windowTo);
  if (windowMinutes <= 0) return null;

  const length = Math.min(s.mainSleepTargetMinutes, windowMinutes);

  // Where does the body think bedtime is, on the night this window covers?
  const bodyFrom = new Date(windowFrom.getTime() + bodyOffsetFromUtc * 60_000);
  const dayStart = Date.UTC(
    bodyFrom.getUTCFullYear(), bodyFrom.getUTCMonth(), bodyFrom.getUTCDate(),
  );
  const idealBodyBed = dayStart + s.preferredBodyBedHour * 3600_000;
  // If the window opens after the ideal bedtime, aim at the following night instead.
  const candidates = [idealBodyBed - 24 * 3600_000, idealBodyBed, idealBodyBed + 24 * 3600_000]
    .map((b) => new Date(b - bodyOffsetFromUtc * 60_000));

  let best: { from: Date; to: Date } | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const from = new Date(
      clamp(c.getTime(), windowFrom.getTime(), windowTo.getTime() - length * 60_000),
    );
    const to = addMinutes(from, length);
    if (to > windowTo) continue;
    // Prefer the placement that lands closest to the body's own bedtime.
    const score = -Math.abs(from.getTime() - c.getTime());
    if (score > bestScore) {
      bestScore = score;
      best = { from, to };
    }
  }
  return best;
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

    const main = placeMainSleep(from, to, bodyOffsetFromUtc, settings);
    if (!main) return;

    const len = minutesBetween(main.from, main.to);
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
      id: `main-${r.next.date}`,
      kind: "main",
      startUtc: main.from.toISOString(),
      endUtc: main.to.toISOString(),
      station: r.prev.endStation,
      why,
      ruleIds: ["far117-sleep-opportunity-8h"],
    });

    // Where the main sleep fell short of the floor and the window still has room
    // before the next report, add a pre-duty nap rather than simply accepting the debt.
    if (len < settings.mainSleepFloorMinutes) {
      const pickup = addMinutes(
        new Date(r.next.reportUtc!), -commuteFor(profile, r.next.station),
      );
      const napEnd = addMinutes(pickup, -settings.napInertiaMinutes);
      const napStart = new Date(
        Math.max(main.to.getTime() + 60 * 60_000, napEnd.getTime() - settings.napCapMinutes * 60_000),
      );
      const napLen = minutesBetween(napStart, napEnd);
      if (napLen >= 30) {
        blocks.push({
          id: `nap-${r.next.date}`,
          kind: "pre-duty-nap",
          startUtc: napStart.toISOString(),
          endUtc: napEnd.toISOString(),
          station: r.next.station,
          why:
            `Only ${formatDuration(len)} of main sleep fits before ${r.next.date}, so this ` +
            `${formatDuration(napLen)} nap takes the edge off. It finishes ` +
            `${formatDuration(settings.napInertiaMinutes)} before you leave so you are not ` +
            `driving on sleep inertia.`,
          ruleIds: ["nap-inertia-gap-45m", "nap-cap-2h"],
        });
      }
    }
  });

  const conflicts: Conflict[] = mandatoryConflicts(duties, profile, pack);

  return { caseId, blocks, conflicts };
}
