import type { CareerSave, UUID } from "@pitch/shared";
import { buildRatings, divisionStandings } from "./season.js";

export interface BoardObjective {
  targetRank: number;
  text: string;
  currentRank: number | null;
  met: boolean;
}

/**
 * Bestuursdoel voor het seizoen: afgeleid van de relatieve sterkte van de club
 * in zijn divisie (sterkere clubs krijgen een hoger doel). Geeft het doel, een
 * leesbare omschrijving en de huidige stand t.o.v. het doel.
 */
export function seasonObjective(save: CareerSave, teamId: UUID): BoardObjective {
  const ws = save.worldState;
  const team = ws.teams.find((t) => t.id === teamId)!;
  const ratings = buildRatings(save);
  const divTeams = ws.teams
    .filter((t) => t.divisionId === team.divisionId)
    .sort((a, b) => (ratings.get(b.id) ?? 0) - (ratings.get(a.id) ?? 0));
  const n = divTeams.length;
  const expected = Math.max(1, divTeams.findIndex((t) => t.id === teamId) + 1);
  // Bestuur is licht ambitieus.
  const targetRank = Math.min(n, Math.max(1, Math.round(expected * 0.9)));

  const div = ws.divisions.find((d) => d.id === team.divisionId);
  const tier1 = (div?.tier ?? 1) === 1;
  let text: string;
  if (targetRank === 1) text = tier1 ? "De titel pakken" : "Kampioen worden & promoveren";
  else if (targetRank <= 4) text = `Eindigen in de top 4`;
  else if (targetRank <= Math.ceil(n / 2)) text = `Eindigen in de top ${targetRank}`;
  else if (targetRank <= n - (div?.relegationSlots ?? 3)) text = "Handhaven in de middenmoot";
  else text = "Degradatie ontlopen";

  const standings = divisionStandings(save, team.divisionId);
  const row = standings.find((r) => r.teamId === teamId);
  const currentRank = row ? row.rank : null;
  const met = currentRank !== null && currentRank <= targetRank;
  return { targetRank, text, currentRank, met };
}
