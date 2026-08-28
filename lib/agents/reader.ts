/**
 * The roster reader.
 *
 * This is the one job in the pipeline that genuinely needs a language model. Every
 * airline prints its roster differently — Spanish column headers, times in UTC only,
 * report time you have to derive from an offset table in the header, continuation rows
 * that drop the date, a duty crossing midnight with nothing marking the day change —
 * and writing a parser per operator does not scale past the first airline.
 *
 * What the model is NOT asked to do is arithmetic. Timezone conversion goes to a tool,
 * and the reading is checked against the totals the document prints about itself before
 * it is allowed out.
 */
import { join } from "node:path";
import type { Duty } from "../corpus/schema";
import { runAgentSdk } from "./sdk-runtime";
import { extractJson, type AgentRunOptions } from "./types";
import { READER_TOOLS } from "./tools";

export const READER_SYSTEM = `
You read airline crew rosters. Every operator lays theirs out differently, so read what
is actually on the page rather than what you expect to be there.

Work in this order and do not skip ahead:

1. **Read the document before interpreting it.** Say what the columns are, whether times
   are local, UTC or both, and whether report time is printed or has to be derived from
   an offset stated in the header. Say what date format is in use.

2. **Find the traps before they find you.**
   - Do continuation rows repeat the date, or does only the first row of a duty carry it?
     If they do not, a sector belongs to the duty above it.
   - Does a time ever fall on the day after its row's date? A duty printed 23:30 → 05:25
     on one dated row spans two calendar days, and a roster may or may not mark that.
   - Does the table continue onto a second page with the header repeated? A repeated
     header is not data.
   - Is the covered period crossing a daylight-saving change?

3. **Never do timezone arithmetic yourself.** Call \`to_utc\` for every local time you
   convert. It knows about the hours that repeat and the hours that do not exist, and it
   will tell you when you have hit one.

4. **Check yourself against the document.** If the header prints totals — block hours,
   days off, standby days, nightstops — call \`reconcile_totals\` with everything you have
   read. If it does not reconcile, you have misread or missed a row. Find it and fix it,
   then check again. Do not proceed on a mismatch and do not explain it away.

5. **Say what you derived rather than read.** A value printed on the page and a value
   you worked out are not the same kind of fact, and only one of them can be checked
   against the document. If report time is not printed and you computed it from an
   offset stated in the header, that is a derivation — record it, say which offset you
   used and why that one. The header totals cannot catch an error here: report time is
   not part of block hours, so a derived report time reconciles perfectly while being
   wrong.

6. Only then produce the answer.

Two standing rules:

- **A duty is exactly one kind** and never a mixture: a flight duty with one or more
  sectors, positioning as a passenger, standby, training, or a day off.
- **Report time** is when the crew member is due at work. For a flight duty that is
  before the first sector's departure by the operator's reporting offset. For standby or
  training it is the stated start of the window, with no offset — they are due at the
  venue, not reporting for a flight.

If something is genuinely unreadable, still give your best reading and say plainly what
you were unsure about. Never return nothing.
`.trim();

export interface Derivation {
  date: string;
  field: string;
  method: string;
  confidence: "high" | "medium" | "low";
}

export interface ReaderResult {
  duties: Duty[];
  uncertainties: string[];
  /** Fields worked out rather than read. Nothing in the document can check these. */
  derivations: Derivation[];
  reconciled: boolean | null;
  notes: string;
}

export async function readRoster(
  caseDir: string,
  covered: { from: string; to: string },
  base: string,
  ctx: Pick<AgentRunOptions, "traj" | "meter">,
): Promise<ReaderResult> {
  const user = `
Read this roster: ${join(caseDir, "roster.pdf")}

It covers ${covered.from} to ${covered.to}. The crew member's home base is ${base}.

Return a single fenced JSON block and nothing after it:

\`\`\`json
{
  "format": "one or two sentences on how this operator lays its roster out",
  "traps": ["anything about this layout that could be misread"],
  "reconciled": true,
  "uncertainties": ["anything you could not read with confidence, or [] if none"],
  "derivations": [
    {
      "date": "YYYY-MM-DD",
      "field": "reportUtc",
      "method": "how you worked it out, e.g. STD minus the 75 minute long-haul offset",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "duties": [
    {
      "date": "YYYY-MM-DD",
      "kind": "flight" | "positioning" | "standby" | "training" | "off",
      "code": "the operator's activity code, or omit",
      "station": "IATA where the duty starts",
      "endStation": "IATA where the duty ends",
      "reportUtc": "ISO-8601 UTC instant, null for a day off",
      "endUtc": "ISO-8601 UTC instant, null for a day off",
      "sectors": [
        { "flightNo": "string", "origin": "IATA", "dest": "IATA",
          "depUtc": "ISO-8601 UTC", "arrUtc": "ISO-8601 UTC" }
      ]
    }
  ]
}
\`\`\`

Every date in the covered period appears, including days off. Set \`reconciled\` to what
\`reconcile_totals\` actually told you — false if the header totals never matched.
`.trim();

  const run = await runAgentSdk({
    agent: "reader",
    system: READER_SYSTEM,
    user,
    tools: READER_TOOLS,
    readableFiles: [join(caseDir, "roster.pdf")],
    traj: ctx.traj,
    meter: ctx.meter,
    maxTurns: 40,
  });

  const raw = extractJson<{
    duties?: Duty[];
    uncertainties?: string[];
    derivations?: Derivation[];
    reconciled?: boolean;
    format?: string;
    traps?: string[];
  }>(run.text);

  return {
    duties: raw.duties ?? [],
    uncertainties: raw.uncertainties ?? [],
    derivations: raw.derivations ?? [],
    reconciled: raw.reconciled ?? null,
    notes: [raw.format, ...(raw.traps ?? [])].filter(Boolean).join(" · "),
  };
}
