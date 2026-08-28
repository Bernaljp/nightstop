/**
 * The deterministic tools an agent may call.
 *
 * Every one of these is arithmetic or a lookup. None of them is judgement. The division
 * is the whole design: a model is very good at reading an unfamiliar document and very
 * bad at being trusted with timezone arithmetic, so it does the reading and hands the
 * sums here.
 */
import { z } from "zod";
import type { NightstopTool } from "./types";
import { localToUtc, minutesBetween, formatDuration } from "../tools/time";
import { AIRPORTS, tzOf } from "../corpus/network";

/**
 * Convert a local wall-clock reading at a station into an absolute instant.
 *
 * Also reports whether the reading is ambiguous or does not exist, which happens twice
 * a year and is exactly when a plan silently goes an hour wrong.
 */
export const toUtcTool: NightstopTool = {
  name: "to_utc",
  description:
    "Convert a local date and time at an airport into an absolute UTC instant. Handles " +
    "daylight saving, including readings that are ambiguous (the hour repeats) or that " +
    "do not exist (the hour is skipped). Always use this instead of adding an offset " +
    "yourself.",
  schema: {
    station: z.string().describe("IATA code, e.g. MAD"),
    localDateTime: z.string().describe('Local wall clock, "YYYY-MM-DDTHH:mm"'),
  },
  async run(args) {
    const station = String(args.station).toUpperCase();
    if (!AIRPORTS[station]) {
      return `Unknown station "${station}". Known: ${Object.keys(AIRPORTS).join(", ")}`;
    }
    const r = localToUtc(String(args.localDateTime), tzOf(station));
    const notes: string[] = [];
    if (r.ambiguous) {
      notes.push(
        "AMBIGUOUS: the clocks went back, so this local time happens twice. The earlier " +
          "instant is returned. Flag this to the crew member rather than guessing.",
      );
    }
    if (r.nonexistent) {
      notes.push(
        "DOES NOT EXIST: the clocks went forward, so this local time is skipped. The " +
          "instant after the transition is returned. Flag this.",
      );
    }
    return JSON.stringify({
      station,
      timezone: tzOf(station),
      localDateTime: args.localDateTime,
      utc: r.utc.toISOString(),
      notes,
    });
  },
};

/**
 * The document grading its own transcription.
 *
 * A roster that prints its own totals is offering a checksum, and it is the single
 * cheapest way to find out that a row was misread — or missed entirely. It caught a
 * lost sector during development that nothing else would have.
 */
export const reconcileTotalsTool: NightstopTool = {
  name: "reconcile_totals",
  description:
    "Check the duties you have read against the totals printed in the roster's header " +
    "(block hours, days off, standby days, nightstops). If they do not reconcile you " +
    "have misread or missed something — find it before going on.",
  schema: {
    base: z.string().describe("IATA code of the crew member's home base"),
    duties: z
      .string()
      .describe(
        "The duties you have read so far, as a JSON array with date, kind, endStation " +
          "and sectors[{depUtc, arrUtc}].",
      ),
    headerBlockHours: z
      .string()
      .describe('Block hours as the header prints it, e.g. "130h30". Empty if absent.'),
    headerDaysOff: z.number().describe("Days off as the header prints it. -1 if absent."),
    headerStandbyDays: z.number().describe("Standby days from the header. -1 if absent."),
    headerNightstops: z.number().describe("Nightstops from the header. -1 if absent."),
  },
  async run(args) {
    type D = {
      date: string;
      kind: string;
      endStation?: string;
      sectors?: { depUtc: string; arrUtc: string }[];
    };
    let duties: D[];
    try {
      duties = JSON.parse(String(args.duties));
    } catch (e) {
      return `Could not parse the duties you passed: ${(e as Error).message}`;
    }
    const base = String(args.base).toUpperCase();

    let block = 0;
    let daysOff = 0;
    let standby = 0;
    let nightstops = 0;
    for (const d of duties) {
      for (const s of d.sectors ?? []) {
        block += minutesBetween(new Date(s.depUtc), new Date(s.arrUtc));
      }
      if (d.kind === "off") daysOff++;
      if (d.kind === "standby") standby++;
      if (d.kind === "flight" && d.endStation && d.endStation.toUpperCase() !== base) {
        nightstops++;
      }
    }

    const parseHm = (s: string): number | null => {
      const m = /^(\d+)h(\d+)$/.exec(s.trim());
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const wantBlock = parseHm(String(args.headerBlockHours ?? ""));
    const rows: string[] = [];
    const problems: string[] = [];

    const compare = (
      label: string,
      got: number,
      want: number | null,
      fmt: (n: number) => string = (n) => String(n),
    ) => {
      if (want === null || want < 0) {
        rows.push(`${label}: ${fmt(got)} (header does not print this)`);
        return;
      }
      const ok = got === want;
      rows.push(`${label}: you have ${fmt(got)}, header says ${fmt(want)} — ${ok ? "OK" : "MISMATCH"}`);
      if (!ok) {
        problems.push(
          `${label} is out by ${fmt(Math.abs(got - want))}. Something has been misread or missed.`,
        );
      }
    };

    compare("block hours", block, wantBlock, formatDuration);
    compare("days off", daysOff, Number(args.headerDaysOff));
    compare("standby days", standby, Number(args.headerStandbyDays));
    compare("nightstops", nightstops, Number(args.headerNightstops));

    return JSON.stringify(
      {
        duties: duties.length,
        checks: rows,
        reconciled: problems.length === 0,
        problems,
      },
      null,
      2,
    );
  },
};

export const READER_TOOLS: NightstopTool[] = [toUtcTool, reconcileTotalsTool];
