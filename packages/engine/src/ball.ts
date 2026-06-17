import { BALL, PITCH, clamp, len, normalize, type Vec2 } from "@pitch/shared";
import type { BallState, Side } from "./types.js";

export function createBall(pos: Vec2): BallState {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0 },
    z: 0,
    vz: 0,
    curve: 0,
    ownerId: null,
    sinceKick: 999,
    lastTouchSide: null,
    lastTouchId: null,
    targetId: null,
  };
}

export interface KickParams {
  /** Richtingsvector (wordt genormaliseerd). */
  dir: Vec2;
  /** Grondsnelheid (units/s). */
  power: number;
  /** Initiële opwaartse snelheid (loft). */
  loft?: number;
  /** Begin-curve. */
  curve?: number;
  byId: string;
  bySide: Side;
  /** Bedoelde ontvanger (komt de bal tegemoet), of null. */
  targetId?: string | null;
}

/** Geef de bal een trap: zet snelheid, hoogte en reset het aftertouch-venster. */
export function kickBall(ball: BallState, p: KickParams): void {
  const dir = normalize(p.dir);
  const power = clamp(p.power, 0, BALL.maxSpeed);
  ball.vel.x = dir.x * power;
  ball.vel.y = dir.y * power;
  ball.vz = p.loft ?? 0;
  ball.curve = p.curve ?? 0;
  ball.z = Math.max(ball.z, 0);
  ball.sinceKick = 0;
  ball.ownerId = null;
  ball.lastTouchSide = p.bySide;
  ball.lastTouchId = p.byId;
  ball.targetId = p.targetId ?? null;
}

/**
 * Aftertouch: tijdens het venster (BALL.aftertouchWindow) na de trap voegt
 * spelerinput curve en loft toe. Dit maakt de bal "muzikaal bestuurbaar"
 * i.p.v. fysisch realistisch — de kern van het SWOS-gevoel.
 */
export function applyAftertouch(ball: BallState, input: Vec2): void {
  if (ball.sinceKick > BALL.aftertouchWindow) return;
  const mag = len(input);
  if (mag < 0.01) return;

  // Beweegrichting van de bal.
  const speed = len(ball.vel);
  if (speed < 0.01) return;
  const fwd = { x: ball.vel.x / speed, y: ball.vel.y / speed };
  // Het effect is het sterkst NET na de trap en zakt over het venster weg:
  // vroeg sturen buigt de bal veel, laat sturen nauwelijks. Kwadratische
  // afname legt het gewicht extra op de eerste momenten na het schot.
  const phase = clamp(1 - ball.sinceKick / BALL.aftertouchWindow, 0, 1);
  const earlyWeight = phase * phase;
  // Zijwaartse (loodrechte) component buigt de bal (curve) — onafhankelijk van loft.
  const side = input.x * -fwd.y + input.y * fwd.x;
  ball.curve += side * BALL.aftertouchCurve * 0.016 * (0.35 + 1.3 * earlyWeight);

  // Tegengesteld sturen (tégen de balrichting in) tilt de bal de lucht in (lob).
  // Onafhankelijk van de curve: ook diagonaal (terug + zijwaarts) blijft de bal
  // vol omhoog gaan — een duidelijke terug-component telt al als volle loft.
  const back = -(input.x * fwd.x + input.y * fwd.y);
  if (back > 0) {
    const loft = Math.min(1, back * 1.5);
    ball.vz += loft * BALL.aftertouchLoft * 0.016;
  }
}

/** Integreer de balfysica één sim-stap (dt seconden). */
export function stepBall(ball: BallState, dt: number, pitchModifier = 1): void {
  ball.sinceKick += dt;

  const airborne = ball.z > 0.01 || ball.vz > 0.01;

  // Curve: zijwaartse acceleratie loodrecht op de bewegingsrichting.
  if (Math.abs(ball.curve) > 0.001) {
    const speed = len(ball.vel);
    if (speed > 0.01) {
      const nx = -ball.vel.y / speed;
      const ny = ball.vel.x / speed;
      ball.vel.x += nx * ball.curve * dt;
      ball.vel.y += ny * ball.curve * dt;
    }
    // Curve neemt af over tijd.
    ball.curve *= Math.max(0, 1 - dt * 1.5);
  }

  // Hoogte (z-as) met zwaartekracht + stuiteren.
  if (airborne) {
    ball.vz -= BALL.gravity * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      if (ball.vz < 0) {
        ball.vz = -ball.vz * BALL.bounce;
        // Grondcontact remt ook de grondvector wat af.
        ball.vel.x *= 0.82;
        ball.vel.y *= 0.82;
        if (ball.vz < 1.2) ball.vz = 0;
      }
    }
  }

  // Grondwrijving / luchtweerstand.
  const drag = airborne ? BALL.airDrag : BALL.groundFriction * pitchModifier;
  const decay = Math.max(0, 1 - drag * dt);
  ball.vel.x *= decay;
  ball.vel.y *= decay;

  // Snelheidsplafond.
  const speed = len(ball.vel);
  if (speed > BALL.maxSpeed) {
    const k = BALL.maxSpeed / speed;
    ball.vel.x *= k;
    ball.vel.y *= k;
  }

  // Positie integreren.
  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;

  // Heel kleine snelheden afkappen tot stilstand (rust-detectie).
  if (ball.z <= 0 && len(ball.vel) < 0.05) {
    ball.vel.x = 0;
    ball.vel.y = 0;
  }
}

/**
 * Voorspel de grondpositie van de bal over t seconden, gegeven de huidige
 * grondvector en rolwrijving (gesloten vorm). Negeert hoogte/curve — goed
 * genoeg voor interceptie-predictie door de AI.
 */
export function projectBallPos(ball: BallState, t: number): Vec2 {
  const k = BALL.groundFriction;
  // pos(t) = pos0 + v0 * (1 - e^{-k t}) / k
  const factor = (1 - Math.exp(-k * t)) / k;
  return {
    x: ball.pos.x + ball.vel.x * factor,
    y: ball.pos.y + ball.vel.y * factor,
  };
}

/** Clamp de bal binnen veld+marge (voorlopige uit-afhandeling voor de slice). */
export function keepBallInBounds(ball: BallState): boolean {
  const minX = -PITCH.margin;
  const maxX = PITCH.width + PITCH.margin;
  const minY = -PITCH.margin;
  const maxY = PITCH.height + PITCH.margin;
  let bounced = false;
  if (ball.pos.x < minX) {
    ball.pos.x = minX;
    ball.vel.x = Math.abs(ball.vel.x) * 0.4;
    bounced = true;
  } else if (ball.pos.x > maxX) {
    ball.pos.x = maxX;
    ball.vel.x = -Math.abs(ball.vel.x) * 0.4;
    bounced = true;
  }
  if (ball.pos.y < minY) {
    ball.pos.y = minY;
    ball.vel.y = Math.abs(ball.vel.y) * 0.4;
    bounced = true;
  } else if (ball.pos.y > maxY) {
    ball.pos.y = maxY;
    ball.vel.y = -Math.abs(ball.vel.y) * 0.4;
    bounced = true;
  }
  return bounced;
}
