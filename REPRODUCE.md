# Reproducing this

Written for someone starting from a clean machine with nothing checked out.

The useful thing about this project's structure: **most of it reproduces with no model
access at all.** The corpus, the grader's own proof, and the deterministic ceiling all
run offline. Only the three model-driven arms need credentials, and they are the only
part that costs anything.

---

## 1. What you need

| | |
|---|---|
| Node | 22.17.1 (any 20+ should work; 22.17.1 is what these results were produced on) |
| npm | ships with Node |
| Disk | ~450 MB, almost all of it `node_modules` |
| Model access | only for §4. Either the Claude Agent SDK on existing Claude Code credentials, or an `ANTHROPIC_API_KEY` |

No system binaries. No Python. No database. `pdfkit` renders the rosters and the Agent
SDK talks to the model; everything else is in the repo.

```bash
git clone https://github.com/Bernaljp/nightstop.git
cd nightstop
npm install          # ~1 min
npm run typecheck    # should print nothing
```

## 2. Regenerate the corpus — no credentials, ~2 seconds

```bash
npm run corpus
```

Writes eight rosters to `corpus/dev/` and their answer keys to `corpus/truth/dev/`. The
generator is seeded, so this reproduces the committed PDFs **byte for byte**. Check it:

```bash
shasum -a 256 -c corpus/manifest.dev.sha256
```

Sixteen `OK` lines. If any file differs, the numbers in `RESULTS.md` were produced
against different inputs and should not be compared.

The answer keys live outside the case directories on purpose — an agent handed a roster
path will list the folder it sits in, and ground truth sitting next to the input is an
accident waiting to happen.

## 3. Prove the scoreboard — no credentials, ~3 seconds

```bash
npm run verify:grader
```

42 assertions. It constructs answers whose correct grade is known by construction — a
perfect one, then one perturbation at a time — and asserts each lands in the bucket it
belongs in: a withheld conflict must score `missed`, an invented one `false_alarm`, a
report time an hour out `misread`, and so on. Expect `All grader expectations hold.`

Run this before believing any other number here. A grader nobody has tested is a way of
laundering an opinion into a number, and two of the worst bugs in this project were in
the measuring apparatus rather than the thing measured.

Then the deterministic ceiling, also free:

```bash
npm run eval -- --arm reference
```

Expect **8/8 trustworthy, 0 silently wrong, 100% field accuracy**. This arm plans from
ground-truth duties, so it is not a baseline — it is the answer to "how much of any
shortfall is the reading rather than the planning".

## 4. The model-driven arms — credentials required

Model access, either way round:

- **Claude Agent SDK** (how these results were produced): install Claude Code and log
  in. The SDK authenticates on those credentials and needs no API key. Usage and
  list-price cost are still reported in full.
- **API key**: put `ANTHROPIC_API_KEY=sk-ant-...` in `.env.local` at the repo root.

```bash
npm run eval -- --arm b1-chatbot     # the baseline: what crew get today
npm run eval -- --arm b2-steelman    # same inputs as the full system, one shot
npm run eval -- --arm nightstop      # the full pipeline
npm run report                       # rebuild RESULTS.md from everything on disk
```

Each arm runs its eight cases four at a time. Add `--case d04-kestrel` for one case, or
`--concurrency 1` to run them one after another.

### Runtime and cost, measured

| Arm | Wall clock | Cost | Per roster |
|---|---|---|---|
| `b1-chatbot` | 36 min | $5.23 | $0.65 |
| `b2-steelman` | 43 min | $6.38 | $0.80 |
| `nightstop` | 22 min | $4.89 | $0.61 |
| `reference` | <1 s | $0.00 | — |

**Reproducing the full table costs about $17 and takes about 100 minutes.** Figures are
`claude-opus-5` list price, as reported by the SDK; running through the Agent SDK bills
a Claude Code subscription rather than API credits, but the equivalent is what is
reported so the numbers mean the same thing either way.

⚠️ **Session limits are real.** Two repeat runs during development died partway through
against an account session limit. A run that hits one produces `unusable` on every
remaining case, which looks exactly like a catastrophic regression. If a whole arm
suddenly scores zero, check the trajectory before believing it:

```bash
grep -l "session limit" results/*/*/trajectory.jsonl
```

Delete such a run rather than reporting it — it measured a quota wall, not this system.

## 5. What you should get

`npm run report` rebuilds `RESULTS.md` from every run on disk. The headline:

| | `b1-chatbot` | `b2-steelman` | `nightstop` | `reference` |
|---|---|---|---|---|
| Trustworthy runs | 0/8 | 1/8 | 8/8 | 8/8 |
| Silently wrong | 8/8 | 3/8 | 0/8 | 0/8 |
| Conflict recall | 0% | 77.5% | 100% | 100% |
| False alarms | 69 | 37 | 0 | 0 |

Model output varies between runs, so an exact match on every case is not expected. What
should hold is the ordering and its size: the chatbot baseline surfacing essentially no
real collisions while inventing dozens, and the full pipeline surfacing all of them with
none invented. Every arm here is **n=1** — see the note in the README.

## 6. Look at what a crew member actually gets

```bash
npm run brief -- results/<runId> d05-halcyon
open out/d05-halcyon-brief.html
```

The `<runId>` is any directory under `results/`. The briefing renders **what the system
read**, not the answer key, so a reading error shows up rather than being hidden.

Worth looking at on `d08-nimbus`, which spans both the European and North American
daylight-saving changes: the shaded circadian-low band visibly drifts across the month,
because it is drawn from the body clock rather than the wall clock.

## 7. Reading the evidence

```
results/<runId>/summary.json          git SHA, corpus hash, model, per-arm summary
results/<runId>/<case>/grade.json     the bucket and every field mismatch
results/<runId>/<case>/duties.json    what the system read
results/<runId>/<case>/plan.json      what it produced
results/<runId>/<case>/trajectory.jsonl   every turn, tool call and result
trajectories/                         the same, rendered for reading
```

Every number in `RESULTS.md` is read out of a `summary.json` rather than typed, so a
figure in the write-up cannot drift from the run that produced it.

Runs also keep the duties they read, so a grader fix can be re-applied to a finished run
without paying to run the model again:

```bash
npm run regrade -- results/<runId>
```

That is how every arm here stays comparable under one grader over one corpus, whenever
each happened to run.
