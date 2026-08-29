# Solution video — script and shot list

Up to five minutes. The brief asks for: the problem and the simple baseline, one realistic
execution start to finish, the final comparison, a brief walk through the changelog, the
change that contributed most, and one experiment that was removed.

**You record this.** Everything below is on screen already — no slides to build. Times are
a guide; the whole thing runs about 4:40 at an unhurried pace.

Before you start: `npm run corpus && npm run report` so the repo is in a clean state, and
have these open in tabs —

1. `corpus/dev/d04-kestrel/roster.pdf`
2. a terminal in the repo
3. `out/d05-halcyon-brief.html`
4. `RESULTS.md`
5. `docs/removed-experiments.md`

---

## 0:00 — 0:35 · The problem, in the document

**Screen:** the Kestrel roster PDF, scrolling slowly.

> "This is a month of flying. Thirty days of duty — early starts, night sectors, standby,
> layovers several time zones from home. Somewhere in here is the answer to the only
> question the person flying it actually has, which is *when do I sleep on the 14th*.
>
> Their operator's system won't tell them. It answers a different question — is this
> roster legal — and that's the company's problem, not theirs."

**Point at the header block.** Report time is not printed on this one. It has to be worked
out from an offset table, and the offset is different for short haul and long haul.

> "Hold that thought. That detail decides this whole project."

## 0:35 — 1:15 · The baseline: what they do today

**Screen:** terminal.

```bash
npm run eval -- --arm b1-chatbot --set dev --case d01-aurora
```

While it runs:

> "Today they either work it out by hand, or they paste the roster into a chatbot. So
> that's the baseline — one prompt, the PDF, their own commute times. Nothing else."

**Screen:** `RESULTS.md`, the headline table.

> "Across eight rosters it reads them at 99.3% field accuracy. It's *good* at reading.
> And it produces a plan you can't rely on in eight cases out of eight.
>
> Seven of those read the month perfectly, and withheld every real collision — because
> nobody showed it the operator's manual. It also cited sixty-nine rules that don't
> exist."

## 1:15 — 2:30 · One real execution

**Screen:** terminal.

```bash
npm run eval -- --arm nightstop --set dev --case d04-kestrel
```

While it runs, talk over it:

> "The model does the reading — that's the part no per-airline parser scales to. But it
> doesn't do arithmetic. Timezone conversion goes to a tool that knows about the hours
> that repeat and the ones that never happen. And it checks itself against the totals the
> document prints about itself, which is the cheapest possible way to find out you missed
> a row."

**Screen:** when it finishes, open the trajectory.

```bash
open trajectories/nightstop-d04-kestrel.md
```

**Scroll to a `to_utc` call, then to the derivations.** Read one aloud:

> "'STD 23:10 Boston minus the seventy-five minute long-haul offset ... cross-checked
> against the printed duty length.' It's telling me which values it *worked out* rather
> than read, and why."

**Screen:** the briefing.

```bash
npm run brief -- results/<runId> d05-halcyon && open out/d05-halcyon-brief.html
```

> "This is what the crew member gets. Decisions first — five things to settle, not
> sixteen, because the same collision on four nights is one decision. Then the month.
>
> The grey band is their circadian low, drawn from the *body* clock. Watch it slide away
> from the wall clock on the Singapore layover and drift back. That's the whole problem in
> one picture."

## 2:30 — 3:15 · The comparison

**Screen:** `RESULTS.md`.

> "Same eight rosters, same grader, same task for every arm.
>
> The chatbot: nothing trustworthy, wrong-and-silent every time. Hand the same model the
> rule pack in one shot and recall goes from zero to seventy-seven percent — most of the
> value is right there. But it invents thirty-seven rules.
>
> Move the rule check into a deterministic function and false alarms go to zero, because a
> deterministic checker *cannot* invent a rule. Eight out of eight, nothing silently
> wrong."

**Scroll to Held out.**

> "Four more rosters generated after every prompt was frozen, not run against until the
> end. Four out of four. `npm run verify:freeze` proves nothing was tuned."

## 3:15 — 4:00 · The change that mattered most

**Screen:** back to the Kestrel roster header, the offset table.

> "After the third iteration exactly one case still failed, and it was this one.
>
> The reader applied the forty-five minute short-haul offset to a long-haul sector. One
> report time, half an hour late. Three hundred and twenty-nine of three hundred and
> thirty fields correct — and still untrustworthy, because half an hour is the difference
> between a nap that helps and one that doesn't.
>
> Here's what didn't catch it. The header totals reconciled, because report time isn't
> part of block hours. And the reader said it was certain.
>
> **A document can only check what it prints. A derived value has no checksum at all.**
>
> The fix wasn't a rule or another check. I asked the model to record which values it had
> worked out rather than read, and say which offset it used and why. That's it. Being made
> to show its work changed the work — and that case has read every field correctly since."

## 4:00 — 4:40 · The experiment I removed

**Screen:** `docs/removed-experiments.md`.

> "One more. When the reader flags something as uncertain, you can hand it back and ask it
> to resolve it. Forty lines. It targets exactly the values most likely to be wrong.
>
> I predicted it would beat my metric while making the system more dangerous. It did
> something worse — it *tied*. Same trustworthy count, same silently-wrong count,
> identical accuracy.
>
> What changed is invisible to every number I report. Values the crew member can check go
> from thirty-three to zero, and it costs thirty-eight percent more. It guessed right every
> time here, which isn't a reason to keep it — the behaviour is identical whether the guess
> is right or wrong.
>
> So: build the scoreboard before the agent. Then distrust the scoreboard too. Both of my
> worst bugs were in the measuring apparatus, not the thing being measured — and the
> decision to cut this came from looking at what the pilot ends up holding, which no number
> in my results table reports."

**End on the briefing page.**

---

## If you need to trim

- Cut the trajectory (1:45–2:00) first — the changelog section covers the same ground.
- Cut the held-out paragraph second.
- **Do not cut** the Kestrel failure or the removed experiment. Those are the two segments
  the brief specifically asks for, and they carry the hot take.

## Recording notes

- Terminal at a large font; the numbers have to be legible at whatever resolution the
  judges watch at.
- The full arm runs take about twenty minutes, so run the single-case commands live and
  cut to the finished `RESULTS.md` for the totals — say that you're doing it.
- The briefing has a dark theme; it will follow your system setting.
