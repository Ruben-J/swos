import { Rng, clamp, rngId, type Player, type Position, type Team } from "@pitch/shared";
import type { MatchPlayerSetup, MatchPlayerStats, TeamSetup } from "@pitch/engine";

const HAIR_COLORS = ["#1b1b1b", "#2e2018", "#5a3a1e", "#8a5a2b", "#c8943f", "#d9c27a", "#a23b1e", "#9a9a9a"];
const SKIN_TONES = ["#f1c9a5", "#e6b48c", "#d49a6a", "#a9714b", "#8a5a3a", "#6b4327"];

/** Posities in een standaard 16-koppige selectie (2 keepers, brede dekking). */
const SQUAD_POSITIONS: Position[] = [
  "GK", "GK",
  "RB", "LB", "CB", "CB", "CB",
  "DM", "CM", "CM", "AM",
  "RW", "LW",
  "ST", "ST",
  "CM",
];

function makeAttributes(rng: Rng, position: Position, quality: number): Player["attributes"] {
  const base = 45 + quality * 35; // 45..80
  const g = (spread = 11): number =>
    Math.round(clamp(rng.gaussian(base, spread), 22, 95));
  const isGk = position === "GK";
  const isDef = position === "RB" || position === "LB" || position === "CB";
  const isAtt = position === "ST" || position === "RW" || position === "LW";
  return {
    pace: g(),
    stamina: g(9),
    ballControl: g(),
    passing: g(),
    shooting: isAtt ? Math.round(clamp(g() + 6, 22, 95)) : g(13),
    finishing: isAtt ? Math.round(clamp(g() + 6, 22, 95)) : g(14),
    heading: isDef || position === "ST" ? Math.round(clamp(g() + 4, 22, 95)) : g(),
    tackling: isDef ? Math.round(clamp(g() + 6, 22, 95)) : g(),
    composure: g(),
    aggression: g(),
    consistency: g(),
    flair: g(),
    goalkeeping: isGk ? Math.round(clamp(rng.gaussian(base + 6, 8), 40, 96)) : 18,
  };
}

/** Positie-gewogen overall 0..100. */
export function playerOverall(p: Player): number {
  const a = p.attributes;
  const pos = p.preferredPositions[0] ?? "CM";
  if (pos === "GK") return Math.round((a.goalkeeping ?? 40) * 0.85 + a.composure * 0.15);
  const def = pos === "RB" || pos === "LB" || pos === "CB";
  const att = pos === "ST" || pos === "RW" || pos === "LW";
  if (def) {
    return Math.round(a.tackling * 0.34 + a.heading * 0.18 + a.pace * 0.16 + a.passing * 0.14 + a.composure * 0.18);
  }
  if (att) {
    return Math.round(a.finishing * 0.3 + a.shooting * 0.22 + a.pace * 0.2 + a.ballControl * 0.16 + a.composure * 0.12);
  }
  return Math.round(a.passing * 0.3 + a.ballControl * 0.22 + a.tackling * 0.16 + a.stamina * 0.14 + a.composure * 0.18);
}

export interface GenPlayerOpts {
  quality: number;
  nationality: string;
  refYear: number;
  position: Position;
  firstName: string;
  lastName: string;
}

export function generatePlayer(rng: Rng, teamId: string, opts: GenPlayerOpts): Player {
  const age = rng.int(17, 34);
  const birthYear = opts.refYear - age;
  const attributes = makeAttributes(rng, opts.position, opts.quality);
  const overall = 50; // herberekend door playerOverall waar nodig
  const value = Math.round(clamp((opts.quality * 0.6 + rng.range(0, 0.4)) * 18_000_000, 50_000, 90_000_000));
  return {
    id: rngId(rng),
    teamId,
    firstName: opts.firstName,
    lastName: opts.lastName,
    nationality: opts.nationality,
    birthDate: `${birthYear}-0${rng.int(1, 9)}-1${rng.int(0, 9)}`,
    ageYears: age,
    preferredPositions: [opts.position],
    foot: rng.chance(0.75) ? "R" : rng.chance(0.5) ? "L" : "B",
    attributes,
    hidden: {
      potential: clamp(opts.quality * 100 + rng.range(-10, 20), 30, 99),
      injuryProneness: rng.int(5, 60),
      professionalism: rng.int(30, 95),
      loyalty: rng.int(20, 90),
    },
    status: {
      morale: rng.int(55, 85),
      fitness: rng.int(85, 100),
      sharpness: rng.int(60, 90),
      form: rng.int(40, 70),
      injury: null,
      suspensionMatchesRemaining: 0,
    },
    market: {
      estimatedValue: value,
      askingPrice: null,
      wageDemand: Math.round(value * 0.0009 + 1500),
      interestScore: 0,
    },
  };
  void overall;
}

export interface NamePool {
  first: readonly string[];
  last: readonly string[];
}

/** Genereer een 16-koppige selectie voor een club met gegeven sterkte (0..1). */
export function generateSquad(
  rng: Rng,
  teamId: string,
  quality: number,
  nationality: string,
  refYear: number,
  names: NamePool,
): Player[] {
  const usedLast = new Set<string>();
  const pickLast = (): string => {
    for (let t = 0; t < 40; t++) {
      const ln = rng.pick(names.last);
      if (!usedLast.has(ln)) {
        usedLast.add(ln);
        return ln;
      }
    }
    return rng.pick(names.last);
  };
  return SQUAD_POSITIONS.map((position) =>
    generatePlayer(rng, teamId, {
      quality,
      nationality,
      refYear,
      position,
      firstName: rng.pick(names.first),
      lastName: pickLast(),
    }),
  );
}

/** Team-rating 0..100: gemiddelde overall van de beste 11 spelers. */
export function teamRating(players: Player[]): number {
  const sorted = [...players].sort((a, b) => playerOverall(b) - playerOverall(a));
  const xi = sorted.slice(0, 11);
  if (xi.length === 0) return 50;
  const sum = xi.reduce((s, p) => s + playerOverall(p), 0);
  return Math.round(sum / xi.length);
}

function appearance(idHash: string): { hair: string; skin: string } {
  let h = 0;
  for (let i = 0; i < idHash.length; i++) h = (h * 31 + idHash.charCodeAt(i)) >>> 0;
  return {
    hair: HAIR_COLORS[h % HAIR_COLORS.length]!,
    // Unsigned shift: een signed >> kan negatief worden -> negatieve index -> undefined.
    skin: SKIN_TONES[(h >>> 3) % SKIN_TONES.length]!,
  };
}

function toMatchStats(p: Player): MatchPlayerStats {
  const a = p.attributes;
  return {
    pace: a.pace,
    passing: a.passing,
    shooting: a.shooting,
    finishing: a.finishing,
    tackling: a.tackling,
    heading: a.heading,
    goalkeeping: a.goalkeeping ?? 18,
    composure: a.composure,
    stamina: a.stamina,
  };
}

const FORMATION_4412: Position[] = ["GK", "RB", "CB", "CB", "LB", "RW", "CM", "CM", "LW", "ST", "ST"];

/** Kies de beste XI in een 4-4-2 en bouw een engine-TeamSetup voor live spel. */
export function toTeamSetup(team: Team, players: Player[]): TeamSetup {
  const pool = [...players].sort((a, b) => playerOverall(b) - playerOverall(a));
  const used = new Set<string>();
  const positionFit = (p: Player, slot: Position): number => {
    const pref = p.preferredPositions[0] ?? "CM";
    if (pref === slot) return 0;
    const group = (pos: Position): string =>
      pos === "GK" ? "g" : "RB LB CB DM".includes(pos) ? "d" : "RW LW ST".includes(pos) ? "a" : "m";
    return group(pref) === group(slot) ? 1 : 2;
  };
  const chosen: { player: Player; slot: Position }[] = [];
  for (const slot of FORMATION_4412) {
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const score = positionFit(p, slot) * 100 - playerOverall(p);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) {
      used.add(best.id);
      chosen.push({ player: best, slot });
    }
  }

  const setupPlayers: MatchPlayerSetup[] = chosen.map(({ player, slot }, i) => {
    const look = appearance(player.id);
    return {
      id: player.id,
      shirtNumber: i + 1,
      position: slot,
      firstName: player.firstName,
      lastName: player.lastName,
      hairColor: look.hair,
      skinColor: look.skin,
      stats: toMatchStats(player),
    };
  });

  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    colorPrimary: team.colors.primary,
    colorSecondary: team.colors.secondary,
    players: setupPlayers,
    formationName: "4-4-2",
    tactics: {
      lineHeight: clamp(team.tacticalIdentity.press, 0.35, 0.7),
      press: clamp(team.tacticalIdentity.press, 0.4, 0.85),
      width: clamp(team.tacticalIdentity.width, 0.4, 0.72),
      tempo: clamp(team.tacticalIdentity.tempo, 0.4, 0.8),
    },
  };
}
