/**
 * The reference distillation of the synthetic operator manual in
 * `docs/sources/operator-manual.md`.
 *
 * This is what a perfect rule distiller would produce from that document. It exists
 * for two reasons: the grader needs a pack to compute conflicts against, and stage 5
 * measures the distiller by diffing what it extracts against this.
 *
 * The operator is invented. These numbers are the operator's own policy, deliberately
 * stricter than the regulatory floor — which is how real operator manuals work, and
 * why "what does the regulation say" is never the whole answer for a crew member.
 */
import type { RulePack } from "./schema";

export const OPERATOR_PACK: RulePack = {
  id: "operator-manual-synthetic",
  origin: "docs/sources/operator-manual.md (synthetic; written for this project)",
  rules: [
    {
      id: "op-rest-12h-home",
      statement:
        "Company policy is 12 hours off at base between duties, not the regulatory 10.",
      source: "Operator Flight Crew Manual §4.2.1",
      hardness: "recommendation",
      check: { kind: "min_rest_between_duties", minutes: 720 },
    },
    {
      id: "op-max-duty-13h",
      statement: "No flight duty period is planned beyond 13 hours.",
      source: "Operator Flight Crew Manual §4.1.3",
      hardness: "hard-limit",
      check: { kind: "max_duty_minutes", minutes: 780 },
    },
    {
      id: "op-max-3-early-starts",
      statement:
        "No more than three duties in a row reporting before 06:00 local.",
      source: "Operator Flight Crew Manual §4.3.2",
      hardness: "recommendation",
      check: { kind: "max_consecutive_early_starts", count: 3, beforeLocalHour: 6 },
    },
  ],
};

/**
 * What a crew member says about themselves. Only they can move these, which is why
 * Nightstop states a collision with one and then stops rather than deciding.
 */
export const PREFERENCE_PACK: RulePack = {
  id: "crew-preferences",
  origin: "Entered by the crew member",
  rules: [
    {
      id: "pref-sleep-target-7h30",
      statement: "I want 7h30 of actual sleep in a day, not 7.",
      source: "You told us",
      hardness: "preference",
      check: { kind: "min_sleep_per_24h", minutes: 450 },
    },
    {
      id: "pref-sleep-window-9h",
      statement:
        "I need 9 hours between getting home and leaving again, or it is not worth going home.",
      source: "You told us",
      hardness: "preference",
      check: { kind: "min_sleep_opportunity", minutes: 540 },
    },
  ],
};

/** Merge packs, later packs winning on id collisions. */
export function mergePacks(...packs: RulePack[]): RulePack {
  const byId = new Map<string, RulePack["rules"][number]>();
  for (const p of packs) for (const r of p.rules) byId.set(r.id, r);
  return {
    id: packs.map((p) => p.id).join("+"),
    origin: packs.map((p) => p.origin).join(" | "),
    rules: [...byId.values()],
  };
}
