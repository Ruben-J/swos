import {
  Rng,
  clamp,
  rngId,
  type CareerSave,
  type Competition,
  type CompetitionScope,
  type Match,
  type UUID,
} from "@pitch/shared";
import { addDays } from "./dates.js";
import { buildRatings } from "./season.js";

/** Dagen tussen opeenvolgende bekerronden. */
const KO_CADENCE = 21;

function roundNumber(label: string): number {
  const m = /(\d+)/.exec(label);
  return m ? parseInt(m[1]!, 10) : 1;
}

/** Maak een knockout-competitie + de eerste ronde (geloot). */
export function buildKnockout(
  rng: Rng,
  seasonId: UUID,
  scope: Exclude<CompetitionScope, "league">,
  name: string,
  countryCode: string | null,
  teamIds: UUID[],
  firstRoundDate: string,
): { competition: Competition; matches: Match[] } {
  const competitionId = rngId(rng);
  const competition: Competition = {
    id: competitionId,
    seasonId,
    divisionId: null,
    type: "cup",
    format: "knockout",
    scope,
    name,
    countryCode,
    teamIds: [...teamIds],
  };
  const draw = rng.shuffle([...teamIds]);
  const matches = pairRound(rng, competitionId, seasonId, draw, 1, firstRoundDate);
  return { competition, matches };
}

function pairRound(
  rng: Rng,
  competitionId: UUID,
  seasonId: UUID,
  teams: UUID[],
  round: number,
  date: string,
): Match[] {
  const matches: Match[] = [];
  for (let i = 0; i + 1 < teams.length; i += 2) {
    matches.push({
      id: rngId(rng),
      seasonId,
      competitionId,
      roundLabel: `Ronde ${round}`,
      date,
      homeTeamId: teams[i]!,
      awayTeamId: teams[i + 1]!,
      venueTeamId: teams[i]!,
      kickoffWeather: "dry",
      pitchType: "normal",
      state: "scheduled",
      score: { home: 0, away: 0 },
      xArcadeMeta: { possessionHomeApprox: 50, shotsHome: 0, shotsAway: 0, motmPlayerId: null },
    });
  }
  return matches;
}

/** Penalty-reeks bij gelijkspel: geeft [thuis, uit] met een beslist verschil. */
export function shootout(rng: Rng, ratingHome: number, ratingAway: number): [number, number] {
  const pscore = (r: number): boolean => rng.chance(clamp(0.7 + (r - 60) * 0.003, 0.55, 0.9));
  let h = 0;
  let a = 0;
  for (let i = 0; i < 5; i++) {
    if (pscore(ratingHome)) h++;
    if (pscore(ratingAway)) a++;
  }
  while (h === a) {
    if (pscore(ratingHome)) h++;
    if (pscore(ratingAway)) a++;
  }
  return [h, a];
}

/** Winnaar van een gespeelde knockout-wedstrijd (gebruikt pens bij gelijkspel). */
export function winnerOf(m: Match): UUID {
  if (m.score.home > m.score.away) return m.homeTeamId;
  if (m.score.away > m.score.home) return m.awayTeamId;
  const ph = m.score.pensHome ?? 0;
  const pa = m.score.pensAway ?? 0;
  return ph >= pa ? m.homeTeamId : m.awayTeamId;
}

/**
 * Verwerk alle knockout-competities: beslis gelijke (gespeelde) wedstrijden met
 * een penaltyreeks, en als een ronde compleet is, loot de volgende ronde uit de
 * winnaars (tot er een kampioen over is). Muteert de save.
 */
export function processKnockouts(save: CareerSave, rng: Rng): void {
  const ws = save.worldState;
  const ratings = buildRatings(save);
  const knockouts = ws.competitions.filter(
    (c) => c.format === "knockout" && c.seasonId === ws.activeSeasonId,
  );

  for (const comp of knockouts) {
    const compMatches = ws.matches.filter((m) => m.competitionId === comp.id);
    if (compMatches.length === 0) continue;

    // Beslis gelijke gespeelde wedstrijden met pens.
    for (const m of compMatches) {
      if (m.state === "played" && m.score.home === m.score.away && m.score.pensHome === undefined) {
        const [ph, pa] = shootout(rng, ratings.get(m.homeTeamId) ?? 60, ratings.get(m.awayTeamId) ?? 60);
        m.score.pensHome = ph;
        m.score.pensAway = pa;
      }
    }

    const maxRound = Math.max(...compMatches.map((m) => roundNumber(m.roundLabel)));
    const roundMatches = compMatches.filter((m) => roundNumber(m.roundLabel) === maxRound);
    if (!roundMatches.every((m) => m.state === "played")) continue;

    const winners = roundMatches.map(winnerOf);
    if (winners.length <= 1) continue; // kampioen bekend

    const round1Date = compMatches
      .filter((m) => roundNumber(m.roundLabel) === 1)
      .map((m) => m.date)
      .sort()[0]!;
    const nextDate = addDays(round1Date, maxRound * KO_CADENCE);
    const next = pairRound(rng, comp.id, comp.seasonId, winners, maxRound + 1, nextDate);
    ws.matches.push(...next);
  }
}

/** Eindwinnaar van een knockout-competitie (of null als nog niet beslist). */
export function knockoutChampion(save: CareerSave, compId: UUID): UUID | null {
  const compMatches = save.worldState.matches.filter((m) => m.competitionId === compId);
  if (compMatches.length === 0) return null;
  const maxRound = Math.max(...compMatches.map((m) => roundNumber(m.roundLabel)));
  const finalMatches = compMatches.filter((m) => roundNumber(m.roundLabel) === maxRound);
  if (finalMatches.length !== 1 || finalMatches[0]!.state !== "played") return null;
  return winnerOf(finalMatches[0]!);
}
