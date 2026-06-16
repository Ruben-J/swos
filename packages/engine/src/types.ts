import type { Position, Vec2 } from "@pitch/shared";

export type { Position } from "@pitch/shared";

export type Side = "home" | "away";

export const otherSide = (s: Side): Side => (s === "home" ? "away" : "home");

/** Spelersattributen die de live-engine gebruikt (subset, 0..100). */
export interface MatchPlayerStats {
  pace: number;
  passing: number;
  shooting: number;
  finishing: number;
  tackling: number;
  heading: number;
  goalkeeping: number;
  composure: number;
  stamina: number;
}

export type PlayerActState =
  | "idle"
  | "run"
  | "kick"
  | "tackle"
  | "header"
  | "recover"
  | "dive";

export interface PlayerEntity {
  id: string;
  side: Side;
  shirtNumber: number;
  position: Position;
  isKeeper: boolean;
  stats: MatchPlayerStats;
  /** Vaste ankerpositie in de formatie (pitch units). */
  anchor: Vec2;
  pos: Vec2;
  vel: Vec2;
  /** Kijkrichting in radialen. */
  facing: number;
  state: PlayerActState;
  /** Resterende tijd in huidige action-state (s). */
  stateTimer: number;
  /** Cooldown voor tackles (s). */
  tackleCooldown: number;
  /** Sprintmeter 0..1, daalt bij sprinten, herstelt bij joggen. */
  stamina: number;
  /** Leeggelopen: kan pas weer sprinten na voldoende herstel (hysterese). */
  exhausted: boolean;
}

/** De bal als spel-specifiek kinematisch object. */
export interface BallState {
  pos: Vec2;
  vel: Vec2;
  /** Hoogte boven het veld (units). */
  z: number;
  /** Verticale snelheid. */
  vz: number;
  /** Curve-coëfficiënt: zijwaartse acceleratie loodrecht op de beweging. */
  curve: number;
  /** Id van de speler die de bal "bezit" (binnen controlRadius), of null. */
  ownerId: string | null;
  /** Tijd sinds de laatste trap (s) — voedt het aftertouch-venster. */
  sinceKick: number;
  /** Wie raakte de bal het laatst (voor uit/corner/goal-toekenning). */
  lastTouchSide: Side | null;
  lastTouchId: string | null;
}

export type MatchPhase =
  | "kickoff"
  | "play"
  | "goal"
  | "halftime"
  | "fulltime"
  | "whistle"
  | "deadball";

/** Genormaliseerde input-intentie voor één bestuurde speler per tick. */
export interface PlayerIntent {
  /** Bewegingsrichting, genormaliseerd of nul. */
  move: Vec2;
  sprint: boolean;
  /** Actieknop: 0 = los, anders aantal seconden ingedrukt (hold-tijd). */
  actionHeld: number;
  /** True op de tick dat de actieknop wordt losgelaten (trigger pass/shot). */
  actionReleased: boolean;
  /** True zolang ingedrukt na release-venster — gebruikt voor aftertouch sturen. */
  aftertouch: Vec2;
  /** Vraag om handmatige spelerwissel (zonder bal). */
  switchPlayer: boolean;
}

export const emptyIntent = (): PlayerIntent => ({
  move: { x: 0, y: 0 },
  sprint: false,
  actionHeld: 0,
  actionReleased: false,
  aftertouch: { x: 0, y: 0 },
  switchPlayer: false,
});

export interface MatchConfig {
  seed: number;
  home: TeamSetup;
  away: TeamSetup;
  /** Welke kant wordt door een mens bestuurd ("home", "away" of null = sim). */
  humanSide: Side | null;
}

export interface TeamSetup {
  id: string;
  name: string;
  shortName: string;
  colorPrimary: string;
  colorSecondary: string;
  players: MatchPlayerSetup[];
  /** Optionele tactische instelling; valt terug op DEFAULT_TACTICS. */
  tactics?: TeamTacticsConfig;
  formationName?: string;
}

export interface TeamTacticsConfig {
  lineHeight: number;
  press: number;
  width: number;
  tempo: number;
}

export interface MatchPlayerSetup {
  id: string;
  shirtNumber: number;
  position: Position;
  stats: MatchPlayerStats;
}
