/**
 * Generates a plausible month of duty for a fictional operator.
 *
 * The shapes here are the ones any line pilot would recognise — short-haul days of
 * two to four sectors out and back from base, long-haul trips with a layover, blocks
 * of standby, training days, and days off in clumps. Nothing is modelled on a real
 * operator's published roster.
 *
 * The generator deliberately plants *tight* rest periods at a controlled rate. Those
 * are what create the rule conflicts the reviewer has to surface, so the corpus needs
 * them to exist rather than hoping they appear by chance.
 */
import { Rng } from "./rng";
import { blockMinutes, hasRoute, tzOf } from "./network";
import type { Duty, Sector } from "./schema";
import {
  addDays,
  addMinutes,
  dateRange,
  localDate,
  localToUtc,
  minutesBetween,
} from "../tools/time";

export interface OperatorProfile {
  /** Invented airline name. */
  name: string;
  /** Two letters used to build flight numbers. */
  prefix: string;
  base: string;
  shortHaul: string[];
  longHaul: string[];
  mix: "short" | "long" | "mixed";
  /** Minutes before first-sector departure that report falls. */
  reportOffset: { short: number; long: number };
  /** Minutes after last-sector arrival that duty ends. */
  debriefMinutes: number;
  /** Codes the operator prints for non-flying duties. */
  codes: { standby: string; training: string; off: string; positioning: string };
  /**
   * Minutes of rest the scheduler leaves between duties. `tight` is deliberately
   * short — legal-looking but uncomfortable — because those are the rest periods
   * that force a rule conflict, and the corpus needs them to exist on purpose
   * rather than by accident.
   */
  minRest: { normal: number; tight: number };
}

interface GenState {
  station: string;
  /** Instant the crew member became free after the last duty. */
  freeAt: Date;
  duties: Duty[];
  seq: number;
}

const MORNING_REPORTS = ["04:35", "05:05", "05:40", "06:10"];
const AFTERNOON_REPORTS = ["12:20", "13:15", "14:40", "15:25"];
const LONGHAUL_DEPS = ["10:15", "12:40", "16:05", "18:30", "21:50", "23:10"];

function mkId(date: string, seq: number): string {
  return `${date}-${String(seq).padStart(2, "0")}`;
}

/**
 * Find the first date on or after `date` where `localTime` in `tz` falls at or after
 * `notBefore`. Returns null if it cannot be placed within `maxDays`.
 *
 * This is what stops the generator producing a roster no human could fly. Without it
 * a long-haul inbound that lands the following morning gets a duty scheduled on top
 * of it, and every downstream rest calculation goes negative.
 */
function placeOnOrAfter(
  date: string,
  localTime: string,
  tz: string,
  notBefore: Date,
  maxDays = 4,
): { date: string; instant: Date } | null {
  for (let i = 0; i <= maxDays; i++) {
    const d = addDays(date, i);
    const inst = localToUtc(`${d}T${localTime}`, tz).utc;
    if (inst >= notBefore) return { date: d, instant: inst };
  }
  return null;
}

function flightNo(op: OperatorProfile, rng: Rng): string {
  return `${op.prefix}${rng.int(100, 899)}`;
}

/** A day of short-haul flying: out-and-back pairs from base. */
function shortHaulDay(
  op: OperatorProfile,
  date: string,
  rng: Rng,
  st: GenState,
  tight: boolean,
): Duty | null {
  const baseTz = tzOf(op.base);
  const reportLocal = tight
    ? MORNING_REPORTS[0]
    : rng.pick(rng.chance(0.6) ? MORNING_REPORTS : AFTERNOON_REPORTS);
  // A tight day is scheduled hard against the rest floor rather than at one of the
  // operator's usual report windows. Airlines really do this, and it is the only way
  // to guarantee the corpus contains rest periods short enough to force a conflict —
  // waiting for one to appear by chance never worked.
  let report: Date;
  if (tight) {
    const floor = addMinutes(st.freeAt, op.minRest.tight);
    // Round up to the next five minutes; rosters do not print odd minutes.
    const rounded = new Date(Math.ceil(floor.getTime() / (5 * 60000)) * 5 * 60000);
    report = rounded;
    date = localDate(report, baseTz);
  } else {
    const placed = placeOnOrAfter(
      date, reportLocal, baseTz, addMinutes(st.freeAt, op.minRest.normal),
    );
    if (!placed) return null;
    date = placed.date;
    report = placed.instant;
  }

  const sectors: Sector[] = [];
  let cursor = addMinutes(report, op.reportOffset.short);
  const legs = rng.int(1, 2); // out-and-back pairs
  for (let i = 0; i < legs; i++) {
    const dest = rng.pick(op.shortHaul.filter((d) => hasRoute(op.base, d)));
    const out = blockMinutes(op.base, dest);
    const dep = cursor;
    const arr = addMinutes(dep, out);
    sectors.push({
      flightNo: flightNo(op, rng),
      origin: op.base,
      dest,
      depUtc: dep.toISOString(),
      arrUtc: arr.toISOString(),
    });
    const turn = rng.int(40, 65);
    const dep2 = addMinutes(arr, turn);
    const arr2 = addMinutes(dep2, out);
    sectors.push({
      flightNo: flightNo(op, rng),
      origin: dest,
      dest: op.base,
      depUtc: dep2.toISOString(),
      arrUtc: arr2.toISOString(),
    });
    cursor = addMinutes(arr2, rng.int(45, 70));
  }

  const last = sectors[sectors.length - 1];
  const end = addMinutes(new Date(last.arrUtc), op.debriefMinutes);
  st.station = op.base;
  st.freeAt = end;
  return {
    id: mkId(date, st.seq++),
    date,
    kind: "flight",
    station: op.base,
    endStation: op.base,
    reportUtc: report.toISOString(),
    endUtc: end.toISOString(),
    sectors,
  };
}

/** Out to a long-haul destination, layover, and back. Returns one duty per direction. */
function longHaulTrip(
  op: OperatorProfile,
  date: string,
  rng: Rng,
  st: GenState,
  layoverNights: number,
): Duty[] | null {
  const baseTz = tzOf(op.base);
  const dest = rng.pick(op.longHaul.filter((d) => hasRoute(op.base, d)));
  const block = blockMinutes(op.base, dest);

  const depLocal = rng.pick(LONGHAUL_DEPS);
  const notBefore = addMinutes(st.freeAt, op.minRest.normal + op.reportOffset.long);
  const placedOut = placeOnOrAfter(date, depLocal, baseTz, notBefore);
  if (!placedOut) return null;
  date = placedOut.date;
  const dep = placedOut.instant;
  const report = addMinutes(dep, -op.reportOffset.long);
  const arr = addMinutes(dep, block);
  const outEnd = addMinutes(arr, op.debriefMinutes);

  const outbound: Duty = {
    id: mkId(date, st.seq++),
    date,
    kind: "flight",
    station: op.base,
    endStation: dest,
    reportUtc: report.toISOString(),
    endUtc: outEnd.toISOString(),
    sectors: [
      {
        flightNo: flightNo(op, rng),
        origin: op.base,
        dest,
        depUtc: dep.toISOString(),
        arrUtc: arr.toISOString(),
      },
    ],
  };

  // The return departs after the layover, at a local hour that makes sense there.
  const destTz = tzOf(dest);
  const retLocal = rng.pick(LONGHAUL_DEPS);
  const layoverFloor = addMinutes(outEnd, op.minRest.normal + op.reportOffset.long);
  const placedRet = placeOnOrAfter(
    addDays(date, layoverNights), retLocal, destTz, layoverFloor,
  );
  if (!placedRet) return null;
  const retDate = placedRet.date;
  const rdep = placedRet.instant;
  const rarr = addMinutes(rdep, block);
  const rReport = addMinutes(rdep, -op.reportOffset.long);
  const retEnd = addMinutes(rarr, op.debriefMinutes);

  const inbound: Duty = {
    id: mkId(retDate, st.seq++),
    date: retDate,
    kind: "flight",
    station: dest,
    endStation: op.base,
    reportUtc: rReport.toISOString(),
    endUtc: retEnd.toISOString(),
    sectors: [
      {
        flightNo: flightNo(op, rng),
        origin: dest,
        dest: op.base,
        depUtc: rdep.toISOString(),
        arrUtc: rarr.toISOString(),
      },
    ],
  };

  st.station = op.base;
  st.freeAt = retEnd;
  return [outbound, inbound];
}

function windowDuty(
  op: OperatorProfile,
  date: string,
  kind: "standby" | "training",
  rng: Rng,
  st: GenState,
): Duty | null {
  const tz = tzOf(op.base);
  const startLocal = kind === "standby" ? rng.pick(["05:00", "06:00", "13:00", "14:00"]) : "08:00";
  const hours = kind === "standby" ? rng.int(6, 10) : 8;
  const placed = placeOnOrAfter(
    date, startLocal, tz, addMinutes(st.freeAt, op.minRest.normal),
  );
  if (!placed) return null;
  date = placed.date;
  const start = placed.instant;
  const end = addMinutes(start, hours * 60);
  st.station = op.base;
  st.freeAt = end;
  return {
    id: mkId(date, st.seq++),
    date,
    kind,
    code: kind === "standby" ? op.codes.standby : op.codes.training,
    station: op.base,
    endStation: op.base,
    reportUtc: start.toISOString(),
    endUtc: end.toISOString(),
    sectors: [],
  };
}

function dayOff(op: OperatorProfile, date: string, st: GenState): Duty {
  return {
    id: mkId(date, st.seq++),
    date,
    kind: "off",
    code: op.codes.off,
    station: op.base,
    endStation: op.base,
    reportUtc: null,
    endUtc: null,
    sectors: [],
  };
}

/**
 * Build a month. `tightRestRate` is the probability that a duty block is scheduled
 * hard against the previous one, which is what plants the rule conflicts.
 */
export function generateMonth(
  op: OperatorProfile,
  from: string,
  to: string,
  rng: Rng,
  tightRestRate = 0.35,
  /**
   * How the roster dates its rows. A UTC-only document dates by UTC day, because
   * printing a local date beside UTC times gives a page whose date column and time
   * column disagree with nothing to say which is right.
   *
   * This has to be applied BEFORE days off are filled in: a duty that moves onto the
   * next day would otherwise land on top of a day off already placed there, and the
   * roster would print two rows for one date that no real roster would.
   */
  dateBy: "local" | "utc" = "local",
): Duty[] {
  const st: GenState = {
    station: op.base,
    freeAt: localToUtc(`${from}T00:00`, tzOf(op.base)).utc,
    duties: [],
    seq: 1,
  };

  let date = from;
  while (date <= to) {
    const tight = rng.chance(tightRestRate);
    const roll = rng.next();

    // Weight the block type by what kind of flying this operator does.
    const wantLong =
      op.mix === "long" ? roll < 0.55 : op.mix === "mixed" ? roll < 0.3 : false;

    if (wantLong && addDays(date, 3) <= to) {
      const nights = rng.int(1, 2);
      const trip = longHaulTrip(op, date, rng, st, nights);
      if (!trip) { date = addDays(date, 1); continue; }
      st.duties.push(...trip);
      // Days between the two duties are part of the trip, not days off.
      date = addDays(trip[1].date, 1);
    } else if (roll < 0.62) {
      const days = rng.int(1, op.mix === "short" ? 4 : 2);
      for (let i = 0; i < days && date <= to; i++) {
        const d = shortHaulDay(op, date, rng, st, tight && i < 2);
        if (!d) { date = addDays(date, 1); continue; }
        st.duties.push(d);
        date = addDays(d.date, 1);
      }
    } else if (roll < 0.72) {
      const days = rng.int(1, 2);
      for (let i = 0; i < days && date <= to; i++) {
        const d = windowDuty(op, date, "standby", rng, st);
        if (!d) { date = addDays(date, 1); continue; }
        st.duties.push(d);
        date = addDays(d.date, 1);
      }
    } else if (roll < 0.78) {
      const d = windowDuty(op, date, "training", rng, st);
      if (!d) { date = addDays(date, 1); continue; }
      st.duties.push(d);
      date = addDays(d.date, 1);
    } else {
      const days = rng.int(2, 4);
      for (let i = 0; i < days && date <= to; i++) {
        st.duties.push(dayOff(op, date, st));
        date = addDays(date, 1);
      }
    }
  }

  if (dateBy === "utc") {
    for (const d of st.duties) {
      const anchor = d.reportUtc ?? d.sectors[0]?.depUtc;
      if (anchor) d.date = anchor.slice(0, 10);
    }
  }

  // Normalise into what a roster actually prints: every date in the covered period
  // appears exactly once unless real flying puts two duties on it, a day off never
  // shares a date with a duty, and duplicate day-off rows collapse. The walk can
  // reach the same date twice when a placement slips forward, so this is a repair
  // step rather than an assertion.
  const byDate = new Map<string, Duty[]>();
  for (const d of st.duties) {
    if (!byDate.has(d.date)) byDate.set(d.date, []);
    byDate.get(d.date)!.push(d);
  }

  // A date with no duty is a day off WHERE THE CREW MEMBER ACTUALLY IS, which is not
  // necessarily home. Fly MAD-ORD on the 1st and the 2nd is spent in Chicago; recording
  // it as a day off at base is wrong about the time zone they will be sleeping in,
  // which is the one thing this whole system exists to get right.
  const out: Duty[] = [];
  let position = op.base;
  for (const cur of dateRange(from, to)) {
    const here = byDate.get(cur) ?? [];
    const real = here.filter((d) => d.kind !== "off");
    if (real.length) {
      real.sort((a, b) => (a.reportUtc ?? "").localeCompare(b.reportUtc ?? ""));
      out.push(...real);
      position = real[real.length - 1].endStation;
    } else {
      out.push({
        id: "",
        date: cur,
        kind: "off",
        code: op.codes.off,
        station: position,
        endStation: position,
        reportUtc: null,
        endUtc: null,
        sectors: [],
      });
    }
  }

  return out.map((d, i) => ({ ...d, id: mkId(d.date, i + 1) }));
}

/** Minutes between the end of one duty and the report of the next. */
export function restMinutes(prev: Duty, next: Duty): number | null {
  if (!prev.endUtc || !next.reportUtc) return null;
  return minutesBetween(new Date(prev.endUtc), new Date(next.reportUtc));
}
