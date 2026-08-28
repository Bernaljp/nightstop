/**
 * The Nightstop pipeline.
 *
 * The division of labour is the point:
 *
 *   the model READS      every airline lays a roster out differently, and this is the
 *                        part no deterministic parser scales to
 *   the engine PLANS     placing sleep in a window and finding rule collisions is
 *                        arithmetic, and arithmetic from a model is arithmetic you have
 *                        to check anyway
 *   the model EXPLAINS   a collision a crew member cannot act on is not information
 *
 * And it always produces a schedule. Where the roster forces a collision with a rule,
 * the collision is stated with something they could do about it, and the choice is
 * left to them — which is not just a design preference: 14 CFR 117.25(f) puts the
 * judgement about sleep opportunity on the crew member by name.
 */
import type { Arm } from "../eval/run";
import { readRoster } from "./reader";
import { buildPlan } from "../plan/engine";

export const NIGHTSTOP_ARM: Arm = {
  name: "nightstop",
  describes:
    "Model reads the roster with a timezone tool and the document's own totals as a " +
    "checksum; the deterministic engine places sleep and finds every rule collision.",
  usesModel: true,
  async run(ctx) {
    const read = await readRoster(
      ctx.caseDir,
      { from: ctx.truth.coveredFrom, to: ctx.truth.coveredTo },
      ctx.truth.profile.base,
      ctx,
    );

    ctx.traj.note("reader", "read complete", {
      duties: read.duties.length,
      reconciledAgainstHeaderTotals: read.reconciled,
      derivations: read.derivations.length,
      uncertainties: read.uncertainties,
      format: read.notes,
    });

    // A reading that never reconciled against the document's own totals is not a reason
    // to refuse — a crew member with a roster in their hand still needs a plan tonight.
    // It is a reason to say so, loudly, at the top of what they are given.
    if (read.reconciled === false) {
      ctx.traj.escalation(
        "reader",
        "the header totals never reconciled with what was read",
        { uncertainties: read.uncertainties },
      );
    }

    const plan = buildPlan(
      ctx.truth.caseId,
      read.duties,
      ctx.truth.profile,
      ctx.pack,
    );
    plan.readingUncertainties = read.uncertainties;
    plan.derivations = read.derivations;

    if (read.derivations.length) {
      ctx.traj.note("reader", "values worked out rather than read", {
        derivations: read.derivations,
      });
    }

    ctx.traj.final("engine", {
      blocks: plan.blocks.length,
      conflicts: plan.conflicts.length,
      byHardness: plan.conflicts.reduce<Record<string, number>>((a, c) => {
        a[c.hardness] = (a[c.hardness] ?? 0) + 1;
        return a;
      }, {}),
    });

    return { duties: read.duties, plan };
  },
};
