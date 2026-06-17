import { PITCH, clamp, dist, distSq, len, normalize, type Vec2 } from "@pitch/shared";
import { projectBallPos } from "./ball.js";
import type { BallState, PlayerEntity, Side } from "./types.js";
import { attackingGoal, defendingGoal, dirTo, playerMaxSpeed } from "./player.js";
import { DEFAULT_TACTICS, rolePressing, tacticalTarget, type TeamTactics } from "./tactics.js";

export interface KickRequest {
  dir: Vec2;
  power: number;
  loft: number;
  curve: number;
  /** Bedoelde ontvanger (komt de bal tegemoet), of null. */
  targetId?: string | null;
}

export interface PlayerCommand {
  move: Vec2;
  sprint: boolean;
  kick: KickRequest | null;
  tackle: boolean;
}

export const noCommand = (): PlayerCommand => ({
  move: { x: 0, y: 0 },
  sprint: false,
  kick: null,
  tackle: false,
});

// --- Geometrie-helpers ---------------------------------------------------

/** Dichtstbijzijnde teamgenoot in een richtingskegel (soft aiming cone). */
export function nearestTeammateInCone(
  players: PlayerEntity[],
  from: PlayerEntity,
  facing: number,
  coneRad = Math.PI * 0.55,
  maxDist = 45,
): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestScore = Infinity;
  const fx = Math.cos(facing);
  const fy = Math.sin(facing);
  for (const p of players) {
    if (p === from || p.side !== from.side || p.isKeeper) continue;
    const dx = p.pos.x - from.pos.x;
    const dy = p.pos.y - from.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 1 || d > maxDist) continue;
    const cos = (dx * fx + dy * fy) / d;
    const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (ang > coneRad) continue;
    const score = ang * 14 + d;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

export function nearestPlayer(
  players: PlayerEntity[],
  side: Side,
  point: Vec2,
  includeKeeper = false,
): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestD = Infinity;
  for (const p of players) {
    if (p.side !== side) continue;
    if (p.isKeeper && !includeKeeper) continue;
    const d = distSq(p.pos, point);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Is de passlijn van -> naar geblokkeerd door een tegenstander? */
export function laneBlocked(
  from: Vec2,
  to: Vec2,
  opponents: PlayerEntity[],
  corridor = 2.3,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < 1e-3) return false;
  const ux = dx / segLen;
  const uy = dy / segLen;
  for (const o of opponents) {
    const rx = o.pos.x - from.x;
    const ry = o.pos.y - from.y;
    const proj = rx * ux + ry * uy;
    if (proj <= 1 || proj >= segLen - 0.5) continue;
    const perp = Math.abs(rx * -uy + ry * ux);
    if (perp < corridor) return true;
  }
  return false;
}

/**
 * Interceptie-predictie: vroegste geprojecteerde balpositie die de speler kan
 * bereiken voordat de bal er is. Gebruikt de gesloten-vorm balprojectie.
 */
export function predictIntercept(
  ball: BallState,
  defenderPos: Vec2,
  defenderSpeed: number,
): Vec2 {
  for (let t = 0.1; t <= 2.5; t += 0.1) {
    const p = projectBallPos(ball, t);
    const reach = defenderSpeed * t + 1.0;
    if (dist(defenderPos, p) <= reach) return p;
  }
  return projectBallPos(ball, 2.5);
}

/**
 * Kies de beste pass: voorwaarts, open lijn, redelijke afstand. Gedeeld door
 * AI en (optioneel) menselijke soft-aim. Geeft null als dribbelen beter is.
 */
export function chooseBestPass(
  players: PlayerEntity[],
  passer: PlayerEntity,
  opponents: PlayerEntity[],
): PlayerEntity | null {
  const attackDirX = passer.side === "home" ? 1 : -1;
  let best: PlayerEntity | null = null;
  let bestScore = -Infinity;
  for (const m of players) {
    if (m === passer || m.side !== passer.side || m.isKeeper) continue;
    const d = dist(passer.pos, m.pos);
    if (d < 6 || d > 42) continue;
    if (laneBlocked(passer.pos, m.pos, opponents)) continue;
    const advancement = (m.pos.x - passer.pos.x) * attackDirX;
    // Ruimte rond de ontvanger (afstand tot dichtstbijzijnde tegenstander).
    let nearestOpp = Infinity;
    for (const o of opponents) nearestOpp = Math.min(nearestOpp, dist(m.pos, o.pos));
    const openness = Math.min(nearestOpp, 12);
    const score = advancement * 1.0 + openness * 0.8 - d * 0.12;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  // Alleen passen als het de bal echt vooruit/uit de druk brengt.
  return bestScore > 2 ? best : null;
}

// --- Team-plan (situationele laag) ---------------------------------------

export interface TeamAiPlan {
  side: Side;
  presserId: string | null;
  coverId: string | null;
  /** Speler die een loopactie maakt (induikt in de ruimte), of null. */
  runnerId: string | null;
  /** Mandekking: verdediger-id -> op te pakken tegenstander-id (max 1-op-1). */
  marks: Map<string, string>;
  targets: Map<string, Vec2>;
}

/** Verdedigende linie volgt de BAL (niet een losse diepe spits): schuift op als
 *  de bal hoger ligt, zakt mee als de bal dichtbij komt. Harde ondergrens zodat
 *  de linie nooit op/achter de keeper komt; cap rond de middenlijn. */
const DEF_LINE_HARD_MIN = 6;
const DEF_LINE_PUSH_MAX = 46;
/** Mark alleen tegenstanders rond de bal (de actieve zone van het veld). */
const MARK_BALL_RADIUS = 38;
/** Verdediger pakt alleen op als de man redelijk dichtbij is, anders houdt hij vorm. */
const MARK_REACH = 24;

/**
 * Situationele laag: wijs per tick rollen toe (wie drukt, wie dekt) en bereken
 * elke spelers positionele basisdoel uit de tactische laag.
 */
export function computeTeamPlan(
  players: PlayerEntity[],
  ball: BallState,
  side: Side,
  controlling: Side | null,
  tactics: TeamTactics = DEFAULT_TACTICS,
  tick = 0,
): TeamAiPlan {
  const teamHasBall = controlling === side;

  // Fase: +1 aanval, -0.6 verdedigen, en bij een LOSSE bal alleen terugzakken
  // als de bal richting het eigen doel rolt — anders neutraal blijven (bijv.
  // een breedtepass mag niet de hele ploeg achteruit sturen).
  let phase: number;
  if (teamHasBall) {
    phase = 1;
  } else if (controlling !== null) {
    phase = -0.6;
  } else if (ball.lastTouchSide === side) {
    // Losse bal die wij het laatst raakten = pass (ook een terugspeelbal) tussen
    // ons in. We zijn nog steeds in bezit: behoud aanval-shape, niet terugzakken.
    phase = 0.7;
  } else {
    const towardOwnGoal = side === "home" ? ball.vel.x < -8 : ball.vel.x > 8;
    phase = towardOwnGoal ? -0.5 : 0.1;
  }

  const targets = new Map<string, Vec2>();
  const outfield: PlayerEntity[] = [];
  for (const p of players) {
    if (p.side !== side) continue;
    targets.set(p.id, tacticalTarget(p.anchor, p.position, side, ball.pos, phase, tactics));
    if (!p.isKeeper) outfield.push(p);
  }

  // Buitenspel: houd de voorste spelers gelijk met de op-één-na-laatste
  // tegenstander. Je kunt niet buitenspel staan op de eigen helft of achter de
  // bal, dus de toegestane lijn = verst van die drie (middenlijn / bal / linie).
  clampOffside(targets, players, side, ball.pos);

  // Verdedigende lijn schuift op met de BAL, niet met een losse diepe spits:
  // ligt de bal op het middenveld, dan staat de linie ook hoger (en zet zo de
  // hoog blijvende aanvallers buitenspel) i.p.v. terug te zakken op de keeper.
  const ballDist = side === "home" ? ball.pos.x : PITCH.width - ball.pos.x;
  const lineFloor = clamp(ballDist * 0.55, DEF_LINE_HARD_MIN, DEF_LINE_PUSH_MAX);
  for (const p of players) {
    if (p.side !== side || p.isKeeper) continue;
    const t = targets.get(p.id);
    if (!t) continue;
    const x = side === "home" ? Math.max(t.x, lineFloor) : Math.min(t.x, PITCH.width - lineFloor);
    if (x !== t.x) targets.set(p.id, { x, y: t.y });
  }

  void tick;

  // Presser/cover bepalen op time-to-ball, gewogen met pressing-bereidheid.
  let presserId: string | null = null;
  let coverId: string | null = null;
  if (!teamHasBall) {
    const ranked = outfield
      .map((p) => {
        const speed = playerMaxSpeed(p.stats, true);
        const time = dist(p.pos, ball.pos) / Math.max(1, speed);
        const eager = 0.5 + rolePressing(p.position) * tactics.press;
        return { p, cost: time / eager };
      })
      .sort((a, b) => a.cost - b.cost);
    presserId = ranked[0]?.p.id ?? null;
    coverId = ranked[1]?.p.id ?? null;
  }

  // Mandekking: gecoördineerd 1-op-1. De presser jaagt de bal; de overige
  // verdedigers pakken elk hoogstens één tegenstander op (en geen twee man op
  // dezelfde). Alleen tegenstanders rond de bal worden gedekt — daarbuiten houdt
  // de ploeg gewoon haar formatie. We dekken NIET als we zelf in bezit zijn —
  // ook niet tijdens een eigen pass (bal even owner-loos): dan formatie zoeken.
  const inPossession = teamHasBall || (controlling === null && ball.lastTouchSide === side);
  const marks = new Map<string, string>();
  if (!inPossession) {
    const carrierId = ball.ownerId;
    const threats = players
      .filter(
        (o) =>
          o.side !== side &&
          !o.isKeeper &&
          o.id !== carrierId &&
          distSq(o.pos, ball.pos) < MARK_BALL_RADIUS * MARK_BALL_RADIUS,
      )
      // Dichtste bij de bal eerst: dat zijn de directe dreigingen.
      .sort((a, b) => distSq(a.pos, ball.pos) - distSq(b.pos, ball.pos));
    const usedDef = new Set<string>();
    if (presserId) usedDef.add(presserId);
    for (const o of threats) {
      let best: PlayerEntity | null = null;
      let bestD = MARK_REACH * MARK_REACH;
      for (const d of outfield) {
        if (usedDef.has(d.id)) continue;
        const dd = distSq(d.pos, o.pos);
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
      if (best) {
        marks.set(best.id, o.id);
        usedDef.add(best.id);
      }
    }
  }

  return { side, presserId, coverId, runnerId: null, marks, targets };
}

/**
 * Schuif positionele doelen terug zodat de aanvallende ploeg niet structureel
 * buitenspel gaat staan. De buitenspellijn is de op-één-na-laatste tegenstander;
 * op de eigen helft of achter de bal kun je niet buitenspel staan.
 */
export function clampOffside(
  targets: Map<string, Vec2>,
  players: PlayerEntity[],
  side: Side,
  ballPos: Vec2,
): void {
  const oppX = players.filter((p) => p.side !== side).map((p) => p.pos.x);
  if (oppX.length < 2) return;
  const half = PITCH.width / 2;
  if (side === "home") {
    // Aanval naar +x: lijn = 2e-grootste tegenstander-x.
    oppX.sort((a, b) => b - a);
    const line = Math.max(oppX[1]!, ballPos.x, half);
    for (const p of players) {
      if (p.side !== side || p.isKeeper) continue;
      const t = targets.get(p.id);
      if (t && t.x > line - 0.6) targets.set(p.id, { x: line - 0.6, y: t.y });
    }
  } else {
    // Aanval naar -x: lijn = 2e-kleinste tegenstander-x.
    oppX.sort((a, b) => a - b);
    const line = Math.min(oppX[1]!, ballPos.x, half);
    for (const p of players) {
      if (p.side !== side || p.isKeeper) continue;
      const t = targets.get(p.id);
      if (t && t.x < line + 0.6) targets.set(p.id, { x: line + 0.6, y: t.y });
    }
  }
}

// --- Actielaag -----------------------------------------------------------

export function computeAiCommand(
  players: PlayerEntity[],
  ball: BallState,
  player: PlayerEntity,
  controlling: Side | null,
  plan: TeamAiPlan,
  ballHeld = false,
): PlayerCommand {
  const cmd = noCommand();
  const ownGoal = defendingGoal(player.side);
  const myGoal = attackingGoal(player.side);
  const opponents = players.filter((p) => p.side !== player.side);

  if (player.isKeeper) return keeperCommand(player, ball, ownGoal, myGoal);

  const teamHasBall = controlling === player.side;
  const target = plan.targets.get(player.id) ?? player.anchor;

  // Bal wordt vastgehouden (keeper): niet pressen, gewoon je positie houden.
  if (ballHeld && !teamHasBall) {
    moveTo(cmd, player, target, false);
    return cmd;
  }

  // Losse bal (niemand bezit): dichtste man of presser jaagt de interceptie.
  const ballLoose = controlling === null && ball.z < 1.6;

  if (ball.ownerId === player.id) {
    return onBallCommand(players, opponents, ball, player, myGoal);
  }

  // Bedoelde ontvanger van een pass: kom de bal actief tegemoet (interceptiepunt).
  if (ball.targetId === player.id && controlling === null && ball.lastTouchSide === player.side) {
    const speed = playerMaxSpeed(player.stats, true);
    const aim = len(ball.vel) > 4 ? predictIntercept(ball, player.pos, speed) : { ...ball.pos };
    moveTo(cmd, player, aim, true);
    return cmd;
  }

  if (teamHasBall) {
    // Support: beweeg naar positionele target (al opgeschoven door de tactische laag).
    moveTo(cmd, player, target, dist(player.pos, ball.pos) > 24);
    return cmd;
  }

  // Verdedigen / losse bal.
  if (player.id === plan.presserId || (ballLoose && isClosestOutfield(players, player, ball.pos))) {
    const speed = playerMaxSpeed(player.stats, true);
    const owner = ball.ownerId;
    let aim: Vec2;
    if (owner && owner !== player.id && !ballLoose) {
      // De tegenstander heeft de bal: niet in de rug lopen. Sta je goal-ver
      // (achter hem), kom dan via een hoek om hem heen naar de doel-zijde i.p.v.
      // recht op zijn rug; sta je al goal-zijde, dan knijp je 'm af bij de bal.
      const toGoal = normalize({ x: ownGoal.x - ball.pos.x, y: ownGoal.y - ball.pos.y });
      const rel = { x: player.pos.x - ball.pos.x, y: player.pos.y - ball.pos.y };
      const behind = rel.x * toGoal.x + rel.y * toGoal.y < 0;
      if (behind) {
        const perp = { x: -toGoal.y, y: toGoal.x };
        const side = rel.x * perp.x + rel.y * perp.y >= 0 ? 1 : -1;
        aim = {
          x: ball.pos.x + toGoal.x * 3 + perp.x * side * 3.2,
          y: ball.pos.y + toGoal.y * 3 + perp.y * side * 3.2,
        };
      } else {
        aim = { ...ball.pos };
      }
    } else {
      aim = len(ball.vel) > 4 ? predictIntercept(ball, player.pos, speed) : { ...ball.pos };
    }
    moveTo(cmd, player, aim, true);
    // Alleen tackelen als de bal echt binnen bereik is (anders overtreding).
    if (dist(player.pos, ball.pos) < 1.45 && owner && owner !== player.id) cmd.tackle = true;
    return cmd;
  }

  // Mandekking: dek je toegewezen man losjes (niet eraan vastgeplakt). Kies
  // positie tussen het eigen doel en de aanvaller met wat ruimte, zodat je niet
  // uit positie bent als hij de bal krijgt. Heeft hij de bal, dan druk je op om
  // af te pakken — maar blijf doel-zijde om het doel af te schermen.
  const markId = plan.marks.get(player.id);
  if (markId) {
    const man = opponents.find((o) => o.id === markId);
    if (man) {
      const toGoal = normalize({ x: ownGoal.x - man.pos.x, y: ownGoal.y - man.pos.y });
      if (ball.ownerId === man.id) {
        // Hij heeft de bal: containment-druk net aan de doel-kant, niet erlangs.
        const press: Vec2 = { x: man.pos.x + toGoal.x * 1.4, y: man.pos.y + toGoal.y * 1.4 };
        moveTo(cmd, player, press, dist(player.pos, press) > 3);
        if (dist(player.pos, man.pos) < 1.7) cmd.tackle = true;
      } else {
        // Geen bal: goal-zijde positie met ruimte (klaar om in te grijpen),
        // maar niet achter de eigen doellijn/keeper.
        const gap = 4.5;
        const mx = man.pos.x + toGoal.x * gap;
        const x = ownGoal.x === 0 ? Math.max(mx, 3) : Math.min(mx, PITCH.width - 3);
        const mark: Vec2 = { x, y: man.pos.y + toGoal.y * gap };
        moveTo(cmd, player, mark, dist(player.pos, mark) > 6);
      }
      return cmd;
    }
  }

  if (player.id === plan.coverId) {
    // Cover: positie tussen bal en eigen doel (cover shadow).
    const cover: Vec2 = {
      x: ball.pos.x + (ownGoal.x - ball.pos.x) * 0.35,
      y: ball.pos.y + (ownGoal.y - ball.pos.y) * 0.35,
    };
    moveTo(cmd, player, cover, true);
    return cmd;
  }

  // Geen man toegewezen en geen rol: houd de formatie (tactische target).
  moveTo(cmd, player, target, false);
  return cmd;
}

/** Mikpunt voor een schot: de doelhoek het verst van de keeper vandaan. */
function shotTarget(opponents: PlayerEntity[], myGoal: Vec2): Vec2 {
  const half = PITCH.goalWidth / 2 - 0.5;
  const gk = opponents.find((o) => o.isKeeper);
  if (!gk) return { x: myGoal.x, y: myGoal.y };
  // Keeper boven het midden -> mik onder, en omgekeerd.
  const y = gk.pos.y <= myGoal.y ? myGoal.y + half : myGoal.y - half;
  return { x: myGoal.x, y };
}

function onBallCommand(
  players: PlayerEntity[],
  opponents: PlayerEntity[],
  ball: BallState,
  player: PlayerEntity,
  myGoal: Vec2,
): PlayerCommand {
  const cmd = noCommand();
  const distToGoal = dist(player.pos, myGoal);
  const pressure = nearestOpponentNear(opponents, player.pos, 3.5);

  // Schieten binnen bereik: mik op de hoek wég van de keeper (niet recht op 'm).
  const aimGoal = shotTarget(opponents, myGoal);
  if (distToGoal < 20 && !laneBlocked(player.pos, aimGoal, opponents, 1.4)) {
    cmd.kick = {
      dir: dirTo(player, aimGoal),
      power: 34 + (player.stats.shooting / 100) * 12,
      loft: distToGoal < 10 ? 0.5 : 2,
      curve: 0,
    };
    return cmd;
  }

  // Pass zoeken (lane-aware, voorwaarts).
  const mate = chooseBestPass(players, player, opponents);
  if (mate && (pressure || dist(player.pos, mate.pos) > 10)) {
    const d = dist(player.pos, mate.pos);
    cmd.kick = {
      dir: dirTo(player, mate.pos),
      power: 14 + Math.min(16, d * 0.55),
      loft: laneBlocked(player.pos, mate.pos, opponents, 1.4) ? 4 : 0,
      curve: 0,
      targetId: mate.id,
    };
    return cmd;
  }

  // Dribbel richting doel; wijk licht uit bij directe druk.
  let dir = dirTo(player, myGoal);
  if (pressure) {
    const away = normalize({ x: player.pos.x - pressure.pos.x, y: player.pos.y - pressure.pos.y });
    dir = normalize({ x: dir.x + away.x * 0.6, y: dir.y + away.y * 0.6 });
  }
  cmd.move = dir;
  cmd.sprint = !pressure;
  return cmd;
}

function keeperCommand(
  gk: PlayerEntity,
  ball: BallState,
  ownGoal: Vec2,
  upfield: Vec2,
): PlayerCommand {
  const cmd = noCommand();

  // Bal in handen -> uittrappen richting de andere helft (clearance).
  if (ball.ownerId === gk.id) {
    cmd.kick = {
      dir: normalize({ x: upfield.x - gk.pos.x, y: upfield.y - gk.pos.y }),
      power: 30,
      loft: 6,
      curve: 0,
    };
    return cmd;
  }

  const sign = ownGoal.x === 0 ? 1 : -1;
  const goalLineX = ownGoal.x + sign * 2.5;
  const speed = len(ball.vel);
  const towardGoal = sign === 1 ? ball.vel.x < -6 : ball.vel.x > 6;
  const half = PITCH.goalWidth / 2 + 1.5;

  // Inkomend schot op doel -> ZIJWAARTSE duik langs de lijn. De keeper
  // anticipeert gedeeltelijk op waar de bal de lijn kruist (60%), zodat hij
  // hoekschoten kan halen — maar niet volledig (een perfect geplaatst schot kan
  // er nog in).
  if (towardGoal && speed > 13 && Math.abs(ball.pos.x - ownGoal.x) < 22) {
    let crossY = ball.pos.y;
    const vx = ball.vel.x;
    if (Math.abs(vx) > 1) {
      const t = clamp((ownGoal.x - ball.pos.x) / vx, 0, 1.2);
      crossY = ball.pos.y + ball.vel.y * t;
    }
    const aimY = ball.pos.y + (crossY - ball.pos.y) * 0.3;
    const targetY = clamp(aimY, PITCH.height / 2 - half, PITCH.height / 2 + half);
    moveTo(cmd, gk, { x: goalLineX, y: targetY }, true);
    return cmd;
  }

  // 1v1 / doorgebroken bal: uitkomen om te smoren (alleen bij trage bal dichtbij).
  if (dist(gk.pos, ball.pos) < 4.5 && speed < 11 && ball.z < 1.6) {
    moveTo(cmd, gk, ball.pos, true);
    if (dist(gk.pos, ball.pos) < 1.5) cmd.tackle = true;
    return cmd;
  }

  // Standaard: op de hoek-bisectrice (lijn bal -> doelmidden). Bij een zijbal
  // blijft de keeper zo meer centraal i.p.v. bij de paal te gaan staan.
  const gc = { x: ownGoal.x, y: PITCH.height / 2 };
  const toBall = normalize({ x: ball.pos.x - gc.x, y: ball.pos.y - gc.y });
  const outDist = 3.5;
  const target: Vec2 = {
    x: gc.x + toBall.x * outDist,
    y: clamp(gc.y + toBall.y * outDist, PITCH.height / 2 - 6, PITCH.height / 2 + 6),
  };
  moveTo(cmd, gk, target, len({ x: target.x - gk.pos.x, y: target.y - gk.pos.y }) > 2.5);
  return cmd;
}

// --- kleine helpers ------------------------------------------------------

function moveTo(cmd: PlayerCommand, p: PlayerEntity, target: Vec2, sprint: boolean): void {
  const to = { x: target.x - p.pos.x, y: target.y - p.pos.y };
  cmd.move = len(to) > 1.0 ? normalize(to) : { x: 0, y: 0 };
  cmd.sprint = sprint && len(to) > 3;
}

function nearestOpponentNear(opponents: PlayerEntity[], point: Vec2, radius: number): PlayerEntity | null {
  let best: PlayerEntity | null = null;
  let bestD = radius * radius;
  for (const o of opponents) {
    const d = distSq(o.pos, point);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function isClosestOutfield(players: PlayerEntity[], player: PlayerEntity, point: Vec2): boolean {
  return nearestPlayer(players, player.side, point)?.id === player.id;
}
