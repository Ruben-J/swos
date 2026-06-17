import { describe, expect, it } from "vitest";
import { TICK_DT } from "@pitch/shared";
import { MatchSim } from "./match.js";
import { emptyIntent, type MatchConfig, type MatchPlayerSetup, type Position } from "./types.js";

const FORMATION: Position[] = [
  "GK",
  "RB",
  "CB",
  "CB",
  "LB",
  "RW",
  "CM",
  "CM",
  "LW",
  "ST",
  "ST",
];

function makePlayers(prefix: string): MatchPlayerSetup[] {
  return FORMATION.map((position, i) => ({
    id: `${prefix}-${i}`,
    shirtNumber: i + 1,
    position,
    firstName: "Test",
    lastName: `Speler${i}`,
    hairColor: "#2e2018",
    skinColor: "#e6b48c",
    stats: {
      pace: 60,
      passing: 60,
      shooting: 60,
      finishing: 60,
      tackling: 60,
      heading: 60,
      goalkeeping: position === "GK" ? 65 : 30,
      composure: 60,
      stamina: 70,
    },
  }));
}

function makeConfig(seed: number): MatchConfig {
  return {
    seed,
    humanSide: null,
    home: {
      id: "h",
      name: "Home",
      shortName: "HOM",
      colorPrimary: "#ff0000",
      colorSecondary: "#ffffff",
      players: makePlayers("h"),
    },
    away: {
      id: "a",
      name: "Away",
      shortName: "AWY",
      colorPrimary: "#0000ff",
      colorSecondary: "#ffffff",
      players: makePlayers("a"),
    },
  };
}

describe("MatchSim", () => {
  it("bouwt 22 spelers met ankers binnen het veld", () => {
    const sim = new MatchSim(makeConfig(1));
    expect(sim.players).toHaveLength(22);
    for (const p of sim.players) {
      expect(p.pos.x).toBeGreaterThanOrEqual(-6);
      expect(p.pos.x).toBeLessThanOrEqual(111);
    }
  });

  it("zet bij de aftrap alle veldspelers op de eigen helft", () => {
    const sim = new MatchSim(makeConfig(5));
    const snap = sim.snapshot();
    expect(snap.phase).toBe("kickoff");
    const half = 52.5;
    for (const p of snap.players) {
      if (p.isKeeper) continue;
      if (p.side === "home") expect(p.x).toBeLessThanOrEqual(half + 0.5);
      else expect(p.x).toBeGreaterThanOrEqual(half - 0.5);
    }
  });

  it("aftrap: match staat stil en tegenstanders blijven van de bal", () => {
    const sim = new MatchSim(makeConfig(3));
    // 0.5s < verplichte stilstand (1.6s): nog steeds aftrap, niemand heeft getrapt.
    for (let i = 0; i < 30; i++) sim.step(TICK_DT, emptyIntent());
    const s = sim.snapshot();
    expect(s.phase).toBe("kickoff");
    const kicking = s.possession;
    expect(kicking).not.toBeNull();
    // Bal ligt stil rond het midden.
    expect(Math.hypot(s.ball.x - 52.5, s.ball.y - 34)).toBeLessThan(3);
    // Tegenstanders van de aftrappende ploeg worden van de bal weggehouden.
    for (const p of s.players) {
      if (p.side === kicking || p.isKeeper) continue;
      const d = Math.hypot(p.x - s.ball.x, p.y - s.ball.y);
      expect(d).toBeGreaterThan(6.5);
    }
  });

  it("is deterministisch: gelijke seed -> identieke staat na N ticks", () => {
    const a = new MatchSim(makeConfig(777));
    const b = new MatchSim(makeConfig(777));
    for (let i = 0; i < 600; i++) {
      a.step(TICK_DT, emptyIntent());
      b.step(TICK_DT, emptyIntent());
    }
    expect(JSON.stringify(a.snapshot())).toEqual(JSON.stringify(b.snapshot()));
  });

  it("verschillende seeds geven verschillende verlopen", () => {
    const a = new MatchSim(makeConfig(1));
    const b = new MatchSim(makeConfig(2));
    for (let i = 0; i < 600; i++) {
      a.step(TICK_DT, emptyIntent());
      b.step(TICK_DT, emptyIntent());
    }
    expect(JSON.stringify(a.snapshot())).not.toEqual(JSON.stringify(b.snapshot()));
  });

  it("scoort niet structureel bevooroordeeld (home én away scoren over veel seeds)", () => {
    let homeTotal = 0;
    let awayTotal = 0;
    const matches = 24;
    for (let seed = 1; seed <= matches; seed++) {
      const sim = new MatchSim(makeConfig(seed * 13));
      let guard = 0;
      while (sim.snapshot().phase !== "fulltime" && guard < 60000) {
        sim.step(TICK_DT, emptyIntent());
        guard++;
      }
      const s = sim.snapshot();
      homeTotal += s.score.home;
      awayTotal += s.score.away;
    }
    const avg = (homeTotal + awayTotal) / matches;
    // Geen kant mag volledig droogvallen (gelijke teams -> geen veld-bias).
    expect(homeTotal).toBeGreaterThan(0);
    expect(awayTotal).toBeGreaterThan(0);
    // Balans: niet absurd hoog of nul.
    expect(avg).toBeGreaterThan(0.5);
    expect(avg).toBeLessThan(12);
    // Symmetrie: home en away in dezelfde orde van grootte.
    const ratio = homeTotal / Math.max(1, awayTotal);
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(2.5);
  });

  it("keeper kan uittrappen zonder de bal meteen terug te vangen", () => {
    const sim = new MatchSim({ ...makeConfig(5), humanSide: "home" });
    const press = { ...emptyIntent(), actionReleased: true, actionHeld: 0.4 };

    // Speel tot 'play' (neem indien nodig de thuis-hervatting in met de "knop").
    let guard = 0;
    while (sim.snapshot().phase !== "play" && guard < 4000) {
      const s = sim.snapshot();
      sim.step(TICK_DT, s.awaitingHumanRestart ? press : emptyIntent());
      guard++;
    }
    expect(sim.snapshot().phase).toBe("play");

    // Zet de thuiskeeper geïsoleerd bij het eigen doel met de bal aan de voet.
    const gk = sim.players.find((p) => p.isKeeper && p.side === "home")!;
    // Geen teamgenoten in de buurt -> keeper doet een lange clearance.
    for (const p of sim.players) {
      if (p !== gk && !p.isKeeper) p.pos = { x: p.side === "home" ? 60 : 90, y: 4 };
    }
    gk.pos = { x: 8, y: 34 };
    gk.vel = { x: 0, y: 0 };
    // Keeper heeft de bal aan de voet (zoals na een redding/terugspeelbal).
    sim.ball.pos = { x: 8, y: 34 };
    sim.ball.z = 0;
    sim.ball.vel = { x: 0, y: 0 };
    sim.ball.vz = 0;
    sim.ball.ownerId = gk.id;
    sim.ball.lastTouchId = gk.id;
    sim.ball.sinceKick = 999;
    sim.step(TICK_DT, emptyIntent());
    expect(sim.snapshot().possession).toBe("home");

    // Mens trapt uit (Z = schieten = harde/lange trap, richting het veld in).
    const kick = {
      ...emptyIntent(),
      actionReleased: true,
      actionHeld: 0.4,
      actionKind: "shoot" as const,
      move: { x: 1, y: 0 },
      aftertouch: { x: 1, y: 0 },
    };
    sim.step(TICK_DT, kick);
    for (let i = 0; i < 40; i++) sim.step(TICK_DT, emptyIntent());

    const gkNow = sim.players.find((p) => p.id === gk.id)!;
    const d = Math.hypot(sim.ball.pos.x - gkNow.pos.x, sim.ball.pos.y - gkNow.pos.y);
    expect(d).toBeGreaterThan(5);
  });

  it("keeper past naar een teamgenoot in de aangegeven richting (beneden)", () => {
    const sim = new MatchSim({ ...makeConfig(5), humanSide: "home" });
    const press = { ...emptyIntent(), actionReleased: true, actionHeld: 0.4 };
    let g = 0;
    while (sim.snapshot().phase !== "play" && g < 4000) {
      const s = sim.snapshot();
      sim.step(TICK_DT, s.awaitingHumanRestart ? press : emptyIntent());
      g++;
    }

    const gk = sim.players.find((p) => p.isKeeper && p.side === "home")!;
    const mate = sim.players.find((p) => p.side === "home" && !p.isKeeper)!;
    // Alleen één teamgenoot, recht onder de keeper; rest ver weg.
    for (const p of sim.players) {
      if (p !== gk && p !== mate && !p.isKeeper) p.pos = { x: p.side === "home" ? 60 : 90, y: 4 };
    }
    gk.pos = { x: 8, y: 20 };
    gk.vel = { x: 0, y: 0 };
    mate.pos = { x: 9, y: 50 }; // beneden (+y)
    mate.vel = { x: 0, y: 0 };
    sim.ball.pos = { x: 8, y: 20 };
    sim.ball.z = 0;
    sim.ball.vel = { x: 0, y: 0 };
    sim.ball.vz = 0;
    sim.ball.ownerId = gk.id;
    sim.ball.lastTouchId = gk.id;
    sim.ball.sinceKick = 999;
    sim.step(TICK_DT, emptyIntent());
    expect(sim.snapshot().possession).toBe("home");

    // X (passen) met richting OMLAAG: keeper hoort naar de teamgenoot beneden te passen.
    const passDown = {
      ...emptyIntent(),
      actionReleased: true,
      actionHeld: 0,
      actionKind: "pass" as const,
      move: { x: 0, y: 1 },
      aftertouch: { x: 0, y: 1 },
    };
    sim.step(TICK_DT, passDown);
    for (let i = 0; i < 30; i++) sim.step(TICK_DT, emptyIntent());

    // Bal is naar beneden gespeeld (richting de teamgenoot), niet weggeramd.
    expect(sim.ball.pos.y).toBeGreaterThan(24);
  });

  it("tackle naast de bal op een tegenstander = overtreding -> vrije trap", () => {
    const sim = new MatchSim({ ...makeConfig(8), humanSide: "home" });
    const press = { ...emptyIntent(), actionReleased: true, actionHeld: 0.4 };
    let g = 0;
    while (sim.snapshot().phase !== "play" && g < 4000) {
      const s = sim.snapshot();
      sim.step(TICK_DT, s.awaitingHumanRestart ? press : emptyIntent());
      g++;
    }
    expect(sim.snapshot().phase).toBe("play");

    const H = sim.players.find((p) => p.side === "home" && !p.isKeeper)!;
    const A = sim.players.find((p) => p.side === "away" && !p.isKeeper)!;
    // Zet anderen ver weg zodat H de actieve speler is en A het slachtoffer.
    for (const p of sim.players) {
      if (p !== H && p !== A && !p.isKeeper) p.pos = { x: p.side === "home" ? 4 : 101, y: 4 };
    }
    H.pos = { x: 50, y: 34 };
    H.tackleCooldown = 0;
    A.pos = { x: 51, y: 34 };
    // Bal ~2 van H (buiten tackle-bereik) maar A vlak naast H.
    sim.ball.pos = { x: 52, y: 34 };
    sim.ball.vel = { x: 0, y: 0 };
    sim.ball.z = 0;
    sim.ball.ownerId = A.id;
    sim.ball.sinceKick = 999;

    // Glijdende tackle: mist de bal, raakt A -> overtreding.
    sim.step(TICK_DT, { ...emptyIntent(), actionReleased: true, actionHeld: 0 });
    // Spel loopt eerst nog door (fluit-fase), pas daarna de vrije trap.
    expect(sim.snapshot().phase).toBe("whistle");
    // Na de fluit-vertraging -> hervatting (deadball) voor de tegenstander.
    for (let i = 0; i < 60 * 3; i++) sim.step(TICK_DT, emptyIntent());
    expect(sim.snapshot().phase).toBe("deadball");
    expect(sim.snapshot().possession).toBe("away");
  });

  it("overtreding in het strafschopgebied -> strafschop op de stip", () => {
    const sim = new MatchSim({ ...makeConfig(8), humanSide: "home" });
    const press = { ...emptyIntent(), actionReleased: true, actionHeld: 0.4 };
    let g = 0;
    while (sim.snapshot().phase !== "play" && g < 4000) {
      const s = sim.snapshot();
      sim.step(TICK_DT, s.awaitingHumanRestart ? press : emptyIntent());
      g++;
    }
    const H = sim.players.find((p) => p.side === "home" && !p.isKeeper)!;
    const A = sim.players.find((p) => p.side === "away" && !p.isKeeper)!;
    for (const p of sim.players) {
      if (p !== H && p !== A && !p.isKeeper) p.pos = { x: p.side === "home" ? 4 : 101, y: 4 };
    }
    // In het strafschopgebied van home (x < 16.5): away wordt gefould -> penalty.
    H.pos = { x: 9, y: 34 };
    H.tackleCooldown = 0;
    A.pos = { x: 10.3, y: 34 };
    sim.ball.pos = { x: 13, y: 34 };
    sim.ball.vel = { x: 0, y: 0 };
    sim.ball.z = 0;
    sim.ball.ownerId = A.id;
    sim.ball.sinceKick = 999;

    sim.step(TICK_DT, { ...emptyIntent(), actionReleased: true, actionHeld: 0 });
    expect(sim.snapshot().phase).toBe("whistle");
    for (let i = 0; i < 60 * 3; i++) sim.step(TICK_DT, emptyIntent());
    expect(sim.snapshot().phase).toBe("deadball");
    expect(sim.snapshot().possession).toBe("away");
    // Bal ligt op de strafschopstip (11 m van het home-doel) op het midden.
    expect(sim.ball.pos.x).toBeCloseTo(11, 0);
    expect(sim.ball.pos.y).toBeCloseTo(34, 0);
  });

  it("uit: spel loopt nog door (fluit) voordat de hervatting verschijnt", () => {
    const sim = new MatchSim(makeConfig(11));
    let g = 0;
    while (sim.snapshot().phase !== "play" && g < 2000) {
      sim.step(TICK_DT, emptyIntent());
      g++;
    }
    // Schiet de bal over de bovenste zijlijn.
    sim.ball.pos = { x: 52, y: 2 };
    sim.ball.vel = { x: 0, y: -30 };
    sim.ball.z = 0;
    sim.ball.ownerId = null;
    sim.ball.sinceKick = 1;
    sim.ball.lastTouchSide = "home";
    let guard = 0;
    while (sim.snapshot().phase === "play" && guard < 60) {
      sim.step(TICK_DT, emptyIntent());
      guard++;
    }
    // Niet meteen de hervatting: eerst de "fluit"-fase, bal echt over de lijn.
    expect(sim.snapshot().phase).toBe("whistle");
    expect(sim.ball.pos.y).toBeLessThan(0);
    // Pas na de vertraging -> hervatting (deadball).
    for (let i = 0; i < 60 * 3; i++) sim.step(TICK_DT, emptyIntent());
    expect(sim.snapshot().phase).toBe("deadball");
  });

  it("speelt een volledige wedstrijd zonder te crashen en bereikt fulltime", () => {
    const sim = new MatchSim(makeConfig(42));
    let guard = 0;
    while (sim.snapshot().phase !== "fulltime" && guard < 200000) {
      sim.step(TICK_DT, emptyIntent());
      guard++;
    }
    const snap = sim.snapshot();
    expect(snap.phase).toBe("fulltime");
    expect(snap.matchMinute).toBeGreaterThanOrEqual(90);
    expect(snap.score.home).toBeGreaterThanOrEqual(0);
    expect(snap.score.away).toBeGreaterThanOrEqual(0);
  });
});
