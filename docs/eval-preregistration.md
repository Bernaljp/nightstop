# Evaluation pre-registration

Committed **before** the held-out corpus was generated and before any agent was run
against any case. Nothing below was chosen after seeing a result. The commit that
introduced this file is the one to check the dates against.

The point of writing this down first is narrow and practical: on a twelve-case
evaluation, the temptation to widen a field list or reclassify a bucket after seeing a
number is enormous, and completely invisible in the final report. This file is what
makes that visible.

## What is being measured

A run takes one roster PDF and the crew member's own settings, and produces a sleep
plan. Nightstop's promise is *always produce a schedule, and never hide a collision* —
so the evaluation asks two questions, not one.

## Primary metric — trustworthy runs, X/12

A case scores 1 if and only if **all three** hold:

1. every duty-bearing field the run read matches ground truth exactly;
2. every rule collision the roster forces is surfaced to the crew member;
3. no collision is raised that is neither forced by the roster nor present in the plan
   that was produced.

## Co-primary — silently wrong, N/12, target 0

Reported at the same prominence as the primary. A run is silently wrong if it delivered
a plan that either (a) was built on a roster it read incorrectly, or (b) withheld a real
collision. These are the only outcomes that can put someone in a cockpit worse rested
than they think they are. A binary primary alone hides the difference between *wrong*
and *flagged*, which is the distinction this whole project turns on.

## Duty-bearing fields — fixed now, not later

Exactly these, and no others:

`date`, `kind`, `station`, `endStation`, `reportUtc`, `endUtc`,
`sectorCount`, `sectorOrigins`, `sectorDests`, `sectorDepUtc`, `sectorArrUtc`

These are the fields the sleep engine consumes. `flightNo` and aircraft type are
transcribed but excluded: reading a flight number wrong is cosmetic, where reading a
report time wrong puts someone to bed at the wrong hour. The list lives in code at
`lib/corpus/schema.ts` as `DUTY_BEARING_FIELDS` and the grader reads it from there, so
it cannot drift from this document without the diff showing it.

## Buckets

Every case lands in exactly one, taking the worst it qualifies for:

| Bucket | Meaning | Counts as |
|---|---|---|
| `clean` | no collisions existed, none raised | trustworthy |
| `surfaced` | collisions existed, all surfaced | trustworthy |
| `false_alarm` | all real ones surfaced, plus one that was not real | — |
| `missed` | a real collision withheld | silently wrong |
| `misread` | plan produced from a roster read wrong | silently wrong |
| `unusable` | no plan produced, or crashed | — |

`false_alarm` is deliberately not counted as silently wrong, and deliberately not
ignored either. Crying wolf does not endanger anyone directly; it gets the tool closed
and never opened again, which does.

## Secondary metrics

Reported for every arm, so an iteration that does not move the primary still has an
evidence cell rather than a shrug:

- field-level parse accuracy (fraction of duty-bearing fields correct)
- conflict recall (real collisions surfaced / real collisions present)
- false alarms raised (count)
- input tokens per run, before and after rule distillation
- USD per run, from `usage`, with cache reads and cache writes priced separately
- wall clock per run
- human minutes per roster

## Arms

| Arm | What it gets |
|---|---|
| `b0-manual` | A person, the PDF, and a clock. n=1, reported as n=1. |
| `b1-chatbot` | One prompt, the PDF attached, no tools, no rule pack. What crew do today. |
| `b2-steelman` | Same model and effort as the final system, handed the *same* inputs — extracted text, the distilled rule pack, the crew member's settings — but one shot, no tools, no review loop. |
| `final` | The full pipeline. |

`b2 → final` is where the improvement claim rests. `b1` is the honest state of the art;
`b0` is what happens without a computer at all. A resources table accompanies the
results, because the arms genuinely do not have the same tools and pretending otherwise
would make the comparison worthless.

## Corpus and the held-out split

Eight development cases, generated with seed `20260828`, hashed in
`corpus/manifest.dev.sha256`, committed before the first agent run.

**Four held-out cases**, generated from a different seed, only after every agent prompt
and skill document is frozen. **They were frozen at commit `7b77a67719996342d81034ec90be858a1e2b5aa7`** — that
commit contains every prompt used by every arm, and the held-out corpus was generated
after it. Check the dates. They will not be opened, inspected, or run against until
the final evaluation. Dev and held-out scores are reported separately. If the held-out
number is worse, that is reported as it stands and the failure explained — a held-out
score that mysteriously matches dev is not evidence of anything.

## Repeats

The final arm runs three times over the full corpus and all three are reported. At
n=12, a single flake moves the primary by 8 points, and a submission that reports one
run has not measured its own variance.

## Amendments, recorded after the fact

Stated here rather than folded into the results, because the point of a pre-registration
is that departures from it are visible.

**The planner changed seven times after the first held-out set had been run.** In order:
a prophylactic nap before duties running through the circadian low; planning every night
in a window rather than one per rest period; shifting bedtime earlier before an early
report and later after a late arrival; anchoring the plan to the hours each crew member
actually keeps, with recovery sleep after a duty that takes those hours off them;
limiting a rest period to one supplementary sleep, separated by four hours; allowing time
to get through the door before sleep starts; and buying sleep with time awake at roughly
2:1 rather than giving every body-clock night a full eight hours.

Every one was a real defect. None was found by a metric — all seven came from rendering
the output and looking at it, six of them from someone else looking. Every arm was
re-run on every corpus after each, and the headline numbers did not move.

Two further changes touched no plan at all. The briefing drew each block in its own
station's timezone, which let a westbound duty and the sleep after it overlap on the page
without overlapping in time; the geometry now comes from a single clock. That fix was then
found to be half a fix — the labels were still in station time, so a block positioned at
00:41 was captioned "ORD 17:41" — and one clock now sets position, label, agenda and table
together, selectable across home, any station on the roster, or UTC. The block reasons were
rewritten to carry durations and place names only, never a clock reading, so nothing in the
text can contradict the zone the reader chose. No number in this pre-registration could have
caught either, and none moved when they were fixed.

**A note on re-planning.** Because the reader is the expensive half and the planner is
deterministic, a planner fix is re-applied to finished runs from the duties they already
read (`npm run replan`), then re-graded. Only the sleep blocks are rebuilt; conflicts are
left exactly as each arm produced them, so the ablation's model-found conflicts are never
quietly replaced with the engine's.

**The honest reading of the held-out numbers.** After the second and third changes the
configuration was re-frozen and a **second** held-out set generated from an unused seed,
because a set that has been seen is not held out. Then the planner changed again. Rather
than re-freeze indefinitely — a freeze nobody can maintain while fixing real bugs is
theatre — here is the precise claim, which `npm run verify:freeze` checks:

> **The reader has never been tuned.** Every prompt and tool a model sees is
> byte-identical to the original freeze at `7b77a67`. No held-out roster has ever
> influenced how a document is read.

The planner is not frozen and is not claimed to be. So a held-out score here means: the
reading was never tuned against these rosters, and the collisions were surfaced under the
rule pack in force when the run happened. Both held-out sets, and every run of each, are
in `results/` and listed in `RESULTS.md`.

## What would falsify the claim

Stated now so it cannot be quietly dropped later:

- If `b2-steelman` matches `final` on both primary and co-primary, the orchestration
  does not earn its cost and the honest conclusion is that one good prompt was enough.
- If rule distillation does not reduce input tokens per run without losing conflict
  recall, it is complexity for its own sake.
- If the review loop never changes a plan across twelve cases, it is decoration.

Each of those outcomes gets its own changelog row if it happens.
