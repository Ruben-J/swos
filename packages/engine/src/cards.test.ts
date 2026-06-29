import { describe, expect, it } from "vitest";
import { MatchSim } from "./match.js";
import type { MatchPlayerSetup, PlayerEntity, TeamSetup } from "./types.js";

function mkTeam(prefix: string): TeamSetup {
  const positions = ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"];
  const players: MatchPlayerSetup[] = positions.map((position, i) => ({
    id: `${prefix}${i}`,
    shirtNumber: i + 1,
    position: position as MatchPlayerSetup["position"],
    firstName: "A",
    lastName: `${prefix}${i}`,
    hairColor: "#222",
    skinColor: "#e6b48c",
    stats: {
      pace: 60, passing: 60, shooting: 60, finishing: 60, tackling: 45,
      heading: 60, goalkeeping: i === 0 ? 70 : 18, composure: 45, stamina: 60, control: 60,
    },
  }));
  return { id: prefix, name: prefix, shortName: prefix, colorPrimary: "#fff", colorSecondary: "#000", players };
}

// De kaartlogica is compile-time private; voor een deterministische test (los van
// het toevallige overtredings-RNG van een volledige wedstrijd) spreken we ze
// rechtstreeks aan via een smalle interface-cast.
interface CardApi {
  players: PlayerEntity[];
  giveCard(p: PlayerEntity, type: "yellow" | "red", secondYellow: boolean): void;
  judgeFoul(offenderId: string, spot: { x: number; y: number }, inBox: boolean): void;
  snapshot(): {
    players: { id: string; yellowCards: number }[];
    cards: { type: "yellow" | "red"; playerId: string }[];
    cardSeq: number;
  };
}

function newSim(): CardApi {
  return new MatchSim({ seed: 1, home: mkTeam("H"), away: mkTeam("A"), humanSide: null }) as unknown as CardApi;
}

describe("kaarten", () => {
  it("gele kaart: speler blijft op het veld met yellowCards verhoogd", () => {
    const sim = newSim();
    const p = sim.players.find((x) => x.side === "home" && !x.isKeeper)!;
    sim.giveCard(p, "yellow", false);
    const snap = sim.snapshot();
    expect(snap.players.length).toBe(22);
    expect(snap.players.find((s) => s.id === p.id)!.yellowCards).toBe(1);
    expect(snap.cards.length).toBe(1);
    expect(snap.cardSeq).toBe(1);
  });

  it("rode kaart: speler verlaat het veld (ploeg met tien)", () => {
    const sim = newSim();
    const p = sim.players.find((x) => x.side === "home" && !x.isKeeper)!;
    const id = p.id;
    sim.giveCard(p, "red", false);
    const snap = sim.snapshot();
    expect(snap.players.length).toBe(21);
    expect(snap.players.some((s) => s.id === id)).toBe(false);
    expect(snap.cards.filter((c) => c.type === "red").length).toBe(1);
  });

  it("tweede gele kaart wordt rood: speler eraf", () => {
    const sim = newSim();
    const p = sim.players.find((x) => x.side === "home" && !x.isKeeper)!;
    const id = p.id;
    sim.giveCard(p, "yellow", false);
    sim.giveCard(p, "red", true); // tweede geel -> rood
    const snap = sim.snapshot();
    expect(snap.players.some((s) => s.id === id)).toBe(false);
    expect(snap.cards.filter((c) => c.type === "red").length).toBe(1);
  });

  it("overtredingen leveren ook echt kaarten op in een gespeelde wedstrijd", () => {
    // Borgt dat de overtredingsfrequentie niet naar ~0 zakt: over een paar
    // volledige AI-wedstrijden vallen er kaarten (was eerder bijna nooit).
    let cards = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new MatchSim({ seed, home: mkTeam("H"), away: mkTeam("A"), humanSide: null });
      const api = sim as unknown as { phase: string; step(dt: number): void; snapshot(): { cards: unknown[] } };
      let guard = 0;
      while (api.phase !== "fulltime" && guard < 200_000) {
        api.step(1 / 60);
        guard++;
      }
      cards += api.snapshot().cards.length;
    }
    expect(cards).toBeGreaterThan(0);
  });

  it("scheidsrechter deelt kaarten uit bij herhaalde overtredingen", () => {
    const sim = newSim();
    const off = sim.players.find((x) => x.side === "home" && !x.isKeeper)!;
    // Herhaalde overtredingen door dezelfde speler -> uiteindelijk geel en rood.
    for (let i = 0; i < 60 && sim.players.some((x) => x.id === off.id); i++) {
      sim.judgeFoul(off.id, { x: 20, y: 34 }, false);
    }
    const snap = sim.snapshot();
    expect(snap.cards.length).toBeGreaterThan(0);
    // Met zoveel overtredingen volgt onvermijdelijk een tweede geel -> rood (eraf).
    expect(snap.players.some((s) => s.id === off.id)).toBe(false);
  });
});
