/**
 * Turns a plan into the rows a briefing renders.
 *
 * Everything a crew member reads is anchored to LOCAL time at the station they are
 * actually at — that is the clock they will look at. The body clock still drives where
 * sleep was placed and why, and it is stated in words where it differs, but nobody
 * plans their evening in UTC.
 */
import type { Duty, CrewProfile } from "../corpus/schema";
import type { SleepPlan, Conflict } from "../plan/schema";
import { phaseTrace } from "../plan/circadian";
import { tzOf } from "../corpus/network";
import {
  dateRange, localHHmm, localDate, minutesBetween, formatDuration, utcOffsetMinutes,
} from "../tools/time";

export interface Span {
  kind: "duty" | "main" | "pre-duty-nap" | "recovery-nap" | "wocl";
  /** Fraction of the day, 0-1, clipped to this row. */
  from: number;
  to: number;
  label: string;
  title: string;
}

export interface DayRow {
  date: string;
  station: string;
  /** Weekday initial, for the left gutter. */
  dow: string;
  spans: Span[];
  dutyText: string;
  sleepText: string;
}

export interface BriefData {
  operator: string;
  from: string;
  to: string;
  base: string;
  days: DayRow[];
  conflicts: { hard: Conflict[]; recommended: Conflict[]; preference: Conflict[] };
  derivations: NonNullable<SleepPlan["derivations"]>;
  uncertainties: string[];
  stats: {
    nights: number;
    dutyDays: number;
    daysOff: number;
    totalSleepMinutes: number;
    shortestSleepMinutes: number;
  };
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

/** Fraction of a local day, clipped to [0,1], for an instant at a station. */
function dayFraction(instant: Date, date: string, tz: string): number | null {
  const d = localDate(instant, tz);
  if (d < date) return 0;
  if (d > date) return 1;
  const hhmm = localHHmm(instant, tz);
  return (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) / 1440;
}

function addSpan(
  rows: Map<string, DayRow>,
  kind: Span["kind"],
  startUtc: string,
  endUtc: string,
  station: string,
  label: string,
  title: string,
): void {
  const tz = tzOf(station);
  const a = new Date(startUtc);
  const b = new Date(endUtc);
  // A block crossing local midnight is drawn on both days rather than wrapping.
  for (const date of dateRange(localDate(a, tz), localDate(b, tz))) {
    const row = rows.get(date);
    if (!row) continue;
    const from = dayFraction(a, date, tz) ?? 0;
    const to = dayFraction(b, date, tz) ?? 1;
    if (to - from < 0.004) continue;
    row.spans.push({ kind, from, to, label, title });
  }
}

export function buildBriefData(
  operator: string,
  duties: Duty[],
  profile: CrewProfile,
  plan: SleepPlan,
  covered: { from: string; to: string },
): BriefData {
  const rows = new Map<string, DayRow>();
  for (const date of dateRange(covered.from, covered.to)) {
    const d = duties.find((x) => x.date === date);
    const station = d?.station ?? profile.base;
    rows.set(date, {
      date,
      station,
      dow: DOW[new Date(`${date}T12:00:00Z`).getUTCDay()],
      spans: [],
      dutyText: "",
      sleepText: "",
    });
  }

  // Circadian low, shaded per day from the body clock rather than the wall clock.
  const phases = phaseTrace(duties, profile);
  for (const [i, d] of duties.filter((x) => x.endUtc).entries()) {
    const phase = phases[i];
    if (!phase) continue;
    const tz = tzOf(d.endStation);
    const drift = phase.offsetFromLocalMinutes;
    const woclLocalStart = (2 * 60 - drift + 1440) % 1440;
    const row = rows.get(localDate(new Date(d.endUtc!), tz));
    if (!row) continue;
    row.spans.push({
      kind: "wocl",
      from: woclLocalStart / 1440,
      to: Math.min(1, (woclLocalStart + 240) / 1440),
      label: "",
      title:
        `Your circadian low, 02:00–06:00 body time` +
        (Math.abs(drift) >= 45
          ? ` — about ${formatDuration(Math.abs(drift))} ${drift > 0 ? "later" : "earlier"} than the local clock, because your body has not caught up yet.`
          : "."),
    });
  }

  for (const d of duties) {
    if (!d.reportUtc || !d.endUtc) continue;
    const tz = tzOf(d.station);
    // `sectors` is absent on plenty of real model output, including for duties it
    // labelled "flight". Reading it unguarded threw after a plan had already rendered.
    const sectors = Array.isArray(d.sectors) ? d.sectors : [];
    const label =
      d.kind === "flight" && sectors.length
        ? sectors.map((s) => `${s.origin}–${s.dest}`).join(" ")
        : d.kind;
    addSpan(
      rows, "duty", d.reportUtc, d.endUtc, d.station, label,
      `On duty ${localHHmm(new Date(d.reportUtc), tz)} → ` +
        `${localHHmm(new Date(d.endUtc), tzOf(d.endStation))} · ${label}`,
    );
    const row = rows.get(d.date);
    if (row) {
      row.dutyText =
        `${localHHmm(new Date(d.reportUtc), tz)}–` +
        `${localHHmm(new Date(d.endUtc), tzOf(d.endStation))} ${label}`;
    }
  }

  let totalSleep = 0;
  let shortest = Infinity;
  for (const b of plan.blocks) {
    const mins = minutesBetween(new Date(b.startUtc), new Date(b.endUtc));
    totalSleep += mins;
    if (b.kind === "main") shortest = Math.min(shortest, mins);
    const tz = tzOf(b.station);
    const label = `${localHHmm(new Date(b.startUtc), tz)}–${localHHmm(new Date(b.endUtc), tz)}`;
    addSpan(rows, b.kind, b.startUtc, b.endUtc, b.station, label, b.why);
    const row = rows.get(localDate(new Date(b.startUtc), tz));
    if (row) {
      row.sleepText = [row.sleepText, `${label} (${formatDuration(mins)})`]
        .filter(Boolean)
        .join(" + ");
    }
  }

  // Draw the shading first so blocks sit on top of it.
  for (const row of rows.values()) {
    row.spans.sort((a, b) => (a.kind === "wocl" ? -1 : b.kind === "wocl" ? 1 : 0));
  }

  const by = (h: string) => plan.conflicts.filter((c) => c.hardness === h);
  return {
    operator,
    from: covered.from,
    to: covered.to,
    base: profile.base,
    days: [...rows.values()],
    conflicts: {
      hard: by("hard-limit"),
      recommended: by("recommendation"),
      preference: by("preference"),
    },
    derivations: plan.derivations ?? [],
    uncertainties: plan.readingUncertainties ?? [],
    stats: {
      nights: plan.blocks.filter((b) => b.kind === "main").length,
      dutyDays: duties.filter((d) => d.reportUtc).length,
      daysOff: duties.filter((d) => d.kind === "off").length,
      totalSleepMinutes: totalSleep,
      shortestSleepMinutes: shortest === Infinity ? 0 : shortest,
    },
  };
}
