/**
 * Deterministic pseudo-random generator.
 *
 * Every simulated value in this system comes from a seeded RNG so the demo is
 * byte-for-byte reproducible across machines and reset cycles. Math.random() is
 * never used outside of id generation for live user actions.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // mulberry32 wants a non-zero 32-bit state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly [T, number][]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1][0];
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

/** The one seed the whole demo derives from. Changing it changes every number. */
export const DEMO_SEED = 20240115;
