/**
 * Roster document formats.
 *
 * Rosters in the wild are produced by a handful of crew-planning systems, and the
 * differences between their outputs are mostly presentational: which columns appear
 * and in what order, whether times are local or UTC, whether report time is printed
 * or has to be derived from an offset table in the header, and whether a multi-sector
 * duty repeats the date on every row or prints it once.
 *
 * These specs model those documented differences. The airlines are invented and no
 * real operator's document is reproduced.
 */
import type { OperatorProfile } from "./months";

export type ColumnId =
  | "date"
  | "report"
  | "end"
  | "code"
  | "flightNo"
  | "origin"
  | "dest"
  | "route"
  | "dep"
  | "arr"
  | "block"
  | "duty"
  | "layover"
  | "equip";

export type DateStyle = "dmy" | "ymd" | "ddmmm";
export type TimeConvention = "local" | "utc" | "both";

export interface FormatSpec {
  caseId: string;
  operator: OperatorProfile;
  /** Fictional crew identifier printed in the header. Not a real person. */
  crewRef: string;
  rank: string;
  language: "en" | "es";
  dateStyle: DateStyle;
  timeConvention: TimeConvention;
  /**
   * "stated" prints report time in its own column. "derived" omits it and prints a
   * reporting-offset table in the header, so report time has to be computed from the
   * first sector's departure — a real and common shape.
   */
  reportTime: "stated" | "derived";
  /** Whether sectors after the first repeat the date. */
  continuationRows: "dated" | "undated";
  /**
   * Whether a time falling on the day after its row's date carries a "+1" marker.
   * Omitting it is realistic and is the whole difficulty of a midnight rollover:
   * 23:30 -> 05:25 on one dated row spans two calendar days with nothing saying so.
   */
  rolloverMarker: boolean;
  columns: ColumnId[];
  legend: "inline" | "block";
  pages: 1 | 2;
  /**
   * Whether the header prints totals (block hours, days off, standbys, layovers).
   * When present these reconcile against the table and act as a checksum the
   * document provides about itself.
   */
  headerTotals: boolean;
  coveredFrom: string;
  coveredTo: string;
  quirks: string[];
  intent: string;
}

export const LABELS: Record<"en" | "es", Record<ColumnId | string, string>> = {
  en: {
    date: "Date", report: "Report", end: "Off Duty", code: "Act", flightNo: "Flight",
    origin: "From", dest: "To", route: "Sector", dep: "STD", arr: "STA",
    block: "Block", duty: "Duty", layover: "Nightstop", equip: "Eq",
    title: "MONTHLY CREW ROSTER", from: "Period From", to: "To", base: "Base",
    crew: "Crew Ref", rank: "Rank", totalsBlock: "Block Hours", totalsOff: "Days Off",
    totalsSby: "Standby Days", totalsLayover: "Nightstops",
    localNote: "All times are LOCAL to the station shown.",
    utcNote: "All times are UTC (Z).",
    bothNote: "LT = local to the station shown. UTC = Zulu.",
    offsetTitle: "REPORTING TIMES (before STD)",
    offsetShort: "Short haul", offsetLong: "Long haul",
    legendTitle: "ACTIVITY CODES", contd: "continued",
  },
  es: {
    date: "Fecha", report: "Reporte", end: "Fin", code: "Act", flightNo: "Vuelo",
    origin: "Ori", dest: "Des", route: "Trayecto", dep: "Salida", arr: "Llegada",
    block: "H.Bloque", duty: "H.Servicio", layover: "Pernocta", equip: "Eq",
    title: "PROGRAMACION MENSUAL DE TRIPULANTES", from: "Fecha Inicio", to: "Fecha Fin",
    base: "Base", crew: "Codigo", rank: "Rango", totalsBlock: "Horas Bloque",
    totalsOff: "Dias Libres", totalsSby: "Reservas", totalsLayover: "Pernoctas",
    localNote: "Las horas se muestran en hora local de la estacion indicada.",
    utcNote: "Las horas se muestran en UTC (Z).",
    bothNote: "LT = hora local de la estacion. UTC = Zulu.",
    offsetTitle: "HORAS DE REPORTE (antes de la salida)",
    offsetShort: "Corto radio", offsetLong: "Largo radio",
    legendTitle: "CODIGOS DE ACTIVIDAD", contd: "continuacion",
  },
};

const MONTHS_EN = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

export function formatDate(isoDate: string, style: DateStyle): string {
  const [y, m, d] = isoDate.split("-");
  switch (style) {
    case "dmy": return `${d}/${m}/${y}`;
    case "ymd": return isoDate;
    case "ddmmm": return `${d}${MONTHS_EN[Number(m) - 1]}`;
  }
}

/** Column widths in characters, used to lay out a monospaced table. */
export const COLUMN_WIDTH: Record<ColumnId, number> = {
  date: 11, report: 8, end: 10, code: 7, flightNo: 7, origin: 5, dest: 5,
  route: 9, dep: 7, arr: 7, block: 8, duty: 9, layover: 9, equip: 5,
};
