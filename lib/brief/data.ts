/**
 * Turns a plan into the rows a briefing renders.
 *
 * ONE CLOCK, FOR EVERYTHING. Position on the grid, the hours written on each block, the
 * day-by-day table: all of it in a single timezone, the crew member's base by default and
 * any station on the roster if they choose one. Nothing in the view is ever in a second
 * zone.
 *
 * It took two goes to get here, and both failures are worth keeping written down. The
 * first version placed each span in its OWN station's timezone, which reads well until a
 * westbound duty and the sleep after it land on the same column: the Madrid–JFK sector
 * was drawn ending at 21:10 (Madrid) and the sleep in New York starting at 19:56 (New
 * York), so the picture showed a crew member asleep an hour and a half before they landed.
 * The second version fixed the geometry but kept station-local times in the labels, so a
 * block sitting at 00:41 on the axis was captioned "ORD 17:41" — the same mistake, moved
 * from the geometry into the text, and just as unreadable.
 *
 * The rule that holds is simpler than either attempt: a view has one clock. Where the
 * reader needs another, they change the clock for the whole view, and the station stays
 * on the block as a PLACE — never as a second set of hours.
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

/** A clock the whole view can be drawn on. */
export interface Zone {
  /** IANA name, e.g. "Europe/Madrid". */
  tz: string;
  /** What to call it: a station code, or UTC. */
  label: string;
}

export interface BriefData {
  operator: string;
  from: string;
  to: string;
  base: string;
  /** The single clock every time in this data is written on. */
  zone: Zone;
  /** The clocks a reader can switch to: base first, then every station visited, then UTC. */
  zones: Zone[];
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
  /** Which clock to draw the whole view on. Defaults to home. */
  viewTz?: string,
): BriefData {
  const homeTz = profile.baseTz || tzOf(profile.base);

  // Every station the roster touches, base first, then UTC. These are the clocks a reader
  // may switch the WHOLE view to; there is no way to ask for two of them at once.
  const zones: Zone[] = [];
  const addZone = (label: string, tz: string) => {
    if (!zones.some((z) => z.tz === tz)) zones.push({ label, tz });
  };
  addZone(profile.base, homeTz);
  for (const d of duties) {
    for (const st of [d.station, d.endStation]) {
      if (st) addZone(st, tzOf(st));
    }
  }
  addZone("UTC", "UTC");

  const tz = zones.some((z) => z.tz === viewTz) ? viewTz! : homeTz;
  const zone = zones.find((z) => z.tz === tz)!;
  const hhmm = (instant: Date) => localHHmm(instant, tz);
  const range = (a: string, b: string) => `${hhmm(new Date(a))}–${hhmm(new Date(b))}`;

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
      tz, "",
      `Your circadian low, 02:00–06:00 body time` +
        (Math.abs(drift) >= 45
          ? ` — about ${formatDuration(Math.abs(drift))} ${drift > 0 ? "later" : "earlier"} than the local clock, because your body has not caught up yet.`
          : "."),
    );
  }

  for (const d of duties) {
    if (!d.reportUtc || !d.endUtc) continue;
    // `sectors` is absent on plenty of real model output, including for duties it
    // labelled "flight". Reading it unguarded threw after a plan had already rendered.
    const sectors = Array.isArray(d.sectors) ? d.sectors : [];
    const label =
      d.kind === "flight" && sectors.length
        ? sectors.map((s) => `${s.origin}–${s.dest}`).join(" ")
        : d.kind;
    // The station codes are places, and they stay. The hours are the view's hours.
    addSpan(
      rows, "duty", d.reportUtc, d.endUtc, tz, label,
      `On duty ${range(d.reportUtc, d.endUtc)} ${zone.label} time · ` +
        `${d.station} → ${d.endStation} · ${label}`,
    );
    const row = rows.get(localDate(new Date(d.reportUtc), tz));
    if (row) row.dutyText = `${range(d.reportUtc, d.endUtc)} ${label}`;
  }

  let totalSleep = 0;
  let shortest = Infinity;
  for (const b of plan.blocks) {
    const mins = minutesBetween(new Date(b.startUtc), new Date(b.endUtc));
    totalSleep += mins;
    if (b.kind === "main") shortest = Math.min(shortest, mins);
    const label = range(b.startUtc, b.endUtc);
    // The station rides along as a place, never as a second set of hours.
    const where = tzOf(b.station) === tz ? "" : ` · you are at ${b.station}`;
    addSpan(rows, b.kind, b.startUtc, b.endUtc, tz, label, `${label} ${zone.label} time${where}. ${b.why}`);
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
    zone,
    zones,
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
