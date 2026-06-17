import type { Match, StandingRow, UUID } from "@pitch/shared";

/**
 * Leid een ranglijst af uit gespeelde wedstrijden. Punten 3/1/0, gesorteerd op
 * punten -> doelsaldo -> doelpunten voor -> teamId (stabiel/deterministisch).
 */
export function computeStandings(teamIds: UUID[], matches: Match[]): StandingRow[] {
  const rows = new Map<UUID, StandingRow>();
  for (const id of teamIds) {
    rows.set(id, {
      teamId: id,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
      rank: 0,
    });
  }

  for (const m of matches) {
    if (m.state !== "played") continue;
    const home = rows.get(m.homeTeamId);
    const away = rows.get(m.awayTeamId);
    if (!home || !away) continue;
    const hg = m.score.home;
    const ag = m.score.away;
    home.played++;
    away.played++;
    home.goalsFor += hg;
    home.goalsAgainst += ag;
    away.goalsFor += ag;
    away.goalsAgainst += hg;
    if (hg > ag) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (hg < ag) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }

  const list = [...rows.values()];
  for (const r of list) r.goalDiff = r.goalsFor - r.goalsAgainst;
  list.sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.teamId.localeCompare(b.teamId),
  );
  list.forEach((r, i) => (r.rank = i + 1));
  return list;
}
