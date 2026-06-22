import { Rng, type CareerSave, type Match, type StandingRow, type UUID } from "@pitch/shared";
import { playerOverall } from "../world/squad.js";
import { quickSimulate } from "./quicksim.js";
import { computeStandings } from "./standings.js";
import { processMatchdayEvents } from "./events.js";
import { processKnockouts } from "./knockout.js";
import { processTraining } from "./training.js";
import { processAiTransfers } from "./aitransfers.js";
import { transferWindowOpen } from "./transfers.js";
import { applyMatchdayFinances } from "./finances.js";

/** Bereken team-ratings (0..100) uit de spelers in de save. */
export function buildRatings(save: CareerSave): Map<UUID, number> {
  const byTeam = new Map<UUID, number[]>();
  for (const p of save.worldState.players) {
    if (!p.teamId) continue;
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(playerOverall(p));
    byTeam.set(p.teamId, arr);
  }
  const ratings = new Map<UUID, number>();
  for (const [teamId, overalls] of byTeam) {
    overalls.sort((a, b) => b - a);
    const xi = overalls.slice(0, 11);
    ratings.set(teamId, Math.round(xi.reduce((s, v) => s + v, 0) / Math.max(1, xi.length)));
  }
  return ratings;
}

/** Eerstvolgende geplande wedstrijd van een team (op datum). */
export function teamNextMatch(matches: Match[], teamId: UUID): Match | null {
  let best: Match | null = null;
  for (const m of matches) {
    if (m.state !== "scheduled") continue;
    if (m.homeTeamId !== teamId && m.awayTeamId !== teamId) continue;
    if (!best || m.date < best.date) best = m;
  }
  return best;
}

/** Pas een uitslag toe op een wedstrijd (markeer gespeeld). */
export function applyResult(
  match: Match,
  homeGoals: number,
  awayGoals: number,
  meta?: Partial<Match["xArcadeMeta"]>,
): void {
  match.score = { home: homeGoals, away: awayGoals };
  match.state = "played";
  match.xArcadeMeta = {
    possessionHomeApprox: meta?.possessionHomeApprox ?? 50,
    shotsHome: meta?.shotsHome ?? homeGoals + 3,
    shotsAway: meta?.shotsAway ?? awayGoals + 3,
    motmPlayerId: meta?.motmPlayerId ?? null,
  };
}

/** Quicksim één wedstrijd uit de team-ratings. */
export function simulateMatch(rng: Rng, ratings: Map<UUID, number>, match: Match): void {
  const hr = ratings.get(match.homeTeamId) ?? 55;
  const ar = ratings.get(match.awayTeamId) ?? 55;
  const r = quickSimulate(rng, hr, ar);
  applyResult(match, r.homeGoals, r.awayGoals, {
    possessionHomeApprox: r.possessionHomeApprox,
    shotsHome: r.shotsHome,
    shotsAway: r.shotsAway,
  });
}

export interface PlayMatchdayOptions {
  /** De wedstrijd die de mens zelf speelt (krijgt de live-uitslag), of null. */
  liveMatchId?: UUID | null;
  liveHomeGoals?: number;
  liveAwayGoals?: number;
}

/** Werk één kalenderdatum af: alle geplande wedstrijden op `date` (alle
 *  competities), daarna knockouts, blessures, training en AI-transfers. */
function simulateDate(
  save: CareerSave,
  rng: Rng,
  date: string,
  opts: PlayMatchdayOptions,
): void {
  const ratings = buildRatings(save);
  for (const m of save.worldState.matches) {
    if (m.state !== "scheduled" || m.date !== date) continue;
    if (opts.liveMatchId && m.id === opts.liveMatchId) {
      applyResult(m, opts.liveHomeGoals ?? 0, opts.liveAwayGoals ?? 0);
    } else {
      simulateMatch(rng, ratings, m);
    }
  }
  // Knockout-rondes: beslis gelijke duels (pens) en loot volgende rondes.
  processKnockouts(save, rng);
  // Blessures/schorsingen (herstel + nieuwe).
  processMatchdayEvents(save, rng, save.manager.currentTeamId);
  // Training/veroudering: hele wereld groeit/loopt terug, eigen club met focus.
  processTraining(save, rng, save.manager.currentTeamId, save.manager.trainingFocus ?? "balanced");
  // AI-clubs handelen onderling als de transferperiode open is.
  if (transferWindowOpen(save)) processAiTransfers(save, rng);
  // Boek de seizoenseconomie van de club van de speler voor deze speeldag.
  applyMatchdayFinances(save, rng, date);
}

/** Zet de seizoensdatum op de eerstvolgende nog te spelen wedstrijd. */
function advanceDate(save: CareerSave, fallback: string): void {
  const upcoming = save.worldState.matches
    .filter((m) => m.state === "scheduled")
    .map((m) => m.date)
    .sort();
  const season = save.worldState.seasons.find((s) => s.id === save.worldState.activeSeasonId);
  if (season) season.currentDate = upcoming[0] ?? fallback;
}

/**
 * Werk alle openstaande speeldagen af t/m `date` (in datumvolgorde), zodat ook
 * tussenliggende beker-/Europa-rondes waarop de eigen club niet speelt worden
 * gespeeld. De live-uitslag geldt voor de eigen wedstrijd op `date`. Muteert en
 * geeft de save terug.
 */
export function playMatchday(
  save: CareerSave,
  rng: Rng,
  date: string,
  opts: PlayMatchdayOptions = {},
): CareerSave {
  const dates = [
    ...new Set(
      save.worldState.matches
        .filter((m) => m.state === "scheduled" && m.date <= date)
        .map((m) => m.date),
    ),
  ].sort();
  // Niets vóór `date` gepland (of `date` zelf leeg): werk in elk geval `date` af.
  if (dates.length === 0) dates.push(date);
  for (const d of dates) {
    simulateDate(save, rng, d, d === date ? opts : {});
  }
  advanceDate(save, date);
  return save;
}

/**
 * Speel alle resterende wedstrijden van het seizoen uit (alle competities),
 * bijvoorbeeld als de eigen club is uitgeschakeld maar beker/Europa nog lopen.
 * Muteert en geeft de save terug.
 */
export function simulateRemaining(save: CareerSave, rng: Rng): CareerSave {
  let guard = 0;
  while (!seasonComplete(save) && guard < 400) {
    const next = save.worldState.matches
      .filter((m) => m.state === "scheduled")
      .map((m) => m.date)
      .sort()[0];
    if (!next) break;
    simulateDate(save, rng, next, {});
    guard++;
  }
  advanceDate(save, save.worldState.seasons.find((s) => s.id === save.worldState.activeSeasonId)?.currentDate ?? "");
  return save;
}

/** Stand van een divisie (afgeleid uit de wedstrijden van die competitie). */
export function divisionStandings(save: CareerSave, divisionId: UUID): StandingRow[] {
  const comp = save.worldState.competitions.find(
    (c) => c.divisionId === divisionId && c.seasonId === save.worldState.activeSeasonId,
  );
  if (!comp) return [];
  const matches = save.worldState.matches.filter((m) => m.competitionId === comp.id);
  return computeStandings(comp.teamIds, matches);
}

/** Zijn alle competitiewedstrijden van het actieve seizoen gespeeld? */
export function seasonComplete(save: CareerSave): boolean {
  return save.worldState.matches
    .filter((m) => m.seasonId === save.worldState.activeSeasonId)
    .every((m) => m.state === "played");
}
