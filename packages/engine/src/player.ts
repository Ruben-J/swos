import {
  PLAYER,
  PITCH,
  angleOf,
  clamp,
  len,
  normalize,
  type Vec2,
} from "@pitch/shared";
import type { MatchPlayerStats, PlayerEntity, Side } from "./types.js";

/** Doelpositie (midden van het doel) voor de aanvalsrichting van een side. */
export function attackingGoal(side: Side): Vec2 {
  // home verdedigt links (x=0), valt rechts aan (x=width). away omgekeerd.
  return side === "home"
    ? { x: PITCH.width, y: PITCH.height / 2 }
    : { x: 0, y: PITCH.height / 2 };
}

export function defendingGoal(side: Side): Vec2 {
  return side === "home"
    ? { x: 0, y: PITCH.height / 2 }
    : { x: PITCH.width, y: PITCH.height / 2 };
}

/** Maximale loopsnelheid afgeleid van pace-attribuut. */
export function playerMaxSpeed(stats: MatchPlayerStats, sprint: boolean): number {
  const paceScale = 0.7 + (stats.pace / 100) * 0.6; // 0.7..1.3
  const base = PLAYER.baseSpeed * paceScale;
  return sprint ? base * PLAYER.sprintMultiplier : base;
}

/**
 * Beweeg een speler richting een gewenste bewegingsvector (genormaliseerd of nul),
 * met acceleratie en snelheidslimiet. Werkt facing bij op de bewegingsrichting.
 */
export function moveTowards(
  p: PlayerEntity,
  desiredDir: Vec2,
  sprint: boolean,
  dt: number,
): void {
  // Sprinten kan alleen met meter (en niet terwijl "leeg" tot voldoende herstel).
  const wantsSprint = sprint && len(desiredDir) > 0.01;
  const canSprint = wantsSprint && !p.exhausted && p.stamina > PLAYER.sprintEmptyThreshold;
  const maxSpeed = playerMaxSpeed(p.stats, canSprint);
  const dirLen = len(desiredDir);
  const target: Vec2 =
    dirLen > 0.01
      ? { x: (desiredDir.x / dirLen) * maxSpeed, y: (desiredDir.y / dirLen) * maxSpeed }
      : { x: 0, y: 0 };

  // Accelereer richting doel-snelheid.
  const ax = target.x - p.vel.x;
  const ay = target.y - p.vel.y;
  const step = PLAYER.accel * dt;
  const am = Math.hypot(ax, ay);
  if (am > 0) {
    const k = Math.min(1, step / am);
    p.vel.x += ax * k;
    p.vel.y += ay * k;
  }

  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;

  // Binnen veld + marge houden.
  p.pos.x = clamp(p.pos.x, -PITCH.margin, PITCH.width + PITCH.margin);
  p.pos.y = clamp(p.pos.y, -PITCH.margin, PITCH.height + PITCH.margin);

  // Facing volgt beweging (of blijft staan bij stilstand).
  if (len(p.vel) > 0.3) p.facing = angleOf(p.vel);

  // Sprintmeter: leegt bij sprinten, herstelt anders. Hysterese: na leeg moet
  // de meter eerst tot reengage-drempel herstellen voordat sprinten weer kan.
  if (canSprint) {
    p.stamina = clamp(p.stamina - dt * PLAYER.sprintDrainPerSec, 0, 1);
  } else {
    p.stamina = clamp(p.stamina + dt * PLAYER.sprintRecoverPerSec, 0, 1);
  }
  if (p.stamina <= PLAYER.sprintEmptyThreshold) p.exhausted = true;
  else if (p.stamina >= PLAYER.sprintReengageThreshold) p.exhausted = false;

  // Lopende action-state (bv. dive) blijft staan tot de timer afloopt.
  if (p.stateTimer > 0) {
    p.stateTimer = Math.max(0, p.stateTimer - dt);
  } else {
    p.state = dirLen > 0.01 ? "run" : "idle";
  }
}

/** Richtingsvector van een speler naar een doelpunt. */
export function dirTo(p: PlayerEntity, target: Vec2): Vec2 {
  return normalize({ x: target.x - p.pos.x, y: target.y - p.pos.y });
}
