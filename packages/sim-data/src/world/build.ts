import {
  Rng,
  clamp,
  hashSeed,
  rngId,
  type CareerSave,
  type Competition,
  type Contract,
  type Division,
  type Match,
  type Player,
  type Season,
  type Team,
  type UUID,
} from "@pitch/shared";
import { FIRST_NAMES, LAST_NAMES } from "../names.js";
import { generateSquad, teamRating } from "./squad.js";
import { COUNTRIES, type ClubSeed } from "./catalogue.js";
import { CLUB_SQUADS } from "./squads/index.js";
import { buildDoubleRoundRobin } from "../career/fixtures.js";
import { addDays } from "../career/dates.js";
import { buildKnockout } from "../career/knockout.js";

/**
 * Bouw de nationale bekers (per land, beide divisies, knockout) en de drie
 * Europese toernooien (CL/EL/ECL) voor één seizoen. `euroRanking` is een lijst
 * tier-1-clubs (beste eerst); de top 16 -> CL, 17-32 -> EL, 33-48 -> ECL.
 */
export function buildCupsAndEuro(
  rng: Rng,
  seasonId: UUID,
  divisions: Division[],
  teams: Team[],
  seasonStart: string,
  euroRanking: UUID[],
): { competitions: Competition[]; matches: Match[] } {
  const competitions: Competition[] = [];
  const matches: Match[] = [];

  // Nationale beker per land (alle clubs van beide divisies).
  const countries = new Map<string, string>();
  for (const d of divisions) countries.set(d.countryCode, d.countryName);
  for (const [code, cname] of countries) {
    const divIds = new Set(divisions.filter((d) => d.countryCode === code).map((d) => d.id));
    const teamIds = teams.filter((t) => divIds.has(t.divisionId)).map((t) => t.id);
    if (teamIds.length < 2) continue;
    const ko = buildKnockout(rng, seasonId, "cup", `${cname} Beker`, code, teamIds, addDays(seasonStart, 11));
    competitions.push(ko.competition);
    matches.push(...ko.matches);
  }

  // Europese toernooien uit de ranglijst.
  const euros: { scope: "cl" | "el" | "ecl"; name: string; slice: [number, number] }[] = [
    { scope: "cl", name: "Champions League", slice: [0, 16] },
    { scope: "el", name: "Europa Cup", slice: [16, 32] },
    { scope: "ecl", name: "Conference League", slice: [32, 48] },
  ];
  for (const e of euros) {
    const ids = euroRanking.slice(e.slice[0], e.slice[1]);
    if (ids.length < 2) continue;
    const ko = buildKnockout(rng, seasonId, e.scope, e.name, null, ids, addDays(seasonStart, 18));
    competitions.push(ko.competition);
    matches.push(...ko.matches);
  }

  return { competitions, matches };
}

/** Rangschik tier-1-clubs (beste eerst) puur op rating — voor seizoen 1. */
export function euroRankingByRating(
  divisions: Division[],
  teams: Team[],
  ratings: Map<UUID, number>,
): UUID[] {
  const tier1 = new Set(divisions.filter((d) => d.tier === 1).map((d) => d.id));
  return teams
    .filter((t) => tier1.has(t.divisionId))
    .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0))
    .map((t) => t.id);
}

const NAME_POOL = { first: FIRST_NAMES, last: LAST_NAMES };

export interface World {
  worldId: UUID;
  divisions: Division[];
  teams: Team[];
  players: Player[];
  contracts: Contract[];
  /** Team-id -> rating 0..100 (afgeleid uit de selectie). */
  ratings: Map<UUID, number>;
}

function makeTeam(
  rng: Rng,
  worldId: UUID,
  divisionId: UUID,
  countryCode: string,
  seed: ClubSeed,
  refYear: number,
): { team: Team; players: Player[]; contracts: Contract[] } {
  const teamId = rngId(rng);
  const team: Team = {
    id: teamId,
    worldId,
    name: seed.name,
    shortName: seed.short,
    city: seed.city,
    countryCode,
    divisionId,
    colors: {
      primary: seed.colors[0],
      secondary: seed.colors[1],
      trim: seed.colors[1],
      goalkeeperPrimary: "#1c1c1c",
    },
    stadium: {
      name: `${seed.city} Arena`,
      capacity: Math.round(clamp(seed.strength * 60_000 + rng.range(4_000, 12_000), 6_000, 82_000)),
      attendanceBase: clamp(0.55 + seed.strength * 0.4, 0.4, 0.98),
      pitchTypeBias: "normal",
    },
    board: {
      patience: rng.int(40, 80),
      ambition: Math.round(clamp(seed.strength * 100 + rng.range(-15, 15), 20, 95)),
      financeDiscipline: rng.int(40, 85),
      youthPreference: rng.int(30, 75),
    },
    finances: {
      balance: Math.round(seed.strength * 80_000_000 + rng.range(1_000_000, 8_000_000)),
      wageBudget: Math.round(seed.strength * 3_000_000 + 200_000),
      transferBudget: Math.round(seed.strength * 40_000_000 + rng.range(0, 4_000_000)),
      sponsorTier: Math.round(clamp(seed.strength * 5, 1, 5)),
      debt: rng.chance(0.3) ? Math.round(rng.range(0, 20_000_000)) : 0,
    },
    reputation: {
      domestic: Math.round(clamp(seed.strength * 100, 20, 96)),
      continental: Math.round(clamp(seed.strength * 90 - 10, 5, 92)),
      youth: rng.int(30, 80),
    },
    tacticalIdentity: {
      tempo: rng.range(0.4, 0.8),
      width: rng.range(0.4, 0.72),
      press: rng.range(0.4, 0.8),
      directness: rng.range(0.3, 0.7),
    },
  };

  // Echte (verbasterde) selectie van deze club indien beschikbaar, anders
  // procedureel met de generieke naam-pool.
  const roster = CLUB_SQUADS[seed.name];
  const players = generateSquad(rng, teamId, seed.strength, countryCode, refYear, NAME_POOL, roster);
  const seasonEnd = `${refYear + rng.int(1, 4)}-06-30`;
  const contracts: Contract[] = players.map((p, i) => ({
    id: rngId(rng),
    playerId: p.id,
    teamId,
    startDate: `${refYear}-07-01`,
    endDate: seasonEnd,
    salaryPerWeek: p.market.wageDemand,
    role: i < 2 ? "Rotation" : i < 11 ? "Starter" : "Rotation",
    squadNumber: i + 1,
    releaseClause: null,
    extensionOptionYears: 0,
  }));

  return { team, players, contracts };
}

/** Bouw de complete (statische) wereld uit de catalogus. */
export function buildWorld(rng: Rng, refYear: number): World {
  const worldId = rngId(rng);
  const divisions: Division[] = [];
  const teams: Team[] = [];
  const players: Player[] = [];
  const contracts: Contract[] = [];
  const ratings = new Map<UUID, number>();

  for (const country of COUNTRIES) {
    for (const div of country.divisions) {
      const divisionId = rngId(rng);
      divisions.push({
        id: divisionId,
        countryCode: country.code,
        countryName: country.name,
        name: div.name,
        tier: div.tier,
        promotionSlots: div.promotion,
        relegationSlots: div.relegation,
      });
      for (const club of div.clubs) {
        const { team, players: sq, contracts: cs } = makeTeam(
          rng,
          worldId,
          divisionId,
          country.code,
          club,
          refYear,
        );
        teams.push(team);
        players.push(...sq);
        contracts.push(...cs);
        ratings.set(team.id, teamRating(sq));
      }
    }
  }

  return { worldId, divisions, teams, players, contracts, ratings };
}

const WEATHER: Match["kickoffWeather"][] = ["dry", "dry", "dry", "wet", "windy"];

/** Maak de league-competities + volledige wedstrijdkalender voor één seizoen. */
export function buildSeasonFixtures(
  rng: Rng,
  seasonId: UUID,
  divisions: Division[],
  teams: Team[],
  seasonStart: string,
): { competitions: Competition[]; matches: Match[] } {
  const competitions: Competition[] = [];
  const matches: Match[] = [];

  for (const div of divisions) {
    const teamIds = teams.filter((t) => t.divisionId === div.id).map((t) => t.id);
    const competitionId = rngId(rng);
    competitions.push({
      id: competitionId,
      seasonId,
      divisionId: div.id,
      type: "league",
      format: "league",
      scope: "league",
      name: div.name,
      countryCode: div.countryCode,
      teamIds,
    });
    const pairings = buildDoubleRoundRobin(teamIds);
    for (const p of pairings) {
      // Eén ronde per week.
      const date = addDays(seasonStart, (p.round - 1) * 7);
      matches.push({
        id: rngId(rng),
        seasonId,
        competitionId,
        roundLabel: `Ronde ${p.round}`,
        date,
        homeTeamId: p.homeId,
        awayTeamId: p.awayId,
        venueTeamId: p.homeId,
        kickoffWeather: rng.pick(WEATHER),
        pitchType: "normal",
        state: "scheduled",
        score: { home: 0, away: 0 },
        xArcadeMeta: { possessionHomeApprox: 50, shotsHome: 0, shotsAway: 0, motmPlayerId: null },
      });
    }
  }

  return { competitions, matches };
}

export interface CreateCareerOptions {
  seed: number | string;
  managerName: string;
  /** Gekozen club (team-id uit de wereld). */
  teamId: UUID;
  refYear?: number;
  difficulty?: "Easy" | "Normal" | "Hard";
}

/** Bouw een nieuwe career-save: wereld + seizoen + kalender, met de gekozen club. */
export function createCareer(world: World, opts: CreateCareerOptions): CareerSave {
  const seedNum = typeof opts.seed === "string" ? hashSeed(opts.seed) : opts.seed;
  const rng = new Rng(seedNum ^ 0x5eed51);
  const refYear = opts.refYear ?? 2025;
  // Seizoensstart op een zaterdag: league in het weekend, beker/Europa midweek.
  const seasonStart = `${refYear}-08-16`;

  const seasonId = rngId(rng);
  const league = buildSeasonFixtures(rng, seasonId, world.divisions, world.teams, seasonStart);
  // Beker + Europese toernooien (seizoen 1: plaatsing op rating).
  const euroRanking = euroRankingByRating(world.divisions, world.teams, world.ratings);
  const cups = buildCupsAndEuro(rng, seasonId, world.divisions, world.teams, seasonStart, euroRanking);
  const competitions = [...league.competitions, ...cups.competitions];
  const matches = [...league.matches, ...cups.matches];

  const season: Season = {
    id: seasonId,
    worldId: world.worldId,
    label: `${refYear}/${(refYear + 1) % 100}`,
    currentDate: seasonStart,
    transferWindows: [
      { startDate: `${refYear}-07-01`, endDate: `${refYear}-09-01`, type: "summer" },
      { startDate: `${refYear + 1}-01-01`, endDate: `${refYear + 1}-02-01`, type: "winter" },
    ],
    competitions: competitions.map((c) => c.id),
    promotedRelegatedResolved: false,
  };

  const nowIso = `${refYear}-07-01T00:00:00.000Z`;
  return {
    id: rngId(rng),
    profileName: opts.managerName,
    createdAt: nowIso,
    updatedAt: nowIso,
    manager: {
      name: opts.managerName,
      reputation: { result: 40, style: 40, finance: 40, development: 40 },
      currentTeamId: opts.teamId,
      achievements: [],
    },
    worldState: {
      activeSeasonId: seasonId,
      divisions: world.divisions,
      competitions,
      teams: world.teams,
      players: world.players,
      contracts: world.contracts,
      matches,
      seasons: [season],
    },
    meta: { saveVersion: 1, checksum: "", difficulty: opts.difficulty ?? "Normal" },
  };
}
