/**
 * The sleep plan as a calendar file.
 *
 * Deliberately an .ics file rather than an API sync, and not as a fallback:
 *
 *   It works for everyone. A Google Calendar API integration needs an OAuth client, and
 *   an unverified one is limited to an allowlist of test users with refresh tokens that
 *   expire in seven days. Anyone this plan is handed to would have to be added by hand.
 *   An .ics imports into Google Calendar, Apple Calendar and Outlook with no account
 *   setup at all.
 *
 *   The import IS the approval gate. Nothing reaches a calendar until a person opens the
 *   file and confirms it, which is the human checkpoint the design requires — enforced by
 *   the shape of the thing rather than by a prompt telling a model to behave.
 *
 * Times are written as absolute UTC instants. A phone renders them in whatever zone it
 * is in, which by construction is the zone the crew member will be sleeping in — the one
 * case where letting the device decide is exactly right.
 */
import type { SleepPlan, SleepBlock } from "../plan/schema";
import type { Duty } from "../corpus/schema";
import { minutesBetween, formatDuration } from "../tools/time";

/** RFC 5545 wants CRLF, escaped separators, and lines folded at 75 octets. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function fold(line: string): string {
  if (line.includes("\r\n") || Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    // Continuations start with a space, so they carry 74 octets of payload.
    const limit = out.length === 0 ? 75 : 74;
    if (Buffer.byteLength(cur + ch, "utf8") > limit) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out[0] + out.slice(1).map((l) => `\r\n ${l}`).join("");
}

function stamp(iso: string): string {
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

const TITLE: Record<SleepBlock["kind"], string> = {
  main: "Sleep",
  "pre-duty-nap": "Nap before duty",
  "recovery-nap": "Recovery sleep",
};

export interface IcsOptions {
  /** Include duty periods, so the plan reads in context. Default true. */
  includeDuties?: boolean;
  /** Fixed value keeps regenerating the same plan byte-identical. */
  dtstamp?: string;
  /** Namespace for event UIDs. */
  uidDomain?: string;
}

export function planToIcs(
  plan: SleepPlan,
  duties: Duty[],
  opts: IcsOptions = {},
): string {
  const { includeDuties = true, dtstamp = "2026-01-01T00:00:00Z", uidDomain = "nightstop.local" } = opts;
  const now = stamp(dtstamp);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nightstop//Rest plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText("Nightstop — rest plan")}`,
    `X-WR-CALDESC:${escapeText(
      "Advisory sleep plan. Not a flight time limitations tool and no ruling on the legality of any duty.",
    )}`,
  ];

  const event = (
    uid: string,
    start: string,
    end: string,
    summary: string,
    description: string,
    category: string,
    transparent: boolean,
  ): void => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@${uidDomain}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `CATEGORIES:${category}`,
      `TRANSP:${transparent ? "TRANSPARENT" : "OPAQUE"}`,
      "END:VEVENT",
    );
  };

  for (const b of plan.blocks) {
    const mins = minutesBetween(new Date(b.startUtc), new Date(b.endUtc));
    const conflictsHere = plan.conflicts.filter((c) => c.date === b.startUtc.slice(0, 10));
    const why = [
      b.why,
      "",
      `${formatDuration(mins)} at ${b.station}.`,
      ...(conflictsHere.length
        ? ["", "Worth knowing:", ...conflictsHere.map((c) => `- ${c.statement}`)]
        : []),
      "",
      "Advisory only. Your operator owns flight time limitations.",
    ].join("\n");
    event(
      b.id,
      b.startUtc,
      b.endUtc,
      `${TITLE[b.kind]} · ${formatDuration(mins)}`,
      why,
      "NIGHTSTOP-SLEEP",
      false,
    );
  }

  if (includeDuties) {
    for (const d of duties) {
      if (!d.reportUtc || !d.endUtc) continue;
      // `sectors` is absent on plenty of real model output, including for duties it
      // labelled "flight". Reading it without a guard threw AFTER the plan had already
      // rendered, and the catch upstream then replaced a perfectly good plan with a
      // failure message.
      const sectors = Array.isArray(d.sectors) ? d.sectors : [];
      const label =
        d.kind === "flight" && sectors.length
          ? sectors.map((s) => `${s.origin}–${s.dest}`).join(" ")
          : d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
      // Duties are shown as free time so they never block the crew member's own calendar
      // — this is a plan about them, not an authority over their diary.
      event(
        `duty-${d.id}`,
        d.reportUtc,
        d.endUtc,
        `Duty · ${label}`,
        `Report ${d.station}, off duty ${d.endStation}.\nFrom your roster, shown so the sleep plan reads in context.`,
        "NIGHTSTOP-DUTY",
        true,
      );
    }
  }

  lines.push("END:VCALENDAR");
  // Fold at the very end rather than per call site. Folding only the lines that looked
  // long left the calendar description at 111 octets, which is the sort of thing a
  // strict importer rejects and a lenient one silently truncates.
  return lines.map(fold).join("\r\n") + "\r\n";
}
