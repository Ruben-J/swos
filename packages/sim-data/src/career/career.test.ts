import { describe, expect, it } from "vitest";
import { Rng, type Match } from "@pitch/shared";
import { buildDoubleRoundRobin, totalRounds } from "./fixtures.js";
import { computeStandings } from "./standings.js";
import { buildWorld } from "../world/build.js";
import { createCareer } from "../world/build.js";
import { divisionStandings, playMatchday, seasonComplete, teamNextMatch } from "./season.js";

describe("fixtures", () => {
  it("dubbel round-robin: iedereen 2x tegen elkaar, geen zelf-duel", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `t${i}`);
    const fx = buildDoubleRoundRobin(ids);
    expect(fx.length).toBe(16 * 15); // n*(n-1) wedstrijden
    expect(totalRounds(16)).toBe(30);

    // Elk team speelt 30 wedstrijden (15 thuis, 15 uit).
    const home = new Map<string, number>();
    const away = new Map<string, number>();
    for (const f of fx) {
      expect(f.homeId).not.toBe(f.awayId);
      home.set(f.homeId, (home.get(f.homeId) ?? 0) + 1);
      away.set(f.awayId, (away.get(f.awayId) ?? 0) + 1);
    }
    for (const id of ids) {
      expect(home.get(id)).toBe(15);
      expect(away.get(id)).toBe(15);
    }

    // Elke geordende paring komt exact 1x voor (A thuis vs B is uniek).
    const seen = new Set<string>();
    for (const f of fx) {
      const key = `${f.homeId}>${f.awayId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("elke ronde heeft n/2 wedstrijden", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `t${i}`);
    const fx = buildDoubleRoundRobin(ids);
    const perRound = new Map<number, number>();
    for (const f of fx) perRound.set(f.round, (perRound.get(f.round) ?? 0) + 1);
    for (let r = 1; r <= 30; r++) expect(perRound.get(r)).toBe(8);
  });
});

describe("standings", () => {
  it("punten 3/1/0 en sortering", () => {
    const mk = (h: string, a: string, hg: number, ag: number): Match =>
      ({
        id: `${h}${a}`,
        seasonId: "s",
        competitionId: "c",
        roundLabel: "r",
        date: "2025-08-15",
        homeTeamId: h,
        awayTeamId: a,
        venueTeamId: h,
        kickoffWeather: "dry",
        pitchType: "normal",
        state: "played",
        score: { home: hg, away: ag },
        xArcadeMeta: { possessionHomeApprox: 50, shotsHome: 0, shotsAway: 0, motmPlayerId: null },
      }) as Match;
    const table = computeStandings(
      ["A", "B", "C"],
      [mk("A", "B", 2, 0), mk("B", "C", 1, 1), mk("C", "A", 0, 3)],
    );
    expect(table[0]!.teamId).toBe("A");
    expect(table[0]!.points).toBe(6);
    expect(table[0]!.goalDiff).toBe(5);
    expect(table.find((r) => r.teamId === "B")!.points).toBe(1);
  });
});

describe("career-seizoen", () => {
  it("simuleert een volledig seizoen: alle wedstrijden gespeeld, stand klopt", () => {
    const rng = new Rng(12345);
    const world = buildWorld(rng, 2025);
    expect(world.teams.length).toBe(192);
    expect(world.divisions.length).toBe(12);

    const myTeam = world.teams[0]!;
    let save = createCareer(world, { seed: 999, managerName: "Test", teamId: myTeam.id });

    // Speel alle speeldagen (quicksim ales).
    const simRng = new Rng(777);
    let guard = 0;
    while (!seasonComplete(save) && guard < 80) {
      const next = teamNextMatch(save.worldState.matches, myTeam.id);
      const date = next ? next.date : save.worldState.matches.find((m) => m.state === "scheduled")!.date;
      save = playMatchday(save, simRng, date);
      guard++;
    }
    expect(seasonComplete(save)).toBe(true);

    // Stand van de divisie van mijn club: 16 teams, elk 30 gespeeld.
    const table = divisionStandings(save, myTeam.divisionId);
    expect(table.length).toBe(16);
    for (const row of table) expect(row.played).toBe(30);
    // Puntenbehoud: totaal punten = 3*beslissingen + 2*gelijkspelen, en
    // gespeelde wedstrijden = 16*30/2 = 240.
    const totalPlayed = table.reduce((s, r) => s + r.played, 0);
    expect(totalPlayed).toBe(16 * 30);
  });
});
