/**
 * The pack Nightstop starts from when a crew member has not supplied their own rules.
 *
 * Every entry is traceable to a public document. Where a number is quoted from a
 * regulation the citation is exact; where it is a reasonable reading of guidance
 * rather than a quoted figure, the source says so. Nothing here invents a limit and
 * attributes it to a regulator.
 *
 * Deliberately NOT here:
 *
 *   Flight duty period limits. Part 117 sets these in a table keyed on report time
 *   and number of segments. Collapsing that into one number and citing Part 117 would
 *   be inventing regulation, so duty-length limits arrive from the operator's own
 *   manual instead — which is exactly the input the rule distiller exists to read.
 *
 *   In-flight controlled rest. It is a tactical decision the crew makes in the cockpit
 *   on the day, and it cannot be put on a calendar in advance.
 */
import type { RulePack } from "./schema";

export const BASELINE_PACK: RulePack = {
  id: "baseline-public",
  origin:
    "Public aviation fatigue guidance: 14 CFR Part 117, ICAO Doc 9966, FAA AC 120-103A, " +
    "UK CAA Paper 2003/8, Flight Safety Foundation controlled-rest guidance.",
  rules: [
    {
      id: "far117-rest-10h",
      statement:
        "You get at least 10 hours off between duties, measured from release to next report.",
      source: "14 CFR 117.25(e)",
      hardness: "hard-limit",
      check: { kind: "min_rest_between_duties", minutes: 600 },
    },
    {
      id: "far117-sleep-opportunity-8h",
      statement:
        "That rest has to leave you 8 uninterrupted hours of sleep opportunity — so your " +
        "commute at both ends comes out of the 10, not out of the 8.",
      source: "14 CFR 117.25(e)",
      hardness: "hard-limit",
      check: { kind: "min_sleep_opportunity", minutes: 480 },
    },
    {
      id: "no-sleep-inside-duty",
      statement: "Nothing gets scheduled as sleep while you are on duty.",
      source:
        "Structural. In-flight controlled rest is a tactical cockpit decision and is out " +
        "of scope for a calendar (Flight Safety Foundation, Controlled Rest on the Flight Deck).",
      hardness: "hard-limit",
      check: { kind: "no_sleep_during_duty" },
    },
    {
      id: "main-sleep-floor-6h",
      statement:
        "A main sleep shorter than 6 hours does not do the job — if the window is that " +
        "tight, something else has to give.",
      source:
        "Reading of FAA AC 120-103A and ICAO Doc 9966 on sleep need and cumulative debt; " +
        "a working floor, not a quoted limit.",
      hardness: "recommendation",
      check: { kind: "min_main_sleep_minutes", minutes: 360 },
    },
    {
      id: "sleep-per-24h-7h",
      statement: "Aim for 7 hours of sleep in any 24, counting naps.",
      source:
        "Reading of ICAO Doc 9966 and FAA AC 120-103A on daily sleep need; a target, not a limit.",
      hardness: "recommendation",
      check: { kind: "min_sleep_per_24h", minutes: 420 },
    },
    {
      id: "nap-inertia-gap-45m",
      statement:
        "Finish a pre-duty nap at least 45 minutes before you leave, so you are not " +
        "driving or reporting through sleep inertia.",
      source:
        "UK CAA Paper 2003/8 (in-flight napping strategies) and Hilditch et al. 2020, " +
        "Chronobiology International, on sleep inertia after naps.",
      hardness: "recommendation",
      check: { kind: "nap_ends_before_pickup", minutes: 45 },
    },
    {
      id: "nap-cap-2h",
      statement:
        "Keep a pre-duty nap to 2 hours or less. Longer and the grogginess afterwards " +
        "starts costing more than the sleep gains.",
      source:
        "UK CAA Paper 2003/8; sleep inertia increases with nap duration (Hilditch et al. 2020).",
      hardness: "recommendation",
      check: { kind: "max_nap_minutes", minutes: 120 },
    },
  ],
};

/**
 * The Window of Circadian Low: the hours when alertness bottoms out. Expressed in
 * BODY time, not local time — that is the whole point of tracking a body clock, and a
 * crew member who has just flown east is not on the clock the wall says.
 */
export const WOCL_BODY_HOURS = { from: 2, to: 6 } as const;
