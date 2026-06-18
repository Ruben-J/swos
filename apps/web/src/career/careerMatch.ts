import type { MatchConfig } from "@pitch/engine";
import { hashSeed, type CareerSave, type Match, type Player, type UUID } from "@pitch/shared";
import { toTeamSetup, type World } from "@pitch/sim-data";

/** Snelle-match-config uit twee wereldteams (career-clubs), mens bestuurt thuis. */
export function worldMatchConfig(world: World, homeId: UUID, awayId: UUID, seed: number): MatchConfig {
  const home = world.teams.find((t) => t.id === homeId)!;
  const away = world.teams.find((t) => t.id === awayId)!;
  const playersOf = (id: UUID): Player[] => world.players.filter((p) => p.teamId === id);
  return {
    seed,
    home: toTeamSetup(home, playersOf(homeId)),
    away: toTeamSetup(away, playersOf(awayId)),
    humanSide: "home",
  };
}

export function playersOfTeam(save: CareerSave, teamId: UUID): Player[] {
  return save.worldState.players.filter((p) => p.teamId === teamId);
}

export function teamById(save: CareerSave, teamId: UUID) {
  return save.worldState.teams.find((t) => t.id === teamId) ?? null;
}

/** Bouw een live-engine-config voor een career-wedstrijd; de mens bestuurt zijn club. */
export function buildMatchConfig(save: CareerSave, match: Match, humanTeamId: UUID): MatchConfig {
  const home = teamById(save, match.homeTeamId)!;
  const away = teamById(save, match.awayTeamId)!;
  const homeSetup = toTeamSetup(home, playersOfTeam(save, home.id));
  const awaySetup = toTeamSetup(away, playersOfTeam(save, away.id));
  return {
    seed: hashSeed(match.id),
    home: homeSetup,
    away: awaySetup,
    humanSide: match.homeTeamId === humanTeamId ? "home" : "away",
  };
}
