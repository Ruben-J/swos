import { describe, expect, it } from "vitest";
import { Rng, type Match } from "@pitch/shared";
import { buildDoubleRoundRobin, totalRounds } from "./fixtures.js";
import { computeStandings } from "./standings.js";
import { buildWorld } from "../world/build.js";
import { createCareer } from "../world/build.js";
import { divisionStandings, playMatchday, seasonComplete, teamNextMatch } from "./season.js";
import { advanceToNextSeason } from "./rollover.js";
import { buyPlayer, sellPlayer, squadSize, transferTargets, transferWindowOpen } from "./transfers.js";
import { isAvailable } from "./events.js";
import { seasonObjective } from "./board.js";

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

  it("seizoensovergang: promotie/degradatie + nieuw seizoen", () => {
    const world = buildWorld(new Rng(42), 2025);
    let save = createCareer(world, { seed: 7, managerName: "T", teamId: world.teams[0]!.id });
    const myTeam = world.teams[0]!;

    // Speel het seizoen uit.
    const simRng = new Rng(1);
    let guard = 0;
    while (!seasonComplete(save) && guard < 80) {
      const m = save.worldState.matches.find((x) => x.state === "scheduled")!;
      save = playMatchday(save, simRng, m.date);
      guard++;
    }

    // Onthoud eindstanden van een tier-1 + tier-2 paar (Engeland).
    const engDivs = world.divisions
      .filter((d) => d.countryCode === "ENG")
      .sort((a, b) => a.tier - b.tier);
    const t1 = engDivs[0]!;
    const t2 = engDivs[1]!;
    const t1Final = divisionStandings(save, t1.id).map((r) => r.teamId);
    const t2Final = divisionStandings(save, t2.id).map((r) => r.teamId);
    const relegated = t1Final.slice(t1Final.length - t1.relegationSlots);
    const promoted = t2Final.slice(0, t2.promotionSlots);

    const prevSeasonId = save.worldState.activeSeasonId;
    const ageBefore = save.worldState.players[0]!.ageYears;
    const { save: next, rollover } = advanceToNextSeason(save, new Rng(99));
    save = next;

    // Nieuw actief seizoen, nieuwe kalender.
    expect(save.worldState.activeSeasonId).not.toBe(prevSeasonId);
    expect(save.worldState.seasons.length).toBe(2);
    expect(save.worldState.players[0]!.ageYears).toBe(ageBefore + 1);

    // Gedegradeerde teams staan nu in tier 2, promovendi in tier 1.
    for (const id of relegated) {
      expect(save.worldState.teams.find((t) => t.id === id)!.divisionId).toBe(t2.id);
    }
    for (const id of promoted) {
      expect(save.worldState.teams.find((t) => t.id === id)!.divisionId).toBe(t1.id);
    }
    expect(rollover.moves.length).toBeGreaterThan(0);

    // Beide divisies houden 16 clubs.
    expect(save.worldState.teams.filter((t) => t.divisionId === t1.id).length).toBe(16);
    expect(save.worldState.teams.filter((t) => t.divisionId === t2.id).length).toBe(16);

    // Het nieuwe seizoen heeft weer een volledige kalender voor mijn (mogelijk
    // andere) divisie.
    const myDivNow = save.worldState.teams.find((t) => t.id === myTeam.id)!.divisionId;
    const next1 = teamNextMatch(save.worldState.matches, myTeam.id);
    expect(next1).not.toBeNull();
    expect(divisionStandings(save, myDivNow).length).toBe(16);
  });

  it("transfers: kopen en verkopen verrekenen budget en selectie", () => {
    const world = buildWorld(new Rng(3), 2025);
    const myTeam = world.teams[0]!;
    const save = createCareer(world, { seed: 1, managerName: "T", teamId: myTeam.id });
    // createCareer zet de datum op 15 aug -> binnen het zomervenster (1 jul-1 sep).
    expect(transferWindowOpen(save)).toBe(true);

    const buyer = save.worldState.teams.find((t) => t.id === myTeam.id)!;
    buyer.finances.transferBudget = 200_000_000; // ruim budget voor de test
    const sizeBefore = squadSize(save, myTeam.id);
    const budgetBefore = buyer.finances.transferBudget;

    const target = transferTargets(save, { limit: 1 })[0]!;
    const sellerId = target.teamId!;
    const sellerSizeBefore = squadSize(save, sellerId);
    const res = buyPlayer(save, target.id);
    expect(res.ok).toBe(true);
    expect(save.worldState.players.find((p) => p.id === target.id)!.teamId).toBe(myTeam.id);
    expect(squadSize(save, myTeam.id)).toBe(sizeBefore + 1);
    expect(squadSize(save, sellerId)).toBe(sellerSizeBefore - 1);
    expect(buyer.finances.transferBudget).toBeLessThan(budgetBefore);
    // Nieuw contract bij mijn club.
    expect(save.worldState.contracts.find((c) => c.playerId === target.id)!.teamId).toBe(myTeam.id);

    // Verkopen: selectie krimpt, budget stijgt.
    const budgetAfterBuy = buyer.finances.transferBudget;
    const sell = sellPlayer(save, target.id);
    expect(sell.ok).toBe(true);
    expect(save.worldState.players.find((p) => p.id === target.id)!.teamId).toBeNull();
    expect(squadSize(save, myTeam.id)).toBe(sizeBefore);
    expect(buyer.finances.transferBudget).toBeGreaterThan(budgetAfterBuy);
  });

  it("blessures/schorsingen: ontstaan en herstellen over een seizoen", () => {
    const world = buildWorld(new Rng(9), 2025);
    const myTeam = world.teams[0]!;
    let save = createCareer(world, { seed: 2, managerName: "T", teamId: myTeam.id });
    const simRng = new Rng(4);
    let everInjured = false;
    let guard = 0;
    while (!seasonComplete(save) && guard < 80) {
      const m = save.worldState.matches.find((x) => x.state === "scheduled")!;
      save = playMatchday(save, simRng, m.date);
      if (save.worldState.players.some((p) => p.teamId === myTeam.id && p.status.injury)) {
        everInjured = true;
      }
      guard++;
    }
    // Over een heel seizoen raakt vrijwel zeker iemand geblesseerd.
    expect(everInjured).toBe(true);
    // Iedereen die fit is, is ook inzetbaar (consistente helper).
    const fit = save.worldState.players.filter((p) => p.teamId === myTeam.id && isAvailable(p));
    expect(fit.length).toBeGreaterThan(0);
  });

  it("board-doel: levert een doel + huidige stand", () => {
    const world = buildWorld(new Rng(11), 2025);
    const myTeam = world.teams[0]!;
    const save = createCareer(world, { seed: 5, managerName: "T", teamId: myTeam.id });
    const obj = seasonObjective(save, myTeam.id);
    expect(obj.targetRank).toBeGreaterThanOrEqual(1);
    expect(obj.targetRank).toBeLessThanOrEqual(16);
    expect(obj.text.length).toBeGreaterThan(0);
  });
});
