/**
 * The answer shape every arm is asked for.
 *
 * Identical across arms on purpose. The brief requires the baseline and the final
 * system to be given the same task, and an evaluation where the baseline was asked a
 * vaguer question is not a comparison. What differs between arms is what each one is
 * GIVEN and how much machinery it may use — never what it is asked to produce.
 */
export const OUTPUT_CONTRACT = `
Return your answer as a single fenced JSON block, and nothing after it.

\`\`\`json
{
  "duties": [
    {
      "date": "YYYY-MM-DD",
      "kind": "flight" | "positioning" | "standby" | "training" | "off",
      "station": "IATA code where the duty starts",
      "endStation": "IATA code where the duty ends",
      "reportUtc": "ISO-8601 instant in UTC, or null for a day off",
      "endUtc": "ISO-8601 instant in UTC, or null for a day off",
      "sectors": [
        {
          "flightNo": "string",
          "origin": "IATA",
          "dest": "IATA",
          "depUtc": "ISO-8601 instant in UTC",
          "arrUtc": "ISO-8601 instant in UTC"
        }
      ]
    }
  ],
  "blocks": [
    {
      "kind": "main" | "pre-duty-nap" | "recovery-nap",
      "startUtc": "ISO-8601 instant in UTC",
      "endUtc": "ISO-8601 instant in UTC",
      "station": "IATA code where they will be sleeping",
      "why": "one sentence, in the words a crew member would use"
    }
  ],
  "conflicts": [
    {
      "ruleId": "the id of the rule this collides with",
      "date": "YYYY-MM-DD the collision lands on",
      "statement": "what collides, in plain language",
      "options": ["what they could do about it"]
    }
  ]
}
\`\`\`

Rules for the JSON, all of which matter:

- **Every time is an absolute UTC instant.** The roster prints local time, or UTC, or
  both — say which it is using and convert. A time that is out by a timezone puts
  someone to bed at the wrong hour.
- **One entry per duty**, in date order, covering every date in the period including
  days off.
- \`reportUtc\` is when they are due at work. For a flight duty that is before the first
  sector's departure by the operator's reporting offset; for standby or training it is
  the stated start of the window, with no offset.
- **Always produce a plan.** If something in the roster is genuinely unreadable, still
  return your best reading and say so in a conflict — never return nothing.
`.trim();
