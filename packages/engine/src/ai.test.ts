import { describe, expect, it } from "vitest";
import { createBall, kickBall } from "./ball.js";
import { chooseBestPass, computeAiCommand, computeTeamPlan, laneBlocked, predictIntercept } from "./ai.js";
import { tacticalTarget } from "./tactics.js";
import type { MatchPlayerStats, PlayerEntity, Position, Side } from "./types.js";

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
  control: 60,
};

function pl(id: string, side: Side, x: number, y: number, position: Position = "CM"): PlayerEntity {
  return {
    id,
    side,
    shirtNumber: 1,
    position,
    firstName: "Test",
    lastName: "Speler",
    hairColor: "#2e2018",
    skinColor: "#e6b48c",
    isKeeper: position === "GK",
    stats: STATS,
    anchor: { x, y },
    pos: { x, y },
    vel: { x: 0, y: 0 },
    facing: 0,
    state: "idle",
    stateTimer: 0,
    tackleCooldown: 0,
    stamina: 1,
    exhausted: false,
  };
}

describe("laneBlocked", () => {
  it("detecteert een tegenstander in de passlijn", () => {
    const opp = [pl("o", "away", 5, 0.4)];
    expect(laneBlocked({ x: 0, y: 0 }, { x: 10, y: 0 }, opp)).toBe(true);
  });
  it("een tegenstander ver van de lijn blokkeert niet", () => {
    const opp = [pl("o", "away", 5, 6)];
    expect(laneBlocked({ x: 0, y: 0 }, { x: 10, y: 0 }, opp)).toBe(false);
  });
});

describe("predictIntercept", () => {
  it("geeft een punt langs de bewegingsrichting van de bal", () => {
    const ball = createBall({ x: 20, y: 34 });
    kickBall(ball, { dir: { x: 1, y: 0 }, power: 20, byId: "p", bySide: "home" });
    const p = predictIntercept(ball, { x: 25, y: 34 }, 7);
    expect(p.x).toBeGreaterThan(20);
    expect(Math.abs(p.y - 34)).toBeLessThan(0.5);
  });
});

describe("chooseBestPass", () => {
  it("kiest een open voorwaartse teamgenoot, niet een geblokkeerde", () => {
    const passer = pl("p", "home", 30, 34);
    const openMate = pl("m1", "home", 48, 34);
    const blockedMate = pl("m2", "home", 48, 20);
    const blocker = pl("b", "away", 39, 20);
    const players = [passer, openMate, blockedMate];
    const opponents = [blocker];
    const best = chooseBestPass(players, passer, opponents);
    expect(best?.id).toBe("m1");
  });

  it("geeft null als er geen zinnige pass is", () => {
    const passer = pl("p", "home", 30, 34);
    const backMate = pl("m", "home", 12, 34); // ver achter
    const best = chooseBestPass([passer, backMate], passer, []);
    expect(best).toBeNull();
  });
});

describe("tacticalTarget", () => {
  it("schuift een aanvaller naar voren bij balbezit", () => {
    const anchor = { x: 70, y: 34 };
    const def = tacticalTarget(anchor, "ST", "home", { x: 52, y: 34 }, -0.6, {
      lineHeight: 0.5,
      press: 0.6,
      width: 0.55,
      tempo: 0.55,
    });
    const att = tacticalTarget(anchor, "ST", "home", { x: 52, y: 34 }, 1, {
      lineHeight: 0.5,
      press: 0.6,
      width: 0.55,
      tempo: 0.55,
    });
    // Aanvallend (home valt naar rechts aan) staat de spits verder naar rechts.
    expect(att.x).toBeGreaterThan(def.x);
  });

  it("een aanvaller blijft hoog bij verdedigen (loopt niet ver terug)", () => {
    const anchor = { x: 78, y: 34 };
    const t = { lineHeight: 0.5, press: 0.6, width: 0.55, tempo: 0.55 };
    // Verdedigend: ST zakt nauwelijks terug t.o.v. een verdediger.
    const stDef = tacticalTarget(anchor, "ST", "home", { x: 30, y: 34 }, -0.6, t);
    const cbDef = tacticalTarget({ x: 20, y: 34 }, "CB", "home", { x: 30, y: 34 }, -0.6, t);
    // Spits blijft duidelijk hoger dan de verdediger -> opstellingen kruisen.
    expect(stDef.x).toBeGreaterThan(cbDef.x + 30);
  });
});

describe("aansluiting & diepteloper", () => {
  it("in balbezit blijft de aanvalslinie kort bij de bal zonder plat te slaan", () => {
    const ball = createBall({ x: 52, y: 34 }); // bal op het middenveld
    const gk = pl("gk", "home", 6, 34, "GK");
    const st1 = pl("st1", "home", 92, 30, "ST"); // anker zeer diep
    const st2 = pl("st2", "home", 78, 38, "ST"); // anker minder diep
    const cb = pl("cb", "home", 20, 34, "CB");
    const plan = computeTeamPlan([gk, st1, st2, cb], ball, "home", "home");
    const a = plan.targets.get("st1")!;
    const b = plan.targets.get("st2")!;
    // Niet doorlopen tot de buitenspellijn: hooguit ~32 vóór de bal.
    expect(a.x).toBeLessThanOrEqual(52 + 32 + 0.001);
    // Maar de linie wordt NIET platgeslagen: de dieper gepositioneerde spits
    // blijft vóór de andere staan (onderling diepteverschil blijft behouden).
    expect(a.x).toBeGreaterThan(b.x + 1);
  });

  it("harde steekpass in de ruimte: de loper wordt aangewezen en loopt door (niet terug)", () => {
    const ball = createBall({ x: 48, y: 34 });
    kickBall(ball, { dir: { x: 1, y: 0 }, power: 38, byId: "p", bySide: "home" });
    const gk = pl("gk", "home", 6, 34, "GK");
    const runner = pl("r", "home", 54, 34, "ST"); // net vóór de bal; bal raast erlangs
    const back = pl("b", "home", 38, 34, "CM"); // achter de bal
    const plan = computeTeamPlan([gk, runner, back], ball, "home", null);
    expect(plan.runnerId).toBe("r");
    const cmd = computeAiCommand([gk, runner, back], ball, runner, null, plan);
    // Loopt VOORUIT op de bal (positieve x), komt niet terug richting eigen helft.
    expect(cmd.move.x).toBeGreaterThan(0);
  });
});

describe("losse bal achterin", () => {
  it("een eigen losse bal zonder diepteloper wordt door de dichtste verdediger opgepakt", () => {
    const ball = createBall({ x: 20, y: 34 });
    // Zachte aanraking achterin (geen vooruit gespeelde steekpass) -> geen loper.
    kickBall(ball, { dir: { x: -1, y: 0 }, power: 5, byId: "x", bySide: "home" });
    const gk = pl("gk", "home", 6, 34, "GK");
    const def = pl("d", "home", 28, 34, "CB"); // dichtst bij de losse bal
    const mid = pl("m", "home", 55, 34, "CM");
    const plan = computeTeamPlan([gk, def, mid], ball, "home", null);
    expect(plan.runnerId).toBeNull();
    const cmd = computeAiCommand([gk, def, mid], ball, def, null, plan);
    // Verdediger loopt richting de bal (naar links, kleinere x).
    expect(cmd.move.x).toBeLessThan(0);
  });
});
