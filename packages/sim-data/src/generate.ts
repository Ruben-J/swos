import { Rng, hashSeed, rngId, type Position } from "@pitch/shared";
import type { MatchPlayerSetup, MatchPlayerStats, TeamSetup } from "@pitch/engine";
import { FORMATIONS } from "@pitch/engine";
import { CITIES, CLUB_CORE, CLUB_PREFIX, FIRST_NAMES, LAST_NAMES } from "./names.js";

/** Haarkleuren (zwart/bruin/blond/rood/grijs). */
const HAIR_COLORS = ["#1b1b1b", "#2e2018", "#5a3a1e", "#8a5a2b", "#c8943f", "#d9c27a", "#a23b1e", "#9a9a9a"];
/** Huidtinten. */
const SKIN_TONES = ["#f1c9a5", "#e6b48c", "#d49a6a", "#a9714b", "#8a5a3a", "#6b4327"];

const SHIRT_PALETTE = [
  ["#d4382f", "#ffffff"],
  ["#1f4ed8", "#ffd23f"],
  ["#0f9d58", "#0b3d1f"],
  ["#7b2ff7", "#f0e6ff"],
  ["#ff8c1a", "#1a1a1a"],
  ["#111827", "#9ca3af"],
  ["#06b6d4", "#003544"],
  ["#e11d8f", "#1a001a"],
];

function makeStats(rng: Rng, position: Position, quality: number): MatchPlayerStats {
  // quality 0..1 stuurt het gemiddelde niveau van het team.
  const base = 45 + quality * 35; // 45..80
  const g = (spread = 12) => Math.round(Math.max(20, Math.min(95, rng.gaussian(base, spread))));
  const isGk = position === "GK";
  const isDef = position === "RB" || position === "LB" || position === "CB";
  const isAtt = position === "ST" || position === "RW" || position === "LW";
  return {
    pace: g(),
    passing: g(),
    shooting: isAtt ? g(10) + 6 : g(),
    finishing: isAtt ? g(10) + 6 : g(14),
    tackling: isDef ? g(10) + 6 : g(),
    heading: isDef || position === "ST" ? g(10) + 4 : g(),
    goalkeeping: isGk ? Math.round(Math.max(40, Math.min(95, rng.gaussian(base + 5, 8)))) : 20,
    composure: g(),
    stamina: g(10),
    control: isAtt || position === "AM" || position === "CM" ? g(10) + 4 : g(),
  };
}

export interface GenerateTeamOptions {
  /** 0..1 algeheel teamniveau. */
  quality?: number;
  colorIndex?: number;
}

export function generateTeam(rng: Rng, opts: GenerateTeamOptions = {}): TeamSetup {
  const quality = opts.quality ?? rng.range(0.4, 0.85);
  const prefix = rng.pick(CLUB_PREFIX);
  const core = rng.pick(CLUB_CORE);
  const name = `${prefix} ${core}`;
  const shortName = core.slice(0, 3).toUpperCase();
  const palette = SHIRT_PALETTE[(opts.colorIndex ?? rng.int(0, SHIRT_PALETTE.length - 1)) % SHIRT_PALETTE.length]!;

  const formationNames = Object.keys(FORMATIONS);
  const formationName = rng.pick(formationNames);
  const formation = FORMATIONS[formationName] as Position[];

  // Unieke achternamen binnen het team; voornamen mogen herhalen.
  const usedLast = new Set<string>();
  const pickLast = (): string => {
    for (let tries = 0; tries < 30; tries++) {
      const ln = rng.pick(LAST_NAMES);
      if (!usedLast.has(ln)) {
        usedLast.add(ln);
        return ln;
      }
    }
    return rng.pick(LAST_NAMES);
  };

  const players: MatchPlayerSetup[] = formation.map((position, i) => ({
    id: rngId(rng),
    shirtNumber: i + 1,
    position,
    firstName: rng.pick(FIRST_NAMES),
    lastName: pickLast(),
    hairColor: rng.pick(HAIR_COLORS),
    skinColor: rng.pick(SKIN_TONES),
    stats: makeStats(rng, position, quality),
  }));

  return {
    id: rngId(rng),
    name,
    shortName,
    colorPrimary: palette[0]!,
    colorSecondary: palette[1]!,
    players,
    formationName,
    tactics: {
      lineHeight: rng.range(0.35, 0.7),
      press: rng.range(0.4, 0.85),
      width: rng.range(0.4, 0.72),
      tempo: rng.range(0.4, 0.8),
    },
  };
}

/** Genereer twee teams en een matchseed voor een snelle vriendschappelijke wedstrijd. */
export function quickMatchSetup(seedInput: number | string): {
  seed: number;
  home: TeamSetup;
  away: TeamSetup;
} {
  const seed = typeof seedInput === "string" ? hashSeed(seedInput) : seedInput;
  const rng = new Rng(seed);
  const home = generateTeam(rng, { quality: rng.range(0.5, 0.85), colorIndex: 0 });
  const away = generateTeam(rng, { quality: rng.range(0.5, 0.85), colorIndex: 1 });
  // Voorkom identieke namen.
  if (away.name === home.name) away.name = `${away.name} B`;
  return { seed, home, away };
}

export { FIRST_NAMES, LAST_NAMES, CITIES };
