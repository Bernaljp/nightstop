/**
 * Duties -> the rows a roster actually prints.
 *
 * Kept separate from PDF drawing so the transcription layer is testable on its own,
 * and so the ground truth and the document can be diffed row by row.
 */
import type { Duty } from "./schema";
import type { ColumnId, FormatSpec } from "./format";
import { formatDate } from "./format";
import { tzOf } from "./network";
import { localDate, localHHmm, formatDuration, minutesBetween } from "../tools/time";

export type PrintRow = Partial<Record<ColumnId, string>> & {
  /** True on the first row of a duty; continuation rows carry the remaining sectors. */
  startsDuty: boolean;
};

/**
 * Render one instant into the cell text a roster would print, honouring the format's
 * time convention and adding a rollover marker where the format uses one.
 */
function timeCell(
  instant: string | null,
  station: string,
  rowDate: string,
  spec: FormatSpec,
): string {
  if (!instant) return "";
  const d = new Date(instant);
  const tz = tzOf(station);
  const local = localHHmm(d, tz);
  const utc = d.toISOString().slice(11, 16);

  let text: string;
  switch (spec.timeConvention) {
    case "local": text = local; break;
    case "utc": text = `${utc}Z`; break;
    case "both": text = `${local}/${utc}Z`; break;
  }
  if (spec.rolloverMarker) {
    const shownDate = spec.timeConvention === "utc" ? d.toISOString().slice(0, 10) : localDate(d, tz);
    if (shownDate > rowDate) text += "+1";
    else if (shownDate < rowDate) text += "-1";
  }
  return text;
}

/**
 * The date a roster prints against a duty, in the convention the document itself uses.
 *
 * A duty is dated by the crew member's base local day, but a UTC-only roster prints
 * times in UTC — so a duty reporting at 22:35 local on the 20th shows a 23:25Z
 * departure that already belongs to the 19th in UTC. Printing the local date beside UTC
 * times produces a document where the date column and the time column disagree, and
 * nothing on the page says which to believe. That is not a hard case; it is an
 * unreadable one, and a corpus should not contain a question with no right answer.
 *
 * So a UTC-only roster dates its rows in UTC, which is what such a roster does in
 * practice.
 */
function rowDateFor(duty: Duty, spec: FormatSpec): string {
  if (spec.timeConvention !== "utc") return duty.date;
  const anchor = duty.reportUtc ?? duty.sectors[0]?.depUtc;
  return anchor ? anchor.slice(0, 10) : duty.date;
}

export function toPrintRows(duties: Duty[], spec: FormatSpec): PrintRow[] {
  const rows: PrintRow[] = [];

  for (const duty of duties) {
    const rowDate = rowDateFor(duty, spec);
    const dateCell = formatDate(rowDate, spec.dateStyle);

    if (duty.sectors.length === 0) {
      // A non-flying duty is one row: the window, and the code that names it.
      const row: PrintRow = { startsDuty: true, date: dateCell, code: duty.code ?? "" };
      if (spec.reportTime === "stated" || duty.kind !== "flight") {
        row.report = timeCell(duty.reportUtc, duty.station, rowDate, spec);
      }
      row.end = timeCell(duty.endUtc, duty.endStation, rowDate, spec);
      row.origin = duty.station;
      row.dest = duty.endStation;
      row.route = duty.kind === "off" ? "" : `${duty.station}-${duty.endStation}`;
      if (duty.reportUtc && duty.endUtc) {
        row.duty = formatDuration(minutesBetween(new Date(duty.reportUtc), new Date(duty.endUtc)));
      }
      rows.push(row);
      continue;
    }

    duty.sectors.forEach((s, i) => {
      const first = i === 0;
      const last = i === duty.sectors.length - 1;
      const row: PrintRow = { startsDuty: first };

      // The continuation-row quirk: only the first row of a duty carries the date.
      row.date = first || spec.continuationRows === "dated" ? dateCell : "";

      if (first && spec.reportTime === "stated") {
        row.report = timeCell(duty.reportUtc, duty.station, rowDate, spec);
      }
      // Duty end prints on the LAST row of the duty, which is where rosters put it
      // and which is what makes an undated continuation row load-bearing.
      if (last) row.end = timeCell(duty.endUtc, duty.endStation, rowDate, spec);

      row.code = "";
      row.flightNo = s.flightNo;
      row.origin = s.origin;
      row.dest = s.dest;
      row.route = `${s.origin}-${s.dest}`;
      row.dep = timeCell(s.depUtc, s.origin, rowDate, spec);
      row.arr = timeCell(s.arrUtc, s.dest, rowDate, spec);
      row.block = formatDuration(minutesBetween(new Date(s.depUtc), new Date(s.arrUtc)));
      if (last && duty.reportUtc && duty.endUtc) {
        row.duty = formatDuration(minutesBetween(new Date(duty.reportUtc), new Date(duty.endUtc)));
      }
      if (last && duty.endStation !== spec.operator.base) row.layover = duty.endStation;
      row.equip = "";
      rows.push(row);
    });
  }
  return rows;
}

/** Header totals, computed from the duties so they always reconcile with the table. */
export interface RosterTotals {
  blockMinutes: number;
  daysOff: number;
  standbyDays: number;
  nightstops: number;
}

export function computeTotals(duties: Duty[], base: string): RosterTotals {
  let blockMinutes = 0;
  let daysOff = 0;
  let standbyDays = 0;
  let nightstops = 0;
  for (const d of duties) {
    for (const s of d.sectors) {
      blockMinutes += minutesBetween(new Date(s.depUtc), new Date(s.arrUtc));
    }
    if (d.kind === "off") daysOff++;
    if (d.kind === "standby") standbyDays++;
    if (d.endStation !== base && d.kind === "flight") nightstops++;
  }
  return { blockMinutes, daysOff, standbyDays, nightstops };
}
