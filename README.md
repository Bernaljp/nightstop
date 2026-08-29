# Nightstop

**Fatigue-informed sleep planning for airline crew.** Upload your roster, get a plan for
when to sleep across the month — and, where the roster collides with a rule, a plain
statement of the collision and what you could do about it.

Built for the micro1 Agentic Workflows Hackathon. Nothing in this repository predates
the competition; what I brought to it was familiarity with the problem and knowing
someone it affects directly.

---

## Try it

**[Open the demo](https://claude.ai/code/artifact/379e642f-93fb-456f-9226-51f0b57b2567)** ·
**[Read the submission page](https://claude.ai/code/artifact/95f33aff-4fbc-49c6-bd88-ee53f12c7adb)**

The demo replays every recorded run: pick any of the twelve rosters, switch
between the first version and the last, and see exactly what each read, planned, surfaced
and withheld — checked against the same ground truth the evaluation used. It also runs
live on a roster you paste, using the real reader prompt and the real planning engine
bundled from this repository.

```bash
npm run demo:data && npm run demo   # writes site/demo.html
```

## Who has this problem

Line pilots and cabin crew on rotating rosters that cross time zones. Every month a PDF
arrives with thirty days of duty on it: early starts, night sectors, standby windows,
layovers in cities several hours from your own body clock.

Working out *when to sleep* against that is real work, and it is work nobody does for
them. Operator systems answer a different question — is this duty legal? — which is the
company's problem, not the crew member's. The crew member's problem is **when do I go to
bed on the 14th**, and the honest answer depends on where their body clock actually is,
how much sleep debt has built up, and how much of their rest period the commute eats at
both ends.

## What they do today, and why it is not good enough

Two things. They work it out by hand, or they paste the roster into a chatbot.

I measured the second one. **It reads the roster at 99.3% field accuracy and still
produces a plan you cannot rely on, in eight cases out of eight.** Seven of those read
the month perfectly and withheld every real collision — not because the model is weak,
but because nobody showed it your operator's manual or asked what *your* lines are. It
also invented 69 rules across eight rosters that it then cited at you.

That is the shape of the bottleneck. The fatigue science is not the scarce thing. What is
scarce is a system that reads *your* roster exactly right, knows *your* rules, and tells
you which of them your month breaks.

## What Nightstop does

```
 roster PDF ────► READER (model)          Every airline lays a roster out differently.
                    │                     This is the one job that genuinely needs a
                    │                     model, and it is given tools rather than
                    │                     trusted with arithmetic:
                    │                       to_utc            timezone conversion,
                    │                                         including the hours that
                    │                                         repeat and the ones that
                    │                                         do not exist
                    │                       reconcile_totals  the document grading its
                    │                                         own transcription against
                    │                                         its printed totals
                    ▼
              ENGINE (deterministic)      Places sleep in every rest period and finds
                    │                     every rule collision. No model: putting a
                    │                     block of sleep in a window is arithmetic, and
                    │                     arithmetic from a model is arithmetic you have
                    │                     to check anyway.
                    ▼
              BRIEFING                    One page. What needs a decision first, then
                                          the month, then the detail.
```

**It always produces a schedule.** Where the roster forces a collision with a rule, the
collision is stated with something you could actually do about it, and the choice is
left to you. That is not a design preference: 14 CFR 117.25(f) puts the judgement about
whether a rest period gives eight hours of sleep opportunity **on the crew member by
name**, and requires them to speak up. A tool that quietly decided for you would be
taking a decision the regulation says is yours.

Rules come from three places and they are not the same kind of thing:

| | |
|---|---|
| **hard limit** | your regulator or operator says it must not happen |
| **recommendation** | fatigue science or company policy says it is a bad idea |
| **preference** | your own line, and only you can move it |

You can supply your own. Point it at your operator's manual and the rule distiller reads
it **once** and reduces it to a pack — because a flight crew manual is mostly uniform
standards, expense claims and security procedures, and putting the whole thing in front
of the planner every month would be absurd.

```bash
npm run distill -- docs/sources/far-117.txt
```

| Document | In | Out | Planner carries |
|---|---|---|---|
| Synthetic operator manual | ~2,841 tokens | ~586 tokens | **79.4% less** |
| 14 CFR Part 117 (real, from eCFR) | ~7,021 tokens | ~711 tokens | **89.9% less** |

Size alone would be a hole rather than a saving, so recall is measured too. Against
`lib/rules/operator-pack.ts` — the reference distillation written by hand *before* the
distiller existed — it recovered **3 of 3** rules, and found a fourth the reference had
missed (minimum rest away from base, ten hours plus travel at both ends).

The more interesting output is what it refuses. Asked for Part 117's duty limits it
returns them as *not encodable*:

> Table B (unaugmented FDP limits, 9–14 hours) and Table C (augmented, 13–19 hours):
> these are keyed on acclimated report time and either segment count or number of
> pilots… inventing one would attribute a limit to the FAA that the FAA did not set.

And on hardness, unprompted: *"No recommendations were produced: this is a regulator's
text throughout, phrased as 'no certificate holder may' / 'must', with no operator policy
layered above it."* Which is the right reading — whether a rule is a limit or advice
depends on who wrote the document, not on how the sentence is phrased.

## Results

Eight synthetic rosters, one grader, same task for every arm. Full tables in
[`RESULTS.md`](RESULTS.md); every number there is read out of a run's `summary.json`
rather than typed.

| | `b1-chatbot` | `b2-steelman` | **`nightstop`** | `reference` |
|---|---|---|---|---|
| **Trustworthy runs** | 0/8 | 1/8 | **8/8** | 8/8 |
| **Silently wrong** (target 0) | 8/8 | 3/8 | **0/8** | 0/8 |
| Field-level parse accuracy | 99.3% | 99.3% | 100% | 100% |
| Conflict recall | 0% | 77.5% | 100% | 100% |
| False alarms raised | 69 | 37 | **0** | 0 |
| Cost per roster | $0.65 | $0.80 | $0.61 | $0.00 |

- **`b1-chatbot`** — one prompt, the PDF, your settings. What you get today.
- **`b2-steelman`** — same model and effort, handed the *same* rule pack and settings
  the full pipeline gets, but one shot, no tools, no second pass. This is the arm the
  improvement claim rests on; `b1` alone would be a soft target.
- **`reference`** — plans from ground-truth duties. Not a baseline: it isolates how much
  of any shortfall is the *reading* rather than the planning.

A run counts as **trustworthy** only if every duty-bearing field matches ground truth
exactly, every collision the roster forces is surfaced, and nothing is raised that is not
real. **Silently wrong** is reported at equal prominence because it is the only outcome
that can hurt someone: a plan delivered off a misread roster, or one that withheld a real
collision. A binary primary alone hides the difference between *wrong* and *flagged*.

### Held out

Four more rosters, generated from a separate seed **after every agent prompt was frozen**
and not run against until the end. They recombine the same documented layout differences
into shapes the development set does not contain — every hard feature at once, a roster
printing no totals at all so the reader's self-check is simply absent, Spanish labels on
a daylight-saving month, and single-character activity codes where a day off is a bare
hyphen.

| | `b1-chatbot` | **`nightstop`** | `reference` |
|---|---|---|---|
| Trustworthy runs | 0/4 | **4/4** | 4/4 |
| Silently wrong | 3/4 | **0/4** | 0/4 |
| Conflict recall | 0% | 100% | 100% |
| False alarms | 39 | **0** | 0 |

**How that number was reached, because it matters.** The first held-out run scored 3/4,
and the failing case turned out to be a bug in *my corpus*, not the reader: the generator
dated rows by base local day while printing times in UTC, so the date column and the time
column disagreed with nothing on the page to say which to believe. The reader transcribed
it exactly as printed and flagged the resulting overlap as probably an error in the source
roster — the more defensible of the two readings. My answer key was wrong. Fixing it
exposed a second bug (the re-dating collided with day-off filling, printing a flight and a
day off on the same date), and the set was re-run after that too.

**No agent prompt, tool or rule was changed at any point.** That is checkable rather than
promised:

```bash
npm run verify:freeze
```

It diffs everything an agent reads against the freeze commit and fails if anything moved.
Fixing a fixture is not tuning a system, but the distinction is only worth anything if
someone else can verify it.

The metric, the field list and the held-out design were fixed in
[`docs/eval-preregistration.md`](docs/eval-preregistration.md) before any agent ran.

**Variance.** The pre-registration commits to three repeats of the final arm, because at
n=8 a single flake moves the primary by 12.5 points. It has now run **four times, 8/8
every time, 0 silently wrong** — no variance across repeats. Every run is listed
individually in [`RESULTS.md`](RESULTS.md), including the one before the derivation
change that scored 7/8 and is marked as a different configuration rather than pooled in
as variance. The baseline arms remain n=1.

(Two earlier repeat attempts died partway through against an account session limit and
were deleted rather than reported — a run that measured a quota wall is not a measurement
of this system. `REPRODUCE.md` says how to spot one.)

## Improvement Changelog

| Stage | What I tried, and why | Evidence | Decision |
|---|---|---|---|
| **Baseline** | `b1-chatbot`: one prompt, the roster PDF, the crew member's own settings. The honest state of the art. | 0/8 trustworthy · 8/8 silently wrong · recall 0% · 69 false alarms | Kept as the baseline. The 0% recall is information asymmetry, not incapacity — it cannot cite rules nobody gave it. |
| **1 · give it the rules** | `b2-steelman`: same model and effort, handed the rule pack. Tests whether the whole problem is just that the model was under-informed. | 1/8 trustworthy · silently wrong 8→3 · **recall 0%→77.5%** · false alarms 69→37 | Kept, as the fair comparison arm. Most of the value is here — but 37 invented rules across 8 rosters, and a rule it made up is worse than one it missed. |
| **2 · tools, not arithmetic** | Reader gets `to_utc` and `reconcile_totals`; the deterministic engine does the placing and the rule checking. | 7/8 trustworthy · silently wrong 3→1 · **recall 100%** · **false alarms 37→0** | Kept. Moving the rule check out of the model is what takes false alarms to zero: a deterministic checker cannot invent a rule. |
| **3 · make it show its work** | Reader must record which values it **derived** rather than read, and say which rule it used. Motivated by the single remaining failure (below), and I expected it to only *surface* the error rather than fix it. | **8/8 trustworthy · 0/8 silently wrong** · d04-kestrel misread → surfaced | Kept, and it is the most surprising result here. Being asked to distinguish a value it read from one it inferred changed whether it inferred correctly. |
| **4 · own rules in** | The distiller: read a rules document once, reduce it to a pack with a hardness on every rule, and never show the planner the source. | Part 117 ~7,021 → ~711 tokens (**−89.9%**); 3/3 recall against the hand-written reference, plus one rule it had missed | Kept. The refusals matter as much as the extractions — it declines to collapse a table-driven limit into a number. |
| **Removed** | A repair pass that resolves flagged uncertainties instead of surfacing them. Predicted to raise the primary metric while making the system more dangerous. | 8/8 either way — **but values shown to the crew member 33 → 0**, cost +38% | Cut. The metric could not see the change at all, which is worse than being fooled by it. [`docs/removed-experiments.md`](docs/removed-experiments.md) |

### The failure that drove stage 3

After stage 2 exactly one case failed, and it is worth more than the seven that passed.

`d04-kestrel` is the roster that does not print report time — it has to be derived from
an offset table in the header, and the offset differs by haul: 45 minutes short, 75
minutes long. On one duty the reader applied 45 to a long-haul BOS–MAD sector, putting
that report time half an hour late. **329 of 330 fields correct**, and the case is still
untrustworthy, because half an hour is the difference between a nap that helps and one
that does not.

What makes it instructive is what did *not* catch it:

- **The header totals reconciled.** Report time is not part of block hours, so the
  document's own checksum passed while the value was wrong.
- **The reader declared no uncertainty.** It was confident.

A document can only grade what it prints. A *derived* field has no checksum at all.

## Main failure mode

**Confident derivation.** Everything on the page can be checked against something else on
the page; everything worked out from it cannot. Stage 3 helps by making derivations
explicit, and the briefing now shows them under *Worth confirming* — but the underlying
exposure has not gone away, it has been made visible. If I kept building, the next thing
would be a second checksum specifically for derived fields: for a stated offset table,
every derived report time must equal STD minus exactly one of the stated offsets, and the
choice must be consistent across sectors of the same haul.

## Hot take

**A good metric is necessary and it is not sufficient — and the two worst bugs in this
project were in the measuring apparatus, not the thing being measured.**

Four things happened here that I did not expect, and they point the same way.

The grader compared timestamps as strings, so `08:00:00.000Z` and `08:00:00Z` counted as
a misread. It reported 78% field accuracy on a roster that had been read perfectly. Had
I not looked at *which* fields were wrong, I would have shipped a chart showing my system
fixing an error that never existed.

My answer key was wrong about days off — it recorded every one as being at base, when
flying MAD→ORD on the 1st means the 2nd is spent in Chicago. I found out because the
reader disagreed with me on six fields and was right about all six.

The fix for the last failing case was not a rule or a check. It was asking the model to
say which values it had worked out rather than read.

And the experiment I removed did not lose on the scoreboard. I expected it to *beat* the
primary metric while being more dangerous. Instead it tied on every number I report,
while taking the count of values a crew member can check from 33 to 0 and costing 38%
more. The metric could not see the difference — which is worse than being fooled by it,
because being fooled at least leaves a trace.

So: in a safety-adjacent domain the useful question is not *how good is the output* but
*can the system tell the difference between something it knows and something it worked
out* — and, one level up, **can your evaluation see the difference between a plan that
was checkable and one that merely looked certain.** Mine could not, and the decision to
cut the repair pass came from reading what a crew member would actually hold, not from
any number in my results table.

Build the scoreboard before the agent. Then distrust the scoreboard too, and go and look
at the artefact.

## Running it

Full instructions, versions, runtime and cost in [`REPRODUCE.md`](REPRODUCE.md). The
short version:

```bash
npm install
npm run corpus          # regenerate the 8 rosters from a seed, byte-identical
npm run verify:grader   # 42 assertions proving the scoreboard — no API key needed
npm run verify:freeze   # proves the held-out set was not tuned against
npm run eval -- --arm reference    # the deterministic ceiling — no API key needed
npm run eval -- --arm nightstop    # the full pipeline (needs credentials)
npm run distill -- docs/sources/far-117.txt   # a regulation into a rule pack
npm run report          # rebuild RESULTS.md from the runs on disk
```

Model access is the Claude Agent SDK, which authenticates with existing Claude Code
credentials; set `ANTHROPIC_API_KEY` in `.env.local` instead if you prefer.

## Ground rules

- **Advisory only.** No ruling on whether any duty is legal. The operator owns that.
- **Synthetic data throughout.** Every airline, roster and crew reference in this
  repository is invented. No real person's schedule appears anywhere in it.
- **Consequential actions are gated.** No model-facing tool can write to a calendar; the
  briefing is produced, and writing it anywhere is a separate step behind approval.
- **Sources are public.** 14 CFR Part 117 from eCFR, ICAO Doc 9966, FAA AC 120-103A, UK
  CAA Paper 2003/8, Flight Safety Foundation controlled-rest guidance. Where a number is
  a reading of guidance rather than a quoted limit, the rule says so.
