import {
  BALL,
  PITCH,
  PITCH_CENTER,
  PLAYER,
  RULES,
  Rng,
  angleOf,
  clamp,
  dist,
  len,
  normalize,
  type Vec2,
} from "@pitch/shared";
import { applyAftertouch, createBall, kickBall, stepBall } from "./ball.js";
import {
  chooseBestPass,
  clampOffside,
  computeAiCommand,
  computeTeamPlan,
  nearestPlayer,
  nearestTeammateInCone,
  noCommand,
  type PlayerCommand,
  type TeamAiPlan,
} from "./ai.js";
import { anchorFor } from "./formation.js";
import { attackingGoal, dirTo, moveTowards } from "./player.js";
import { DEFAULT_TACTICS, roleAdvance, type TeamTactics } from "./tactics.js";
import {
  emptyIntent,
  otherSide,
  type BallState,
  type MatchConfig,
  type MatchPhase,
  type MatchPlayerSetup,
  type PlayerEntity,
  type PlayerIntent,
  type Position,
  type Side,
  type TeamSetup,
} from "./types.js";

const CROSSBAR_HEIGHT = 2.44;
const WHISTLE_DELAY = 2.0; // s spel loopt door na uit/overtreding voor de hervatting
const KEEPER_DISTRIBUTE_DELAY = 1.6; // s die de AI-keeper de bal vasthoudt voor uittrap
const CORNER_SETUP_PAUSE = 3.2; // s extra stilstand bij een hoek zodat de ploegen zich opstellen
const AIM_ROTATE_RATE = 1.8; // rad/s waarmee links/rechts het richt-pijltje draait
const FREEKICK_DANGER_DIST = 30; // tot deze afstand van het doel: muurtje + opstelling

/** Soort spelhervatting (stuurt nemer-keuze en voorsortering van de ploegen). */
type RestartKind = "kickoff" | "throwin" | "goalkick" | "corner" | "freekick" | "penalty";

/** Hervatting met een mikbaar richt-pijltje (schiet/voorzet in de pijlrichting). */
function isAimableRestart(kind: RestartKind | null): boolean {
  return kind === "corner" || kind === "freekick" || kind === "penalty";
}

export interface MatchSnapshotPlayer {
  id: string;
  side: Side;
  shirtNumber: number;
  position: Position;
  firstName: string;
  lastName: string;
  hairColor: string;
  skinColor: string;
  x: number;
  y: number;
  facing: number;
  state: string;
  isKeeper: boolean;
  isActive: boolean;
  hasBall: boolean;
}

export interface MatchSnapshot {
  players: MatchSnapshotPlayer[];
  ball: { x: number; y: number; z: number };
  score: { home: number; away: number };
  matchSeconds: number;
  matchMinute: number;
  /** Helft (1 of 2) — de teams wisselen in de 2e helft van kant. */
  half: number;
  phase: MatchPhase;
  possession: Side | null;
  activeId: string | null;
  /** Sprintmeter (0..1) van de bestuurde speler, voor de HUD. */
  activeStamina: number;
  activeExhausted: boolean;
  /** Wacht de hervatting op een inname door de menselijke speler? */
  awaitingHumanRestart: boolean;
  /** Richt-pijltje (rad) voor een mikbare hervatting van de mens, of null. */
  restartAim: number | null;
}

export class MatchSim {
  readonly config: MatchConfig;
  private rng: Rng;
  players: PlayerEntity[] = [];
  ball: BallState;
  score = { home: 0, away: 0 };

  matchSeconds = 0;
  phase: MatchPhase = "kickoff";
  private phaseTimer = 0;
  private half = 1;
  /** Huidige helft (1/2) — voor de presentatie-rotatie van het veld. */
  get currentHalf(): number {
    return this.half;
  }
  private kickoffSide: Side = "home";
  private lastConcededSide: Side | null = null;

  private humanSide: Side | null;
  activeId: Record<Side, string | null> = { home: null, away: null };
  private tactics: Record<Side, TeamTactics>;

  // Spelhervatting (aftrap/inworp/doeltrap/hoek/vrije trap): wie neemt, welke ploeg.
  private restartTakerId: string | null = null;
  private restartTakingSide: Side | null = null;
  private restartReady = 0; // verplichte stilstand voordat ingenomen mag worden
  private restartIsKickoff = false;
  private restartIsPenalty = false;
  private restartKind: RestartKind | null = null;
  // Richt-hoek (rad) voor een mikbare hervatting (hoek/vrije trap/penalty): het
  // pijltje dat de mens met links/rechts bijstelt; Z schiet die richting op.
  private restartAim: number | null = null;
  // Uitgestelde vrije trap door een overtreding (verwerkt na de commandolus).
  private pendingFoul: { spot: Vec2; side: Side } | null = null;
  // "Fluit"-fase: bal gaat over de lijn / overtreding gemaakt; spel loopt nog
  // ~2s na voordat naar de hervatting wordt geschakeld.
  private whistleTimer = 0;
  private pendingRestart: { spot: Vec2; takingSide: Side; kind: RestartKind } | null = null;
  // Bal beschermd voor deze ploeg (keeper heeft 'm vast): niet af te pakken.
  private ballProtectedFor: Side | null = null;
  // Hoelang de keeper de bal nu al vasthoudt (s). Stuurt de uittrap-/uitgooi-
  // vertraging zodat de keeper de bal eerst even klemvast pakt i.p.v. direct weg.
  private keeperHoldTime = 0;

  constructor(config: MatchConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.humanSide = config.humanSide;
    this.tactics = {
      home: config.home.tactics ?? DEFAULT_TACTICS,
      away: config.away.tactics ?? DEFAULT_TACTICS,
    };
    this.ball = createBall({ ...PITCH_CENTER });
    this.buildTeam(config.home, "home");
    this.buildTeam(config.away, "away");
    this.kickoffSide = this.rng.chance() ? "home" : "away";
    this.resetForKickoff(this.kickoffSide);
  }

  private buildTeam(setup: TeamSetup, side: Side): void {
    // Groepeer per positie om dubbele posities te kunnen spreiden.
    const byPos = new Map<string, MatchPlayerSetup[]>();
    for (const ps of setup.players) {
      const arr = byPos.get(ps.position) ?? [];
      arr.push(ps);
      byPos.set(ps.position, arr);
    }
    for (const ps of setup.players) {
      const group = byPos.get(ps.position)!;
      const slot = group.indexOf(ps);
      const anchor = anchorFor(side, ps.position, slot, group.length);
      // Kleine seed-afhankelijke variatie in positionering (geen GK).
      if (ps.position !== "GK") {
        anchor.x += this.rng.range(-1.2, 1.2);
        anchor.y += this.rng.range(-1.2, 1.2);
      }
      this.players.push({
        id: ps.id,
        side,
        shirtNumber: ps.shirtNumber,
        position: ps.position,
        firstName: ps.firstName,
        lastName: ps.lastName,
        hairColor: ps.hairColor,
        skinColor: ps.skinColor,
        isKeeper: ps.position === "GK",
        stats: ps.stats,
        anchor,
        pos: { ...anchor },
        vel: { x: 0, y: 0 },
        facing: side === "home" ? 0 : Math.PI,
        state: "idle",
        stateTimer: 0,
        tackleCooldown: 0,
        stamina: 1,
        exhausted: false,
      });
    }
  }

  private resetForKickoff(side: Side): void {
    this.kickoffSide = side;
    this.ball = createBall({ ...PITCH_CENTER });
    this.ballProtectedFor = null;
    const halfX = PITCH.width / 2;
    for (const p of this.players) {
      // Zet iedereen terug op anker, maar dwing ze op de eigen helft.
      const x = p.side === "home"
        ? Math.min(p.anchor.x, halfX - 0.8)
        : Math.max(p.anchor.x, halfX + 0.8);
      p.pos = { x, y: p.anchor.y };
      p.vel = { x: 0, y: 0 };
      p.state = "idle";
    }
    // Eén speler van de aftrappende ploeg bij de bal (mag over de middenlijn).
    const taker = nearestPlayer(this.players, side, PITCH_CENTER);
    if (taker) {
      taker.pos = { x: PITCH_CENTER.x - (side === "home" ? 1.5 : -1.5), y: PITCH_CENTER.y };
      this.restartTakerId = taker.id;
    } else {
      this.restartTakerId = null;
    }
    this.restartTakingSide = side;
    this.restartReady = RULES.restartPause;
    this.restartIsKickoff = true;
    this.restartIsPenalty = false;
    this.restartKind = "kickoff";
    this.phase = "kickoff";
  }

  /**
   * De hervatting wordt ingenomen: de nemer trapt/gooit de bal naar een
   * teamgenoot (of in de aangegeven richting). Pas dan is de bal in het spel.
   */
  private takeRestart(dir: Vec2, power: number, loft: number, targetId: string | null = null): void {
    const taker = this.byId(this.restartTakerId);
    this.phase = "play";
    if (taker) {
      this.ball.pos = { x: taker.pos.x, y: taker.pos.y };
      kickBall(this.ball, { dir, power, loft, curve: 0, byId: taker.id, bySide: taker.side, targetId });
      taker.state = "kick";
    }
    this.restartTakerId = null;
    this.restartTakingSide = null;
    this.restartIsKickoff = false;
    this.restartIsPenalty = false;
    this.restartKind = null;
    this.restartAim = null;
    this.ballProtectedFor = null;
  }

  private byId(id: string | null): PlayerEntity | null {
    if (!id) return null;
    return this.players.find((p) => p.id === id) ?? null;
  }

  private controllingSide(): Side | null {
    const owner = this.byId(this.ball.ownerId);
    return owner ? owner.side : null;
  }

  /** Eén vaste sim-stap. humanIntent geldt voor de actieve speler van humanSide. */
  step(dt: number, humanIntent: PlayerIntent = emptyIntent()): void {
    // Fasebeheer.
    if (this.phase === "kickoff" || this.phase === "deadball") {
      this.stepRestart(dt, humanIntent);
      return;
    } else if (this.phase === "goal") {
      this.phaseTimer -= dt;
      // Bal rolt het net in en blijft daar hangen; spelers sorteren alvast
      // voor op de aftrap (eigen helft).
      stepBall(this.ball, dt);
      this.settleBallInNet();
      this.driftToKickoff(dt);
      if (this.phaseTimer <= 0) {
        // De ploeg die tegen kreeg, trapt af.
        this.resetForKickoff(this.lastConcededSide ?? otherSide(this.kickoffSide));
      }
      return;
    } else if (this.phase === "halftime") {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.half = 2;
        this.resetForKickoff(otherSide(this.kickoffSide));
      }
      return;
    } else if (this.phase === "whistle") {
      this.stepWhistle(dt);
      return;
    } else if (this.phase === "fulltime") {
      return;
    }

    // Schud de spelervolgorde per tick: geen enkele ploeg krijgt een
    // structureel first-mover-voordeel in ownership-/botsing-/commandolussen.
    this.rng.shuffle(this.players);

    this.updateActivePlayers(humanIntent);
    this.updateBallOwnership();

    const controlling = this.controllingSide();
    const ballHeld = this.ballProtectedFor !== null;

    // Keeper-vasthoudtimer: loopt op zolang een keeper de bal klemvast heeft,
    // reset zodra niemand (of een veldspeler) de bal heeft.
    const holdingKeeper = this.byId(this.ball.ownerId);
    if (holdingKeeper?.isKeeper && this.ballProtectedFor === holdingKeeper.side) {
      this.keeperHoldTime += dt;
    } else {
      this.keeperHoldTime = 0;
    }

    // Situationele laag: één team-plan per ploeg per tick.
    const plans: Record<Side, TeamAiPlan> = {
      home: computeTeamPlan(this.players, this.ball, "home", controlling, this.tactics.home, this.matchSeconds),
      away: computeTeamPlan(this.players, this.ball, "away", controlling, this.tactics.away, this.matchSeconds),
    };

    // Commando's bepalen en toepassen (volgorde al geschud bovenaan de tick).
    for (const p of this.players) {
      p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
      const isHumanActive =
        this.humanSide === p.side && this.activeId[p.side] === p.id && this.phase === "play";
      const cmd = isHumanActive
        ? this.buildHumanCommand(p, humanIntent)
        : computeAiCommand(this.players, this.ball, p, controlling, plans[p.side], ballHeld);

      // AI-keeper houdt de bal eerst even klemvast voordat hij uittrapt/uitgooit
      // (geen instant clearance). De menselijke keeper trapt zelf, dus die niet.
      const aiKeeperHolding =
        !isHumanActive &&
        p.isKeeper &&
        this.ball.ownerId === p.id &&
        this.keeperHoldTime < KEEPER_DISTRIBUTE_DELAY;
      if (aiKeeperHolding) cmd.kick = null;

      // AI-keeper: fysieke duik naar een inkomend schot (impuls); de dive-state
      // onderdrukt daarna zijn normale beweging in applyCommand, zodat de impuls
      // hem ballistisch naar het kruispunt draagt.
      if (!isHumanActive && p.isKeeper) this.tryKeeperDive(p);

      // AI maakt af en toe een overtreding: een verdediger die dicht op de
      // baldragende tegenstander zit (lichaam binnen bereik) terwijl de bal net
      // buiten schoon bereik is, kan een mistimede sliding inzetten -> de man
      // i.p.v. de bal raken. Kans is klein en hoger bij een zwakke tackler.
      if (!isHumanActive && !p.isKeeper && p.tackleCooldown <= 0 && !cmd.tackle) {
        const owner = this.byId(this.ball.ownerId);
        if (owner && owner.side !== p.side) {
          const dMan = dist(p.pos, owner.pos);
          const dBall = dist(p.pos, this.ball.pos);
          if (dMan < PLAYER.tackleRange + 0.3 && dBall > PLAYER.tackleRange) {
            const foulProb = 0.006 * (1.5 - p.stats.tackling / 100);
            if (this.rng.chance(foulProb)) cmd.tackle = true;
          }
        }
      }

      // AI-schoten zijn niet perfect: voeg richting-scatter toe zodat de
      // computer niet elke bal pijlrecht in de hoek mikt. Dichtbij = nauwkeurig,
      // van afstand = wild; betere shooting = strakker. Een mens mikt zelf en
      // wordt niet verstoord. Zo blijft de keeper de meeste AI-schoten pakken
      // terwijl een bewust geplaatst menselijk schot er wél in kan.
      if (!isHumanActive && !p.isKeeper && cmd.kick && !cmd.kick.targetId) {
        const goal = attackingGoal(p.side);
        const dGoal = dist(p.pos, goal);
        const toGoal = normalize({ x: goal.x - p.pos.x, y: goal.y - p.pos.y });
        const aim = cmd.kick.dir;
        const dot = aim.x * toGoal.x + aim.y * toGoal.y;
        if (dGoal < 28 && dot > 0.6) {
          const sh = p.stats.shooting / 100;
          const sigma = (0.04 + dGoal * 0.011) * (1.5 - sh);
          const ang = Math.atan2(aim.y, aim.x) + this.rng.gaussian(0, sigma);
          cmd.kick.dir = { x: Math.cos(ang), y: Math.sin(ang) };
        }
      }

      this.applyCommand(p, cmd, dt);
    }

    // Spelers kunnen niet door elkaar lopen (duwen wel).
    this.resolvePlayerCollisions();

    // Keeper met de bal mag niet buiten zijn strafschopgebied komen.
    this.clampKeeperWithBallToBox();

    // Keeper houdt de bal vast: tegenstanders moeten afstand houden.
    if (this.ballProtectedFor) {
      this.keepOpponentsAway(this.ballProtectedFor, RULES.keeperHoldKeepOut);
    }

    // Overtreding tijdens deze tick -> spel loopt nog ~2s door, dan vrije trap.
    // In het strafschopgebied van de verdediger -> strafschop.
    if (this.pendingFoul) {
      const f = this.pendingFoul;
      this.pendingFoul = null;
      const atkGoal = attackingGoal(f.side);
      if (this.isInPenaltyBox(f.spot, atkGoal)) {
        const spotX =
          atkGoal.x === 0 ? PITCH.penaltySpotDist : PITCH.width - PITCH.penaltySpotDist;
        this.beginWhistle({ x: spotX, y: PITCH.height / 2 }, f.side, "penalty");
      } else {
        this.beginWhistle(f.spot, f.side, "freekick");
      }
      return;
    }

    // Aftertouch voor de menselijke speler tijdens het venster na zijn trap.
    if (this.humanSide && this.ball.lastTouchSide === this.humanSide) {
      const steer = len(humanIntent.aftertouch) > 0.01 ? humanIntent.aftertouch : humanIntent.move;
      applyAftertouch(this.ball, steer);
    }

    // Balfysica + botsingen.
    stepBall(this.ball, dt);
    this.resolveBallPlayerCollisions();
    this.keeperSaves();
    if (!this.checkGoal()) {
      this.handleOutOfPlay();
    }

    // Klok.
    this.matchSeconds += dt;
    const minute = this.matchMinute();
    if (this.half === 1 && minute >= RULES.halfTimeMinute) {
      this.phase = "halftime";
      this.phaseTimer = 1.2;
    } else if (this.half === 2 && minute >= RULES.matchMinutes) {
      this.phase = "fulltime";
    }
  }

  private matchMinute(): number {
    return Math.floor(this.matchSeconds / RULES.secondsPerMatchMinute);
  }

  private updateActivePlayers(intent: PlayerIntent): void {
    for (const side of ["home", "away"] as Side[]) {
      const ownerOnSide = this.byId(this.ball.ownerId)?.side === side ? this.ball.ownerId : null;
      if (ownerOnSide) {
        this.activeId[side] = ownerOnSide;
        continue;
      }
      // Auto-switch naar de dichtstbijzijnde veldspeler bij de bal.
      const near = nearestPlayer(this.players, side, this.ball.pos);
      if (near) this.activeId[side] = near.id;
    }
    void intent;
  }

  private updateBallOwnership(): void {
    // Beschermde bal (keeper heeft 'm vast): eigenaar blijft, niet af te pakken.
    const curOwner = this.byId(this.ball.ownerId);
    if (this.ballProtectedFor) {
      if (curOwner?.isKeeper && curOwner.side === this.ballProtectedFor) return;
      this.ballProtectedFor = null; // keeper heeft de bal losgelaten
    }
    // Bal net getrapt? Even geen nieuwe eigenaar (laat 'm los).
    if (this.ball.sinceKick < 0.12) {
      this.ball.ownerId = null;
      return;
    }
    if (this.ball.z > 1.6) {
      this.ball.ownerId = null;
      return;
    }
    // Een hard schot/harde bal is niet zomaar te controleren: hij vliegt door
    // (verdedigers kunnen 'm niet simpelweg stilzetten door ervoor te staan).
    if (this.ball.ownerId === null && len(this.ball.vel) > 18) {
      return;
    }
    let best: PlayerEntity | null = null;
    let bestD: number = BALL.controlRadius;
    for (const p of this.players) {
      const d = dist(p.pos, this.ball.pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    this.ball.ownerId = best ? best.id : null;
    if (best) {
      this.ball.lastTouchSide = best.side;
      this.ball.lastTouchId = best.id;
      // Bal aangekomen/onderschept: bedoelde-ontvanger-aanduiding vervalt.
      this.ball.targetId = null;
      // Keeper die de bal controleert -> klemvast (beschermd balbezit).
      if (best.isKeeper) this.ballProtectedFor = best.side;
    }
  }

  private buildHumanCommand(p: PlayerEntity, intent: PlayerIntent): PlayerCommand {
    const cmd = noCommand();
    cmd.move = intent.move;
    cmd.sprint = intent.sprint;

    const isOwner = this.ball.ownerId === p.id;

    if (intent.actionReleased) {
      const hold = intent.actionHeld;
      // Z = schieten, X = passen. (null = generieke release telt als pass.)
      const shoot = intent.actionKind === "shoot";
      const aimDir = this.aimDirection(p, intent);
      if (isOwner) {
        if (p.isKeeper) {
          // Keeper verdeelt naar een teamgenoot in de kijkrichting. X = korte,
          // ROLLENDE en goed te controleren pass; Z = verre, lofted uittrap.
          const longBall = shoot;
          const maxDist = longBall ? 70 : 38;
          const mate = nearestTeammateInCone(
            this.players,
            p,
            aimAngle(aimDir),
            Math.PI * 0.6,
            maxDist,
          );
          const dir = mate ? dirTo(p, mate.pos) : aimDir;
          const d = mate ? dist(p.pos, mate.pos) : longBall ? 36 : 14;
          const tId = mate?.id ?? null;
          cmd.kick = longBall
            ? { dir, power: clamp(16 + d * 0.45, 18, 32), loft: 4 + (hold >= 0.5 ? 4 : 0), curve: 0, targetId: tId }
            : { dir, power: clamp(8 + d * 0.4, 10, 17), loft: 0, curve: 0, targetId: tId };
        } else if (shoot) {
          // Een schot is ALTIJD zo hard als deze speler kan (op basis van zijn
          // shooting-stat) — een korte tik is dus al een vol schot. Langer
          // inhouden doet alleen íets met de hoogte; echte hoogte maak je los
          // met aftertouch (tégen de balrichting in sturen).
          const sh = p.stats.shooting / 100;
          const full = 30 + sh * 16; // hardste schot van deze speler
          // Een normale tik = al een vol schot (bereikt vol rond 0.15s). Een
          // ECHT korte tik tikt de bal alleen even voor je uit (zacht).
          const ramp = clamp(hold / 0.15, 0, 1);
          const power = 8 + ramp * (full - 8);
          // Langer inhouden tilt de bal echt van de grond. loft = opwaartse
          // beginsnelheid; piek ≈ loft²/(2·g). lift 0..1 over ~0.5s -> tot ~10
          // u/s -> ruim 2 m hoog. Echte krul/extra hoogte nog via aftertouch.
          const lift = clamp((hold - 0.15) / 0.5, 0, 1);
          cmd.kick = {
            dir: { x: Math.cos(p.facing), y: Math.sin(p.facing) },
            power,
            loft: ramp * 0.5 + lift * 9.5,
            curve: 0,
          };
        } else {
          // Pass (X) naar de teamgenoot in de gestuurde richting: strakke kegel
          // + zwaar hoekgewicht, zodat de richting voorgaat op pure nabijheid.
          const mate = nearestTeammateInCone(
            this.players,
            p,
            aimAngle(aimDir),
            Math.PI * 0.42,
            48,
            34,
          );
          const dir = mate ? dirTo(p, mate.pos) : aimDir;
          const d = mate ? dist(p.pos, mate.pos) : 14;
          cmd.kick = { dir, power: 13 + Math.min(15, d * 0.5), loft: 0, curve: 0, targetId: mate?.id ?? null };
        }
      } else if (dist(p.pos, this.ball.pos) < 1.3 && this.ball.z < 1.5) {
        // Losse bal aan de voet: one-touch (X = pass, Z = clear).
        cmd.kick = shoot
          ? { dir: aimDir, power: 26, loft: 3, curve: 0 }
          : { dir: aimDir, power: 16, loft: 0, curve: 0 };
      } else {
        // Sliding tackle richting de bal.
        cmd.tackle = true;
      }
    }
    return cmd;
  }

  /** Richting voor pass/schot: looprichting indien aanwezig, anders facing. */
  private aimDirection(p: PlayerEntity, intent: PlayerIntent): Vec2 {
    if (len(intent.move) > 0.1) return normalize(intent.move);
    return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
  }

  private applyCommand(p: PlayerEntity, cmd: PlayerCommand, dt: number): void {
    // Een duikende keeper: zijn duik-impuls draagt hem BALLISTISCH (constante
    // snelheid) naar het kruispunt — niet afremmen, anders komt hij niet op tijd.
    // Hij stuurt niet meer bij (een duik is een commitment). Daarna komt hij pas
    // overeind als de dive-timer afloopt.
    if (p.isKeeper && p.state === "dive" && p.stateTimer > 0 && this.ball.ownerId !== p.id) {
      // Duik tot het eindpunt en stop daar — niet ver voorbij de bal doorschieten.
      const tgt = p.diveTarget;
      if (tgt) {
        const toX = tgt.x - p.pos.x;
        const toY = tgt.y - p.pos.y;
        const remain = Math.hypot(toX, toY);
        const stepLen = len(p.vel) * dt;
        if (remain <= stepLen + 0.02) {
          // Bereikt: zet op het doel en blijf liggen (geen snelheid meer).
          p.pos.x = tgt.x;
          p.pos.y = tgt.y;
          p.vel.x = 0;
          p.vel.y = 0;
        } else {
          p.pos.x += p.vel.x * dt;
          p.pos.y += p.vel.y * dt;
        }
      } else {
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
      }
      p.pos.x = clamp(p.pos.x, -PITCH.margin, PITCH.width + PITCH.margin);
      p.pos.y = clamp(p.pos.y, -PITCH.margin, PITCH.height + PITCH.margin);
      // Keeper blijft ook tijdens de duik naar de bal kijken (duik = zijwaarts).
      p.facing = angleOf({ x: this.ball.pos.x - p.pos.x, y: this.ball.pos.y - p.pos.y });
      p.stateTimer = Math.max(0, p.stateTimer - dt);
      return;
    }

    // Beweging.
    moveTowards(p, cmd.move, cmd.sprint, dt);

    // Een keeper kijkt altijd naar de bal (behalve als hij 'm zelf draagt en
    // uittrapt) — zo blijft hij oogcontact houden en duikt hij zijwaarts.
    if (p.isKeeper && this.ball.ownerId !== p.id) {
      p.facing = angleOf({ x: this.ball.pos.x - p.pos.x, y: this.ball.pos.y - p.pos.y });
    }

    // Bal dragen: licht voor de speler uit "kleven".
    if (this.ball.ownerId === p.id && this.ball.sinceKick > 0.12) {
      const ahead = 0.9;
      const fx = Math.cos(p.facing);
      const fy = Math.sin(p.facing);
      const targetX = p.pos.x + fx * ahead;
      const targetY = p.pos.y + fy * ahead;
      this.ball.pos.x += (targetX - this.ball.pos.x) * Math.min(1, dt * 12);
      this.ball.pos.y += (targetY - this.ball.pos.y) * Math.min(1, dt * 12);
      this.ball.vel.x = p.vel.x;
      this.ball.vel.y = p.vel.y;
      this.ball.z = 0;
      this.ball.vz = 0;
    }

    // Trap.
    if (cmd.kick) {
      kickBall(this.ball, {
        dir: cmd.kick.dir,
        power: cmd.kick.power,
        loft: cmd.kick.loft,
        curve: cmd.kick.curve,
        byId: p.id,
        bySide: p.side,
        targetId: cmd.kick.targetId ?? null,
      });
      p.state = "kick";
      p.stateTimer = 0.2;
    }

    // Tackle (sliding) — uitzondering op de spelerbotsing: je mag inglijden.
    if (cmd.tackle && p.tackleCooldown <= 0) {
      p.state = "tackle";
      p.stateTimer = 0.35;
      p.tackleCooldown = 0.9;
      // Inglij-impuls richting de bal.
      const lunge = dirTo(p, this.ball.pos);
      p.vel.x += lunge.x * 6;
      p.vel.y += lunge.y * 6;

      // Beschermde bal (keeper vast): niet af te pakken door de tegenstander.
      const stealable = !this.ballProtectedFor || this.ballProtectedFor === p.side;
      const dBall = dist(p.pos, this.ball.pos);
      if (stealable && dBall < PLAYER.tackleRange) {
        // Bal binnen bereik: win 'm (kans schaalt met tackling).
        const owner = this.byId(this.ball.ownerId);
        const success =
          !owner ||
          owner.side !== p.side ||
          this.rng.chance(0.55 + (p.stats.tackling - 50) / 180);
        if (success) {
          const dir = dirTo(p, this.ball.pos);
          kickBall(this.ball, { dir, power: 6, loft: 0, curve: 0, byId: p.id, bySide: p.side });
        }
      } else if (stealable) {
        // Bal niet bij de tackle: raak je een tegenstander -> overtreding.
        const victim = this.nearestOpponentWithinTackle(p);
        if (victim) {
          this.pendingFoul = { spot: { ...victim.pos }, side: victim.side };
        }
      }
    }
  }

  /** Dichtstbijzijnde tegenstander binnen tackle-bereik (voor overtredingen). */
  private nearestOpponentWithinTackle(p: PlayerEntity): PlayerEntity | null {
    let best: PlayerEntity | null = null;
    let bestD: number = PLAYER.tackleRange;
    for (const o of this.players) {
      if (o.side === p.side) continue;
      const d = dist(o.pos, p.pos);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Spelers kunnen niet overlappen; ze duwen elkaar (tacklende glijdt door). */
  private resolvePlayerCollisions(): void {
    const minDist = PLAYER.radius * 2;
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const a = this.players[i]!;
      if (a.state === "tackle") continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.players[j]!;
        if (b.state === "tackle") continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const d = Math.hypot(dx, dy);
        if (d >= minDist || d <= 1e-4) continue;
        const push = (minDist - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
      }
    }
  }

  /** Spelhervatting met pauze: spelers herpositioneren, bal ligt stil. */
  /**
   * Beschermde spelhervatting (aftrap/inworp/doeltrap/hoek/vrije trap).
   * De wedstrijd staat stil: de bal ligt bij de nemer en is niet af te pakken,
   * tegenstanders moeten afstand houden. Wordt pas "in het spel" als de nemer
   * de bal speelt (mens: actieknop; AI: na de verplichte stilstand).
   */
  private stepRestart(dt: number, humanIntent: PlayerIntent): void {
    this.restartReady = Math.max(0, this.restartReady - dt);
    const taking = this.restartTakingSide;
    if (!taking) {
      this.phase = "play";
      this.restartIsKickoff = false;
      this.restartKind = null;
      this.ballProtectedFor = null;
      return;
    }
    const taker = this.byId(this.restartTakerId);
    const halfX = PITCH.width / 2;

    // Bal ligt stil bij de nemer en is van de nemer (niet te stelen). Bij een
    // aftrap ligt de bal exact op de middenstip (de nemer staat ernaast).
    if (taker) {
      this.ball.pos = this.restartIsKickoff
        ? { x: PITCH_CENTER.x, y: PITCH_CENTER.y }
        : { x: taker.pos.x, y: taker.pos.y };
      this.ball.ownerId = taker.id;
      this.ball.lastTouchSide = taker.side;
      if (this.restartIsKickoff) {
        taker.facing = taker.side === "home" ? 0 : Math.PI;
      }
    }
    this.ball.vel = { x: 0, y: 0 };
    this.ball.vz = 0;
    this.ball.z = 0;
    if (taking) this.ballProtectedFor = taking;

    // Mens stelt het richt-pijltje bij door opzij te sturen t.o.v. de pijl
    // (push loodrecht op de pijl = pijl draait die kant op). Werkt in
    // wereld-ruimte, dus rotatie-onafhankelijk (klopt ook met het gedraaide veld).
    if (taking === this.humanSide && this.restartAim !== null && len(humanIntent.move) > 0.1) {
      const ax = Math.cos(this.restartAim);
      const ay = Math.sin(this.restartAim);
      const steer = -humanIntent.move.x * ay + humanIntent.move.y * ax; // component ⊥ op de pijl
      this.restartAim += steer * AIM_ROTATE_RATE * dt;
      if (taker) taker.facing = this.restartAim;
    }

    const special = this.restartKind
      ? this.restartSpecialTargets(this.ball.pos, taking, this.restartKind, taker?.id ?? null)
      : null;
    const plans: Record<Side, TeamAiPlan> = {
      home: computeTeamPlan(this.players, this.ball, "home", taking, this.tactics.home, this.matchSeconds),
      away: computeTeamPlan(this.players, this.ball, "away", taking, this.tactics.away, this.matchSeconds),
    };
    for (const p of this.players) {
      p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
      p.state = "idle";
      if (taker && p.id === taker.id) {
        p.vel = { x: 0, y: 0 };
        continue;
      }
      let target =
        special?.get(p.id) ?? plans[p.side].targets.get(p.id) ?? p.anchor;
      if (this.restartIsKickoff) {
        // Bij aftrap iedereen op de eigen helft.
        const cx = p.side === "home" ? Math.min(target.x, halfX - 0.8) : Math.max(target.x, halfX + 0.8);
        target = { x: cx, y: target.y };
      }
      const to = { x: target.x - p.pos.x, y: target.y - p.pos.y };
      const sprint = special !== null && len(to) > 4;
      moveTowards(p, len(to) > 1.0 ? normalize(to) : { x: 0, y: 0 }, sprint, dt);
    }
    this.resolvePlayerCollisions();

    // Tegenstanders op afstand van de bal houden (mogen niet afrennen/afpakken).
    const keepOut = this.restartIsKickoff
      ? Math.max(RULES.restartKeepOut, PITCH.centerCircleRadius)
      : RULES.restartKeepOut;
    if (taking) this.keepOpponentsAway(taking, keepOut);

    // Innemen pas na de verplichte stilstand.
    if (this.restartReady > 0) return;
    if (!taker) {
      this.phase = "play";
      this.restartTakingSide = null;
      this.restartIsKickoff = false;
      this.restartKind = null;
      this.ballProtectedFor = null;
      return;
    }
    const goal = attackingGoal(taking);
    if (taking === this.humanSide) {
      // Match staat stil tot de mens zelf inneemt.
      if (humanIntent.actionReleased) {
        // Schiet-/voorzetrichting = het richt-pijltje als dat actief is (hoek/
        // vrije trap/penalty), anders de toetsrichting.
        const shootDir =
          this.restartAim !== null
            ? { x: Math.cos(this.restartAim), y: Math.sin(this.restartAim) }
            : this.aimDirection(taker, humanIntent);
        if (this.restartIsPenalty) {
          this.takeRestart(shootDir, 34, 1);
        } else {
          const charge = clamp(humanIntent.actionHeld / 0.5, 0, 1);
          const shoot = humanIntent.actionKind === "shoot";
          if (shoot && !this.restartIsKickoff) {
            // Z = geladen schot/voorzet in de pijlrichting. Langer inhouden =
            // harder én hoger.
            this.takeRestart(shootDir, 20 + charge * 16, 3 + charge * 9);
          } else {
            // X = gerichte, harde pass op maat naar een teamgenoot in de
            // TOETSrichting (ook bij hoek/inworp); de ontvanger komt 'm tegemoet.
            const passAim = this.aimDirection(taker, humanIntent);
            const mate = nearestTeammateInCone(
              this.players,
              taker,
              aimAngle(passAim),
              Math.PI * 0.6,
              this.restartIsKickoff ? 40 : 64,
            );
            const dir = mate ? dirTo(taker, mate.pos) : passAim;
            const d = mate ? dist(taker.pos, mate.pos) : 18;
            const power = this.restartIsKickoff
              ? clamp(11 + d * 0.4, 12, 22)
              : clamp(14 + d * 0.5, 16, 34);
            this.takeRestart(dir, power, 0, mate?.id ?? null);
          }
        }
      }
      return;
    }
    // Strafschop door AI: hard schot naar een hoek, weg van de keeper.
    if (this.restartIsPenalty) {
      const gk = this.players.find((p) => p.isKeeper && p.side !== taking);
      const half = PITCH.goalWidth / 2 - 0.6;
      const targetY = gk && gk.pos.y <= goal.y ? goal.y + half : goal.y - half;
      this.takeRestart(dirTo(taker, { x: goal.x, y: targetY }), 36, 0.5);
      return;
    }
    // AI neemt in: speel naar een teamgenoot (anders richting doel).
    const opponents = this.players.filter((p) => p.side !== taking);
    const mate =
      chooseBestPass(this.players, taker, opponents) ??
      nearestTeammateInCone(this.players, taker, taker.facing, Math.PI, 40);
    if (mate) {
      const d = dist(taker.pos, mate.pos);
      this.takeRestart(dirTo(taker, mate.pos), 13 + Math.min(14, d * 0.5), 0, mate.id);
    } else {
      this.takeRestart(dirTo(taker, goal), 20, 3);
    }
  }

  /**
   * Houd een keeper die de bal vast/in bezit heeft binnen zijn eigen
   * strafschopgebied (een keeper mag de bal niet buiten het gebied dragen).
   */
  private clampKeeperWithBallToBox(): void {
    const owner = this.byId(this.ball.ownerId);
    if (!owner?.isKeeper) return;
    const depth = PITCH.penaltyBoxDepth;
    const halfW = PITCH.penaltyBoxWidth / 2;
    const minY = PITCH.height / 2 - halfW + 0.4;
    const maxY = PITCH.height / 2 + halfW - 0.4;
    // home verdedigt links (x=0), away rechts (x=width).
    const x =
      owner.side === "home"
        ? clamp(owner.pos.x, 0.4, depth - 0.4)
        : clamp(owner.pos.x, PITCH.width - depth + 0.4, PITCH.width - 0.4);
    owner.pos.x = x;
    owner.pos.y = clamp(owner.pos.y, minY, maxY);
    // Bal mee naar de keeper (hij draagt 'm).
    this.ball.pos.x = owner.pos.x;
    this.ball.pos.y = owner.pos.y;
  }

  /** Duw tegenstanders van de hervattende ploeg radiaal weg van de bal. */
  private keepOpponentsAway(takingSide: Side, radius: number): void {
    for (const p of this.players) {
      if (p.side === takingSide) continue;
      const dx = p.pos.x - this.ball.pos.x;
      const dy = p.pos.y - this.ball.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < radius) {
        if (d < 1e-4) {
          p.pos.x = this.ball.pos.x + radius;
        } else {
          p.pos.x = this.ball.pos.x + (dx / d) * radius;
          p.pos.y = this.ball.pos.y + (dy / d) * radius;
        }
        p.pos.x = clamp(p.pos.x, -PITCH.margin, PITCH.width + PITCH.margin);
        p.pos.y = clamp(p.pos.y, -PITCH.margin, PITCH.height + PITCH.margin);
        p.vel = { x: 0, y: 0 };
      }
    }
  }

  /** Bal stuitert van spelers (eenvoudige cirkelbotsing, leesbare rebounds). */
  private resolveBallPlayerCollisions(): void {
    // Ballen boven kniehoogte vliegen over veldspelers heen (lob/hoog schot).
    if (this.ball.z > 0.7) return;
    // Een krappere blokradius: schoten kunnen rakelings langs een verdediger.
    const minDist = PLAYER.radius + BALL.radius - 0.2;
    for (const p of this.players) {
      if (this.ball.ownerId === p.id) continue;
      if (p.isKeeper) continue; // keeper via keeperSaves (vangen/parreren)
      const dx = this.ball.pos.x - p.pos.x;
      const dy = this.ball.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d < minDist && d > 1e-4) {
        // Snelle schoten kunnen langs een verdediger glippen (niet altijd blok).
        const speed = len(this.ball.vel);
        if (speed > 16) {
          const blockChance = clamp(1 - (speed - 16) * 0.035, 0.2, 1);
          if (!this.rng.chance(blockChance)) {
            // Glipt erlangs: zet de bal voorbij de verdediger (één beslissing,
            // niet elke tick opnieuw rollen terwijl hij passeert).
            const ux = this.ball.vel.x / speed;
            const uy = this.ball.vel.y / speed;
            this.ball.pos.x = p.pos.x + ux * (minDist + 0.4);
            this.ball.pos.y = p.pos.y + uy * (minDist + 0.4);
            continue;
          }
        }
        const nx = dx / d;
        const ny = dy / d;
        this.ball.pos.x = p.pos.x + nx * minDist;
        this.ball.pos.y = p.pos.y + ny * minDist;
        const vn = this.ball.vel.x * nx + this.ball.vel.y * ny;
        if (vn < 0) {
          this.ball.vel.x -= (1 + 0.4) * vn * nx;
          this.ball.vel.y -= (1 + 0.4) * vn * ny;
        }
        this.ball.lastTouchSide = p.side;
        this.ball.lastTouchId = p.id;
      }
    }
  }

  /**
   * Fysieke duik: bij een inkomend schot voorspelt de AI-keeper waar de bal zijn
   * lijn kruist en geeft zichzelf één impuls die kant op. Hij redt alleen als zijn
   * lijf de bal daarna echt raakt (keeperSaves) — de duik bepaalt of hij er komt.
   * Een hard/ver geplaatst schot haalt hij zo niet (duiksnelheid is begrensd).
   */
  private tryKeeperDive(p: PlayerEntity): void {
    if (p.state === "dive") return; // al aan het duiken
    if (this.ball.ownerId === p.id) return;
    if (this.ball.z > 2.6) return;
    const goalX = p.side === "home" ? 0 : PITCH.width;
    const sign = goalX === 0 ? 1 : -1;
    const vx = this.ball.vel.x;
    const towardGoal = sign === 1 ? vx < -6 : vx > 6;
    if (!towardGoal) return;
    const speed = len(this.ball.vel);
    if (speed < 14) return;
    if (Math.abs(this.ball.pos.x - goalX) > 22) return;

    const lineX = goalX + sign * 1.3;
    const t = (lineX - this.ball.pos.x) / vx;
    // Reactietijd: de keeper "leest" het schot pas als het dichtbij genoeg is —
    // hij kan niet een seconde van tevoren al naar de hoek vertrekken. Daardoor
    // halen harde, in de hoek geplaatste schoten het net wél.
    if (t < 0.02 || t > 0.32) return;
    // Voorspelfout: de keeper schat het kruispunt niet perfect (groter bij een
    // sneller schot). Zo glipt een goed geplaatst schot er soms langs.
    const predErr = this.rng.gaussian(0, 0.5 + speed * 0.022);
    const crossY = this.ball.pos.y + this.ball.vel.y * t + predErr;
    // Mist het doel sowieso? Dan niet duiken.
    const top = PITCH.height / 2 - PITCH.goalWidth / 2 - 1.5;
    const bot = PITCH.height / 2 + PITCH.goalWidth / 2 + 1.5;
    if (crossY < top || crossY > bot) return;

    const gapX = lineX - p.pos.x;
    const gapY = crossY - p.pos.y;
    const gap = Math.hypot(gapX, gapY);
    if (gap < 0.5) return; // staat al goed, gewoon blijven staan
    const dir = { x: gapX / gap, y: gapY / gap };
    // Duiksnelheid begrensd door keeperskwaliteit. Bewust niet hoog: de keeper
    // kan niet de hele goal afdekken, dus de hoeken blijven kwetsbaar.
    const diveSpeed = 3.2 + (p.stats.goalkeeping / 100) * 2; // 3.2..5.2 u/s
    const need = gap / Math.max(0.08, t);
    const v = Math.min(diveSpeed, need);
    p.vel.x = dir.x * v;
    p.vel.y = dir.y * v;
    p.diveTarget = { x: lineX, y: crossY };
    p.state = "dive";
    p.stateTimer = 0.45;
  }

  /**
   * Keeperredding: binnen (duik)bereik pakt de keeper de bal. Snelle/hoge/ver
   * uitgestrekte ballen houdt hij niet klemvast maar bokst/parreert hij weg
   * (losse rebound); makkelijke ballen vangt hij vast (beschermd balbezit).
   */
  private keeperSaves(): void {
    if (this.ball.z > 2.7) return;
    for (const p of this.players) {
      if (!p.isKeeper) continue;
      // Niet meteen je eigen uittrap/uitworp weer oppakken.
      if (this.ball.lastTouchId === p.id && this.ball.sinceKick < 0.7) continue;

      // Afwerkkwaliteit van de schutter: een goede finisher plaatst 'm scherper,
      // dus de keeper reikt er minder makkelijk bij en houdt 'm minder vaak vast.
      const shooter = this.byId(this.ball.lastTouchId);
      const finishing = shooter && shooter.side !== p.side ? shooter.stats.shooting : 50;
      const finBonus = clamp((finishing - 55) / 45, 0, 1); // 0 bij ≤55, 1 bij 100

      // De keeper redt ALLEEN met zijn lijf: geen magisch duikbereik op afstand.
      // Het poppetje moet de bal echt raken (binnen zijn straal). Wil hij een
      // hoekschot halen, dan moet hij er fysiek voor duiken/lopen (AI-laag).
      // Lijf + armbereik van de keeper (armen tellen als "het poppetje zelf" —
      // geen magie op afstand, wel iets meer dan een veldspeler-straal).
      const baseR = PLAYER.radius + BALL.radius + 0.05 + (p.stats.goalkeeping / 100) * 0.3;
      const speed = len(this.ball.vel);
      const goalX = p.side === "home" ? 0 : PITCH.width;
      const towardGoal = goalX === 0 ? this.ball.vel.x < -3 : this.ball.vel.x > 3;
      // Een goede finisher legt 'm scherp in de hoek: minimaal effect, want het
      // gaat nu puur om lichaamscontact.
      const reach = baseR - finBonus * 0.15;
      const d = dist(p.pos, this.ball.pos);
      if (d >= reach) continue;

      // Was het een duik (uitgestrekt of snel schot)?
      const stretch = Math.max(0, d - baseR);
      const diving = stretch > 0.4 || speed > 20;
      if (diving) {
        p.state = "dive";
        p.stateTimer = 0.6;
      }

      // Een hard, goed geplaatst schot kan de keeper helemaal kloppen (de bal
      // gaat er ongehinderd langs i.p.v. dat hij 'm raakt) — schaalt met
      // afwerking en snelheid. Zo gaan ook strakke schoten er weleens in.
      const beatChance = clamp(finBonus * (speed - 22) * 0.022, 0, 0.5);
      if (towardGoal && this.rng.chance(beatChance)) {
        if (diving) {
          p.state = "dive";
          p.stateTimer = 0.6;
        }
        return; // keeper geklopt, bal loopt door
      }

      // Makkelijke bal (traag/middel, laag, geen strek, zwakke finisher) -> klemvast.
      const easy = speed < 14 && this.ball.z < 1.4 && stretch < 0.6 && finBonus < 0.3;
      // Anders: kans op klemvast daalt met snelheid, hoogte, strek en afwerking.
      const catchProb =
        0.84 +
        0.3 * (p.stats.goalkeeping / 100) -
        speed * 0.012 -
        this.ball.z * 0.14 -
        stretch * 0.18 -
        finBonus * 0.3;
      // Ver uitgestrekt (echte duik) kan de keeper nooit klemvast pakken — dan
      // bokst/tikt hij de bal weg. Zo valt een bal niet "dood" ver van de keeper
      // vandaan stil, maar ketst hij weg (leest als een duikredding).
      const canHold = stretch < 0.9;
      const heldCleanly = easy || (canHold && this.ball.z < 2.4 && this.rng.chance(catchProb));

      if (heldCleanly) {
        // Klemvast.
        this.ball.ownerId = p.id;
        this.ballProtectedFor = p.side;
        this.ball.vel = { x: 0, y: 0 };
        this.ball.vz = 0;
        this.ball.z = 0;
        this.ball.sinceKick = 999;
        this.ball.lastTouchSide = p.side;
        this.ball.lastTouchId = p.id;
      } else {
        // Wegboksen/parreren: deflecteer de bal het veld in (losse rebound).
        this.parryBall(p);
      }
      return;
    }
  }

  /** Keeper bokst de bal weg van het doel: bij voorkeur ZIJWAARTS naar de
   *  dichtstbijzijnde zijlijn (breed weg van het centrum), zodat hij niet recht
   *  voor de voeten van een inlopende spits terugvalt. */
  private parryBall(gk: PlayerEntity): void {
    const outX = gk.pos.x < PITCH.width / 2 ? 1 : -1; // weg van eigen doel
    // Naar de dichtstbijzijnde zijlijn boksen (af en toe de andere kant op).
    const sideSign = gk.pos.y < PITCH.height / 2 ? -1 : 1;
    const flip = this.rng.chance(0.25) ? -1 : 1;
    const lateral = sideSign * flip * this.rng.range(1.0, 1.9);
    const dir = normalize({ x: outX * this.rng.range(0.4, 0.85), y: lateral });
    const power = 12 + this.rng.range(0, 6); // harder wegwerken, klaart de zone
    this.ball.vel = { x: dir.x * power, y: dir.y * power };
    this.ball.vz = this.rng.range(2, 5); // omhoog geklopt
    this.ball.ownerId = null;
    this.ballProtectedFor = null;
    this.ball.sinceKick = 0; // voorkomt dat de keeper 'm meteen terugpakt
    this.ball.lastTouchSide = gk.side;
    this.ball.lastTouchId = gk.id;
    gk.state = "dive";
    gk.stateTimer = 0.6;
  }

  /** Doelpuntdetectie. Returnt true als er gescoord is. */
  private checkGoal(): boolean {
    const y = this.ball.pos.y;
    const withinPosts =
      y > PITCH.height / 2 - PITCH.goalWidth / 2 &&
      y < PITCH.height / 2 + PITCH.goalWidth / 2;
    const underBar = this.ball.z < CROSSBAR_HEIGHT;
    if (!withinPosts || !underBar) return false;

    if (this.ball.pos.x <= 0) {
      // home-doel: away scoort.
      this.score.away += 1;
      this.onGoal("away");
      return true;
    }
    if (this.ball.pos.x >= PITCH.width) {
      this.score.home += 1;
      this.onGoal("home");
      return true;
    }
    return false;
  }

  private onGoal(scoringSide: Side): void {
    this.phase = "goal";
    this.phaseTimer = 1.8;
    this.lastConcededSide = otherSide(scoringSide);
    // Bal houdt z'n vaart -> rolt door in het doel (niet op de lijn blijven).
    this.ball.ownerId = null;
    this.ballProtectedFor = null;
  }

  /** Bal het net in laten rollen en daar laten hangen (afremmen + clampen). */
  private settleBallInNet(): void {
    const scoringSide = this.lastConcededSide ? otherSide(this.lastConcededSide) : "home";
    const goalX = scoringSide === "home" ? PITCH.width : 0;
    const dir = scoringSide === "home" ? 1 : -1;
    const backX = goalX + dir * (PITCH.goalDepth - BALL.radius);

    // Net vangt de bal: sterk afremmen.
    this.ball.vel.x *= 0.8;
    this.ball.vel.y *= 0.78;
    this.ball.vz *= 0.6;

    // Binnen de netdiepte houden (niet door het net heen).
    if (dir > 0) {
      if (this.ball.pos.x > backX) {
        this.ball.pos.x = backX;
        this.ball.vel.x = 0;
      }
    } else if (this.ball.pos.x < backX) {
      this.ball.pos.x = backX;
      this.ball.vel.x = 0;
    }
    // Binnen de netbreedte houden.
    const top = PITCH.height / 2 - PITCH.goalWidth / 2 + BALL.radius;
    const bot = PITCH.height / 2 + PITCH.goalWidth / 2 - BALL.radius;
    this.ball.pos.y = clamp(this.ball.pos.y, top, bot);
  }

  /** Spelers driften naar hun aftrap-posities (eigen helft) tijdens een pauze. */
  private driftToKickoff(dt: number): void {
    const halfX = PITCH.width / 2;
    for (const p of this.players) {
      p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
      const ax =
        p.side === "home" ? Math.min(p.anchor.x, halfX - 2) : Math.max(p.anchor.x, halfX + 2);
      const to = { x: ax - p.pos.x, y: p.anchor.y - p.pos.y };
      moveTowards(p, len(to) > 1 ? normalize(to) : { x: 0, y: 0 }, false, dt);
    }
    this.resolvePlayerCollisions();
  }

  /**
   * Set-pieces light: detecteer uitbal en herstart als inworp, doeltrap of
   * hoekschop. De ploeg die níet als laatste raakte krijgt de bal (behalve
   * doeltrap/hoekschop, bepaald door de eindlijn + laatste aanraking).
   */
  private handleOutOfPlay(): void {
    const b = this.ball.pos;
    const lastSide = this.ball.lastTouchSide;
    const margin = 0.2;

    // Zijlijnen -> inworp voor de tegenstander van wie het laatst raakte.
    if (b.y < 0 || b.y > PITCH.height) {
      const takingSide: Side = lastSide ? otherSide(lastSide) : "home";
      const spot: Vec2 = {
        x: clamp(b.x, 4, PITCH.width - 4),
        y: b.y < 0 ? margin : PITCH.height - margin,
      };
      this.beginWhistle(spot, takingSide, "throwin");
      return;
    }

    // Eindlijnen (geen goal): doeltrap of hoekschop.
    if (b.x < 0 || b.x > PITCH.width) {
      const leftEnd = b.x < 0;
      // Verdedigende ploeg aan deze eindlijn: home verdedigt links (x=0).
      const defendingSide: Side = leftEnd ? "home" : "away";
      const cornerY = b.y < PITCH.height / 2 ? margin + 0.5 : PITCH.height - margin - 0.5;
      if (lastSide === defendingSide) {
        // Eigen ploeg raakte laatst -> hoekschop voor de aanvaller.
        const spot: Vec2 = { x: leftEnd ? margin + 0.5 : PITCH.width - margin - 0.5, y: cornerY };
        this.beginWhistle(spot, otherSide(defendingSide), "corner");
      } else {
        // Aanvaller raakte laatst -> doeltrap voor de verdediger: vanaf de
        // doelgebied-lijn (5-meterlijn), genomen door de keeper.
        const spot: Vec2 = {
          x: leftEnd ? PITCH.goalAreaDepth : PITCH.width - PITCH.goalAreaDepth,
          y: PITCH.height / 2,
        };
        this.beginWhistle(spot, defendingSide, "goalkick");
      }
    }
  }

  /** Bal is uit / overtreding gemaakt: spel loopt nog even door (fluit-fase). */
  private beginWhistle(spot: Vec2, takingSide: Side, kind: RestartKind): void {
    this.pendingRestart = { spot: { ...spot }, takingSide, kind };
    this.whistleTimer = WHISTLE_DELAY;
    this.phase = "whistle";
  }

  /** Ligt `spot` in het strafschopgebied dat `attackingGoal` verdedigt? */
  private isInPenaltyBox(spot: Vec2, atkGoal: Vec2): boolean {
    const inWidth = Math.abs(spot.y - PITCH.height / 2) < PITCH.penaltyBoxWidth / 2;
    const depth = PITCH.penaltyBoxDepth;
    const inDepth = atkGoal.x === 0 ? spot.x < depth : spot.x > PITCH.width - depth;
    return inWidth && inDepth;
  }

  /**
   * Fluit-fase: bal blijft rollen (over de lijn), en spelers blijven bewegen —
   * ze sorteren alvast voor op de komende hervatting (de vermoedelijke nemer
   * gaat richting de plek, de rest neemt positie in).
   */
  private stepWhistle(dt: number): void {
    this.whistleTimer -= dt;
    stepBall(this.ball, dt);

    const r = this.pendingRestart;
    if (r) {
      this.positionForRestart(r.spot, r.takingSide, r.kind, dt);
    }

    if (this.whistleTimer <= 0 && r) {
      this.pendingRestart = null;
      this.restartDeadBall(r.spot, r.takingSide, r.kind);
    }
  }

  /**
   * Voorsortering tijdens de fluit-fase: de vermoedelijke nemer gaat naar de
   * plek, de rest neemt positie in. Bij een hoekschop pakt de helft van het
   * veld op in het strafschopgebied; bij overige hervattingen volgt iedereen
   * de tactische laag.
   */
  private positionForRestart(spot: Vec2, takingSide: Side, kind: RestartKind, dt: number): void {
    const taker =
      kind === "goalkick"
        ? (this.players.find((p) => p.isKeeper && p.side === takingSide) ?? null)
        : nearestPlayer(this.players, takingSide, spot, true);
    const special = this.restartSpecialTargets(spot, takingSide, kind, taker?.id ?? null);
    // Bij een doeltrap zou de territoriale bal-shift de ploeg juist naar het
    // eigen doel trekken (de bal ligt daar); negeer 'm dan en spreid op rol.
    const spotBall: BallState = { ...this.ball, pos: spot, vel: { x: 0, y: 0 } };
    const plans: Record<Side, TeamAiPlan> = {
      home: computeTeamPlan(this.players, spotBall, "home", takingSide, this.tactics.home, this.matchSeconds),
      away: computeTeamPlan(this.players, spotBall, "away", takingSide, this.tactics.away, this.matchSeconds),
    };
    for (const p of this.players) {
      p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
      const target =
        taker && p.id === taker.id
          ? spot
          : (special?.get(p.id) ?? plans[p.side].targets.get(p.id) ?? p.anchor);
      const to = { x: target.x - p.pos.x, y: target.y - p.pos.y };
      // Bij hoek/doeltrap sprinten de spelers naar hun plek (op tijd opstellen).
      const sprint = special !== null && len(to) > 4;
      moveTowards(p, len(to) > 1 ? normalize(to) : { x: 0, y: 0 }, sprint, dt);
    }
    this.resolvePlayerCollisions();
  }

  /** Speciale opstelling per hervattingstype (hoek/doeltrap), anders null. */
  private restartSpecialTargets(
    spot: Vec2,
    takingSide: Side,
    kind: RestartKind,
    takerId: string | null,
  ): Map<string, Vec2> | null {
    if (kind === "corner") return this.cornerTargets(spot, takingSide, takerId);
    if (kind === "goalkick") return this.goalKickTargets(takingSide);
    if (kind === "penalty") return this.penaltyTargets(takingSide, takerId);
    if (kind === "freekick") {
      // Alleen rond het strafschopgebied een gevaarlijke set-piece-opstelling
      // (muurtje + aanvallers voor het doel); elders gewoon doorspelen.
      const dGoal = dist(spot, attackingGoal(takingSide));
      if (dGoal < FREEKICK_DANGER_DIST) return this.freekickTargets(spot, takingSide, takerId);
    }
    return null;
  }

  /**
   * Strafschop-opstelling: alleen de nemer (op de stip) en de verdedigende
   * keeper (op de lijn) staan in/bij het gebied. Alle andere veldspelers wachten
   * aan de rand van het strafschopgebied (buiten de box, achter de stip) tot er
   * getrapt is; daarna mogen ze op de rebound.
   */
  private penaltyTargets(takingSide: Side, takerId: string | null): Map<string, Vec2> {
    const m = new Map<string, Vec2>();
    const goal = attackingGoal(takingSide); // doel waarop geschoten wordt
    const gx = goal.x;
    const sign = gx === 0 ? 1 : -1; // het veld in vanaf dat doel
    const cy = PITCH.height / 2;
    const defendingSide = otherSide(takingSide);

    // Verdedigende keeper op de doellijn.
    const gk = this.players.find((p) => p.isKeeper && p.side === defendingSide);
    if (gk) m.set(gk.id, { x: clamp(gx + sign * 0.6, 0, PITCH.width), y: cy });

    // Alle veldspelers (beide ploegen) behalve de nemer wachten net buiten de
    // box, gespreid in rijen aan de rand van het strafschopgebied.
    const edgeX = gx + sign * (PITCH.penaltyBoxDepth + 2);
    const waiters = this.players.filter((p) => !p.isKeeper && p.id !== takerId);
    const perRow = 5;
    const spacing = 6;
    waiters.forEach((p, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const yy = cy + (col - (perRow - 1) / 2) * spacing;
      m.set(p.id, {
        x: clamp(edgeX + sign * row * 3.2, 2, PITCH.width - 2),
        y: clamp(yy, 4, PITCH.height - 4),
      });
    });

    return m;
  }

  /**
   * Gevaarlijke vrije trap (rond de box): de aanvallende ploeg verzamelt voor
   * het doel (zoals bij een hoek), de verdedigers zetten een muurtje van 2-3
   * spelers op de bal-doellijn op vrijetrap-afstand, de rest dekt in de zone.
   */
  private freekickTargets(spot: Vec2, takingSide: Side, takerId: string | null): Map<string, Vec2> {
    const m = new Map<string, Vec2>();
    const defendingSide = otherSide(takingSide);
    const goal = attackingGoal(takingSide);
    const gx = goal.x;
    const sign = gx === 0 ? 1 : -1; // het veld in vanaf het doel
    const cy = PITCH.height / 2;
    const goalCenter: Vec2 = { x: gx, y: cy };
    const toGoal = normalize({ x: goalCenter.x - spot.x, y: goalCenter.y - spot.y });
    const perp: Vec2 = { x: -toGoal.y, y: toGoal.x };
    const dGoal = dist(spot, goalCenter);

    // Verdedigend muurtje op vrijetrap-afstand op de lijn bal -> doel.
    const wallCount = dGoal < 24 ? 3 : 2;
    const wallCenter: Vec2 = { x: spot.x + toGoal.x * 9.15, y: spot.y + toGoal.y * 9.15 };
    const defAll = this.players.filter((p) => p.side === defendingSide && !p.isKeeper);
    const wallers = [...defAll]
      .sort((a, b) => dist(a.pos, wallCenter) - dist(b.pos, wallCenter))
      .slice(0, wallCount);
    const wallSet = new Set(wallers.map((p) => p.id));
    wallers.forEach((p, i) => {
      const off = (i - (wallCount - 1) / 2) * 1.3;
      m.set(p.id, {
        x: clamp(wallCenter.x + perp.x * off, 2, PITCH.width - 2),
        y: clamp(wallCenter.y + perp.y * off, 2, PITCH.height - 2),
      });
    });

    // Overige verdedigers: dekken gespreid in het strafschopgebied/doelgebied.
    const restDef = defAll.filter((p) => !wallSet.has(p.id));
    restDef.forEach((p, i) => {
      const depth = 3.5 + (i % 3) * 3;
      const dy = (((i + 1) % 5) - 2) * 5;
      m.set(p.id, {
        x: clamp(gx + sign * depth, 2, PITCH.width - 2),
        y: clamp(cy + dy, 5, PITCH.height - 5),
      });
    });

    // Aanvallers: nemer staat al bij de bal; één biedt zich kort aan vlakbij de
    // bal (aanlegger), de rest verzamelt voor het doel, een paar blijven achter.
    const atk = this.players
      .filter((p) => p.side === takingSide && !p.isKeeper && p.id !== takerId)
      .sort((a, b) => roleAdvance(b.position) - roleAdvance(a.position));
    const layoff = atk.length
      ? atk.reduce((a, b) => (dist(a.pos, spot) < dist(b.pos, spot) ? a : b))
      : null;
    if (layoff) {
      m.set(layoff.id, {
        x: clamp(spot.x - toGoal.x * 2.5 + perp.x * 3, 2, PITCH.width - 2),
        y: clamp(spot.y - toGoal.y * 2.5 + perp.y * 3, 4, PITCH.height - 4),
      });
    }
    const boxSlots: [number, number][] = [
      [7, -5], [7, 4], [10, -1], [12, -7], [11, 5], [14, 0],
    ];
    const backX = clamp(gx + sign * PITCH.width * 0.55, 6, PITCH.width - 6);
    const boxers = atk.filter((p) => p !== layoff);
    boxers.forEach((p, i) => {
      if (i < boxSlots.length) {
        const [d, dy] = boxSlots[i]!;
        m.set(p.id, { x: clamp(gx + sign * d, 2, PITCH.width - 2), y: clamp(cy + dy, 4, PITCH.height - 4) });
      } else {
        m.set(p.id, { x: backX, y: clamp(cy + (i % 2 === 0 ? -10 : 10), 6, PITCH.height - 6) });
      }
    });

    return m;
  }

  /**
   * Doeltrap-opstelling: de hele ploeg (behalve de keeper) staat ruim vóór het
   * strafschopgebied en spreidt op rol naar voren — niemand blijft naast de
   * keeper hangen, zodat een uittrap ook echt naar voren kan.
   */
  private goalKickTargets(takingSide: Side): Map<string, Vec2> {
    const m = new Map<string, Vec2>();
    const sign = takingSide === "home" ? 1 : -1; // het veld in
    const ownGoalX = takingSide === "home" ? 0 : PITCH.width;
    // Begin net buiten het strafschopgebied, spreid op rol-agressie naar voren.
    const baseX = ownGoalX + sign * (PITCH.penaltyBoxDepth + 4);
    const reach = PITCH.width * 0.42;
    for (const p of this.players) {
      if (p.side !== takingSide || p.isKeeper) continue;
      const x = clamp(baseX + sign * roleAdvance(p.position) * reach, 4, PITCH.width - 4);
      m.set(p.id, { x, y: clamp(p.anchor.y, 5, PITCH.height - 5) });
    }
    // Niet buitenspel gaan staan: de tegenstander staat na het uitvallen vaak
    // nog hoog, dus klem de voorhoede op de buitenspellijn (bal op de doellijn).
    clampOffside(m, this.players, takingSide, { x: ownGoalX, y: PITCH.height / 2 });

    // Tegenstander: compact pressblok tussen de middenlijn en de rand van het
    // strafschopgebied van de nemer — geen spelers die hoog bij dat doel blijven
    // hangen. De meest aanvallende drukt het hoogst, verdedigers zakken terug.
    const pressLine = ownGoalX + sign * (PITCH.penaltyBoxDepth + 6);
    const backLine = PITCH.width / 2;
    for (const p of this.players) {
      if (p.side === takingSide || p.isKeeper) continue;
      const adv = clamp(roleAdvance(p.position) / 0.55, 0, 1);
      const x = clamp(backLine + (pressLine - backLine) * adv, 4, PITCH.width - 4);
      m.set(p.id, { x, y: clamp(p.anchor.y, 5, PITCH.height - 5) });
    }
    return m;
  }

  /**
   * Hoekschop-opstelling: de aanvallende ploeg verzamelt voor het doel (de
   * meeste spelers in/rond het strafschopgebied, een paar blijven achter); de
   * verdedigers pakken in het gebied mannetjes op, één of twee blijven hoog
   * voor de counter. Keepers blijven bij hun doel.
   */
  private cornerTargets(spot: Vec2, takingSide: Side, takerId: string | null): Map<string, Vec2> {
    const m = new Map<string, Vec2>();
    const defendingSide = otherSide(takingSide);
    const atkGoalX = attackingGoal(takingSide).x; // doel waar de hoek voor is
    const sign = atkGoalX === 0 ? 1 : -1; // het veld in, weg van die doellijn
    const cy = PITCH.height / 2;
    const nearTop = spot.y < cy; // hoek boven of onder

    // Verzamelpunten in het strafschopgebied (diepte vanaf de doellijn, y t.o.v.
    // het midden). Aanvallers iets ruimer, verdedigers strakker (markeren).
    const atkSlots: [number, number][] = [
      [5.5, -2], [5.5, 5], [8, -6], [9, 1], [11, -2], [6, nearTop ? 9 : -9], [12.5, 6],
    ];
    const defSlots: [number, number][] = [
      [4, -1], [4, 4], [6.5, -4], [7, 2], [3, -7], [9.5, 0], [5, 8],
    ];
    const slotPos = (depth: number, dy: number): Vec2 => ({
      x: clamp(atkGoalX + sign * depth, 2, PITCH.width - 2),
      y: clamp(cy + dy, 4, PITCH.height - 4),
    });

    // Aanvallende ploeg: nemer staat al bij de vlag; de meest aanvallende
    // veldspelers gaan de box in, de twee minst aanvallende blijven achter.
    const atk = this.players
      .filter((p) => p.side === takingSide && !p.isKeeper && p.id !== takerId)
      .sort((a, b) => roleAdvance(b.position) - roleAdvance(a.position));

    // Korte-corner-optie: één speler (de dichtstbijzijnde bij de vlag) biedt zich
    // vlakbij de hoekvlag aan, zodat de nemer 'm ook kort kan spelen.
    let shortPlayer: PlayerEntity | null = null;
    let shortBest = Infinity;
    for (const p of atk) {
      const dd = dist(p.pos, spot);
      if (dd < shortBest) {
        shortBest = dd;
        shortPlayer = p;
      }
    }
    const shortSpot: Vec2 | null = shortPlayer
      ? {
          x: clamp(atkGoalX + sign * 4.5, 2, PITCH.width - 2),
          y: spot.y < cy ? Math.min(spot.y + 9, cy) : Math.max(spot.y - 9, cy),
        }
      : null;
    if (shortPlayer && shortSpot) m.set(shortPlayer.id, shortSpot);

    const boxers = atk.filter((p) => p !== shortPlayer);
    const backX = clamp(atkGoalX + sign * PITCH.width * 0.62, 6, PITCH.width - 6);
    boxers.forEach((p, i) => {
      if (i < atkSlots.length) {
        const [d, dy] = atkSlots[i]!;
        m.set(p.id, slotPos(d, dy));
      } else {
        // Achterblijvers als restdekking rond de eigen helft.
        m.set(p.id, { x: backX, y: clamp(cy + (i % 2 === 0 ? -10 : 10), 6, PITCH.height - 6) });
      }
    });

    // Verdedigende ploeg: meeste spelers in de box (markeren), de twee meest
    // aanvallende blijven hoog als uitlaatklep voor de counter.
    let def = this.players
      .filter((p) => p.side === defendingSide && !p.isKeeper)
      .sort((a, b) => roleAdvance(a.position) - roleAdvance(b.position));

    // Eén verdediger dekt de korte-corner-aanbieder: ga net aan de doel-kant van
    // hem staan zodat de korte hoek niet vrij is.
    if (shortSpot) {
      let marker: PlayerEntity | null = null;
      let markBest = Infinity;
      for (const p of def) {
        const dd = dist(p.pos, shortSpot);
        if (dd < markBest) {
          markBest = dd;
          marker = p;
        }
      }
      if (marker) {
        const toGoal = normalize({ x: atkGoalX - shortSpot.x, y: PITCH.height / 2 - shortSpot.y });
        m.set(marker.id, {
          x: clamp(shortSpot.x + toGoal.x * 2.2, 2, PITCH.width - 2),
          y: clamp(shortSpot.y + toGoal.y * 2.2, 4, PITCH.height - 4),
        });
        def = def.filter((p) => p !== marker);
      }
    }

    const outletX = clamp(atkGoalX + sign * PITCH.width * 0.5, 6, PITCH.width - 6);
    def.forEach((p, i) => {
      if (i < def.length - 2) {
        const [d, dy] = defSlots[Math.min(i, defSlots.length - 1)]!;
        m.set(p.id, slotPos(d, dy));
      } else {
        m.set(p.id, { x: outletX, y: clamp(cy + (i % 2 === 0 ? -12 : 12), 6, PITCH.height - 6) });
      }
    });

    return m;
  }

  private restartDeadBall(spot: Vec2, takingSide: Side, kind: RestartKind): void {
    this.ball.pos = { ...spot };
    this.ball.vel = { x: 0, y: 0 };
    this.ball.vz = 0;
    this.ball.z = 0;
    this.ball.curve = 0;
    this.ball.sinceKick = 999;
    this.ball.ownerId = null;
    this.ball.lastTouchSide = takingSide;
    this.ball.lastTouchId = null;
    // Een doeltrap wordt door de keeper genomen; verder de dichtstbijzijnde speler.
    const taker =
      kind === "goalkick"
        ? (this.players.find((p) => p.isKeeper && p.side === takingSide) ?? null)
        : nearestPlayer(this.players, takingSide, spot, true);
    if (taker) {
      taker.pos = { x: spot.x, y: spot.y };
      taker.vel = { x: 0, y: 0 };
      this.restartTakerId = taker.id;
    } else {
      this.restartTakerId = null;
    }
    this.restartTakingSide = takingSide;
    const dangerFreekick =
      kind === "freekick" && dist(spot, attackingGoal(takingSide)) < FREEKICK_DANGER_DIST;
    this.restartReady =
      kind === "corner" || kind === "penalty" || dangerFreekick
        ? CORNER_SETUP_PAUSE
        : RULES.restartPause;
    this.restartIsKickoff = false;
    this.restartIsPenalty = kind === "penalty";
    this.restartKind = kind;
    // De nemer kijkt richting het doel (handig voor zowel mens als AI-penalty).
    if (taker) taker.facing = takingSide === "home" ? 0 : Math.PI;
    // Mikbare hervatting (hoek/vrije trap/penalty): start het richt-pijltje
    // richting het doel; de mens stelt het met links/rechts bij.
    if (isAimableRestart(kind)) {
      const goal = attackingGoal(takingSide);
      this.restartAim = Math.atan2(goal.y - spot.y, goal.x - spot.x);
    } else {
      this.restartAim = null;
    }
    this.ballProtectedFor = takingSide;
    this.phase = "deadball";
  }

  /** Lichtgewicht snapshot voor de renderer/UI. */
  snapshot(): MatchSnapshot {
    const activePlayer = this.humanSide ? this.byId(this.activeId[this.humanSide]) : null;
    return {
      players: this.players.map((p) => ({
        id: p.id,
        side: p.side,
        shirtNumber: p.shirtNumber,
        position: p.position,
        firstName: p.firstName,
        lastName: p.lastName,
        hairColor: p.hairColor,
        skinColor: p.skinColor,
        x: p.pos.x,
        y: p.pos.y,
        facing: p.facing,
        state: p.state,
        isKeeper: p.isKeeper,
        isActive: this.activeId[p.side] === p.id,
        hasBall: this.ball.ownerId === p.id,
      })),
      ball: { x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.z },
      score: { ...this.score },
      matchSeconds: this.matchSeconds,
      matchMinute: clamp(this.matchMinute(), 0, RULES.matchMinutes),
      half: this.half,
      phase: this.phase,
      possession: this.controllingSide(),
      activeId: this.humanSide ? this.activeId[this.humanSide] : null,
      activeStamina: activePlayer?.stamina ?? 1,
      activeExhausted: activePlayer?.exhausted ?? false,
      awaitingHumanRestart:
        (this.phase === "kickoff" || this.phase === "deadball") &&
        this.restartReady <= 0 &&
        this.restartTakingSide !== null &&
        this.restartTakingSide === this.humanSide,
      // Pijltje tonen zodra de mens de mikbare hervatting mag nemen.
      restartAim:
        this.phase === "deadball" &&
        this.restartTakingSide === this.humanSide &&
        this.restartAim !== null
          ? this.restartAim
          : null,
    };
  }
}

function aimAngle(dir: Vec2): number {
  return Math.atan2(dir.y, dir.x);
}
