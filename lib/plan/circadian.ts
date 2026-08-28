/**
 * Body clock.
 *
 * The whole difficulty of this problem is that a crew member's body is not on the clock
 * the wall says. Fly east and your body is still hours behind local time; it catches up
 * slowly, and faster westward than eastward. So "sleep at 23:00 local" is advice for a
 * body that has been there a week, not one that landed this morning.
 *
 * Phase is tracked as an offset in minutes from BASE local time and adapts toward the
 * station the crew member is actually at, at a bounded rate. It is derived from the
 * roster on every run and never stored: rosters get reissued, and a phase persisted
 * from a month that has since changed is the integral of a history that no longer
 * happened.
 */
import type { Duty, CrewProfile } from "../corpus/schema";
import { tzOf } from "../corpus/network";
import { utcOffsetMinutes, minutesBetween, HOUR } from "../tools/time";

/**
 * How far the body clock shifts per day of exposure to a new time zone. Eastward
 * adaptation is slower than westward — the body finds it easier to stay up late than
 * to fall asleep early. Values are the conventional ~1h/day east, ~1.5h/day west used
 * throughout aviation fatigue guidance.
 */
export const ADAPT_PER_DAY = { east: 60, west: 90 } as const;

export interface PhaseSample {
  atUtc: string;
  /**
   * Minutes the body clock sits ahead of (+) or behind (−) local time at the station
   * the crew member is at. Zero means fully adapted to where they are.
   */
  offsetFromLocalMinutes: number;
  station: string;
}

/**
 * Replay the roster and report the body clock at the start of each rest period.
 *
 * Seeded fully adapted to base, because that is the only defensible starting
 * assumption: the alternative is inventing a history the roster does not contain.
 */
export function phaseTrace(duties: Duty[], profile: CrewProfile): PhaseSample[] {
  const working = duties.filter((d) => d.reportUtc && d.endUtc);
  if (!working.length) return [];

  const baseTz = profile.baseTz;
  // Body clock expressed as an offset from UTC, starting on base time.
  let bodyOffset = utcOffsetMinutes(new Date(working[0].reportUtc!), baseTz);
  let at = new Date(working[0].reportUtc!);
  const out: PhaseSample[] = [];

  for (const duty of working) {
    const end = new Date(duty.endUtc!);
    const station = duty.endStation;
    const localOffset = utcOffsetMinutes(end, tzOf(station));

    // Adapt toward wherever they now are, for however long has passed.
    const days = Math.max(0, minutesBetween(at, end)) / (24 * 60);
    const gap = localOffset - bodyOffset;
    if (gap !== 0) {
      // Moving the body clock forward (later local time, i.e. eastward travel) is the
      // slow direction.
      const rate = gap > 0 ? ADAPT_PER_DAY.east : ADAPT_PER_DAY.west;
      const move = Math.min(Math.abs(gap), rate * days) * Math.sign(gap);
      bodyOffset += move;
    }
    at = end;
    out.push({
      atUtc: end.toISOString(),
      offsetFromLocalMinutes: Math.round(bodyOffset - localOffset),
      station,
    });
  }
  return out;
}

/**
 * The Window of Circadian Low in real time, for a body sitting `bodyOffsetFromUtc`
 * minutes ahead of UTC, on the day containing `around`.
 *
 * WOCL is 02:00–06:00 BODY time (ICAO Doc 9966). Expressing it in local time is the
 * mistake that makes a jet-lagged crew member's plan wrong.
 */
export function woclWindows(
  around: Date,
  bodyOffsetFromUtc: number,
): Array<{ from: Date; to: Date }> {
  const bodyNow = new Date(around.getTime() + bodyOffsetFromUtc * 60_000);
  const dayStart = Date.UTC(
    bodyNow.getUTCFullYear(), bodyNow.getUTCMonth(), bodyNow.getUTCDate(),
  );
  // A sleep beginning at 23:00 body time reaches the circadian low of the FOLLOWING
  // body day, so both candidate nights are returned and the caller takes whichever
  // actually overlaps. Anchoring on the start instant's own day alone reports zero
  // WOCL coverage for exactly the sleeps that cover it best.
  const toReal = (dayOffset: number, h: number) =>
    new Date(dayStart + dayOffset * 24 * HOUR + h * HOUR - bodyOffsetFromUtc * 60_000);
  return [-1, 0, 1].map((d) => ({ from: toReal(d, 2), to: toReal(d, 6) }));
}

/** Minutes of circadian low a block covers, across whichever body night it reaches. */
export function woclCoverageMinutes(
  from: Date,
  to: Date,
  bodyOffsetFromUtc: number,
): number {
  return woclWindows(from, bodyOffsetFromUtc)
    .map((w) => overlapMinutes(from, to, w.from, w.to))
    .reduce((a, b) => a + b, 0);
}

export function overlapMinutes(
  aFrom: Date, aTo: Date, bFrom: Date, bTo: Date,
): number {
  const from = Math.max(aFrom.getTime(), bFrom.getTime());
  const to = Math.min(aTo.getTime(), bTo.getTime());
  return Math.max(0, Math.round((to - from) / 60_000));
}
