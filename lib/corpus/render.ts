/**
 * Draws a roster PDF.
 *
 * Monospaced throughout, because that is how crew-planning systems print and because
 * fixed column positions are what make a roster readable at a glance. Output must be
 * byte-identical across runs, so every date the PDF embeds is pinned.
 */
import PDFDocument from "pdfkit";
import type { FormatSpec, ColumnId } from "./format";
import { LABELS, COLUMN_WIDTH, formatDate } from "./format";
import type { PrintRow, RosterTotals } from "./rows";
import { formatDuration } from "../tools/time";

/** Pinned so a regenerated corpus diffs clean. */
const FIXED_DATE = new Date("2026-08-01T00:00:00Z");

const FONT = "Courier";
const FONT_BOLD = "Courier-Bold";
const SIZE = 7.6;
const CHAR_W = SIZE * 0.6; // Courier advance width is 0.6 em
const LEADING = 10.2;
const MARGIN = 34;

function cellWidth(c: ColumnId, spec: FormatSpec): number {
  // "both" prints local and UTC in one cell, so time columns need the room.
  const timeCols: ColumnId[] = ["report", "end", "dep", "arr"];
  const extra = spec.timeConvention === "both" && timeCols.includes(c) ? 8 : 0;
  const marker = spec.rolloverMarker && timeCols.includes(c) ? 2 : 0;
  return (COLUMN_WIDTH[c] + extra + marker) * CHAR_W;
}

export function renderRoster(
  spec: FormatSpec,
  rows: PrintRow[],
  totals: RosterTotals,
): Promise<Buffer> {
  const L = LABELS[spec.language];
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    info: {
      Title: `${spec.operator.name} ${L.title}`,
      Author: spec.operator.name,
      Creator: "nightstop-corpus",
      Producer: "nightstop-corpus",
      CreationDate: FIXED_DATE,
      ModDate: FIXED_DATE,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const pageWidth = doc.page.width - MARGIN * 2;
  let y = MARGIN;

  const line = (text: string, opts: { bold?: boolean; size?: number } = {}) => {
    doc.font(opts.bold ? FONT_BOLD : FONT).fontSize(opts.size ?? SIZE);
    doc.text(text, MARGIN, y, { lineBreak: false });
    y += LEADING;
  };
  const rule = () => {
    doc.moveTo(MARGIN, y).lineTo(MARGIN + pageWidth, y).lineWidth(0.4).stroke();
    y += 4;
  };

  const drawHeader = (continued: boolean) => {
    line(`${spec.operator.name}`, { bold: true, size: 11 });
    y += 1;
    line(`${L.title}${continued ? `  (${L.contd})` : ""}`, { bold: true, size: 9 });
    y += 2;
    line(
      `${L.from}: ${formatDate(spec.coveredFrom, spec.dateStyle)}   ` +
        `${L.to}: ${formatDate(spec.coveredTo, spec.dateStyle)}   ` +
        `${L.base}: ${spec.operator.base}   ` +
        `${L.crew}: ${spec.crewRef}   ${L.rank}: ${spec.rank}`,
    );
    if (spec.headerTotals) {
      line(
        `${L.totalsBlock}: ${formatDuration(totals.blockMinutes)}   ` +
          `${L.totalsOff}: ${totals.daysOff}   ` +
          `${L.totalsSby}: ${totals.standbyDays}   ` +
          `${L.totalsLayover}: ${totals.nightstops}`,
      );
    }
    const note =
      spec.timeConvention === "local" ? L.localNote
      : spec.timeConvention === "utc" ? L.utcNote
      : L.bothNote;
    line(note);

    if (spec.reportTime === "derived") {
      y += 2;
      line(L.offsetTitle, { bold: true });
      line(`  ${L.offsetShort}: ${spec.operator.reportOffset.short} min`);
      line(`  ${L.offsetLong}: ${spec.operator.reportOffset.long} min`);
    }

    y += 3;
    rule();
    // Column headers.
    doc.font(FONT_BOLD).fontSize(SIZE);
    let x = MARGIN;
    for (const c of spec.columns) {
      doc.text(String(L[c] ?? c), x, y, { lineBreak: false });
      x += cellWidth(c, spec);
    }
    y += LEADING;
    rule();
  };

  const drawRow = (r: PrintRow) => {
    doc.font(FONT).fontSize(SIZE);
    let x = MARGIN;
    for (const c of spec.columns) {
      const v = r[c] ?? "";
      if (v) doc.text(v, x, y, { lineBreak: false });
      x += cellWidth(c, spec);
    }
    y += LEADING;
  };

  drawHeader(false);

  const splitAt = spec.pages === 2 ? Math.ceil(rows.length / 2) : rows.length;
  rows.forEach((r, i) => {
    if (i === splitAt && spec.pages === 2) {
      doc.addPage();
      y = MARGIN;
      drawHeader(true);
    }
    // A blank half-line before each new duty makes blocks legible, as rosters do.
    if (r.startsDuty && i !== 0 && i !== splitAt) y += 2;
    drawRow(r);
  });

  if (spec.legend === "block") {
    y += 6;
    rule();
    line(L.legendTitle, { bold: true });
    const c = spec.operator.codes;
    const glossEn: Record<string, string> = {
      [c.off]: "Day off",
      [c.standby]: "Standby / reserve",
      [c.training]: "Simulator or ground training",
      [c.positioning]: "Positioning as passenger",
    };
    const glossEs: Record<string, string> = {
      [c.off]: "Dia libre",
      [c.standby]: "Reserva",
      [c.training]: "Entrenamiento simulador o tierra",
      [c.positioning]: "Traslado como pasajero",
    };
    const gloss = spec.language === "es" ? glossEs : glossEn;
    for (const [code, meaning] of Object.entries(gloss)) {
      line(`  ${code.padEnd(8)} ${meaning}`);
    }
  }

  doc.end();
  return done;
}
