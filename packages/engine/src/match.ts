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
  isKeeperOneOnOne,
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
const KEEPER_DIVE_VZ = 6; // verticale impuls (units/s) waarmee een keeperduik de lucht in springt
const KEEPER_RECOVER = 0.7; // s die de keeper nodig heeft om na een duik weer overeind te komen
const TUMBLE_TIME = 0.85; // s dat een omvergelopen speler tuimelt/ligt na een overtreding
const GOAL_CELEBRATION = 5.0; // s dat een doelpunt-viering duurt vóór de aftrap
const BOARDING_DIST = 3; // units buiten de lijn waar de reclameborden staan
const BOARDING_HEIGHT = 1.5; // bal hoger dan dit vliegt over de boarding heen
const BOARDING_REST = 0.55; // terugkaats-energie van de bal tegen de boarding
const CORNER_SETUP_PAUSE = 3.2; // s extra stilstand bij een hoek zodat de ploegen zich opstellen
const AIM_ROTATE_RATE = 1.8; // rad/s waarmee links/rechts het richt-pijltje draait
const FREEKICK_DANGER_DIST = 30; // tot deze afstand van het doel: muurtje + opstelling
const PLAYER_OOB = 0.6; // u dat een speler hoogstens buiten de lijnen mag komen
const WALKOUT_DURATION = 6.0; // s waarin de spelers vanaf de middenlijn opkomen
const WALKOUT_WALK_SPEED = 9.0; // u/s wandeltempo tijdens de opkomst

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
  /** Hoogte boven de grond (units), >0 tijdens een keeperduik (sprong). */
  z: number;
  facing: number;
  state: string;
  isKeeper: boolean;
  isActive: boolean;
  hasBall: boolean;
  /** Hoe de speler de bal vasthoudt: ingooi (boven het hoofd), keeper (in de
   *  handen), of niet (null = aan de voet / geen bal). Puur voor de animatie. */
  hold: "throw" | "keeper" | null;
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
  /** Doelpunten in volgorde, met maker en minuut (voor de scorebord-overlay). */
  goals: GoalEvent[];
  /** Laatste bal-in-het-doel (voor de net-animatie); seq stijgt per doelpunt. */
  goalImpact: GoalImpact | null;
  /** Loopt op bij elke keeperredding op een schot (voor audio "oooh"). */
  saveSeq: number;
}

export interface GoalEvent {
  side: Side;
  scorer: string;
  minute: number;
  ownGoal: boolean;
}

/** Inslag van de bal in het doel: welk doel (x-lijn), op welke hoogte (y) en hoe
 *  hard (snelheid). `seq` stijgt per doelpunt zodat de renderer een nieuwe inslag
 *  herkent. Puur presentatie — beïnvloedt de sim niet. */
export interface GoalImpact {
  goalX: number;
  y: number;
  speed: number;
  seq: number;
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
  private walkoutTargets = new Map<string, Vec2>();
  private walkoutTimer = 0;
  private half = 1;
  /** Huidige helft (1/2) — voor de presentatie-rotatie van het veld. */
  get currentHalf(): number {
    return this.half;
  }
  private kickoffSide: Side = "home";
  private lastConcededSide: Side | null = null;
  // Doelpunt-viering: de scorende ploeg rent juichend naar een hoekpunt; null
  // als er niet gevierd wordt (bv. eigen doelpunt).
  private celebration: { side: Side; point: Vec2 } | null = null;
  private goals: GoalEvent[] = [];
  private goalImpact: GoalImpact | null = null;
  private goalImpactSeq = 0;
  /** Loopt op bij elke keeperredding op een schot richting doel (voor audio). */
  private saveSeq = 0;

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
    this.startWalkout(this.kickoffSide);
  }

  /**
   * Opkomst: de spelers lopen vanaf de middenlijn (scherm-links) het veld op
   * naar hun aftrappositie. Tijdens deze fase tonen we de opstellingen. Daarna
   * gaat het over in de normale aftrap.
   */
  private startWalkout(side: Side): void {
    // Bepaal eerst de aftrapposities (resetForKickoff zet ze) en bewaar die als
    // looptarget; daarna zetten we iedereen terug bij de tunnel-ingang.
    this.resetForKickoff(side);
    this.walkoutTargets.clear();
    for (const p of this.players) this.walkoutTargets.set(p.id, { ...p.pos });

    // Ingang: bij de middenlijn, net buiten de zijlijn op y≈0 (scherm-links in
    // de 1e helft). De spelers staan in de "tunnel" (negatieve y) en lopen op.
    const halfX = PITCH.width / 2;
    const order = this.players.filter((p) => p.side === "home").concat(
      this.players.filter((p) => p.side === "away"),
    );
    order.forEach((p, i) => {
      const lane = p.side === "home" ? -1.3 : 1.3;
      p.pos = { x: halfX + lane, y: -1 - i * 0.75 };
      p.vel = { x: 0, y: 0 };
      p.state = "run";
      p.facing = Math.PI / 2; // kijkt het veld in (richting +y)
    });

    this.phase = "walkout";
    this.walkoutTimer = WALKOUT_DURATION;
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
    const isThrowIn = this.restartKind === "throwin";
    this.phase = "play";
    if (taker) {
      this.ball.pos = { x: taker.pos.x, y: taker.pos.y };
      // Inworp: de bal verlaat de handen BOVEN het hoofd en maakt een boog. Zet
      // dus de begin-hoogte op kophoogte en garandeer wat loft (anders ploft hij
      // meteen op de grond i.p.v. door de lucht te vliegen).
      if (isThrowIn) {
        this.ball.z = 2.0;
        loft = Math.max(loft, 3.5);
      }
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
    if (this.phase === "walkout") {
      this.stepWalkout(dt);
      return;
    } else if (this.phase === "kickoff" || this.phase === "deadball") {
      this.stepRestart(dt, humanIntent);
      return;
    } else if (this.phase === "goal") {
      this.phaseTimer -= dt;
      // Bal rolt het net in en blijft daar hangen.
      stepBall(this.ball, dt);
      this.settleBallInNet();
      // Eerste deel van de viering rennen ze juichend naar de hoek; de laatste
      // ~1.6s sorteren ze voor op de aftrap (eigen helft).
      if (this.celebration && this.phaseTimer > 1.6) {
        this.stepCelebration(dt);
      } else {
        this.driftToKickoff(dt);
      }
      if (this.phaseTimer <= 0) {
        this.celebration = null;
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
      if (!isHumanActive && p.isKeeper) {
        this.tryKeeperDive(p);
        this.tryKeeperSmother(p);
      }

      // AI maakt af en toe een overtreding: een verdediger die dicht op de
      // baldragende tegenstander zit (lichaam binnen bereik) terwijl de bal net
      // buiten schoon bereik is, kan een mistimede sliding inzetten -> de man
      // i.p.v. de bal raken. Kans is klein en hoger bij een zwakke tackler.
      if (!isHumanActive && !p.isKeeper && p.tackleCooldown <= 0 && !cmd.tackle && !cmd.slide) {
        const owner = this.byId(this.ball.ownerId);
        if (owner && owner.side !== p.side) {
          const dMan = dist(p.pos, owner.pos);
          const dBall = dist(p.pos, this.ball.pos);
          if (dMan < PLAYER.tackleRange + 0.3 && dBall > PLAYER.tackleRange) {
            const foulProb = 0.006 * (1.5 - p.stats.tackling / 100);
            if (this.rng.chance(foulProb)) cmd.slide = true; // mistimede inglijder
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
    // Keepers blijven sowieso binnen hun eigen strafschopgebied (ook bij uitkomen).
    this.clampKeepersToBox();

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

    // Aftertouch (effect/lob) alleen na een SCHOT van de mens — niet na een pass.
    // Een pass heeft een doel-ontvanger (targetId); dan geen effect toepassen.
    if (
      this.humanSide &&
      this.ball.lastTouchSide === this.humanSide &&
      this.ball.targetId === null
    ) {
      const steer = len(humanIntent.aftertouch) > 0.01 ? humanIntent.aftertouch : humanIntent.move;
      applyAftertouch(this.ball, steer);
    }

    // Balfysica + botsingen.
    stepBall(this.ball, dt);
    this.resolvePostCollisions();
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

    // Een keeper loop je NIET met de pijltjes rond: hij wordt door de AI
    // gepositioneerd. De human kan hem wél laten uittrappen/uitgooien (de actie).
    if (p.isKeeper) {
      cmd.move = { x: 0, y: 0 };
      cmd.sprint = false;
    }

    const isOwner = this.ball.ownerId === p.id;

    if (intent.actionReleased) {
      const hold = intent.actionHeld;
      // Z = schieten, X = passen. (null = generieke release telt als pass.)
      const shoot = intent.actionKind === "shoot";
      const aimDir = this.aimDirection(p, intent);
      if (isOwner) {
        if (p.isKeeper) {
          // Keeper verdeelt. X = korte, ROLLENDE en goed te controleren pass naar
          // een teamgenoot. Z = een ECHTE uittrap naar voren: hoe langer ingehouden,
          // hoe harder én verder (geladen boomball downfield).
          const longBall = shoot;
          if (longBall) {
            // Laad-fractie over ~0.6s inhouden -> power 24..42, loft 5..11.
            const charge = clamp(hold / 0.6, 0, 1);
            const mate = nearestTeammateInCone(this.players, p, aimAngle(aimDir), Math.PI * 0.6, 80);
            // Bij een gerichte trap mag een teamgenoot 'm gaan halen; vol ingehouden
            // is het meer een verre boombal in de richting (geen vaste ontvanger).
            const dir = mate && charge < 0.85 ? dirTo(p, mate.pos) : aimDir;
            const tId = charge < 0.85 ? mate?.id ?? null : null;
            cmd.kick = {
              dir,
              power: clamp(24 + charge * 18, 24, 42),
              loft: 5 + charge * 6,
              curve: 0,
              targetId: tId,
            };
          } else {
            // X = een STRAKKE, harde pass naar de teamgenoot waar je naar wijst
            // (smalle kegel zodat de richting telt). Komt vlot aan, geen slome rol.
            const mate = nearestTeammateInCone(this.players, p, aimAngle(aimDir), Math.PI * 0.45, 55, 30);
            const dir = mate ? dirTo(p, mate.pos) : aimDir;
            const d = mate ? dist(p.pos, mate.pos) : 16;
            cmd.kick = { dir, power: clamp(19 + d * 0.55, 20, 36), loft: 0, curve: 0, targetId: mate?.id ?? null };
          }
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
            loft: ramp * 2.0 + lift * 9.5,
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
        // Niet aan de bal: X = sliding tackle (inglijden, kan overtreding worden),
        // Z = staande tackle (poken, veilig, alleen winst als hij de bal raakt).
        if (shoot) cmd.tackle = true;
        else cmd.slide = true;
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
    // Duik afgelopen (timer op 0 of bal gevangen) -> overgang naar 'recover':
    // de keeper komt neer en moet weer overeind komen voordat hij kan bewegen of
    // opnieuw duiken.
    if (p.isKeeper && p.state === "dive" && (p.stateTimer <= 0 || this.ball.ownerId === p.id)) {
      p.state = "recover";
      p.stateTimer = KEEPER_RECOVER;
      p.vel.x = 0;
      p.vel.y = 0;
    }
    // Recover: de keeper ligt nog/komt overeind. Geen beweging, geen nieuwe duik.
    if (p.isKeeper && p.state === "recover") {
      if (p.stateTimer > 0) {
        p.vel.x = 0;
        p.vel.y = 0;
        // Rustig naar de grond zakken (de duik-arc landt) en overeind komen.
        p.z = Math.max(0, (p.z ?? 0) - BALL.gravity * dt * 0.5);
        if (p.z <= 0) {
          p.z = 0;
          p.vz = 0;
        }
        p.stateTimer = Math.max(0, p.stateTimer - dt);
        // Kijkrichting: met bal het veld in, anders naar de bal.
        if (this.ball.ownerId === p.id) {
          const g = attackingGoal(p.side);
          p.facing = angleOf({ x: g.x - p.pos.x, y: g.y - p.pos.y });
        } else {
          p.facing = angleOf({ x: this.ball.pos.x - p.pos.x, y: this.ball.pos.y - p.pos.y });
        }
        return;
      }
      p.state = "idle"; // hersteld -> weer normaal
    }

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
      // Spelers blijven nagenoeg binnen de lijnen (alleen de bal mag echt uit).
      p.pos.x = clamp(p.pos.x, -PLAYER_OOB, PITCH.width + PLAYER_OOB);
      p.pos.y = clamp(p.pos.y, -PLAYER_OOB, PITCH.height + PLAYER_OOB);
      // Keeper blijft ook tijdens de duik naar de bal kijken (duik = zijwaarts).
      p.facing = angleOf({ x: this.ball.pos.x - p.pos.x, y: this.ball.pos.y - p.pos.y });
      // Sprong-arc: de duik gaat zijwaarts de LUCHT in en landt weer (z-as).
      p.z = Math.max(0, (p.z ?? 0) + (p.vz ?? 0) * dt);
      p.vz = (p.vz ?? 0) - BALL.gravity * dt;
      if (p.z <= 0) p.vz = 0;
      p.stateTimer = Math.max(0, p.stateTimer - dt);
      return;
    }

    // Omvergelopen door een overtreding: de speler tuimelt en blijft even liggen
    // (geen controle, geen input) tot hij weer opkrabbelt. Tijdens een tackle
    // raakt deze speler niemand en pakt hij niets — hij is uitgeschakeld.
    if (p.state === "tumble") {
      if (p.stateTimer > 0) {
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
        p.vel.x *= Math.max(0, 1 - dt * 5); // tuimelt uit
        p.vel.y *= Math.max(0, 1 - dt * 5);
        p.pos.x = clamp(p.pos.x, -PLAYER_OOB, PITCH.width + PLAYER_OOB);
        p.pos.y = clamp(p.pos.y, -PLAYER_OOB, PITCH.height + PLAYER_OOB);
        p.stateTimer = Math.max(0, p.stateTimer - dt);
        return;
      }
      p.state = "idle"; // weer overeind
    }

    // Sliding tackle is een COMMITMENT: eenmaal ingezet glijdt de speler
    // ballistisch door in de inzet-richting — NIET bij te sturen. Onderweg wordt
    // contact afgehandeld: raakt hij de BAL dan wint hij 'm; raakt hij (zonder bal)
    // het LIJF van een tegenstander dan is het een overtreding. Pas op echt
    // contact, dus niet meer "te snel" een fluit.
    if (p.state === "slide" && p.stateTimer > 0) {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.vel.x *= Math.max(0, 1 - dt * 4); // glijdt uit
      p.vel.y *= Math.max(0, 1 - dt * 4);
      p.pos.x = clamp(p.pos.x, -PLAYER_OOB, PITCH.width + PLAYER_OOB);
      p.pos.y = clamp(p.pos.y, -PLAYER_OOB, PITCH.height + PLAYER_OOB);
      p.stateTimer = Math.max(0, p.stateTimer - dt);
      this.resolveSlideContact(p);
      return;
    }

    // Niet (meer) aan het duiken: keeper staat met beide voeten op de grond.
    if (p.isKeeper) {
      p.z = 0;
      p.vz = 0;
    }

    // Beweging.
    moveTowards(p, cmd.move, cmd.sprint, dt);

    // Een keeper kijkt naar de bal als hij 'm niet heeft. Heeft hij 'm vast, dan
    // kijkt hij RUSTIG het veld in (richting de aanval) en draait hij niet rond
    // (de bal ligt vlak bij hem, dus naar-de-bal-kijken zou laten tollen).
    if (p.isKeeper) {
      if (this.ball.ownerId === p.id) {
        const g = attackingGoal(p.side);
        p.facing = angleOf({ x: g.x - p.pos.x, y: g.y - p.pos.y });
      } else {
        p.facing = angleOf({ x: this.ball.pos.x - p.pos.x, y: this.ball.pos.y - p.pos.y });
      }
    }

    // Bal dragen: licht voor de speler uit "kleven". Balcontrole bepaalt hoe
    // strak: lage controle = bal verder voor de voeten + lossere touch, en bij
    // een scherpe draai kan de bal losschieten (de speler verspeelt 'm).
    if (this.ball.ownerId === p.id && this.ball.sinceKick > 0.12) {
      const ctrl = p.stats.control / 100; // 0..1
      const moving = len(p.vel);
      // CONSISTENTE basisafstand aan de voet (niet sterk per speler verschillend),
      // met een ZICHTBAAR dribbelritme: touches duwen de bal heen en weer
      // (dichterbij -> verderweg -> dichterbij). Sneller lopen = grotere, snellere
      // touches; minder balcontrole = wat lossere uitslag.
      const base = 0.95;
      const amp = (moving > 1.2 ? 0.7 : 0.18) + (1 - ctrl) * 0.2;
      const cadence = 7 + moving * 0.5; // touch-frequentie (rad/s)
      const ahead = base + amp * 0.5 * Math.sin(this.matchSeconds * cadence);
      const stick = 10 + ctrl * 8; // catch-up: hoog = strak aan de voet
      const fx = Math.cos(p.facing);
      const fy = Math.sin(p.facing);
      const targetX = p.pos.x + fx * ahead;
      const targetY = p.pos.y + fy * ahead;
      this.ball.pos.x += (targetX - this.ball.pos.x) * Math.min(1, dt * stick);
      this.ball.pos.y += (targetY - this.ball.pos.y) * Math.min(1, dt * stick);

      // Te ver achtergebleven (scherpe draai/versnelling) bij beperkte controle ->
      // de bal raakt los: ownership vrij, hij rolt door in de looprichting.
      const offDist = dist(this.ball.pos, p.pos);
      const looseLimit = base + amp + 0.8 + ctrl * 0.6;
      const speed = len(p.vel);
      if (offDist > looseLimit && speed > 5) {
        this.ball.ownerId = null;
        this.ballProtectedFor = null;
        this.ball.sinceKick = 0; // voorkomt instant terugpakken
        this.ball.lastTouchSide = p.side;
        this.ball.lastTouchId = p.id;
        this.ball.vel.x = (this.ball.pos.x - p.pos.x) / Math.max(0.1, offDist) * speed * 0.9;
        this.ball.vel.y = (this.ball.pos.y - p.pos.y) / Math.max(0.1, offDist) * speed * 0.9;
      } else {
        this.ball.vel.x = p.vel.x;
        this.ball.vel.y = p.vel.y;
      }
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

    // Tackles. Twee soorten:
    //  - STAANDE tackle (cmd.tackle): poken naar de bal zonder in te glijden. Wint
    //    alleen als hij de bal echt raakt; maakt vrijwel nooit een overtreding.
    //  - SLIDING tackle (cmd.slide): inglijden met impuls (uitzondering op de
    //    spelerbotsing). Wint de bal of, mis je 'm en raak je de man, overtreding.
    if (cmd.slide && p.tackleCooldown <= 0) {
      // Sliding STARTEN: vaste glij-impuls naar de bal (commitment). Het winnen
      // van de bal / de overtreding wordt onderweg afgehandeld in de slide-branch
      // hierboven (op echt contact), niet hier op het inzet-moment.
      p.state = "slide";
      p.stateTimer = 0.55;
      p.tackleCooldown = 1.0;
      p.slideTouched = false;
      // Glij de STUURrichting op (waar de speler heen duwt), niet automatisch naar
      // de bal. Geen input -> de huidige kijkrichting.
      const lunge =
        len(cmd.move) > 0.1
          ? normalize(cmd.move)
          : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
      p.vel.x = lunge.x * 12;
      p.vel.y = lunge.y * 12;
      p.facing = angleOf(lunge);
      // Raakt hij op het inzet-moment al de bal of een tegenstander, meteen afhandelen.
      this.resolveSlideContact(p);
    } else if (cmd.tackle && p.tackleCooldown <= 0) {
      // STAANDE tackle: instant poken; wint alleen als de bal echt binnen bereik
      // is. Mist hij, dan raakt hij niemand hard -> geen overtreding.
      p.state = "tackle";
      p.stateTimer = 0.3;
      p.tackleCooldown = 0.6;
      const stealable = !this.ballProtectedFor || this.ballProtectedFor === p.side;
      const dBall = dist(p.pos, this.ball.pos);
      if (stealable && dBall < PLAYER.tackleRange * 0.8) {
        const owner = this.byId(this.ball.ownerId);
        if (!owner || owner.side !== p.side || this.rng.chance(0.65 + (p.stats.tackling - 50) / 180)) {
          kickBall(this.ball, { dir: dirTo(p, this.ball.pos), power: 6, loft: 0, curve: 0, byId: p.id, bySide: p.side });
        }
      }
    }
  }

  /**
   * Contact-afhandeling tijdens een sliding tackle (zowel op het inzet-moment als
   * onderweg). Raakt de glijder de BAL -> hij wint 'm (kans schaalt met tackling).
   * Raakt hij (zonder bal) het LIJF van een tegenstander -> overtreding. Eén keer
   * per slide (slideTouched), zodat het echt op contact gebeurt en niet "te snel".
   */
  private resolveSlideContact(p: PlayerEntity): void {
    if (p.slideTouched) return;
    const stealable = !this.ballProtectedFor || this.ballProtectedFor === p.side;
    if (!stealable) return;
    const dBall = dist(p.pos, this.ball.pos);
    if (dBall < PLAYER.tackleRange) {
      p.slideTouched = true;
      const owner = this.byId(this.ball.ownerId);
      const ownTeam = owner !== null && owner.side === p.side;
      // Een sliding wint geen gecontroleerde bal: hij TIKT 'm stevig WEG in de
      // glij-richting (met wat spreiding), zodat de bal echt loskomt i.p.v. zacht
      // voor de voeten te blijven. Een bal van een teamgenoot alleen soms (tackling).
      if (!ownTeam || this.rng.chance(0.5 + (p.stats.tackling - 50) / 180)) {
        const dir =
          len(p.vel) > 0.1 ? normalize(p.vel) : dirTo(p, this.ball.pos);
        const ang = Math.atan2(dir.y, dir.x) + this.rng.range(-0.4, 0.4);
        const power = 10 + this.rng.range(0, 5);
        kickBall(this.ball, {
          dir: { x: Math.cos(ang), y: Math.sin(ang) },
          power,
          loft: this.rng.range(0, 1.2),
          curve: 0,
          byId: p.id,
          bySide: p.side,
        });
      }
      return;
    }
    // "Punt van de voet": het gestrekte glij-been reikt VÓÓR het zwaartepunt uit
    // in de glij-richting. Alleen als dat puntje het lijf van een tegenstander
    // raakt is het een overtreding — pal langs iemand heen glijden (lijf opzij,
    // niet in de baan) is dus géén fout meer.
    const dir =
      len(p.vel) > 0.1
        ? normalize(p.vel)
        : { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    const reach = PLAYER.radius + 0.5; // voetpunt vóór het zwaartepunt
    const foot = { x: p.pos.x + dir.x * reach, y: p.pos.y + dir.y * reach };
    const hitR = PLAYER.radius + 0.15; // lijf-straal van de tegenstander
    for (const o of this.players) {
      if (o.side === p.side) continue;
      if (dist(foot, o.pos) < hitR) {
        p.slideTouched = true;
        // De omvergelopen speler VALT: korte tuimeling, weg van de tackelaar én
        // mee in de glij-richting, daarna blijft hij even liggen.
        const away = normalize({ x: o.pos.x - p.pos.x, y: o.pos.y - p.pos.y });
        o.state = "tumble";
        o.stateTimer = TUMBLE_TIME;
        o.vel = { x: away.x * 3 + dir.x * 2.5, y: away.y * 3 + dir.y * 2.5 };
        this.pendingFoul = { spot: { ...o.pos }, side: o.side };
        return;
      }
    }
  }

  /** Spelers kunnen niet overlappen; ze duwen elkaar (tacklende glijdt door). */
  private resolvePlayerCollisions(): void {
    const minDist = PLAYER.radius * 2;
    const n = this.players.length;
    for (let i = 0; i < n; i++) {
      const a = this.players[i]!;
      if (a.state === "slide") continue; // inglijder glijdt door
      for (let j = i + 1; j < n; j++) {
        const b = this.players[j]!;
        if (b.state === "slide") continue;
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
    const cy = PITCH.height / 2;
    // AI-doeltrap WISSELT: soms een verre, hoge boombal naar voren, soms laag
    // opbouwen naar een vrije man. Zo wordt 'ie niet altijd kort/laag genomen.
    if (this.restartKind === "goalkick") {
      if (this.rng.chance(0.5)) {
        // Hoge, lange uittrap richting de andere helft.
        const downfield: Vec2 = {
          x: taker.pos.x + (goal.x - taker.pos.x) * 0.6,
          y: clamp(cy + this.rng.range(-18, 18), 6, PITCH.height - 6),
        };
        const mate = nearestTeammateInCone(this.players, taker, aimAngle(dirTo(taker, goal)), Math.PI * 0.5, 95);
        const tgt = mate ? mate.pos : downfield;
        const d = dist(taker.pos, tgt);
        this.takeRestart(dirTo(taker, tgt), clamp(20 + d * 0.35, 28, 42), 7 + this.rng.range(0, 3), mate?.id ?? null);
        return;
      }
      // Laag opbouwen.
      const mate = chooseBestPass(this.players, taker, this.players.filter((p) => p.side !== taking));
      const tgt = mate ? mate.pos : { x: taker.pos.x + (goal.x - taker.pos.x) * 0.3, y: cy };
      const d = dist(taker.pos, tgt);
      this.takeRestart(dirTo(taker, tgt), clamp(13 + d * 0.5, 14, 28), 0, mate?.id ?? null);
      return;
    }
    // AI-hoekschop WISSELT: meestal een hoge voorzet de box in, soms kort.
    if (this.restartKind === "corner") {
      const toFieldX = goal.x === 0 ? 1 : -1;
      if (this.rng.chance(0.65)) {
        // Hoge voorzet naar de rand van het doelgebied (eigen spelers duiken in).
        const target: Vec2 = {
          x: goal.x + toFieldX * (PITCH.goalAreaDepth + 3),
          y: clamp(cy + this.rng.range(-6, 6), 6, PITCH.height - 6),
        };
        const d = dist(taker.pos, target);
        this.takeRestart(dirTo(taker, target), clamp(14 + d * 0.5, 18, 32), 8 + this.rng.range(0, 2.5));
        return;
      }
      // Korte hoek naar een aangever.
      const mate =
        chooseBestPass(this.players, taker, this.players.filter((p) => p.side !== taking)) ??
        nearestTeammateInCone(this.players, taker, taker.facing, Math.PI, 30);
      const tgt = mate ? mate.pos : goal;
      const d = dist(taker.pos, tgt);
      this.takeRestart(dirTo(taker, tgt), clamp(12 + d * 0.5, 13, 26), 0, mate?.id ?? null);
      return;
    }
    // Overige hervattingen (vrije trap/inworp): speel naar een vrije man, anders
    // richting doel.
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

  /** Houd elke keeper binnen zijn eigen strafschopgebied (ook zonder bal, dus
   *  ook bij uitkomen/duiken komt hij niet buiten de zone). */
  private clampKeepersToBox(): void {
    const depth = PITCH.penaltyBoxDepth;
    const halfW = PITCH.penaltyBoxWidth / 2;
    const minY = PITCH.height / 2 - halfW + 0.4;
    const maxY = PITCH.height / 2 + halfW - 0.4;
    for (const p of this.players) {
      if (!p.isKeeper) continue;
      p.pos.x =
        p.side === "home"
          ? clamp(p.pos.x, 0, depth - 0.4)
          : clamp(p.pos.x, PITCH.width - depth + 0.4, PITCH.width);
      p.pos.y = clamp(p.pos.y, minY, maxY);
    }
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
    if (p.state === "dive" || p.state === "recover") return; // al aan het duiken/herstellen
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
    p.z = 0;
    p.vz = KEEPER_DIVE_VZ;
  }

  /**
   * Uitkomen + smoren bij een 1v1: komt een tegenstander met de bal alleen op de
   * keeper af binnen het strafschopgebied (geen verdediger ertussen), dan lanceert
   * de keeper zich naar de bal (duik vooruit). Komt hij erbij, dan claimt/bokst
   * keeperSaves de bal. Bewust een commitment: mist hij, dan ligt hij en kan de
   * aanvaller 'm omspelen.
   */
  private tryKeeperSmother(gk: PlayerEntity): void {
    if (gk.state === "dive" || gk.state === "recover") return; // al onderweg/herstellen
    if (this.ball.ownerId === gk.id) return;
    const ownGoal = gk.side === "home" ? { x: 0, y: PITCH.height / 2 } : { x: PITCH.width, y: PITCH.height / 2 };
    const speed = len(this.ball.vel);
    // Zelfde strikte 1v1-check als de uitloop-AI: alleen bij een centraal
    // doorgebroken aanvaller (geen zijkant, geen man ertussen).
    if (!isKeeperOneOnOne(this.players, gk, this.ball, ownGoal, speed)) return;

    // Pas duiken als de bal binnen lung-afstand is (anders eerst lopend uitkomen).
    const gapX = this.ball.pos.x - gk.pos.x;
    const gapY = this.ball.pos.y - gk.pos.y;
    const gap = Math.hypot(gapX, gapY);
    if (gap > 4.5 || gap < 0.4) return;

    // Lanceer-impuls naar de bal (sneller dan lopen: het is een sprong).
    const v = Math.min(7, gap / 0.16);
    gk.vel.x = (gapX / gap) * v;
    gk.vel.y = (gapY / gap) * v;
    gk.diveTarget = { x: this.ball.pos.x, y: this.ball.pos.y };
    gk.state = "dive";
    gk.stateTimer = 0.5;
    gk.z = 0;
    gk.vz = KEEPER_DIVE_VZ;
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

      // Signaleer een echte REDDING (op een schot richting doel) voor o.a. audio.
      if (towardGoal && speed > 13) this.saveSeq++;

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
    // De redding is gemaakt: de keeper maakt zijn duik AF (landt) en komt weer
    // overeind — hij lanceert zich NIET opnieuw de lucht in. De recover-staat
    // laat de duik-arc rustig neerkomen en houdt hem even op de grond.
    gk.state = "recover";
    gk.stateTimer = KEEPER_RECOVER;
    gk.vel.x = 0;
    gk.vel.y = 0;
    gk.vz = 0;
  }

  /** Doelpuntdetectie. Returnt true als er gescoord is. */
  /**
   * Botsing van de bal tegen de doelpalen. Elke paal is een dunne verticale
   * cilinder op een hoek van het doel; staat de bal lager dan de lat, dan kaatst
   * hij om de normaal (paal -> bal) terug. De inkomende HOEK bepaalt zo vanzelf
   * of de bal van de binnenkant alsnog het doel in gaat of het veld weer in.
   */
  private resolvePostCollisions(): void {
    if (this.ball.z >= CROSSBAR_HEIGHT) return; // over de lat: geen paal meer
    const cy = PITCH.height / 2;
    const halfG = PITCH.goalWidth / 2;
    const postR = 0.12; // straal van de paal
    const hitR = postR + BALL.radius;
    const posts: Vec2[] = [
      { x: 0, y: cy - halfG },
      { x: 0, y: cy + halfG },
      { x: PITCH.width, y: cy - halfG },
      { x: PITCH.width, y: cy + halfG },
    ];
    for (const post of posts) {
      const dx = this.ball.pos.x - post.x;
      const dy = this.ball.pos.y - post.y;
      const d = Math.hypot(dx, dy);
      if (d >= hitR || d < 1e-4) continue;
      const nx = dx / d;
      const ny = dy / d;
      // Zet de bal op contactafstand buiten de paal.
      this.ball.pos.x = post.x + nx * hitR;
      this.ball.pos.y = post.y + ny * hitR;
      // Reflecteer alleen de naar de paal toe gerichte snelheidscomponent.
      const vn = this.ball.vel.x * nx + this.ball.vel.y * ny;
      if (vn < 0) {
        const rest = 0.7; // energieverlies bij de kaats
        this.ball.vel.x -= (1 + rest) * vn * nx;
        this.ball.vel.y -= (1 + rest) * vn * ny;
        this.ball.curve *= 0.4;
      }
    }
  }

  private checkGoal(): boolean {
    const y = this.ball.pos.y;
    const withinPosts =
      y > PITCH.height / 2 - PITCH.goalWidth / 2 &&
      y < PITCH.height / 2 + PITCH.goalWidth / 2;
    const underBar = this.ball.z < CROSSBAR_HEIGHT;
    if (!withinPosts || !underBar) return false;

    if (this.ball.pos.x <= 0) {
      // home-doel: away scoort.
      this.recordGoalImpact(0);
      this.score.away += 1;
      this.onGoal("away");
      return true;
    }
    if (this.ball.pos.x >= PITCH.width) {
      this.recordGoalImpact(PITCH.width);
      this.score.home += 1;
      this.onGoal("home");
      return true;
    }
    return false;
  }

  /** Leg de bal-inslag in het doel vast voor de net-animatie (presentatie). */
  private recordGoalImpact(goalX: number): void {
    this.goalImpact = {
      goalX,
      y: this.ball.pos.y,
      speed: Math.hypot(this.ball.vel.x, this.ball.vel.y),
      seq: ++this.goalImpactSeq,
    };
  }

  private onGoal(scoringSide: Side): void {
    this.phase = "goal";
    this.lastConcededSide = otherSide(scoringSide);
    // Maker = laatste aanraking; zit die bij de tegenpartij -> eigen doelpunt.
    const toucher = this.byId(this.ball.lastTouchId);
    const ownGoal = !!toucher && toucher.side !== scoringSide;
    const scorer = toucher ? `${toucher.firstName[0]}. ${toucher.lastName}` : "?";
    this.goals.push({
      side: scoringSide,
      scorer,
      minute: Math.max(1, Math.min(RULES.matchMinutes, Math.ceil(this.matchMinute()))),
      ownGoal,
    });
    // Viering: bij een echt doelpunt rent de scorende ploeg juichend naar een
    // hoekvlag bij het doel waar gescoord is; bij een eigen doelpunt geen feest.
    if (ownGoal) {
      this.phaseTimer = 1.8;
      this.celebration = null;
    } else {
      this.phaseTimer = GOAL_CELEBRATION;
      const goalX = scoringSide === "home" ? PITCH.width : 0; // doel waar gescoord is
      const refY = toucher ? toucher.pos.y : this.ball.pos.y;
      this.celebration = {
        side: scoringSide,
        point: {
          x: goalX === 0 ? 4 : PITCH.width - 4, // net binnen de hoek
          y: refY < PITCH.height / 2 ? 4 : PITCH.height - 4,
        },
      };
    }
    // Bal houdt z'n vaart -> rolt door in het doel (niet op de lijn blijven).
    this.ball.ownerId = null;
    this.ballProtectedFor = null;
  }

  /**
   * Doelpunt-viering: de scorende veldspelers rennen juichend naar het hoekpunt
   * en juichen daar; de keeper en de tegenpartij keren terug naar hun
   * aftrap-positie.
   */
  private stepCelebration(dt: number): void {
    const cel = this.celebration!;
    const halfX = PITCH.width / 2;
    for (const p of this.players) {
      p.tackleCooldown = Math.max(0, p.tackleCooldown - dt);
      if (p.side === cel.side && !p.isKeeper) {
        const to = { x: cel.point.x - p.pos.x, y: cel.point.y - p.pos.y };
        const d = len(to);
        moveTowards(p, d > 3 ? normalize(to) : { x: 0, y: 0 }, d > 6, dt);
        p.facing = angleOf({ x: cel.point.x - p.pos.x, y: cel.point.y - p.pos.y });
        p.state = "celebrate"; // juichen (armen omhoog) — ook al rennend
      } else {
        const ax = p.side === "home" ? Math.min(p.anchor.x, halfX - 2) : Math.max(p.anchor.x, halfX + 2);
        const to = { x: ax - p.pos.x, y: p.anchor.y - p.pos.y };
        moveTowards(p, len(to) > 1 ? normalize(to) : { x: 0, y: 0 }, false, dt);
      }
    }
    this.resolvePlayerCollisions();
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
  /** Opkomst: loop iedereen naar zijn aftrappositie; daarna over naar de aftrap. */
  private stepWalkout(dt: number): void {
    this.walkoutTimer -= dt;
    let allArrived = true;
    for (const p of this.players) {
      const t = this.walkoutTargets.get(p.id);
      if (!t) continue;
      const to = { x: t.x - p.pos.x, y: t.y - p.pos.y };
      const d = len(to);
      if (d > 0.25) {
        allArrived = false;
        const step = Math.min(d, WALKOUT_WALK_SPEED * dt);
        p.pos.x += (to.x / d) * step;
        p.pos.y += (to.y / d) * step;
        p.facing = angleOf(to);
        p.state = "run";
      } else {
        p.pos.x = t.x;
        p.pos.y = t.y;
        p.state = "idle";
      }
      p.vel = { x: 0, y: 0 };
    }
    if (this.walkoutTimer <= 0 || allArrived) {
      for (const p of this.players) {
        const t = this.walkoutTargets.get(p.id);
        if (t) p.pos = { ...t };
        p.state = "idle";
        p.facing = p.side === "home" ? 0 : Math.PI;
      }
      // De aftrapstaat is al gezet door resetForKickoff in startWalkout.
      this.phase = "kickoff";
    }
  }

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

  /**
   * Bal die naast/over de lijn gaat kaatst tegen de reclameborden (een stukje
   * buiten de lijn). Een lage bal stuitert terug; een hoge bal (boven de borden)
   * vliegt eroverheen. In de goalmond staat een net i.p.v. boarding.
   */
  private bounceOffBoarding(): void {
    const b = this.ball;
    if (b.z >= BOARDING_HEIGHT) return; // hoge bal: over de boarding heen
    const d = BOARDING_DIST;
    const goalLo = PITCH.height / 2 - PITCH.goalWidth / 2;
    const goalHi = PITCH.height / 2 + PITCH.goalWidth / 2;
    const inGoalMouth = b.pos.y > goalLo - 0.5 && b.pos.y < goalHi + 0.5;
    if (!inGoalMouth) {
      if (b.pos.x < -d && b.vel.x < 0) {
        b.pos.x = -d;
        b.vel.x *= -BOARDING_REST;
      } else if (b.pos.x > PITCH.width + d && b.vel.x > 0) {
        b.pos.x = PITCH.width + d;
        b.vel.x *= -BOARDING_REST;
      }
    }
    if (b.pos.y < -d && b.vel.y < 0) {
      b.pos.y = -d;
      b.vel.y *= -BOARDING_REST;
    } else if (b.pos.y > PITCH.height + d && b.vel.y > 0) {
      b.pos.y = PITCH.height + d;
      b.vel.y *= -BOARDING_REST;
    }
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
    this.bounceOffBoarding(); // bal kaatst tegen de reclameborden (of vliegt eroverheen)

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

    // Verdedigende keeper op de doellijn; de nemer op de stip.
    const gk = this.players.find((p) => p.isKeeper && p.side === defendingSide);
    if (gk) m.set(gk.id, { x: clamp(gx + sign * 0.6, 0, PITCH.width), y: cy });
    const spotX = gx === 0 ? PITCH.penaltySpotDist : PITCH.width - PITCH.penaltySpotDist;
    if (takerId) m.set(takerId, { x: spotX, y: cy });

    // Iedereen anders houdt gewoon zijn FORMATIEPOSITIE (anchor); alleen wie in
    // het strafschopgebied zou staan, schuift tot net buiten de box (de regel:
    // op de nemer en keeper na mag niemand in het gebied tot er getrapt is).
    const boxDepth = PITCH.penaltyBoxDepth;
    const halfBoxW = PITCH.penaltyBoxWidth / 2;
    const edgeX = gx + sign * (boxDepth + 1.5);
    for (const p of this.players) {
      if (p.isKeeper || p.id === takerId) continue;
      const t: Vec2 = { ...p.anchor };
      const inDepth = sign === 1 ? t.x < boxDepth : t.x > PITCH.width - boxDepth;
      const inWidth = Math.abs(t.y - cy) < halfBoxW;
      if (inDepth && inWidth) t.x = edgeX; // net buiten de box, eigen y behouden
      m.set(p.id, { x: clamp(t.x, 2, PITCH.width - 2), y: clamp(t.y, 4, PITCH.height - 4) });
    }

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

    // Keeper gaat bij een gevaarlijke vrije trap netjes OP de doellijn staan,
    // iets naar de balzijde om de hoek af te dekken (niet uitkomen).
    const gk = this.players.find((p) => p.side === defendingSide && p.isKeeper);
    if (gk) {
      const postLimit = PITCH.goalWidth / 2 - 0.4;
      m.set(gk.id, {
        x: gx + sign * 0.6,
        y: clamp(cy + (spot.y - cy) * 0.35, cy - postLimit, cy + postLimit),
      });
    }

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

    // Tegenstander zakt terug bij een doeltrap: de meeste spelers rond/achter de
    // middenlijn. MAAR de twee meest aanvallende staan NIET tussen de keeper en
    // zijn verdedigers (in de opbouwzone) — die zetten zich net ACHTER de
    // verdedigerslinie (doel-ver-kant), klaar om een korte opbouwpass te
    // onderscheppen zonder in de box te kampen.
    const defLineX = baseX; // waar de opbouwende verdedigers staan (box-rand)
    const behind = (extra: number): number =>
      clamp(defLineX + sign * extra, 4, PITCH.width - 4); // net achter de verdedigers
    const advForward = ownGoalX + sign * (PITCH.width * 0.46); // rond de middenlijn
    const deepBack = ownGoalX + sign * (PITCH.width * 0.66); // op de eigen helft
    const opp = this.players
      .filter((p) => p.side !== takingSide && !p.isKeeper)
      .sort((a, b) => roleAdvance(b.position) - roleAdvance(a.position));
    // Minimale terugtrek-afstand: NIEMAND van de tegenpartij blijft pal voor de
    // keeper/box hangen — ook de voorste spitsen zakken flink terug.
    const minRetreat = behind(14);
    const pushedBack = (x: number): number => (sign === 1 ? Math.max(x, minRetreat) : Math.min(x, minRetreat));
    opp.forEach((p, i) => {
      let x: number;
      if (i === 0) x = behind(14); // spits: ruim achter de verdedigers
      else if (i === 1) x = behind(20); // tweede aanvaller nog verder terug
      else {
        const adv = clamp(roleAdvance(p.position) / 0.55, 0, 1);
        x = clamp(deepBack + (advForward - deepBack) * adv, 4, PITCH.width - 4);
      }
      m.set(p.id, { x: pushedBack(x), y: clamp(p.anchor.y, 5, PITCH.height - 5) });
    });
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

  /** Animatie-stijl waarmee een speler de bal vasthoudt (zie MatchSnapshotPlayer.hold). */
  private holdStyle(p: PlayerEntity): "throw" | "keeper" | null {
    if (this.ball.ownerId !== p.id) return null;
    if (this.restartKind === "throwin" && p.id === this.restartTakerId) return "throw";
    if (p.isKeeper && this.ballProtectedFor === p.side) return "keeper";
    return null;
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
        z: p.z ?? 0,
        facing: p.facing,
        state: p.state,
        isKeeper: p.isKeeper,
        isActive: this.activeId[p.side] === p.id,
        hasBall: this.ball.ownerId === p.id,
        hold: this.holdStyle(p),
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
      goals: this.goals.map((g) => ({ ...g })),
      goalImpact: this.goalImpact ? { ...this.goalImpact } : null,
      saveSeq: this.saveSeq,
    };
  }
}

function aimAngle(dir: Vec2): number {
  return Math.atan2(dir.y, dir.x);
}
