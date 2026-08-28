/**
 * Rule packs.
 *
 * A crew member's schedule is constrained by three different kinds of thing, and
 * conflating them is the mistake this whole design exists to avoid:
 *
 *   hard-limit     - their operator or regulator says it must not happen
 *   recommendation - fatigue science or the operator says it is a bad idea
 *   preference     - the crew member's own line, which only they can move
 *
 * Nightstop never decides which of these to break. It states the collision and hands
 * the choice back, because only the person flying knows whether a recommendation is
 * something they are willing to trade tonight.
 *
 * A pack is produced once per source document by the rule distiller and cached. The
 * planner never sees the source document, only the pack — that is the entire answer
 * to "regulations are 200 pages and mostly not about sleep".
 */

export type Hardness = "hard-limit" | "recommendation" | "preference";

/**
 * The machine-checkable half of a rule. Keeping this a small closed vocabulary is
 * deliberate: a rule the checker cannot evaluate is a rule that silently does nothing,
 * so the distiller is forced to express what it extracts in terms that can be tested.
 */
export type RuleCheck =
  /** Rest between the end of one duty and the report of the next. */
  | { kind: "min_rest_between_duties"; minutes: number }
  /** Sleep opportunity available in a rest period, after commuting both ways. */
  | { kind: "min_sleep_opportunity"; minutes: number }
  /** Length of a single duty, report to off-duty. */
  | { kind: "max_duty_minutes"; minutes: number }
  /** Total sleep scheduled in any rolling 24 hours. */
  | { kind: "min_sleep_per_24h"; minutes: number }
  /** A nap must finish this long before the crew member leaves for the airport. */
  | { kind: "nap_ends_before_pickup"; minutes: number }
  /** Length of a pre-duty nap. */
  | { kind: "max_nap_minutes"; minutes: number }
  /** Length of a single main sleep. */
  | { kind: "min_main_sleep_minutes"; minutes: number }
  /** Sleep may never be scheduled inside a duty period. */
  | { kind: "no_sleep_during_duty" }
  /** Consecutive duties starting before this local hour. */
  | { kind: "max_consecutive_early_starts"; count: number; beforeLocalHour: number };

export interface Rule {
  id: string;
  /** One sentence, in the words a crew member would use. Shown in conflicts. */
  statement: string;
  /**
   * Where this came from — a regulation paragraph, an operator manual section, or
   * "you told us". Every rule carries one so a conflict can be traced.
   */
  source: string;
  hardness: Hardness;
  check: RuleCheck;
}

export interface RulePack {
  id: string;
  /** What document or input this pack was distilled from. */
  origin: string;
  rules: Rule[];
  /**
   * Token accounting for the distillation, so the saving is evidence rather than a
   * claim. Absent for hand-written packs.
   */
  distillation?: {
    sourceTokens: number;
    packTokens: number;
    model: string;
  };
}

export function rulesByKind<K extends RuleCheck["kind"]>(
  pack: RulePack,
  kind: K,
): (Rule & { check: Extract<RuleCheck, { kind: K }> })[] {
  return pack.rules.filter((r) => r.check.kind === kind) as never;
}
