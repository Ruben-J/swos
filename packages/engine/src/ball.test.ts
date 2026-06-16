import { describe, expect, it } from "vitest";
import { BALL, TICK_DT, len } from "@pitch/shared";
import {
  applyAftertouch,
  createBall,
  keepBallInBounds,
  kickBall,
  stepBall,
} from "./ball.js";

describe("balmodel", () => {
  it("kickBall zet snelheid in de richting met geclampte power", () => {
    const ball = createBall({ x: 50, y: 34 });
    kickBall(ball, { dir: { x: 1, y: 0 }, power: 999, byId: "p1", bySide: "home" });
    expect(ball.vel.x).toBeCloseTo(BALL.maxSpeed, 5);
    expect(ball.vel.y).toBeCloseTo(0, 5);
    expect(ball.sinceKick).toBe(0);
    expect(ball.lastTouchId).toBe("p1");
  });

  it("grondwrijving brengt de bal uiteindelijk tot stilstand", () => {
    const ball = createBall({ x: 50, y: 34 });
    kickBall(ball, { dir: { x: 1, y: 0 }, power: 20, byId: "p1", bySide: "home" });
    for (let i = 0; i < 60 * 10; i++) stepBall(ball, TICK_DT);
    expect(len(ball.vel)).toBeLessThan(0.1);
  });

  it("loft laat de bal stijgen en weer landen op z=0", () => {
    const ball = createBall({ x: 50, y: 34 });
    kickBall(ball, { dir: { x: 1, y: 0 }, power: 15, loft: 8, byId: "p1", bySide: "home" });
    let maxZ = 0;
    for (let i = 0; i < 60 * 5; i++) {
      stepBall(ball, TICK_DT);
      maxZ = Math.max(maxZ, ball.z);
    }
    expect(maxZ).toBeGreaterThan(0.5);
    expect(ball.z).toBeCloseTo(0, 1);
  });

  it("aftertouch buigt de bal binnen het venster, niet erbuiten", () => {
    const inWindow = createBall({ x: 50, y: 34 });
    kickBall(inWindow, { dir: { x: 1, y: 0 }, power: 20, byId: "p1", bySide: "home" });
    applyAftertouch(inWindow, { x: 0, y: 1 });
    stepBall(inWindow, TICK_DT);
    expect(Math.abs(inWindow.vel.y)).toBeGreaterThan(0);

    const outWindow = createBall({ x: 50, y: 34 });
    kickBall(outWindow, { dir: { x: 1, y: 0 }, power: 20, byId: "p1", bySide: "home" });
    outWindow.sinceKick = BALL.aftertouchWindow + 0.1;
    const beforeCurve = outWindow.curve;
    applyAftertouch(outWindow, { x: 0, y: 1 });
    expect(outWindow.curve).toBe(beforeCurve);
  });

  it("keepBallInBounds houdt de bal binnen veld + marge", () => {
    const ball = createBall({ x: 50, y: 34 });
    ball.pos.x = 9999;
    ball.vel.x = 50;
    keepBallInBounds(ball);
    expect(ball.pos.x).toBeLessThan(9999);
    expect(ball.vel.x).toBeLessThanOrEqual(0);
  });
});
