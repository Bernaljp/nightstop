# Agent trajectories

One walk-through per agent, rendered from the JSONL each run writes. Every event is
here: what the agent was told, every turn it took, what its tools answered, and — where
it happened — the feedback that sent it back and the human checkpoint that gated it.

The raw JSONL sits beside each run at `results/<runId>/<case>/trajectory.jsonl`.

| Agent | Where it ran | Why this one |
|---|---|---|
| [`reader`](reader-d04-kestrel.md) | `nightstop` on `d04-kestrel` | The reader on the roster that does not print report time. It has to be derived from the offset table in the header, and the offset differs by haul — the one case that failed before the reader was asked to declare its derivations. |
| [`reader`](reader-d07-cirrus.md) | `nightstop` on `d07-cirrus` | A duty printed 23:30 → 05:25 on one dated row with nothing marking the day change, and continuation rows carrying no date either. Watch it use to_utc rather than doing the arithmetic itself. |
| [`reader`](reader-d08-nimbus.md) | `nightstop` on `d08-nimbus` | A month spanning both the European and North American daylight-saving changes, with transatlantic sectors whose offset changes mid-trip. |
| [`chatbot`](chatbot-d01-aurora.md) | `b1-chatbot` on `d01-aurora` | The baseline for comparison: one prompt, no tools, no rule pack. It reads the roster well and then cites rules that do not exist. |
| [`steelman`](steelman-d02-meridian.md) | `b2-steelman` on `d02-meridian` | The fairness arm, and the one that makes the case for taking the rule check away from the model. Same model, same effort, handed the same rule pack — it finds real collisions, and in the same breath cites limits nobody set. |
| [`rule-checker`](rule-checker-d01-aurora.md) | `a-model-checks` on `d01-aurora` | The ablation's `rule-checker`. Identical to the full system except a model finds the collisions instead of a function. It finds every real one on this roster, then adds several that are not there — the failure a deterministic checker cannot have. |
| [`distiller`](distiller.md) | the rules document | The `distiller`, run once per rules document rather than per roster. A 200-page regulation becomes a compact rule pack, each rule carrying the clause it came from so nothing in the plan is traceable to a rule nobody can look up. |
| [`repair`](repair-d04-kestrel.md) | `nightstop-repair` on `d04-kestrel` | The removed experiment. The `revise` event is the moment a flagged uncertainty gets resolved instead of surfaced — the behaviour this design refuses. |
