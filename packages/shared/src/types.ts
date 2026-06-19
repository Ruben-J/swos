/**
 * Datamodel voor de carrièrewereld. Volgt de schema's uit
 * docs/deep-research-report.md. Alle data is fictief en zelf gegenereerd.
 *
 * Principes:
 * - Contracts zijn aparte records, geen geneste velden in Player.
 * - Matchresultaten worden immutable gelogd; standings leiden we daaruit af.
 * - Hidden attributes voeden scout-onzekerheid en emergent verhalen.
 * - Werelddata is seedbaar (deterministische generatie).
 */

export type UUID = string;

export type Position =
  | "GK"
  | "RB"
  | "LB"
  | "CB"
  | "DM"
  | "CM"
  | "AM"
  | "RW"
  | "LW"
  | "ST";

export type Foot = "L" | "R" | "B";

export interface TeamColors {
  primary: string;
  secondary: string;
  trim: string;
  goalkeeperPrimary: string;
}

export interface Team {
  id: UUID;
  worldId: UUID;
  name: string;
  shortName: string;
  city: string;
  countryCode: string;
  divisionId: UUID;
  colors: TeamColors;
  stadium: {
    name: string;
    capacity: number;
    attendanceBase: number;
    pitchTypeBias: "normal" | "soft" | "hard" | "wet";
  };
  board: {
    patience: number; // 0..100
    ambition: number;
    financeDiscipline: number;
    youthPreference: number;
  };
  finances: {
    balance: number;
    wageBudget: number;
    transferBudget: number;
    sponsorTier: number;
    debt: number;
  };
  reputation: {
    domestic: number;
    continental: number;
    youth: number;
  };
  tacticalIdentity: {
    tempo: number;
    width: number;
    press: number;
    directness: number;
  };
}

export interface PlayerAttributes {
  pace: number;
  stamina: number;
  ballControl: number;
  passing: number;
  shooting: number;
  finishing: number;
  heading: number;
  tackling: number;
  composure: number;
  aggression: number;
  consistency: number;
  flair: number;
  goalkeeping?: number;
}

export interface Player {
  id: UUID;
  teamId: UUID | null;
  firstName: string;
  lastName: string;
  nationality: string;
  birthDate: string;
  ageYears: number;
  preferredPositions: Position[];
  foot: Foot;
  attributes: PlayerAttributes;
  hidden: {
    potential: number;
    injuryProneness: number;
    professionalism: number;
    loyalty: number;
  };
  status: {
    morale: number;
    fitness: number;
    sharpness: number;
    form: number;
    injury: null | { type: string; daysRemaining: number };
    suspensionMatchesRemaining: number;
  };
  market: {
    estimatedValue: number;
    askingPrice: number | null;
    wageDemand: number;
    interestScore: number;
  };
}

export type SquadRole = "Prospect" | "Rotation" | "Starter" | "Key" | "Star";

export interface Contract {
  id: UUID;
  playerId: UUID;
  teamId: UUID;
  startDate: string;
  endDate: string;
  salaryPerWeek: number;
  role: SquadRole;
  squadNumber: number | null;
  releaseClause: number | null;
  extensionOptionYears: number;
}

/** Een divisie (competitieniveau) binnen een land. Promotie/degradatie tussen
 *  opeenvolgende tiers. Statisch deel van de wereld (verandert niet per seizoen). */
export interface Division {
  id: UUID;
  countryCode: string;
  countryName: string;
  name: string;
  /** 1 = hoogste niveau, 2 = tweede, enz. */
  tier: number;
  /** Aantal clubs dat promoveert naar tier-1 (relevant voor tier >= 2). */
  promotionSlots: number;
  /** Aantal clubs dat degradeert naar de lagere divisie. */
  relegationSlots: number;
}

/** Een competitie-instantie: één seizoen van een divisie (of beker). Levert de
 *  wedstrijden; de stand leiden we af uit de gespeelde wedstrijden. */
/** Soort competitie: nationale league, nationale beker of Europees toernooi. */
export type CompetitionScope = "league" | "cup" | "cl" | "el" | "ecl";

export interface Competition {
  id: UUID;
  seasonId: UUID;
  /** Alleen voor leagues; null voor beker/Europese toernooien. */
  divisionId: UUID | null;
  type: "league" | "cup";
  /** league = volledige round-robin; knockout = bekersysteem (winnaar door). */
  format: "league" | "knockout";
  scope: CompetitionScope;
  name: string;
  /** Landcode (nationale beker), of null voor league/Europees. */
  countryCode: string | null;
  teamIds: UUID[];
}

/** Eén rij in een afgeleide ranglijst. */
export interface StandingRow {
  teamId: UUID;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  rank: number;
}

export type MatchState = "scheduled" | "played" | "abandoned";

export interface Match {
  id: UUID;
  seasonId: UUID;
  competitionId: UUID;
  roundLabel: string;
  date: string;
  homeTeamId: UUID;
  awayTeamId: UUID;
  venueTeamId: UUID;
  kickoffWeather: "dry" | "wet" | "snow" | "windy";
  pitchType: "normal" | "hard" | "soft" | "muddy" | "frozen";
  state: MatchState;
  score: {
    home: number;
    away: number;
    aetHome?: number;
    aetAway?: number;
    pensHome?: number;
    pensAway?: number;
  };
  xArcadeMeta: {
    possessionHomeApprox: number;
    shotsHome: number;
    shotsAway: number;
    motmPlayerId: UUID | null;
  };
}

export interface Season {
  id: UUID;
  worldId: UUID;
  label: string;
  currentDate: string;
  transferWindows: Array<{
    startDate: string;
    endDate: string;
    type: "summer" | "winter" | "special";
  }>;
  competitions: UUID[];
  promotedRelegatedResolved: boolean;
}

export interface CareerSave {
  id: UUID;
  profileName: string;
  createdAt: string;
  updatedAt: string;
  manager: {
    name: string;
    reputation: {
      result: number;
      style: number;
      finance: number;
      development: number;
    };
    currentTeamId: UUID;
    achievements: string[];
  };
  worldState: {
    activeSeasonId: UUID;
    divisions: Division[];
    competitions: Competition[];
    teams: Team[];
    players: Player[];
    contracts: Contract[];
    matches: Match[];
    seasons: Season[];
  };
  meta: {
    saveVersion: number;
    checksum: string;
    difficulty: "Easy" | "Normal" | "Hard";
  };
}
