import { describe, expect, it } from "vitest";
import { Rng, hashSeed } from "./rng.js";

describe("Rng", () => {
  it("levert dezelfde stroom bij gelijke seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("levert verschillende stromen bij verschillende seed", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toEqual(b.next());
  });

  it("next() blijft in [0, 1)", () => {
    const r = new Rng(99);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() respecteert grenzen inclusief", () => {
    const r = new Rng(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 9);
      expect(Number.isInteger(v)).toBe(true);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBe(3);
    expect(max).toBe(9);
  });

  it("snapshot/restore herstelt de exacte stroom", () => {
    const r = new Rng(555);
    r.next();
    r.next();
    const snap = r.snapshot();
    const after = [r.next(), r.next(), r.next()];
    r.restore(snap);
    expect([r.next(), r.next(), r.next()]).toEqual(after);
  });

  it("shuffle is deterministisch bij gelijke seed", () => {
    const a = new Rng(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Rng(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
  });

  it("hashSeed is stabiel en seedbaar", () => {
    expect(hashSeed("club-amsterdam")).toBe(hashSeed("club-amsterdam"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    const r1 = new Rng(hashSeed("world-1"));
    const r2 = new Rng(hashSeed("world-1"));
    expect(r1.next()).toBe(r2.next());
  });
});
