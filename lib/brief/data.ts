/**
 * Turns a plan into the rows a briefing renders.
 *
 * ONE TIMEZONE DRAWS THE GRID. Every span is positioned in the crew member's base time,
 * and the times written on it are local to wherever they will be.
 *
 * The first version placed each span in its own station's timezone, which reads well
 * until a westbound duty and the sleep after it land on the same column: the Madrid–JFK
 * sector was drawn ending at 21:10 (Madrid) and the sleep in New York starting at 19:56
 * (New York), so the picture showed a crew member asleep an hour and a half before they
 * landed. Nothing was wrong with the plan. A calendar drawn in more than one timezone at
 * once will eventually draw two things overlapping that never overlapped, and on this
 * particular calendar that is the one mistake it must not make.
 *
 * So the geometry comes from a single clock, and the label on each block carries the
 * local time — with the station in front of it whenever that is a different clock from
 * the one the grid is on.
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
  /** The clock the grid is drawn on, named for the reader. */
  gridStation: string;
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
  tz: string,
  label: string,
  title: string,
): void {
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
  const gridTz = profile.baseTz || tzOf(profile.base);
  /** The local clock at a station, and whether it differs from the one the grid uses. */
  const away = (station: string) => tzOf(station) !== gridTz;
  const at = (instant: Date, station: string) => localHHmm(instant, tzOf(station));

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
    const end = new Date(d.endUtc!);
    const drift = phase.offsetFromLocalMinutes;
    // Body clock as an offset from UTC, so the low becomes two real instants rather than
    // a fraction of somebody's local day. Positioned like everything else, it can no
    // longer drift out of step with the blocks drawn over it.
    const bodyOffset = utcOffsetMinutes(end, tzOf(d.endStation)) + drift;
    const body = new Date(end.getTime() + bodyOffset * 60_000);
    const bodyMidnight = Date.UTC(body.getUTCFullYear(), body.getUTCMonth(), body.getUTCDate());
    const from = new Date(bodyMidnight + 2 * 60 * 60_000 - bodyOffset * 60_000);
    addSpan(
      rows, "wocl", from.toISOString(), new Date(from.getTime() + 4 * 60 * 60_000).toISOString(),
      gridTz, "",
      `Your circadian low, 02:00–06:00 body time` +
        (Math.abs(drift) >= 45
          ? ` — about ${formatDuration(Math.abs(drift))} ${drift > 0 ? "later" : "earlier"} than the local clock, because your body has not caught up yet.`
          : "."),
    );
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
      rows, "duty", d.reportUtc, d.endUtc, gridTz, label,
      `On duty ${at(new Date(d.reportUtc), d.station)} ${d.station} → ` +
        `${at(new Date(d.endUtc), d.endStation)} ${d.endStation} · ${label}`,
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
    const clock = `${localHHmm(new Date(b.startUtc), tz)}–${localHHmm(new Date(b.endUtc), tz)}`;
    // Away from base the block sits on the grid at base time but reads in local time, so
    // the station goes in front of the hours. Without it the chip says 17:41 while sitting
    // at midnight on the axis, and the reader has no way to know which one to believe.
    const label = away(b.station) ? `${b.station} ${clock}` : clock;
    addSpan(rows, b.kind, b.startUtc, b.endUtc, gridTz, label, b.why);
    const row = rows.get(localDate(new Date(b.startUtc), gridTz));
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
    gridStation: profile.base,
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
