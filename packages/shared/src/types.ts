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

/** Shirtpatroon: effen, smalle verticale strepen, of één middenstreep. */
export type KitPattern = "plain" | "stripes" | "centre";

/** Eén tenue (thuis of uit): hoofdkleur, accentkleur (strepen/nummer) + patroon. */
export interface Kit {
  primary: string;
  secondary: string;
  pattern: KitPattern;
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
  /** Thuis- en uittenue (renderer kiest op basis van thuis/uit). */
  kits?: { home: Kit; away: Kit };
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
    /** Lopende seizoenstotalen (alleen bijgehouden voor de club van de speler). */
    season?: { gate: number; sponsor: number; wages: number; prize: number };
    /** Boekhouding van de laatste afgewerkte speeldag (voor het overzicht). */
    lastMatchday?: { date: string; gate: number; sponsor: number; wages: number; net: number };
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
  /** Doelpuntenmakers (één playerId per goal, in scoorvolgorde home dan away).
   *  Optioneel: oudere saves / nog niet gespeelde wedstrijden hebben dit niet. */
  goalScorers?: UUID[];
  /** Assistgevers (subset; niet elk doelpunt heeft een assist). */
  goalAssists?: UUID[];
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

/** Wekelijkse trainingsfocus: stuurt welke attributen sneller groeien. */
export type TrainingFocus = "balanced" | "attack" | "defense" | "fitness" | "youth";

/** Door de manager gekozen opstelling/tactiek voor zijn eigen club. */
export interface ManagerTactics {
  /** Formatienaam (bv. "4-3-3"); leeg = automatisch op clubvoorkeur. */
  formation: string;
  /** 11 speler-id's in slotvolgorde van de formatie; leeg = beste XI. */
  lineup: UUID[];
  /** Tactische instellingen (0..1); ontbreekt = clubidentiteit. */
  shape?: { lineHeight: number; press: number; width: number; tempo: number };
}

/** Een baanaanbod van een andere club aan de manager (bij seizoensovergang). */
export interface JobOffer {
  teamId: UUID;
  divisionId: UUID;
  /** Aantrekkelijkheid 0..100 (clubreputatie/niveau). */
  appeal: number;
  /** Korte motivatietekst voor de UI. */
  reason: string;
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
    /** Wekelijkse trainingsfocus van de eigen club (default "balanced"). */
    trainingFocus?: TrainingFocus;
    /** Openstaande baanaanbiedingen (na een seizoensovergang). */
    pendingOffers?: JobOffer[];
    /** Door de manager gekozen opstelling + tactiek van de eigen club. */
    tactics?: ManagerTactics;
    /** Cumulatieve (ongeronde) overall-ontwikkeling per speler dit seizoen. */
    seasonDev?: Record<UUID, number>;
    /** Seizoen waar seasonDev bij hoort (om bij overgang te resetten). */
    seasonDevSeasonId?: UUID;
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
