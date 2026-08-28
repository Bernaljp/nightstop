/**
 * Per-agent token and cost accounting.
 *
 * Two things here are easy to get wrong and both understate the bill badly:
 *
 *   1. Usage must be accumulated on EVERY turn of an agent loop. The final message
 *      carries only its own turn, so reading usage once at the end misses everything
 *      that came before it.
 *   2. Cached input is not the same price as fresh input. Folding cache reads into
 *      input_tokens overstates cost once skill documents are being cached, which is
 *      exactly when the numbers start mattering.
 */

/** claude-opus-5, USD per million tokens. */
export const PRICE = {
  model: "claude-opus-5",
  inputPerMTok: 5,
  outputPerMTok: 25,
  /** Cache reads are billed at a fraction of the input rate. */
  cacheReadMultiplier: 0.1,
  /** Writing to the cache costs a premium over plain input. */
  cacheWriteMultiplier: 1.25,
} as const;

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  turns: number;
}

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    turns: 0,
  };
}

export function addUsage(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals {
  return {
    inputTokens: a.inputTokens + (b.inputTokens ?? 0),
    outputTokens: a.outputTokens + (b.outputTokens ?? 0),
    cacheReadInputTokens: a.cacheReadInputTokens + (b.cacheReadInputTokens ?? 0),
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + (b.cacheCreationInputTokens ?? 0),
    turns: a.turns + (b.turns ?? 0),
  };
}

/** Shape the SDK returns on `message.usage`. */
export interface SdkUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function fromSdkUsage(u: SdkUsage): Partial<UsageTotals> {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    turns: 1,
  };
}

export function costUsd(u: UsageTotals): number {
  const m = 1e6;
  return (
    (u.inputTokens / m) * PRICE.inputPerMTok +
    (u.outputTokens / m) * PRICE.outputPerMTok +
    (u.cacheReadInputTokens / m) * PRICE.inputPerMTok * PRICE.cacheReadMultiplier +
    (u.cacheCreationInputTokens / m) * PRICE.inputPerMTok * PRICE.cacheWriteMultiplier
  );
}

/** Every token that entered the model, however it was billed. */
export function totalInputTokens(u: UsageTotals): number {
  return u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens;
}

export class UsageMeter {
  private byAgentMap = new Map<string, UsageTotals>();

  add(agent: string, usage: SdkUsage): void {
    const cur = this.byAgentMap.get(agent) ?? emptyUsage();
    this.byAgentMap.set(agent, addUsage(cur, fromSdkUsage(usage)));
  }

  byAgent(): Record<string, UsageTotals> {
    return Object.fromEntries(this.byAgentMap);
  }

  total(): UsageTotals {
    let t = emptyUsage();
    for (const u of this.byAgentMap.values()) t = addUsage(t, u);
    return t;
  }

  totalCostUsd(): number {
    return costUsd(this.total());
  }
}
