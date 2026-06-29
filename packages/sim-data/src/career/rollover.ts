import {
  Rng,
  rngId,
  type CareerSave,
  type Division,
  type Season,
  type UUID,
} from "@pitch/shared";
import { buildCupsAndEuro, buildSeasonFixtures } from "../world/build.js";
import { divisionStandings } from "./season.js";
import { processYouthIntake } from "./youth.js";
import { generateJobOffers, updateManagerReputation } from "./jobs.js";
import { applySeasonPrizeMoney } from "./finances.js";

export interface PromotionMove {
  teamId: UUID;
  fromDivisionId: UUID;
  toDivisionId: UUID;
  direction: "promotie" | "degradatie";
}

export interface SeasonRollover {
  champions: { divisionId: UUID; teamId: UUID }[];
  moves: PromotionMove[];
}

/** Jaar uit een seizoenslabel "2025/26" -> 2025. */
function seasonYear(label: string): number {
  return parseInt(label.split("/")[0] ?? "2025", 10);
}

/**
 * Sluit het actieve seizoen af: bepaal kampioenen, regel promotie/degradatie
 * tussen opeenvolgende divisies per land, en bouw een nieuw seizoen met een
 * verse kalender. Spelers verouderen één jaar. Muteert en geeft de save terug,
 * plus een overzicht van de mutaties.
 */
export function advanceToNextSeason(
  save: CareerSave,
  rng: Rng,
): { save: CareerSave; rollover: SeasonRollover } {
  const ws = save.worldState;
  const oldSeason = ws.seasons.find((s) => s.id === ws.activeSeasonId)!;
  const champions: SeasonRollover["champions"] = [];
  const moves: PromotionMove[] = [];

  // Eindstanden per divisie (vóór verplaatsing).
  const finalTable = new Map<UUID, UUID[]>(); // divisionId -> teamIds in rangorde
  for (const div of ws.divisions) {
    const table = divisionStandings(save, div.id);
    finalTable.set(div.id, table.map((r) => r.teamId));
    if (table[0]) champions.push({ divisionId: div.id, teamId: table[0].teamId });
  }

  // Manager-reputatie bijwerken op de eigen eindklassering (vóór verplaatsing).
  const myTeam = ws.teams.find((t) => t.id === save.manager.currentTeamId);
  if (myTeam) {
    const myDiv = ws.divisions.find((d) => d.id === myTeam.divisionId);
    const order = finalTable.get(myTeam.divisionId) ?? [];
    const rank = order.indexOf(myTeam.id) + 1;
    if (myDiv && rank > 0) {
      updateManagerReputation(save, rank, order.length, myDiv.tier);
    }
    // Prijzengeld voor het afgelopen seizoen (klassering + beker/Europa).
    applySeasonPrizeMoney(save);
    // Seizoenstotalen resetten voor het nieuwe seizoen.
    if (myTeam.finances.season) myTeam.finances.season = { gate: 0, sponsor: 0, wages: 0, prize: 0 };
    myTeam.finances.lastMatchday = undefined;
  }

  // Promotie/degradatie per land, tussen tier t en t+1.
  const byCountry = new Map<string, Division[]>();
  for (const div of ws.divisions) {
    const arr = byCountry.get(div.countryCode) ?? [];
    arr.push(div);
    byCountry.set(div.countryCode, arr);
  }
  for (const divs of byCountry.values()) {
    divs.sort((a, b) => a.tier - b.tier);
    for (let i = 0; i < divs.length - 1; i++) {
      const upper = divs[i]!;
      const lower = divs[i + 1]!;
      const upTable = finalTable.get(upper.id) ?? [];
      const lowTable = finalTable.get(lower.id) ?? [];
      const downN = upper.relegationSlots;
      const upN = lower.promotionSlots;
      // Onderkant van de hogere divisie degradeert.
      const relegated = upTable.slice(upTable.length - downN);
      // Bovenkant van de lagere divisie promoveert.
      const promoted = lowTable.slice(0, upN);
      for (const teamId of relegated) {
        moves.push({ teamId, fromDivisionId: upper.id, toDivisionId: lower.id, direction: "degradatie" });
      }
      for (const teamId of promoted) {
        moves.push({ teamId, fromDivisionId: lower.id, toDivisionId: upper.id, direction: "promotie" });
      }
    }
  }
  // Pas de verplaatsingen toe op de teams.
  for (const mv of moves) {
    const team = ws.teams.find((t) => t.id === mv.teamId);
    if (team) team.divisionId = mv.toDivisionId;
  }

  // Spelers verouderen een jaar; gele-kaart-tellers gaan het nieuwe seizoen op nul.
  for (const p of ws.players) {
    p.ageYears += 1;
    p.status.yellowCards = 0;
  }

  // Nieuw seizoen + verse kalender.
  oldSeason.promotedRelegatedResolved = true;
  const nextYear = seasonYear(oldSeason.label) + 1;
  const seasonStart = `${nextYear}-08-16`;
  const seasonId = rngId(rng);
  const league = buildSeasonFixtures(rng, seasonId, ws.divisions, ws.teams, seasonStart);

  // Europese plaatsing op basis van de eindstanden van dit seizoen: per
  // tier-1-divisie de rangorde, geïnterleaved (alle nummers 1, dan alle 2, ...).
  const tier1Tables = ws.divisions
    .filter((d) => d.tier === 1)
    .map((d) => finalTable.get(d.id) ?? []);
  const euroRanking: UUID[] = [];
  const maxLen = Math.max(0, ...tier1Tables.map((t) => t.length));
  for (let pos = 0; pos < maxLen; pos++) {
    for (const t of tier1Tables) if (t[pos]) euroRanking.push(t[pos]!);
  }
  const cups = buildCupsAndEuro(rng, seasonId, ws.divisions, ws.teams, seasonStart, euroRanking);
  const competitions = [...league.competitions, ...cups.competitions];
  const matches = [...league.matches, ...cups.matches];

  const season: Season = {
    id: seasonId,
    worldId: oldSeason.worldId,
    label: `${nextYear}/${(nextYear + 1) % 100}`,
    currentDate: seasonStart,
    transferWindows: [
      { startDate: `${nextYear}-07-01`, endDate: `${nextYear}-09-01`, type: "summer" },
      { startDate: `${nextYear + 1}-01-01`, endDate: `${nextYear + 1}-02-01`, type: "winter" },
    ],
    competitions: competitions.map((c) => c.id),
    promotedRelegatedResolved: false,
  };

  ws.competitions.push(...competitions);
  ws.matches.push(...matches);
  ws.seasons.push(season);
  ws.activeSeasonId = seasonId;

  // Jeugdinstroom voor de hele wereld (nieuwe lichting per club).
  processYouthIntake(save, rng, nextYear, nextYear);

  // Baanaanbiedingen op basis van de bijgewerkte reputatie.
  save.manager.pendingOffers = generateJobOffers(save, rng);

  return { save, rollover: { champions, moves } };
}
