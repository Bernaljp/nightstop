/**
 * Deterministic RNG. The corpus must regenerate byte-identically from a seed, so
 * nothing in the generator may touch Math.random or the clock.
 *
 * mulberry32 — small, fast, and good enough for laying out fixtures.
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("pick from empty list");
    return xs[this.int(0, xs.length - 1)];
  }
  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Fisher-Yates, in place, returns the array. */
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  }
}

/** Stable 32-bit hash of a string, so seeds can be derived from case ids. */
export function seedFrom(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
