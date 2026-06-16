import { describe, expect, it } from "vitest";
import { TICK_DT } from "@pitch/shared";
import { moveTowards, playerMaxSpeed } from "./player.js";
import type { MatchPlayerStats, PlayerEntity } from "./types.js";

const STATS: MatchPlayerStats = {
  pace: 60,
  passing: 60,
  shooting: 60,
  finishing: 60,
  tackling: 60,
  heading: 60,
  goalkeeping: 30,
  composure: 60,
  stamina: 60,
};

function mk(): PlayerEntity {
  return {
    id: "p",
    side: "home",
    shirtNumber: 1,
    position: "CM",
    isKeeper: false,
    stats: STATS,
    anchor: { x: 0, y: 0 },
    pos: { x: 0, y: 34 },
    vel: { x: 0, y: 0 },
    facing: 0,
    state: "idle",
    stateTimer: 0,
    tackleCooldown: 0,
    stamina: 1,
    exhausted: false,
  };
}

describe("sprintmeter", () => {
  it("sprinten is sneller dan joggen", () => {
    expect(playerMaxSpeed(STATS, true)).toBeGreaterThan(playerMaxSpeed(STATS, false));
  });

  it("loopt leeg bij blijven sprinten en raakt 'leeg'", () => {
    const p = mk();
    let minStam = 1;
    let everExhausted = false;
    for (let i = 0; i < 60 * 6; i++) {
      moveTowards(p, { x: 1, y: 0 }, true, TICK_DT);
      minStam = Math.min(minStam, p.stamina);
      if (p.exhausted) everExhausted = true;
    }
    expect(minStam).toBeLessThan(0.1);
    expect(everExhausted).toBe(true);
  });

  it("herstelt volledig bij niet-sprinten", () => {
    const p = mk();
    for (let i = 0; i < 60 * 6; i++) moveTowards(p, { x: 1, y: 0 }, true, TICK_DT);
    for (let i = 0; i < 60 * 8; i++) moveTowards(p, { x: 1, y: 0 }, false, TICK_DT);
    expect(p.stamina).toBeGreaterThan(0.8);
    expect(p.exhausted).toBe(false);
  });

  it("een lege speler haalt geen sprintsnelheid (zelfs met sprint-input)", () => {
    const p = mk();
    p.stamina = 0;
    p.exhausted = true;
    // Eén lange rechte sprint-poging; door uitputting blijft hij op jogtempo.
    for (let i = 0; i < 60; i++) moveTowards(p, { x: 1, y: 0 }, true, TICK_DT);
    const speed = Math.hypot(p.vel.x, p.vel.y);
    expect(speed).toBeLessThanOrEqual(playerMaxSpeed(STATS, false) + 0.01);
  });
});
