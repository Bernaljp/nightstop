# Nightstop

**Fatigue-informed sleep planning for airline crew.** Upload your roster, get a plan for
when to sleep across the month — and, where the roster collides with a rule, a plain
statement of the collision and what you could do about it.

Built for the micro1 Agentic Workflows Hackathon. Nothing in this repository predates
the competition; what I brought to it was familiarity with the problem and knowing
someone it affects directly.

---

## How agents built this

The brief rewards purposeful agent use and asks for trajectories from every agent used.
Agents appear twice here: inside the product, and in the building of it.
[`docs/how-agents-built-this.md`](docs/how-agents-built-this.md) is the second half, and it
leads with what *did not* happen — no `/wayfinder` map, no custom skills, no ADRs, and the
empty directories that prove it. What did shape the build: four bundled skills, each with a
visible consequence in the repository, and four planning subagents, one of which is the
reason this evaluation has a co-primary metric at all.

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

**Two held-out sets, and why.** The engine changed several times after the first freeze —
naps, night coverage, the two shift rules, the crew member's own hours — and each change
made that first set less held out, because it had already been seen. Amending a
pre-registration once is honest; doing it four times and still calling the number held out
is not. So the configuration was re-frozen at `577189a` and a **second** set generated from
a seed never used before: **4/4 trustworthy, 0 silently wrong, against the chatbot's 0/4
and 4/4 silently wrong.** The first set is kept in `RESULTS.md` — it remains a fair test of
the reading, which never changed — but the clean claim rests on the second.

**How the first set's number was reached, because it matters.** The first held-out run scored 3/4,
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

## What each change was worth

Four arms, each differing from the one above it by **one** thing, on the same eight
rosters under the same grader. The third exists only to answer a question the other three
cannot.

| | one prompt | + the rule pack | + tools | + deterministic checking |
|---|---|---|---|---|
| **Trustworthy** | 0/8 | 1/8 | 1/8 | **8/8** |
| Silently wrong | 8/8 | 3/8 | 0/8 | **0/8** |
| Reads the roster | 99.3% | 99.3% | **100%** | 100% |
| Finds real collisions | 0% | 77.5% | **100%** | 100% |
| **Invents rules** | 69 | 37 | 40 | **0** |
| Cost per roster | $0.65 | $0.80 | $0.88 | **$0.71** |

Read across that table and the story is not the one I expected to be telling.

**Giving it the rules is most of the value, and nowhere near enough.** Recall goes 0 → 77.5%
because a model cannot cite an operator manual nobody showed it. But it starts attributing
limits to regulators that never set them.

**Tools fix the reading, completely.** `to_utc` — which knows about the hours that repeat
and the ones that never happen — and `reconcile_totals`, which checks the transcription
against the totals the document prints about itself. Field accuracy goes to 100% and stays
there. Silently wrong goes to zero.

**And then the model finds every single real collision — 100% recall — and still fails.**
That third column is an ablation: same reader, same tools, same engine placing the sleep,
the model asked only to find the rule collisions instead of a function computing them. It
finds all of them. It also invents **40** across eight rosters, so seven of eight cases are
untrustworthy, and it costs *more* to do it.

**The last column changes one thing.** The rule check moves out of the model and into a
deterministic function. Invented rules: 40 → 0. Trustworthy: 1/8 → 8/8. Cheaper, too.

Three of the seven stages moved neither headline number. All three were real defects — a planner that never suggested a nap, one that left every day
off unplanned, and one that gave every crew member the same bedtime regardless of what they
told it — and all three were found by rendering the output and looking at it, never by a
metric. That is the argument for the hot take below as
much as any of the numbers above.

> The model was never the bottleneck on **finding** collisions. It was the bottleneck on
> **not inventing** them. A deterministic checker cannot invent a rule — the failure mode
> is removed by construction rather than discouraged by prompting.

So the biggest single improvement in this project came from taking work *away* from the
model. The agentic engineering that mattered was deciding, with evidence, which half of the
job it should not be doing — and the tools that let it do the other half exactly right.

## Improvement Changelog

| Stage | What I tried, and why | Evidence | Decision |
|---|---|---|---|
| **Baseline** | `b1-chatbot`: one prompt, the roster PDF, the crew member's own settings. The honest state of the art. | 0/8 trustworthy · 8/8 silently wrong · recall 0% · 69 false alarms | Kept as the baseline. The 0% recall is information asymmetry, not incapacity — it cannot cite rules nobody gave it. |
| **1 · give it the rules** | `b2-steelman`: same model and effort, handed the rule pack. Tests whether the whole problem is just that the model was under-informed. | 1/8 trustworthy · silently wrong 8→3 · **recall 0%→77.5%** · false alarms 69→37 | Kept, as the fair comparison arm. Most of the value is here — but 37 invented rules across 8 rosters, and a rule it made up is worse than one it missed. |
| **2 · tools, not arithmetic** | Reader gets `to_utc` and `reconcile_totals`; the deterministic engine does the placing and the rule checking. | 7/8 trustworthy · silently wrong 3→1 · **recall 100%** · **false alarms 37→0** | Kept. Moving the rule check out of the model is what takes false alarms to zero: a deterministic checker cannot invent a rule. |
| **2b · ablation: who should check the rules?** | Held the reader, tools and engine identical and gave the rule check back to the model, to find out whether the gain in stage 2 belonged to the tools or to the deterministic checker. | Recall stays 100%, field accuracy stays 100% — and invented rules go 0 → **40**, trustworthy 8/8 → **1/8**, at higher cost | The deterministic checker is worth seven of eight cases. Kept as evidence; it is why the final system has no LLM in the rule path. |
| **3 · make it show its work** | Reader must record which values it **derived** rather than read, and say which rule it used. Motivated by the single remaining failure (below), and I expected it to only *surface* the error rather than fix it. | **8/8 trustworthy · 0/8 silently wrong** · d04-kestrel misread → surfaced | Kept, and it is the most surprising result here. Being asked to distinguish a value it read from one it inferred changed whether it inferred correctly. |
| **4 · own rules in** | The distiller: read a rules document once, reduce it to a pack with a hardness on every rule, and never show the planner the source. | Part 117 ~7,021 → ~711 tokens (**−89.9%**); 3/3 recall against the hand-written reference, plus one rule it had missed | Kept. The refusals matter as much as the extractions — it declines to collapse a table-driven limit into a number. |
| **5 · a nap you would actually take** | The planner had never recommended a nap in twelve rosters — the rule only fired below a six-hour night, and the tightest window is 6h50. Added a prophylactic nap before any duty running an hour or more through the circadian low. Found by building the demo, not by reading a metric. | 2–6 naps per roster (0 on the short-haul European case, correctly); primary and co-primary **unchanged** at 8/8 and 0 | Kept. It moved no number I report, which is the point: the summary statistics could not see that a whole class of advice was missing. |
| **6 · every night, not one per gap** | The planner placed one main sleep per *rest period*, which is right only when the rest period is one night — and four of the first six on the Aurora roster span two. Every day off had no sleep at all. Found by someone looking at the calendar, not by a metric. | Night coverage ~19 → 20–27 per month; plan violations 70 → 15 → **0** as the two shift rules landed; primary and co-primary **unchanged** at 8/8 and 0 | Kept. The second stage running that moved no number I report. |
| **7 · their hours, not a default** | Everyone was being given a 23:00 bedtime — a hardcoded default the crew member had no say in. Real crew differ by hours. `usualSleep` is now part of the profile, every night is anchored to it, and recovery sleep follows a duty that took 90 minutes or more out of the hours they normally keep. | Recovery sleep produced for the first time (it was declared in the schema and never emitted); the advice changes from *"23:00 to 07:00"* to *"about 3h27 later than your usual 21:30 — the roster leaves no room to keep your normal hours here"*; primary and co-primary again **unchanged** | Kept. Third stage in a row that moved no headline number. |
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

## The calendar

The plan is delivered as an `.ics` file alongside the briefing — every sleep block with
its reasoning in the description, plus your duties for context, marked *free* so the plan
never blocks out your own diary.

```bash
npm run brief -- results/<runId> d05-halcyon    # writes the briefing and the .ics
```

Google Calendar takes it under Settings → Import & export; macOS and iOS open it
directly; Outlook imports it as an iCalendar file. Times are absolute UTC instants, so a
phone renders them in whatever zone it is in — which is, by construction, the zone the
crew member will be sleeping in.

**Why a file rather than a Google Calendar API sync.** A sync needs an OAuth client, and
an unverified one is capped at an allowlist of test users with refresh tokens that expire
in seven days — anyone handed this plan would have to be added by hand first. The file
works for everyone immediately, needs no account setup, and makes the human checkpoint
structural: nothing reaches a calendar until a person imports it. API sync would be the
right call for a product with a verified OAuth app behind it; it is the wrong call for
something a judge should be able to run in five minutes.

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
- **Consequential actions are gated.** No model-facing tool can write to a calendar. The
  plan comes out as an `.ics` file, and importing it is the approval — a person opens it
  and confirms, on their own device. The gate is the shape of the thing, not a prompt
  asking a model to behave.
- **Sources are public.** 14 CFR Part 117 from eCFR, ICAO Doc 9966, FAA AC 120-103A, UK
  CAA Paper 2003/8, Flight Safety Foundation controlled-rest guidance. Where a number is
  a reading of guidance rather than a quoted limit, the rule says so.
