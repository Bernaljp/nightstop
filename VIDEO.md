# Solution video — shot list and script

Up to five minutes. Two columns throughout: **what is on screen** and **what you say over
it**. Nothing here needs slides — every shot is a real page or a real terminal.

Runs about **4:55** at an unhurried pace.

---

## Before you record

```bash
cd nightstop
npm run corpus && npm run report          # clean state
npm run brief -- results/$(ls -t results | grep nightstop | head -1) d05-halcyon
open out/d05-halcyon-brief.html
```

Open these and leave them open, in this tab order:

| # | Tab / window | Why |
|---|---|---|
| 1 | `corpus/dev/d04-kestrel/roster.pdf` | the problem, and the failure at 3:20 |
| 2 | The demo (published artifact), **Recorded runs**, Aurora selected | the whole comparison |
| 3 | `out/d05-halcyon-brief.html` | what a pilot actually gets |
| 4 | `RESULTS.md` in a viewer | the numbers |
| 5 | Terminal, in the repo | one live run |
| 6 | `docs/removed-experiments.md` | the removal |

Terminal at ~18pt. Browser zoom ~110%. Both readable at 720p, because that is what a
judge may be watching at.

---

## 0:00 – 0:30 · The document

| Screen | Say |
|---|---|
| **Tab 1**, the Kestrel roster PDF, full screen. Scroll slowly through a week of rows. | "This is a month of flying. Thirty days of duty — early starts, night sectors, standby, layovers several time zones from home." |
| **Stop scrolling. Cursor-highlight the header block**, specifically the two lines reading *Short haul: 45 min · Long haul: 75 min*. Leave it on screen for a beat. | "Somewhere in here is the only question the person flying it actually has: when do I sleep on the 14th. And notice — this roster never prints a report time. You have to work it out from these two numbers. Hold that thought. It decides the whole project." |

## 0:30 – 1:20 · What they get today

| Screen | Say |
|---|---|
| **Tab 2**, the demo. Make sure **Recorded runs** is selected and the roster picker reads **AURORA AIRLINES**. Click **v1 · one prompt**. | "Today a pilot either works it out by hand, or pastes the roster into a chatbot. That's the baseline — one prompt, the document, their own commute times. Here is what it produced, on a real roster." |
| **Point at the four stat numbers**, left to right, pausing on each. | "It read the roster perfectly — zero fields wrong. And it surfaced none of the ten real collisions in this month." |
| **Scroll down to the red *Withheld* block.** Let two or three of the lines sit on screen long enough to read. | "These are the ten it never mentioned. 'Only ten hours off between the first and the second — twelve is the floor.' 'A fourteen-hour duty against a thirteen-hour limit.' The pilot is never told." |
| **Scroll to *Raised, but not traceable to any rule*.** | "And it raised twelve things it couldn't point to a rule for. To be fair to it, several are sensible fatigue observations — it was never shown the operator's manual. But a warning you can't look up is a warning you can't act on." |

## 1:20 – 1:50 · The same roster, the final version

| Screen | Say |
|---|---|
| **Click v4 · Nightstop.** Do not change anything else. Let the panel redraw. | "Same roster. Same page. Last version." |
| **Let the green *trustworthy* chip and the stat row sit on screen for a full three seconds.** Say nothing over it. | *(silence — let them read 10/10 and 0)* |
| Then: | "Ten of ten surfaced. Nothing invented. Nothing hidden." |

> This cut is the single most persuasive three seconds in the video. Do not rush it and do
> not talk over it.

## 1:50 – 2:35 · What it actually is

| Screen | Say |
|---|---|
| **Tab 5**, terminal. Type and run: `npm run eval -- --arm nightstop --set dev --case d07-cirrus` | "Here it is running. The model does the reading — that's the part no per-airline parser scales to, because every airline prints a roster differently." |
| While it runs, **switch to tab 2** and pick **CIRRUS CONNECT** from the roster list, still on v4. **Point at the STD/STA columns** on a row where the times run 23:55 → 02:20. | "This one prints a duty crossing midnight with nothing marking the day change, and continuation rows that don't repeat the date. Read that end time as same-day and you've shortened the duty by twenty-four hours." |
| Back to **tab 5** when it finishes. | "It doesn't do arithmetic, though. Timezone conversion goes to a tool that knows about the hours that repeat and the ones that never happen — and it checks itself against the totals the document prints about itself." |

## 2:35 – 3:10 · What a pilot gets

| Screen | Say |
|---|---|
| **Tab 2**, still on v4, **scroll to the phone calendar** and page one week forward. | "And here's the plan as you'd actually see it — a week on a phone. Blue is sleep, green a nap before a night duty, orange the flying. The dashed band behind them is the circadian low." |
| **Tab 3**, the briefing, scrolled to the top. | "Same plan, printable." |
| **Point at the stat row**, then at *What needs your decision*. | "Decisions first — five things to settle, not sixteen, because the same collision on four nights is one decision, not four." |
| **Scroll to the ribbon.** Move the cursor slowly left to right across the **19th and 20th**, the Singapore days. | "Now watch the grey band. That's the circadian low — drawn from the *body* clock, not the wall clock. On the Singapore layover it sits mid-morning local, then drifts back over the following week. That's the whole problem in one picture, and it's the reason 'sleep at 11pm local' is advice for a body that's been there a week." |
| **Scroll to a green nap block** in the ribbon, then to its line in the day-by-day table. | "And where a duty runs through that low, it puts a nap in front of it — take this two hours now, while you can still sleep. That rule only exists because building the demo showed the planner had never once suggested a nap in twelve rosters." |
| **Scroll to *Put it in your calendar*.** | "And it comes out as a calendar file. Every block carries its reasoning; duties come along marked free so it never blocks out your own diary. Importing it is the approval — nothing reaches a calendar until a person opens it." |

## 3:10 – 3:50 · The change that mattered most

| Screen | Say |
|---|---|
| **Tab 4**, `RESULTS.md`, at the headline table. | "Eight rosters, one grader, same task for every arm. Chatbot: nothing trustworthy. Hand the same model the rule pack in one shot and recall goes zero to seventy-seven percent — most of the value is right there. But it invents thirty-seven rules. Move the rule check into a deterministic function and that goes to zero, because a deterministic checker *cannot* invent a rule." |
| **Scroll to *Repeats*.** | "Eight of eight, four runs, no variance. Four more rosters generated after every prompt was frozen: four of four." |
| **Switch to tab 1**, the Kestrel header block again — same shot as 0:15. | "After the third iteration exactly one case still failed. This one. The reader used the forty-five minute short-haul offset on a long-haul sector. One report time, half an hour late — three hundred and twenty-nine of three hundred and thirty fields correct, and still untrustworthy." |
| Stay on the header. | "Here's what didn't catch it. The header totals reconciled, because report time isn't part of block hours. And the reader said it was certain. **A document can only check what it prints. A derived value has no checksum at all.**" |
| **Switch to tab 3**, scroll to *Worth confirming*. | "The fix wasn't a rule or another check. I asked the model to record which values it had *worked out* rather than read. That's it. Being made to show its work changed the work — and that case has read every field correctly since." |

## 3:50 – 4:35 · What I removed, and the take

| Screen | Say |
|---|---|
| **Tab 6**, `docs/removed-experiments.md`, scrolled to experiment 2. | "One more. When the reader flags something as uncertain, you can hand it back and ask it to resolve it. Forty lines. I predicted it would beat my metric while making the system more dangerous." |
| **Point at the comparison table** in that file — the row reading 33 → 0. | "It did something worse. It *tied*. Same trustworthy count, same silently-wrong count. What changed is invisible to every number I report: values the pilot can check go from thirty-three to zero, and it costs thirty-eight percent more. It guessed right every time here — which isn't a reason to keep it, because the behaviour is identical whether the guess is right or wrong." |
| **Switch to tab 2**, the demo, and scroll the phone calendar. | "And here is the number I did not expect to be reporting. Seven of my eleven stages moved neither headline number — a planner that never suggested a nap, one that asked for twenty-four hours of sleep in a forty-six hour layover, a calendar that drew a pilot asleep before they landed. All seven were real. **None was caught by a metric.** Six were caught by someone reading the output." |
| **Switch to tab 3**, the briefing, and leave it on screen. | "So: build the scoreboard before the agent. Then distrust the scoreboard too. Both of my worst bugs were in the measuring apparatus, not the thing being measured — and the decision to cut that experiment came from looking at what the pilot ends up holding, which no number in my results table reports." |
| Hold on the briefing. Stop. | *(end)* |

---

## Optional 20-second tag, if you are under time

| Screen | Say |
|---|---|
| **Tab 2**, click **Try it live**, press **Read and plan it**, let it stream. | "And it isn't a recording. This page calls the model with the real reader prompt and plans with the real engine, bundled out of the repo." |
| When the calendar draws, **scroll the phone view** and hit **next week** once. | "Same plan, on a phone. Sleep, naps, duties, and the circadian low behind them." |
| When it finishes, click **Download the calendar**. | "Same code that produced every number you just saw." |

⚠️ Only include this if it succeeds on a rehearsal. It is a live model call and it can be
rate limited. The recorded half never fails, so nothing is lost by cutting it.

---

## If it runs long

Cut in this order:

1. The live tag (0:20)
2. The Cirrus midnight-rollover aside at 2:10 (0:20)
3. The *Repeats* / held-out lines at 3:25 (0:15)
4. The seven-of-eleven line at 4:10 (0:20) — only if you must; it is the strongest
   evidence in the video that the evaluation was run honestly

**Do not cut** the v1 → v4 switch at 1:20, the Kestrel failure at 3:25, or the removed
experiment. Those are the three the brief specifically asks for, and they carry the hot
take.

## Recording notes

- **The three-second silence at 1:40 is deliberate.** Resist filling it.
- Run the single-case command live; cut to the finished `RESULTS.md` for totals rather
  than waiting twenty minutes, and say that you are doing so.
- The briefing and the demo follow your system light/dark setting. Pick one and stay in it.
- If a live call fails while recording, say "that's a live model call and it dropped —
  here's the recorded run" and switch. It reads as competence, not a failure.
