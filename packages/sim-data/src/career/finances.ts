import { clamp, Rng, type CareerSave, type CompetitionScope, type Team, type UUID } from "@pitch/shared";
import { divisionStandings } from "./season.js";
import { weeklyWageBill } from "./transfers.js";

/**
 * Seizoenseconomie voor de club van de speler. Geld komt binnen via recettes
 * (thuiswedstrijden), sponsor/TV (per speeldag) en prijzengeld (seizoenseinde);
 * eraf gaan de wekelijkse lonen. AI-clubs houden hun statische budget (scope:
 * "Eigen club + overzicht"). Alle bedragen in hele euro's, deterministisch via de
 * meegegeven rng.
 */

const emptySeason = (): { gate: number; sponsor: number; wages: number; prize: number } => ({
  gate: 0,
  sponsor: 0,
  wages: 0,
  prize: 0,
});

/** Divisietier van een team (1 = hoogste); default 3 als onbekend. */
function teamTier(save: CareerSave, team: Team): number {
  return save.worldState.divisions.find((d) => d.id === team.divisionId)?.tier ?? 3;
}

/** Ticketprijs per toeschouwer (€), schaalt met niveau en clubreputatie. */
function ticketPrice(save: CareerSave, team: Team): number {
  const tier = teamTier(save, team);
  const base = tier === 1 ? 40 : tier === 2 ? 26 : 16;
  const rep = clamp((team.reputation?.domestic ?? 50) / 50, 0.6, 1.7);
  return Math.round(base * rep);
}

/** Recette van één thuiswedstrijd: opkomst × ticketprijs. Grotere affiches
 *  (beker/Europa) trekken iets meer publiek. */
function gateReceipts(save: CareerSave, team: Team, scope: CompetitionScope, rng: Rng): number {
  const cap = team.stadium.capacity;
  const draw = scope === "league" ? 1 : scope === "cup" ? 1.06 : 1.15;
  const occ = clamp(team.stadium.attendanceBase * draw + rng.range(-0.05, 0.05), 0.3, 1);
  const attendance = Math.round(cap * occ);
  return attendance * ticketPrice(save, team);
}

/** Sponsor/TV-termijn per gespeelde speeldag, uit de sponsortier + niveau. */
function sponsorPerMatchday(save: CareerSave, team: Team): number {
  const tier = teamTier(save, team);
  const base = tier === 1 ? 90_000 : tier === 2 ? 40_000 : 16_000;
  return Math.round((team.finances.sponsorTier || 1) * base * 0.4);
}

/**
 * Boek de financiën van de club van de speler voor één afgewerkte kalenderdatum:
 * recettes van thuiswedstrijden + sponsor − lonen (op dagen dat de club speelt).
 * Werkt het saldo en de seizoens-/laatste-speeldag-boekhouding bij.
 */
export function applyMatchdayFinances(save: CareerSave, rng: Rng, date: string): void {
  const myId = save.manager.currentTeamId;
  const team = save.worldState.teams.find((t) => t.id === myId);
  if (!team) return;

  const myMatches = save.worldState.matches.filter(
    (m) => m.date === date && m.state === "played" && (m.homeTeamId === myId || m.awayTeamId === myId),
  );
  if (myMatches.length === 0) return; // de eigen club speelde niet -> geen boeking

  const compScope = (id: UUID): CompetitionScope =>
    save.worldState.competitions.find((c) => c.id === id)?.scope ?? "league";

  let gate = 0;
  for (const m of myMatches) {
    if (m.homeTeamId === myId && m.venueTeamId === myId) gate += gateReceipts(save, team, compScope(m.competitionId), rng);
  }
  const sponsor = sponsorPerMatchday(save, team);
  const wages = weeklyWageBill(save, myId);
  const net = gate + sponsor - wages;

  const fin = team.finances;
  fin.season ??= emptySeason();
  fin.balance += net;
  fin.season.gate += gate;
  fin.season.sponsor += sponsor;
  fin.season.wages += wages;
  fin.lastMatchday = { date, gate, sponsor, wages, net };
}

/**
 * Ken prijzengeld toe aan de club van de speler bij seizoenseinde: een pot op
 * basis van eindklassering in de eigen divisie (hoger = meer) plus een bonus per
 * gewonnen knockout-duel in beker/Europa. Werkt saldo + seizoenstotaal bij.
 */
export function applySeasonPrizeMoney(save: CareerSave): number {
  const myId = save.manager.currentTeamId;
  const team = save.worldState.teams.find((t) => t.id === myId);
  if (!team) return 0;
  const tier = teamTier(save, team);
  const potTop = tier === 1 ? 30_000_000 : tier === 2 ? 8_000_000 : 2_500_000;

  // Klasseringsgeld: lineair van potTop (1e) tot ~10% (laatste).
  const table = divisionStandings(save, team.divisionId);
  const n = Math.max(1, table.length);
  const rank = table.find((r) => r.teamId === myId)?.rank ?? n;
  const placeShare = 0.1 + 0.9 * ((n - rank) / Math.max(1, n - 1));
  let prize = Math.round(potTop * placeShare);

  // Beker/Europa: bonus per gewonnen knockout-duel.
  const ws = save.worldState;
  const cupBonus = tier === 1 ? 1_200_000 : tier === 2 ? 400_000 : 150_000;
  for (const m of ws.matches) {
    if (m.seasonId !== ws.activeSeasonId || m.state !== "played") continue;
    const comp = ws.competitions.find((c) => c.id === m.competitionId);
    if (!comp || comp.format !== "knockout") continue;
    const home = m.homeTeamId === myId;
    const away = m.awayTeamId === myId;
    if (!home && !away) continue;
    const hg = m.score.aetHome ?? m.score.home;
    const ag = m.score.aetAway ?? m.score.away;
    const won = home ? hg > ag : ag > hg;
    if (won) prize += cupBonus;
  }

  const fin = team.finances;
  fin.season ??= emptySeason();
  fin.balance += prize;
  fin.season.prize += prize;
  return prize;
}
