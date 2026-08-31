/**
 * Deterministic conflict detection.
 *
 * Two different questions, and keeping them apart is what makes the evaluation honest:
 *
 *   mandatoryConflicts()  Which rules does the ROSTER already break, before anyone
 *                         plans anything? These are unavoidable — no arrangement of
 *                         sleep can fix a 9-hour rest period — so a system that fails
 *                         to surface one has hidden something the crew member needed
 *                         to see. This is the answer key for the primary metric.
 *
 *   planViolations()      Which rules does a PARTICULAR plan break? These are the
 *                         planner's own mistakes, and unlike the above they are
 *                         fixable by planning better.
 *
 * Nothing here is an LLM. The grader must be able to compute the truth on its own,
 * or it is just asking a model to mark its own homework.
 */
import type { Duty, CrewProfile } from "../corpus/schema";
import type { RulePack, Rule } from "../rules/schema";
import type { Conflict, SleepPlan, SleepBlock } from "../plan/schema";
import { addMinutes, minutesBetween, formatDuration, localHHmm } from "../tools/time";
import { tzOf } from "../corpus/network";

export function commuteFor(profile: CrewProfile, station: string): number {
  return profile.commuteMinutes[station] ?? profile.defaultCommuteMinutes;
}

export interface RestPeriod {
  id: string;
  prev: Duty;
  next: Duty;
  /** End of duty to report of the next, which is what a regulation measures. */
  restMinutes: number;
  /**
   * The part of that actually available for sleep: it starts when they reach the hotel
   * or their own front door, and ends when they leave for the airport. The commute
   * comes out of the rest period, not out of the sleep.
   */
  sleepWindowFromUtc: string;
  sleepWindowToUtc: string;
  sleepWindowMinutes: number;
}

/** Rest periods between consecutive duties that actually involve reporting somewhere. */
export function restPeriods(duties: Duty[], profile: CrewProfile): RestPeriod[] {
  const working = duties.filter((d) => d.reportUtc && d.endUtc);
  const out: RestPeriod[] = [];
  for (let i = 1; i < working.length; i++) {
    const prev = working[i - 1];
    const next = working[i];
    const end = new Date(prev.endUtc!);
    const report = new Date(next.reportUtc!);
    const from = addMinutes(end, commuteFor(profile, prev.endStation));
    const to = addMinutes(report, -commuteFor(profile, next.station));
    out.push({
      id: `rest:${prev.id}..${next.id}`,
      prev,
      next,
      restMinutes: minutesBetween(end, report),
      sleepWindowFromUtc: from.toISOString(),
      sleepWindowToUtc: to.toISOString(),
      sleepWindowMinutes: minutesBetween(from, to),
    });
  }
  return out;
}

function conflict(
  rule: Rule,
  date: string,
  where: string,
  statement: string,
  options: string[],
): Conflict {
  return { ruleId: rule.id, hardness: rule.hardness, date, where, statement, options };
}

/**
 * Collisions inherent to the roster. Any plan built on this month has them, so these
 * are exactly what a crew member has to be told about.
 */
export function mandatoryConflicts(
  duties: Duty[],
  profile: CrewProfile,
  pack: RulePack,
): Conflict[] {
  const out: Conflict[] = [];
  const rests = restPeriods(duties, profile);

  for (const rule of pack.rules) {
    switch (rule.check.kind) {
      case "min_rest_between_duties": {
        const need = rule.check.minutes;
        for (const r of rests) {
          if (r.restMinutes < need) {
            out.push(
              conflict(
                rule,
                r.next.date,
                r.id,
                `Only ${formatDuration(r.restMinutes)} off between ${r.prev.date} and ` +
                  `${r.next.date} — ${formatDuration(need)} is the floor.`,
                [
                  "Tell your operator: this looks like a rostering error worth querying.",
                  "Fly it and let me protect as much sleep as the window allows.",
                ],
              ),
            );
          }
        }
        break;
      }
      case "min_sleep_opportunity": {
        const need = rule.check.minutes;
        for (const r of rests) {
          if (r.sleepWindowMinutes < need) {
            const commute =
              commuteFor(profile, r.prev.endStation) + commuteFor(profile, r.next.station);
            out.push(
              conflict(
                rule,
                r.next.date,
                r.id,
                `Before ${r.next.date} you have ${formatDuration(r.restMinutes)} off, but ` +
                  `${formatDuration(commute)} of it is travel — that leaves ` +
                  `${formatDuration(r.sleepWindowMinutes)} to sleep in, against ` +
                  `${formatDuration(need)}.`,
                [
                  "Sleep at the airport hotel instead of going home, if that is an option.",
                  "Take the shortfall and add a pre-duty nap where one fits.",
                  "Query the pairing with crewing.",
                ],
              ),
            );
          }
        }
        break;
      }
      case "min_main_sleep_minutes": {
        const need = rule.check.minutes;
        for (const r of rests) {
          // Only mandatory when the window is too small for any conforming main sleep.
          if (r.sleepWindowMinutes < need) {
            out.push(
              conflict(
                rule,
                r.next.date,
                r.id,
                `The window before ${r.next.date} is ${formatDuration(r.sleepWindowMinutes)} — ` +
                  `too short for a ${formatDuration(need)} main sleep however it is placed.`,
                [
                  "Split it: a shorter main sleep plus a nap.",
                  "Accept the short night and plan recovery sleep after the duty.",
                ],
              ),
            );
          }
        }
        break;
      }
      case "max_duty_minutes": {
        const need = rule.check.minutes;
        for (const d of duties) {
          if (!d.reportUtc || !d.endUtc) continue;
          const len = minutesBetween(new Date(d.reportUtc), new Date(d.endUtc));
          if (len > need) {
            out.push(
              conflict(
                rule,
                d.date,
                d.id,
                `${d.date} is a ${formatDuration(len)} duty, against a ` +
                  `${formatDuration(need)} limit.`,
                [
                  "Query it with crewing before the day.",
                  "Plan a pre-duty nap and protect the sleep either side.",
                ],
              ),
            );
          }
        }
        break;
      }
      case "max_consecutive_early_starts": {
        const { count, beforeLocalHour } = rule.check;
        let run: Duty[] = [];
        for (const d of duties) {
          if (!d.reportUtc) {
            run = [];
            continue;
          }
          const hour = Number(localHHmm(new Date(d.reportUtc), tzOf(d.station)).slice(0, 2));
          if (hour < beforeLocalHour) run.push(d);
          else run = [];
          if (run.length === count + 1) {
            out.push(
              conflict(
                rule,
                d.date,
                run[run.length - 1].id,
                `${run.length} early starts back to back, ending ${d.date}. Sleep debt ` +
                  `builds across a run like this faster than any one night shows.`,
                [
                  "Bring bedtime forward across the whole run, not just the night before.",
                  "Protect a recovery sleep on the far side of it.",
                ],
              ),
            );
            run = run.slice(1);
          }
        }
        break;
      }
      default:
        // Plan-dependent; handled by planViolations.
        break;
    }
  }

  // Collapse to one conflict per rule per date.
  //
  // Two rest periods can end on the same date when a date carries two duties, and the
  // same rule then fires twice with the same (rule, date) key. Left in, the answer key
  // holds indistinguishable entries and a system that surfaces one gets credit for
  // both — so the metric would quietly overstate. A crew member only needs telling
  // once about a given rule on a given date anyway.
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.ruleId}@${c.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function overlaps(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function blockMinutesOf(b: SleepBlock): number {
  return minutesBetween(new Date(b.startUtc), new Date(b.endUtc));
}

/** Rules a specific plan breaks. These are the planner's own errors. */
export function planViolations(
  plan: SleepPlan,
  duties: Duty[],
  profile: CrewProfile,
  pack: RulePack,
): Conflict[] {
  const out: Conflict[] = [];
  const working = duties.filter((d) => d.reportUtc && d.endUtc);

  for (const rule of pack.rules) {
    switch (rule.check.kind) {
      case "no_sleep_during_duty": {
        for (const b of plan.blocks) {
          for (const d of working) {
            if (
              overlaps(
                new Date(b.startUtc), new Date(b.endUtc),
                new Date(d.reportUtc!), new Date(d.endUtc!),
              )
            ) {
              out.push(
                conflict(rule, d.date, d.id, `A ${b.kind} overlaps the duty on ${d.date}.`, [
                  "Move the block outside the duty.",
                ]),
              );
            }
          }
        }
        break;
      }
      case "max_nap_minutes": {
        for (const b of plan.blocks) {
          if (b.kind === "pre-duty-nap" && blockMinutesOf(b) > rule.check.minutes) {
            out.push(
              conflict(
                rule, b.startUtc.slice(0, 10), b.id,
                `A ${formatDuration(blockMinutesOf(b))} pre-duty nap, against a ` +
                  `${formatDuration(rule.check.minutes)} cap.`,
                ["Shorten it, or make it the main sleep instead."],
              ),
            );
          }
        }
        break;
      }
      case "nap_ends_before_pickup": {
        for (const b of plan.blocks) {
          if (b.kind !== "pre-duty-nap") continue;
          const next = working.find((d) => new Date(d.reportUtc!) >= new Date(b.endUtc));
          if (!next) continue;
          const pickup = addMinutes(
            new Date(next.reportUtc!), -commuteFor(profile, next.station),
          );
          const gap = minutesBetween(new Date(b.endUtc), pickup);
          if (gap < rule.check.minutes) {
            out.push(
              conflict(
                rule, next.date, b.id,
                `That nap finishes ${formatDuration(gap)} before you leave — you want at ` +
                  `least ${formatDuration(rule.check.minutes)} to shake it off.`,
                ["Wake earlier.", "Drop the nap and go for the earlier bedtime instead."],
              ),
            );
          }
        }
        break;
      }
      case "min_gap_between_sleeps": {
        const sorted = [...plan.blocks].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
        for (let i = 1; i < sorted.length; i++) {
          const gap = minutesBetween(new Date(sorted[i - 1].endUtc), new Date(sorted[i].startUtc));
          if (gap < rule.check.minutes) {
            out.push(
              conflict(
                rule, sorted[i].startUtc.slice(0, 10), sorted[i].id,
                `Only ${formatDuration(gap)} between one sleep ending and the next ` +
                  `starting — that is one broken night, not two.`,
                ["Merge them, or drop the second."],
              ),
            );
          }
        }
        break;
      }
      case "min_main_sleep_minutes": {
        const rests = restPeriods(duties, profile);
        // The slot actually available to THIS block, not the whole rest period: a window
        // holding two nights gives the second one only what is left after the first plus
        // the separation. Measuring against the whole window called a boxed-in 5h15
        // second night the planner's fault when nothing could have made it longer.
        const ordered = [...plan.blocks].sort((a, b) => a.startUtc.localeCompare(b.startUtc));
        const sepRule = pack.rules.find((x) => x.check.kind === "min_gap_between_sleeps");
        const sep = sepRule && sepRule.check.kind === "min_gap_between_sleeps"
          ? sepRule.check.minutes : 0;
        for (const b of plan.blocks) {
          if (b.kind !== "main") continue;
          const len = blockMinutesOf(b);
          if (len >= rule.check.minutes) continue;
          // Only the planner's fault if the window could have held a longer sleep.
          const r = rests.find((rp) =>
            overlaps(
              new Date(b.startUtc), new Date(b.endUtc),
              new Date(rp.sleepWindowFromUtc), new Date(rp.sleepWindowToUtc),
            ),
          );
          if (!r) continue;
          const idx = ordered.findIndex((x) => x.id === b.id);
          const prevBlock = ordered[idx - 1];
          const nextBlock = ordered[idx + 1];
          const slotFrom = Math.max(
            new Date(r.sleepWindowFromUtc).getTime(),
            prevBlock ? new Date(prevBlock.endUtc).getTime() + sep * 60_000 : 0,
          );
          const slotTo = Math.min(
            new Date(r.sleepWindowToUtc).getTime(),
            nextBlock ? new Date(nextBlock.startUtc).getTime() - sep * 60_000 : Infinity,
          );
          const slot = Math.round((slotTo - slotFrom) / 60_000);
          if (slot >= rule.check.minutes) {
            out.push(
              conflict(
                rule, b.startUtc.slice(0, 10), b.id,
                `A ${formatDuration(len)} main sleep in a slot that had room for ` +
                  `${formatDuration(slot)}.`,
                ["Lengthen it — the time was available."],
              ),
            );
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}
