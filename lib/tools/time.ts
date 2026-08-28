/**
 * Timezone and duration arithmetic.
 *
 * This exists so no model ever has to do date maths in its head. Every offset comes
 * from the IANA database via Intl, so DST transitions are handled by the platform
 * rather than by a table someone has to remember to update.
 */

/** Minutes east of UTC for `tz` at the given instant. Negative west of Greenwich. */
export function utcOffsetMinutes(instantUtc: Date, tz: string): number {
  // Format the instant in the target zone, read the wall-clock back, and diff.
  // `en-CA` gives YYYY-MM-DD, which parses unambiguously.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instantUtc)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  // `hour` can come back as "24" at midnight in some ICU versions.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asIfUtc - instantUtc.getTime()) / 60000);
}

/**
 * Turn a local wall-clock reading in `tz` into an absolute instant.
 *
 * Ambiguity is real and must not be papered over: during a spring-forward gap the
 * reading names no instant, and during an autumn fall-back overlap it names two.
 * We resolve by taking the offset that round-trips, preferring the earlier instant
 * on an overlap, and report which case we hit so callers can flag it.
 */
export function localToUtc(
  localIso: string, // "YYYY-MM-DDTHH:mm"
  tz: string,
): { utc: Date; ambiguous: boolean; nonexistent: boolean } {
  const [datePart, timePart] = localIso.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);

  // Probe the offset from instants either side of the reading. A transition inside
  // that window is exactly what makes a reading ambiguous or nonexistent, and a
  // single probe at the naive instant lands on only one side of it.
  const probes = [naive - 12 * HOUR, naive, naive + 12 * HOUR];
  const offsets = [
    ...new Set(probes.map((t) => utcOffsetMinutes(new Date(t), tz))),
  ];

  const roundTrips = (cand: Date) =>
    cand.getTime() + utcOffsetMinutes(cand, tz) * 60000 === naive;

  const unique = [
    ...new Set(
      offsets
        .map((off) => new Date(naive - off * 60000))
        .filter(roundTrips)
        .map((c) => c.getTime()),
    ),
  ].sort((a, b) => a - b);

  if (unique.length === 0) {
    // Spring-forward gap: the reading names no instant. Return the post-transition
    // instant so callers get something usable, but say so.
    const fallback = new Date(naive - Math.min(...offsets) * 60000);
    return { utc: fallback, ambiguous: false, nonexistent: true };
  }
  return {
    utc: new Date(unique[0]),
    ambiguous: unique.length > 1,
    nonexistent: false,
  };
}

/** Wall-clock reading in `tz` for an instant, as "YYYY-MM-DDTHH:mm". */
export function utcToLocal(instantUtc: Date, tz: string): string {
  const off = utcOffsetMinutes(instantUtc, tz);
  const shifted = new Date(instantUtc.getTime() + off * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** "HH:mm" in `tz`. */
export function localHHmm(instantUtc: Date, tz: string): string {
  return utcToLocal(instantUtc, tz).slice(11, 16);
}

/** "YYYY-MM-DD" in `tz`. */
export function localDate(instantUtc: Date, tz: string): string {
  return utcToLocal(instantUtc, tz).slice(0, 10);
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;

export function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * MIN);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MIN);
}

/** "7h20" — how crew write durations, and how they read back fastest. */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(minutes);
  return `${sign}${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** Add whole days to a YYYY-MM-DD string without touching timezones. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 24 * HOUR;
  return new Date(t).toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD between two dates. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
