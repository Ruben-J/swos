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
      heading: 60, goalkeeping: i === 0 ? 70 : 18, composure: 50, stamina: 60, control: 60,
    },
  }));
  return { id: prefix, name: prefix, shortName: prefix, colorPrimary: "#fff", colorSecondary: "#000", players };
}

interface SimApi {
  players: PlayerEntity[];
  ball: { pos: { x: number; y: number }; vel: { x: number; y: number }; z: number; ownerId: string | null; sinceKick: number };
  phase: string;
  activeId: Record<string, string | null>;
  step(dt: number, intent?: unknown): void;
}

const fwdIntent = {
  move: { x: 1, y: 0 },
  sprint: false,
  actionHeld: 0,
  actionReleased: false,
  actionKind: null,
  aftertouch: { x: 0, y: 0 },
  switchPlayer: false,
};

describe("balcontrole / dribbel", () => {
  it("een stilstaande baldrager houdt de bal rustig aan de voet (geen dribbel-bob)", () => {
    const sim = new MatchSim({ seed: 1, home: mkTeam("H"), away: mkTeam("A"), humanSide: "home" }) as unknown as SimApi;
    const carrier = sim.players.find((p) => p.side === "home" && p.position === "CM")!;
    carrier.pos.x = 50;
    carrier.pos.y = 34;
    carrier.vel.x = 0;
    carrier.vel.y = 0;
    sim.phase = "play";
    sim.activeId.home = carrier.id; // door de mens bestuurd -> staat stil bij lege intent
    sim.ball.pos.x = carrier.pos.x + 0.7;
    sim.ball.pos.y = carrier.pos.y;

    const dists: number[] = [];
    for (let i = 0; i < 70; i++) {
      // Isoleer de drager: zet alle andere spelers ver weg zodat niemand 'm raakt.
      for (const o of sim.players) {
        if (o.id === carrier.id) continue;
        o.pos.x = 200 + sim.players.indexOf(o);
        o.pos.y = 200;
      }
      sim.ball.ownerId = carrier.id;
      sim.ball.sinceKick = 1; // carry-logica actief
      sim.step(1 / 60); // mens-actieve drager krijgt lege intent -> beweegt niet
      if (i >= 35) dists.push(Math.hypot(sim.ball.pos.x - carrier.pos.x, sim.ball.pos.y - carrier.pos.y));
    }
    // De drager bezit de bal nog en de afstand bal->voet is vrijwel constant
    // (geen heen-en-weer dribbelritme bij stilstand).
    expect(sim.ball.ownerId).toBe(carrier.id);
    const spread = Math.max(...dists) - Math.min(...dists);
    expect(spread).toBeLessThan(0.06);
  });

  it("een lopende baldrager houdt de bal controleerbaar dichtbij (niet ver vooruit)", () => {
    const sim = new MatchSim({ seed: 1, home: mkTeam("H"), away: mkTeam("A"), humanSide: "home" }) as unknown as SimApi;
    const carrier = sim.players.find((p) => p.side === "home" && p.position === "CM")!;
    carrier.pos.x = 40;
    carrier.pos.y = 34;
    sim.phase = "play";
    sim.activeId.home = carrier.id;
    sim.ball.pos.x = carrier.pos.x + 0.7;
    sim.ball.pos.y = carrier.pos.y;

    let maxOff = 0;
    for (let i = 0; i < 80; i++) {
      for (const o of sim.players) {
        if (o.id === carrier.id) continue;
        o.pos.x = 200 + sim.players.indexOf(o);
        o.pos.y = 200;
      }
      sim.ball.ownerId = carrier.id;
      sim.ball.sinceKick = 1;
      sim.step(1 / 60, fwdIntent); // de mens dribbelt vooruit
      if (i >= 20) maxOff = Math.max(maxOff, Math.hypot(sim.ball.pos.x - carrier.pos.x, sim.ball.pos.y - carrier.pos.y));
    }
    // De drager beweegt (en bezit de bal nog), maar de bal blijft binnen ~1.2 van
    // de voet — dichtbij genoeg om te passen/draaien zonder hem te verliezen.
    expect(sim.ball.ownerId).toBe(carrier.id);
    expect(carrier.pos.x).toBeGreaterThan(41); // hij is echt vooruit gelopen
    expect(maxOff).toBeLessThan(1.2);
  });
});
