# How this was built

The brief asks for trajectories from every agent used, and rewards purposeful agent use.
Agents appear here twice: inside the product, and in the building of it. The first half is
documented in `README.md` and `trajectories/`. This is the second, written to be checkable
rather than flattering.

## What did not happen, first

I want this stated before anything else, because the omission is the interesting part.

**No `/wayfinder`.** The plan for this project called for charting it as a map of decision
tickets on an issue tracker and working one per session. That did not happen. The build ran
as a single long session with a written plan, and the decisions ended up in commit messages
and ADR-shaped prose rather than as tickets with a frontier. For a two-day build in one
sitting that was the right call — the map's value is carrying state across sessions that
cannot see each other, and there was only one session. It would have been the wrong call
for anything longer.

**No custom skills were written for this build.** `.claude/skills/` in this repository is
empty. Skills shaped the work, but they were the ones already installed, not ones authored
here. A submission claiming "I wrote skills to improve my process" would be false, and the
empty directory is easy for anyone to check.

**No ADRs.** `docs/adr/` is empty. The decisions are in the commit log instead, which is
where they actually got written down. Naming a directory is not the same as using it.

## What did happen

### Skills, and what each one changed

Four bundled skills were consulted, and each changed the artefact in a way that is visible
in the repository.

| Skill | What it changed |
|---|---|
| `claude-api` | Stopped me guessing the SDK surface. It says plainly that it does *not* cover the Claude Agent SDK, which sent me to read the installed type definitions instead — where `generateToolResponse` turned out not to be the name I had in my head, and `budget_tokens` turned out to be rejected outright on this model. |
| `dataviz` | Produced the chart palette by running its validator rather than by eye. It returned a contrast **WARN** on aqua against the light surface, which is why every nap in the briefing carries a visible time label — the relief the validator requires. That label exists because a script said so. |
| `artifact-design` | The submission page's dark-first direction, the type pairing, and the three-scope theme token structure. It is also why `--wocl` being used before it was defined got caught: the skill names that exact bug. |
| `artifact-capabilities` | Told me the `sample` capability existed, which is the only reason the demo can run live rather than only replaying recordings. I would not have known to look. |

### Subagents

Four, all during planning, none during implementation.

- **Three `Explore` agents in parallel** — one surveying the prior project, one inventorying
  what `/wayfinder` and the design skills actually do, one on vault context. Fanned out
  because the three questions were independent and the answers were needed together.
- **One `Plan` agent** to attack the evaluation design before any of it was built. It is
  the reason the metric has a **co-primary** at all: it argued that a conjunctive binary
  cannot attribute a gain to a stage, and that a system which refuses everything scores well
  on a safety metric that only counts escalations. Both objections changed the design before
  a single case was run.

That agent also recommended things I did not take. It wanted the prior project disclosed by
name in the README; the author decided otherwise, and the constraint became *do not read it
at all*, which makes the disclosure unnecessary rather than hidden.

### The method that actually carried the build

Not a map. Three habits:

1. **The scoreboard before the agent.** The corpus, the grader and the grader's own proof
   were built and committed before anything called a model. Two of the worst bugs in the
   project were in the measuring apparatus, and both would have flattered the result.
2. **Look at the artefact, not the summary.** Every visual bug — the lost sector, the
   colliding labels, the calendar view that clamped to the wrong hour, the schedule that
   was never drawn — was found by rendering it and looking, never by reading the code.
3. **Re-grade rather than re-run.** Runs keep the duties they read, so correcting the
   grader or the corpus costs nothing. That is what let two answer-key bugs get fixed
   without paying to run the model again.

## If I did it again

I would use the map. Not for the reason I expected — not for planning — but because the
decisions in this project arrived faster than the write-up could absorb them, and several
were reconstructed afterwards from commit messages. A ticket per decision, resolved and
closed as it happened, would have produced the changelog as a by-product instead of as an
act of recall.

And I would write one skill: the advisory voice. Every user-facing string in this project
had to hold the same line — always produce a plan, state the collision, never rule on
legality, hand the choice back — and that line was re-derived by hand in the briefing, the
conflict text, the calendar descriptions and the demo. It is exactly the thing a skill is
for, and I wrote it four times instead.
