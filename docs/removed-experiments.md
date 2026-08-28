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

**What I tried.** When the reader flags a row as unreadable, hand that row back to the
model on its own, with more context, and ask it to work out what it says. Cheap, about
forty lines, and it targets exactly the cases that were failing.

**What happened.** It works. On the cases where the reader hesitated, the repair pass
usually produced the right answer and the primary metric went **up**.

**Why it was cut anyway.** Look at what it does to the *kind* of error. Before the repair
pass, an unreadable row was flagged and put in front of the crew member. After it, the
row was filled in confidently and the flag disappeared. The metric rewarded that, because
most of the guesses were right. But the ones that were wrong were now invisible — turned
from *"I could not read this, please check"* into an assertion of fact.

That is the trade this product exists to refuse. A crew member who is told the tool is
unsure loses thirty seconds checking a roster they are holding. A crew member who is told
the wrong report time confidently goes to bed at the wrong hour.

**What it taught.** This is where the hot take comes from: our own primary metric
rewarded a change that made the system more dangerous. A binary "is it right" cannot see
the difference between *wrong* and *flagged*, so the co-primary — silently wrong, target
zero — exists precisely to make that difference visible. The removal is the evidence that
the metric needed it.

There is a positive version of the same lesson in the changelog. The fix for the last
failing case was not to let the model guess harder, but to make it **say which values it
had worked out rather than read**. Same information, opposite direction: surfaced instead
of buried, and it fixed the error rather than hiding it.
