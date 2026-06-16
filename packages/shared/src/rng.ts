/**
 * Seedbare, deterministische PRNG. Geen Math.random() in het sim-pad:
 * dezelfde seed levert exact dezelfde stroom getallen, zodat wedstrijden
 * reproduceerbaar zijn (replay-tests, latere authoritative multiplayer).
 *
 * Implementatie: mulberry32 — klein, snel, goede distributie voor game-gebruik.
 */

export type Seed = number;

export class Rng {
  private state: number;

  constructor(seed: Seed) {
    // Forceer naar 32-bit unsigned en vermijd state 0.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Volgende float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] (beide inclusief). */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Boolean met kans p (default 0.5). */
  chance(p = 0.5): boolean {
    return this.next() < p;
  }

  /** Kies een willekeurig element uit een niet-lege array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick op lege array");
    return arr[this.int(0, arr.length - 1)] as T;
  }

  /** Fisher-Yates shuffle (in-place) met deze RNG. Geeft dezelfde array terug. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Benaderde normaalverdeling (Box-Muller), geclamped optioneel buiten. */
  gaussian(mean = 0, stdDev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return mean + n * stdDev;
  }

  /** Huidige interne state — handig voor snapshot/restore in replays. */
  snapshot(): number {
    return this.state;
  }

  restore(state: number): void {
    this.state = state | 0;
  }
}

/** Hash een string naar een 32-bit seed (FNV-1a). Voor named seeds. */
export function hashSeed(str: string): Seed {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
