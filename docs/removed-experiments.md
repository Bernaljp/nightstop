# Experiments that were removed

The brief asks for the experiments that were taken out and what they taught. Both of
these were built, run, and cut — and the second one is the more useful of the two,
because it *improved* the primary metric and was removed anyway.

---

## 1. Letting the model check the rules

**What I tried.** In the first design the reviewer was a second model pass: give it the
rule pack and the plan, ask it to report every collision. It seemed obviously right —
rules are written in English, and checking English against a schedule is the sort of
thing a model is good at.

**What happened.** `b2-steelman` is that design, and it is in the results table.
Conflict recall went from 0% to 77.5%, which is a real gain. But it raised **37 false
alarms across eight rosters** — collisions with rules that either did not exist or did
not apply. Some were plausible-sounding inventions (`FRM.CIRCADIAN-WHIPLASH`,
`FTL.FDP.MAX`) attributed to regulations that say no such thing.

**Why it was cut.** A tool that invents a limit and attributes it to your regulator is
worse than one that misses a real one. The missed collision leaves you where you already
were; the invented one teaches you to disregard the tool, and then the real one goes
unread too. Moving the rule check into a deterministic function took false alarms from
37 to **0**, and a deterministic checker cannot invent a rule — the failure mode is
removed by construction rather than discouraged by prompting.

**What it taught.** Use the model for the part that is genuinely open-ended — reading a
document nobody has seen before — and not for the part that has a right answer. The
division is not about capability. It is about which failures you can afford.

---

## 2. Letting the model repair rows it could not read

**What I tried.** When the reader flags a value as uncertain — or as *derived* rather than
read — hand it back to the model on its own, with the roster and everything the first pass
produced, and ask it to resolve it. Cheap, about forty lines, and it targets exactly the
values most likely to be wrong. Run it yourself with `--arm nightstop-repair`.

**What I predicted.** That it would raise the primary metric while making the system more
dangerous, and that the removal would therefore cost me points on my own headline number.

**What actually happened.** Both arms scored **8/8 trustworthy, 0 silently wrong, 100%
field accuracy, 100% conflict recall**. Identical. What differs is everything the metric
does not look at:

| | shipped | with the repair pass |
|---|---|---|
| Trustworthy runs | 8/8 | 8/8 |
| Silently wrong | 0/8 | 0/8 |
| **Values the crew member is shown and can check** | **33** | **0** |
| Cost per roster | $0.61 | $0.84 (+38%) |

Thirty-three derived values across eight rosters — every one a number worked out rather
than read, each with its reasoning attached — become zero. The pass resolves them,
clears the flags, and hands over a plan that looks certain throughout. It costs 38% more
to produce that.

**Why it was cut.** On this corpus the repair pass happened to guess right every time, so
nothing broke. That is not a reason to keep it; it is the reason it is dangerous. The
behaviour is identical whether the guess is right or wrong — the flag is cleared either
way — so the only thing standing between a crew member and a confidently wrong report
time is that the model happened to be correct. Eight rosters is not evidence that it
always will be, and a derived value is precisely the kind nothing in the document can
check.

**What it taught, which was not what I expected.** I predicted the metric would reward the
dangerous change. It did something worse: **it could not see the change at all.** A
scoreboard that scores only the plan is blind to whether the crew member was given
anything to check it with, and my co-primary — silently wrong, target zero — did not
catch this either, because on this corpus nothing *was* silently wrong.

So the removal does not rest on a number in the results table. It rests on an argument
about which failure the design refuses, and the honest version of the hot take is:
**a good metric is necessary and it is not sufficient.** The thing that decided this was
looking at what the crew member ends up holding, which no summary statistic here reports.
If I kept building, "values surfaced for confirmation" would become a reported metric,
precisely so this trade stops being invisible.

There is a positive version of the same lesson in the changelog. The fix for the last
failing case was not to let the model guess harder, but to make it **say which values it
had worked out rather than read**. Same information, opposite direction: surfaced instead
of buried — and it fixed the error rather than hiding it.
