# Agent trajectories

One walk-through per agent, rendered from the JSONL each run writes. Every event is
here: what the agent was told, every turn it took, what its tools answered, and — where
it happened — the feedback that sent it back and the human checkpoint that gated it.

The raw JSONL sits beside each run at `results/<runId>/<case>/trajectory.jsonl`.

| Agent | Case | Why this one |
|---|---|---|
| [`nightstop`](nightstop-d04-kestrel.md) | `d04-kestrel` | The reader on the roster that does not print report time. It has to be derived from the offset table in the header, and the offset differs by haul — the one case that failed before the reader was asked to declare its derivations. |
| [`nightstop`](nightstop-d07-cirrus.md) | `d07-cirrus` | A duty printed 23:30 → 05:25 on one dated row with nothing marking the day change, and continuation rows carrying no date either. Watch it use to_utc rather than doing the arithmetic itself. |
| [`nightstop`](nightstop-d08-nimbus.md) | `d08-nimbus` | A month spanning both the European and North American daylight-saving changes, with transatlantic sectors whose offset changes mid-trip. |
| [`b1-chatbot`](b1-chatbot-d01-aurora.md) | `d01-aurora` | The baseline for comparison: one prompt, no tools, no rule pack. It reads the roster well and then cites rules that do not exist. |
