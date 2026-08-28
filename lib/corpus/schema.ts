/**
 * Nightstop corpus — domain schema.
 *
 * These are the types the whole system keys on. `Duty` is the seam: everything
 * upstream (a PDF from some airline) turns into duties, and everything downstream
 * (circadian model, planner, reviewer, calendar) reads duties and nothing else.
 *
 * Times are ALWAYS stored as absolute UTC ISO instants. A roster prints local time,
 * or UTC, or both; the ground truth records the instant so a mis-read timezone is a
 * detectable error rather than an invisible one.
 */

/** IATA station code, e.g. "MAD". Every place a crew member can be is a station. */
export type Station = string;

export type DutyKind =
  | "flight" // one or more operated sectors
  | "positioning" // travelling as a passenger for the operator (deadhead)
  | "standby" // on call within a stated window
  | "training" // ground or simulator, at a stated venue
  | "off"; // a day off

/** One takeoff-to-landing leg. */
export interface Sector {
  flightNo: string;
  origin: Station;
  dest: Station;
  /** Scheduled time of departure, absolute UTC. */
  depUtc: string;
  /** Scheduled time of arrival, absolute UTC. */
  arrUtc: string;
}

/**
 * One entry on a roster. A duty is exactly one kind and never a mixture.
 *
 * `reportUtc`/`endUtc` bound the working period. For a flight duty, report precedes
 * the first sector's departure by the operator's reporting offset. For standby and
 * training, report is the stated start of the window — the crew member is due at the
 * venue, not reporting for a flight.
 */
export interface Duty {
  /** Stable within a roster: `${date}-${seq}`. */
  id: string;
  /** Calendar date the roster prints this duty against, YYYY-MM-DD in base local time. */
  date: string;
  kind: DutyKind;
  /** The operator's short label where the roster uses one, e.g. "SBY", "SIM". */
  code?: string;
  /** Where the duty starts. */
  station: Station;
  /** Where the duty ends. Same as `station` for standby, training and out-and-backs. */
  endStation: Station;
  /** Absolute UTC. Null only for a day off. */
  reportUtc: string | null;
  endUtc: string | null;
  sectors: Sector[];
}

/**
 * The fields the sleep engine actually consumes. Pre-registered here so the grader
 * cannot be widened or narrowed after results are seen — see docs/eval-preregistration.md.
 *
 * `flightNo` is transcribed but NOT duty-bearing: getting it wrong is a cosmetic error,
 * where a wrong `reportUtc` puts someone to bed at the wrong hour.
 */
export const DUTY_BEARING_FIELDS = [
  "date",
  "kind",
  "station",
  "endStation",
  "reportUtc",
  "endUtc",
  "sectorCount",
  "sectorOrigins",
  "sectorDests",
  "sectorDepUtc",
  "sectorArrUtc",
] as const;

export type DutyBearingField = (typeof DUTY_BEARING_FIELDS)[number];

/** What a crew member tells Nightstop about themselves. */
export interface CrewProfile {
  /** The station they are rostered from and go home to. Exactly one. */
  base: Station;
  /** IANA zone of the base, e.g. "Europe/Madrid". */
  baseTz: string;
  /**
   * Door-to-report travel time in minutes, per station. At base this is home to
   * airport; away from base it is hotel to airport. Configured, never computed.
   */
  commuteMinutes: Record<Station, number>;
  /** Default for any station not listed above. */
  defaultCommuteMinutes: number;
}

/** The answer key for one case. Never shown to any agent. */
export interface GroundTruth {
  caseId: string;
  operator: string;
  /** Inclusive date range the roster covers, YYYY-MM-DD. */
  coveredFrom: string;
  coveredTo: string;
  profile: CrewProfile;
  duties: Duty[];
  /** Which format quirks this case exercises — used to explain failures, not to score. */
  quirks: string[];
  /**
   * Human-readable note on what makes this case hard. Published in the corpus README
   * so a judge can see the intent without reading the generator.
   */
  intent: string;
}
