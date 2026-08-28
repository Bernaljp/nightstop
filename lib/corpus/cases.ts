/**
 * The evaluation corpus.
 *
 * Eight development cases, each exercising one documented presentational difference
 * between crew-planning system outputs. Four held-out cases are defined separately and
 * generated only once the agent prompts and skills are frozen — see
 * docs/eval-preregistration.md.
 *
 * Every airline here is invented.
 */
import type { OperatorProfile } from "./months";
import type { FormatSpec } from "./format";

const EU_SHORT = ["BCN", "LIS", "CDG", "LHR", "FCO", "FRA", "DUB", "ARN"];
const EU_LONG = ["JFK", "BOS", "ORD", "GRU", "BOG", "LAX", "DXB", "SIN"];

function op(
  name: string,
  prefix: string,
  base: string,
  mix: OperatorProfile["mix"],
  over: Partial<OperatorProfile> = {},
): OperatorProfile {
  return {
    name,
    prefix,
    base,
    shortHaul: EU_SHORT.filter((s) => s !== base),
    longHaul: EU_LONG.filter((s) => s !== base),
    mix,
    reportOffset: { short: 60, long: 90 },
    debriefMinutes: 30,
    codes: { standby: "SBY", training: "SIM", off: "OFF", positioning: "DHD" },
    minRest: { normal: 12 * 60, tight: 10 * 60 },
    ...over,
  };
}

const SEP = { coveredFrom: "2026-09-01", coveredTo: "2026-09-30" };

export const DEV_CASES: FormatSpec[] = [
  {
    caseId: "d01-aurora",
    operator: op("AURORA AIRLINES", "AU", "MAD", "short"),
    crewRef: "AU-40118", rank: "CP/A320",
    language: "en", dateStyle: "dmy", timeConvention: "local",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "block", "end", "duty"],
    legend: "inline", pages: 1, headerTotals: true, ...SEP,
    quirks: ["clean-tabular"],
    intent:
      "The easy case. Everything is stated: dates on every row, report time printed, " +
      "local times, a rollover marker, and header totals that reconcile. If a system " +
      "cannot read this one, nothing else it does matters.",
  },
  {
    caseId: "d02-meridian",
    operator: op("MERIDIAN LINEAS AEREAS", "MD", "MAD", "short", {
      codes: { standby: "RES", training: "ENT", off: "LIB", positioning: "TRA" },
    }),
    crewRef: "MD-22740", rank: "CM/A321",
    language: "es", dateStyle: "dmy", timeConvention: "local",
    reportTime: "stated", continuationRows: "undated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "origin", "dest", "dep", "arr", "block", "end", "duty"],
    legend: "block", pages: 1, headerTotals: true, ...SEP,
    quirks: ["spanish", "undated-continuation-rows", "non-english-codes"],
    intent:
      "Spanish labels and codes, and sectors after the first carry no date. A reader " +
      "that keys on the date column alone will merge or split duties wrongly.",
  },
  {
    caseId: "d03-polaris",
    operator: op("POLARIS WORLD", "PW", "LHR", "long"),
    crewRef: "PW-77031", rank: "CP/B789",
    language: "en", dateStyle: "ymd", timeConvention: "utc",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "block", "end", "layover"],
    legend: "inline", pages: 1, headerTotals: true, ...SEP,
    quirks: ["utc-only", "long-haul", "layover-column"],
    intent:
      "Every time is UTC. Nothing on the page says what the local hour is at either " +
      "end of a sector, so sleep cannot be placed without converting first.",
  },
  {
    caseId: "d04-kestrel",
    operator: op("KESTREL EUROPE", "KE", "MAD", "mixed", {
      reportOffset: { short: 45, long: 75 },
    }),
    crewRef: "KE-51902", rank: "FO/A320",
    language: "en", dateStyle: "dmy", timeConvention: "local",
    reportTime: "derived", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "code", "flightNo", "route", "dep", "arr", "block", "end", "duty"],
    legend: "inline", pages: 1, headerTotals: true, ...SEP,
    quirks: ["report-time-derived", "header-offset-table"],
    intent:
      "Report time is not printed. It has to be derived from the offset table in the " +
      "header and the first sector's departure - and the offset differs by haul, so " +
      "using one number for the month is silently wrong.",
  },
  {
    caseId: "d05-halcyon",
    operator: op("HALCYON AIR", "HY", "LHR", "mixed"),
    crewRef: "HY-63344", rank: "CP/A350",
    language: "en", dateStyle: "ddmmm", timeConvention: "both",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "end", "layover"],
    legend: "inline", pages: 2, headerTotals: true, ...SEP,
    quirks: ["two-page", "repeated-header", "dual-time", "ddmmm-dates"],
    intent:
      "The table runs across two pages with the header repeated, and every time cell " +
      "carries both local and UTC. Treating the second page header as data, or picking " +
      "the wrong half of a dual time, both corrupt the month.",
  },
  {
    caseId: "d06-vantage",
    operator: op("VANTAGE REGIONAL", "VG", "MAD", "short", {
      codes: { standby: "R1", training: "TRG", off: "X", positioning: "PSG" },
    }),
    crewRef: "VG-10877", rank: "FO/AT76",
    language: "en", dateStyle: "ddmmm", timeConvention: "local",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "block", "end", "duty"],
    legend: "block", pages: 1, headerTotals: true, ...SEP,
    quirks: ["terse-codes", "legend-block"],
    intent:
      "Activity codes are terse and operator-specific - X is a day off, R1 is standby - " +
      "and their meaning lives only in the legend block at the foot of the document.",
  },
  {
    caseId: "d07-cirrus",
    operator: op("CIRRUS CONNECT", "CR", "MAD", "mixed"),
    crewRef: "CR-31265", rank: "CP/A320",
    language: "en", dateStyle: "dmy", timeConvention: "local",
    reportTime: "stated", continuationRows: "undated", rolloverMarker: false,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "block", "end", "duty"],
    legend: "inline", pages: 1, headerTotals: true, ...SEP,
    quirks: ["midnight-rollover", "no-rollover-marker", "undated-continuation-rows"],
    intent:
      "Duties that cross local midnight print as 23:30 -> 05:25 on one dated row with " +
      "nothing marking the day change, and continuation rows carry no date either. " +
      "Reading the end time as same-day shortens the duty by 24 hours.",
  },
  {
    caseId: "d08-nimbus",
    operator: op("NIMBUS INTERNATIONAL", "NB", "MAD", "long"),
    crewRef: "NB-90412", rank: "CP/B77W",
    language: "en", dateStyle: "dmy", timeConvention: "local",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "block", "end", "layover"],
    legend: "inline", pages: 1, headerTotals: true,
    coveredFrom: "2026-10-11", coveredTo: "2026-11-09",
    quirks: ["dst-transition", "long-haul", "transatlantic"],
    intent:
      "Europe falls back on 25 October and North America on 1 November, so this month " +
      "contains a local hour that happens twice and transatlantic sectors whose offset " +
      "changes mid-trip. Fixed offset arithmetic drifts by an hour and never says so.",
  },
];

/**
 * The held-out set.
 *
 * Generated only after every agent prompt was frozen (see docs/eval-preregistration.md
 * for the commit), from a different seed, and not opened or run against until the final
 * evaluation. They recombine the same documented layout differences in ways the
 * development set does not, so nothing here was tuned against.
 */
export const HELDOUT_CASES: FormatSpec[] = [
  {
    caseId: "h01-corvus",
    operator: op("CORVUS AIRWAYS", "CV", "MAD", "mixed", {
      reportOffset: { short: 50, long: 80 },
      codes: { standby: "STBY", training: "TRN", off: "DO", positioning: "PAX" },
    }),
    crewRef: "CV-58210", rank: "CP/A21N",
    language: "en", dateStyle: "ddmmm", timeConvention: "utc",
    reportTime: "derived", continuationRows: "undated", rolloverMarker: false,
    columns: ["date", "code", "flightNo", "route", "dep", "arr", "block", "end", "duty"],
    legend: "block", pages: 1, headerTotals: true, ...SEP,
    quirks: [
      "report-time-derived", "utc-only", "undated-continuation-rows",
      "no-rollover-marker", "legend-block",
    ],
    intent:
      "Every hard thing at once: report time derived from the header, UTC-only times, " +
      "continuation rows with no date, and no rollover marker anywhere. Nothing here is " +
      "new — it is the combination that has not been seen.",
  },
  {
    caseId: "h02-lyra",
    operator: op("LYRA CONNECT", "LY", "LHR", "short"),
    crewRef: "LY-13094", rank: "FO/E190",
    language: "en", dateStyle: "ymd", timeConvention: "both",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "origin", "dest", "dep", "arr", "block", "end", "duty"],
    legend: "inline", pages: 2, headerTotals: false, ...SEP,
    quirks: ["no-header-totals", "two-page", "dual-time", "split-origin-dest"],
    intent:
      "The header prints no totals, so the document offers no checksum at all — the one " +
      "self-check the reader leans on is simply absent, and it has to notice rather than " +
      "report a reconciliation it never did.",
  },
  {
    caseId: "h03-tellus",
    operator: op("TELLUS LINEAS", "TL", "MAD", "long", {
      codes: { standby: "RSV", training: "SIM", off: "LIB", positioning: "PSJ" },
    }),
    crewRef: "TL-77451", rank: "CP/B788",
    language: "es", dateStyle: "dmy", timeConvention: "local",
    reportTime: "stated", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "report", "code", "flightNo", "route", "dep", "arr", "block", "end", "layover"],
    legend: "block", pages: 1, headerTotals: true,
    coveredFrom: "2026-10-11", coveredTo: "2026-11-09",
    quirks: ["spanish", "dst-transition", "long-haul", "transatlantic"],
    intent:
      "Spanish labels on a month that crosses both daylight-saving changes. The language " +
      "and the DST trap have each been seen, never together.",
  },
  {
    caseId: "h04-atria",
    operator: op("ATRIA REGIONAL", "AT", "LHR", "short", {
      reportOffset: { short: 40, long: 70 },
      codes: { standby: "A", training: "T", off: "-", positioning: "P" },
    }),
    crewRef: "AT-90233", rank: "FO/AT72",
    language: "en", dateStyle: "dmy", timeConvention: "local",
    reportTime: "derived", continuationRows: "dated", rolloverMarker: true,
    columns: ["date", "code", "flightNo", "route", "dep", "arr", "block", "end", "duty", "equip"],
    legend: "block", pages: 1, headerTotals: true, ...SEP,
    quirks: ["single-character-codes", "report-time-derived", "empty-equipment-column"],
    intent:
      "Activity codes are single characters — a day off is a bare hyphen — and there is " +
      "an equipment column that is empty on every row. Both invite a reader to see " +
      "structure that is not there.",
  },
];
