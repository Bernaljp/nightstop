/**
 * A sleep plan and the conflicts that come with it.
 *
 * The product philosophy is in this file: a plan is ALWAYS produced. Where it collides
 * with a rule, the collision is stated as a `Conflict` carrying options, not resolved
 * silently and not used as an excuse to refuse. The crew member picks.
 */
import type { Station } from "../corpus/schema";
import type { Hardness } from "../rules/schema";

export type SleepKind =
  /** The primary sleep of a rest period. */
  | "main"
  /** Taken before a duty to blunt fatigue later in it. */
  | "pre-duty-nap"
  /** Taken after a duty to repay accumulated sleep debt. */
  | "recovery-nap";

export interface SleepBlock {
  id: string;
  kind: SleepKind;
  startUtc: string;
  endUtc: string;
  /** Where they will be — which fixes what the clock on the wall says. */
  station: Station;
  /** One line, in crew language, explaining why this block sits here. */
  why: string;
  /** Rules this block was placed to serve. */
  ruleIds: string[];
}

export interface Conflict {
  /** The rule that collides. */
  ruleId: string;
  hardness: Hardness;
  /**
   * The roster date the collision lands on, YYYY-MM-DD. For a rest period this is the
   * date of the duty you are resting BEFORE, because that is how a crew member thinks
   * about it — "the night before the 14th". Conflicts are matched on (rule, date),
   * which is something a reader can produce from the document without knowing any of
   * our internal identifiers.
   */
  date: string;
  /** Free-text detail: which duty or rest period, for display. */
  where: string;
  /** What collides, in plain language. This is what the crew member reads. */
  statement: string;
  /**
   * What they can actually do about it. A conflict with no options is a complaint,
   * not a decision, so the reviewer is required to offer at least one.
   */
  options: string[];
}

export interface SleepPlan {
  caseId: string;
  blocks: SleepBlock[];
  conflicts: Conflict[];
  /**
   * Anything the reader was unsure of in the roster itself. Distinct from a conflict:
   * a conflict is a rule collision, this is "I could not read that duty time".
   * A plan is still produced, but these are shown for confirmation first.
   */
  readingUncertainties?: string[];
  notes?: string;
}
