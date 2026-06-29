import { Rng, clamp, rngId, type Player, type Position, type Team } from "@pitch/shared";
import { FORMATIONS, type MatchPlayerSetup, type MatchPlayerStats, type TeamSetup } from "@pitch/engine";
import { kitFor } from "./kits.js";

/** Verdeling van formaties over de clubs (deterministisch op team-id). */
const FORMATION_POOL = ["4-4-2", "4-4-2", "4-3-3", "4-3-3", "4-3-3", "3-5-2", "3-4-3", "4-5-1"];

/** Kies een vaste formatie voor een club (zelfde id -> zelfde formatie). */
export function teamFormationName(teamId: string): string {
  let h = 0;
  for (let i = 0; i < teamId.length; i++) h = (h * 31 + teamId.charCodeAt(i)) >>> 0;
  return FORMATION_POOL[h % FORMATION_POOL.length]!;
}

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

/** Positie-gewogen overall 0..100, ongerond (voor het meten van kleine groei). */
export function playerOverallExact(p: Player): number {
  const a = p.attributes;
  const pos = p.preferredPositions[0] ?? "CM";
  if (pos === "GK") return (a.goalkeeping ?? 40) * 0.85 + a.composure * 0.15;
  const def = pos === "RB" || pos === "LB" || pos === "CB";
  const att = pos === "ST" || pos === "RW" || pos === "LW";
  if (def) {
    return a.tackling * 0.34 + a.heading * 0.18 + a.pace * 0.16 + a.passing * 0.14 + a.composure * 0.18;
  }
  if (att) {
    return a.finishing * 0.3 + a.shooting * 0.22 + a.pace * 0.2 + a.ballControl * 0.16 + a.composure * 0.12;
  }
  return a.passing * 0.3 + a.ballControl * 0.22 + a.tackling * 0.16 + a.stamina * 0.14 + a.composure * 0.18;
}

/** Positie-gewogen overall 0..100. */
export function playerOverall(p: Player): number {
  return Math.round(playerOverallExact(p));
}

export interface GenPlayerOpts {
  quality: number;
  nationality: string;
  refYear: number;
  position: Position;
  firstName: string;
  lastName: string;
  /** Vaste leeftijd (anders willekeurig 17..34). Voor jeugdspelers. */
  age?: number;
  /** Vast verborgen potentieel (anders afgeleid van `quality`). */
  potential?: number;
}

export function generatePlayer(rng: Rng, teamId: string, opts: GenPlayerOpts): Player {
  const age = opts.age ?? rng.int(17, 34);
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
      potential: opts.potential ?? clamp(opts.quality * 100 + rng.range(-10, 20), 30, 99),
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
      yellowCards: 0,
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

/** Een vaste, op de echte selectie gebaseerde (verbasterde) speler. */
export interface RosterEntry {
  first: string;
  last: string;
  pos: Position;
}

/**
 * Genereer de selectie van een club. Is een `roster` (verbasterde echte
 * selectie) gegeven, dan worden naam + positie daaruit overgenomen en alleen de
 * attributen procedureel uit de clubsterkte afgeleid. Anders volledig
 * procedureel met een naam-pool.
 */
export function generateSquad(
  rng: Rng,
  teamId: string,
  quality: number,
  nationality: string,
  refYear: number,
  names: NamePool,
  roster?: RosterEntry[],
): Player[] {
  if (roster && roster.length >= 11) {
    return roster.map((r) =>
      generatePlayer(rng, teamId, {
        quality,
        nationality,
        refYear,
        position: r.pos,
        firstName: r.first,
        lastName: r.last,
      }),
    );
  }

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
    control: a.ballControl,
  };
}

/** Hoe goed past een speler op een formatieslot (0 = exact, hoger = slechter). */
export function positionFit(p: Player, slot: Position): number {
  const pref = p.preferredPositions[0] ?? "CM";
  if (pref === slot) return 0;
  const group = (pos: Position): string =>
    pos === "GK" ? "g" : "RB LB CB DM".includes(pos) ? "d" : "RW LW ST".includes(pos) ? "a" : "m";
  return group(pref) === group(slot) ? 1 : 2;
}

/**
 * Kies de beste XI voor een formatie uit een spelersgroep. Geblesseerde/geschorste
 * spelers blijven buiten beeld zolang er 11 fitte over zijn. Geeft de toewijzing
 * speler->slot in formatievolgorde.
 */
export function pickBestEleven(
  players: Player[],
  formationName: string,
): { player: Player; slot: Position }[] {
  const formation = (FORMATIONS[formationName] ?? FORMATIONS["4-4-2"]!) as Position[];
  const fit = players.filter((p) => p.status.injury === null && p.status.suspensionMatchesRemaining === 0);
  const usable = fit.length >= 11 ? fit : players;
  const pool = [...usable].sort((a, b) => playerOverall(b) - playerOverall(a));
  const used = new Set<string>();
  const chosen: { player: Player; slot: Position }[] = [];
  for (const slot of formation) {
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
  return chosen;
}

export interface TeamSetupOverride {
  /** Formatienaam; valt terug op de clubvoorkeur. */
  formationName?: string;
  /** 11 speler-id's in slotvolgorde; ontbrekende/onbekende slots vult de beste XI. */
  lineup?: string[];
  /** Tactische instellingen (0..1). */
  shape?: { lineHeight: number; press: number; width: number; tempo: number };
}

/** Kies de XI in de teamformatie en bouw een engine-TeamSetup voor live spel.
 *  Met `override` bepaalt de manager formatie/opstelling/tactiek zelf. `kitSide`
 *  kiest het thuis- of uittenue (thuisploeg = "home", uitploeg = "away"). */
export function toTeamSetup(
  team: Team,
  players: Player[],
  override?: TeamSetupOverride,
  kitSide: "home" | "away" = "home",
): TeamSetup {
  const formationName = override?.formationName || teamFormationName(team.id);
  const formation = (FORMATIONS[formationName] ?? FORMATIONS["4-4-2"]!) as Position[];

  let chosen: { player: Player; slot: Position }[];
  const lineup = override?.lineup;
  if (lineup && lineup.length > 0) {
    // Handmatige opstelling: wijs gekozen spelers toe op slotvolgorde, vul gaten
    // met de beste resterende spelers.
    const byId = new Map(players.map((p) => [p.id, p]));
    const used = new Set<string>();
    chosen = [];
    formation.forEach((slot, i) => {
      const pid = lineup[i];
      const p = pid ? byId.get(pid) : undefined;
      if (p && !used.has(p.id)) {
        used.add(p.id);
        chosen.push({ player: p, slot });
      } else {
        chosen.push({ player: null as unknown as Player, slot });
      }
    });
    // Vul lege slots met beste beschikbare (niet-gebruikte) speler.
    const rest = [...players]
      .filter((p) => !used.has(p.id))
      .sort((a, b) => playerOverall(b) - playerOverall(a));
    for (const c of chosen) {
      if (c.player) continue;
      const pick = rest.shift();
      if (pick) {
        used.add(pick.id);
        c.player = pick;
      }
    }
    chosen = chosen.filter((c) => c.player);
  } else {
    chosen = pickBestEleven(players, formationName);
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

  // Bank: de beste resterende spelers (niet in de basis), voor wissels.
  const startingIds = new Set(chosen.map((c) => c.player.id));
  const benchPlayers: MatchPlayerSetup[] = [...players]
    .filter((p) => !startingIds.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a))
    .slice(0, 7)
    .map((player, i) => {
      const look = appearance(player.id);
      return {
        id: player.id,
        shirtNumber: 12 + i,
        position: player.preferredPositions[0] ?? "CM",
        firstName: player.firstName,
        lastName: player.lastName,
        hairColor: look.hair,
        skinColor: look.skin,
        stats: toMatchStats(player),
      };
    });

  const kit = kitFor(team, kitSide);
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    colorPrimary: kit.primary,
    colorSecondary: kit.secondary,
    pattern: kit.pattern,
    players: setupPlayers,
    bench: benchPlayers,
    formationName,
    tactics: override?.shape
      ? {
          lineHeight: clamp(override.shape.lineHeight, 0.35, 0.7),
          press: clamp(override.shape.press, 0.4, 0.85),
          width: clamp(override.shape.width, 0.4, 0.72),
          tempo: clamp(override.shape.tempo, 0.4, 0.8),
        }
      : {
          lineHeight: clamp(team.tacticalIdentity.press, 0.35, 0.7),
          press: clamp(team.tacticalIdentity.press, 0.4, 0.85),
          width: clamp(team.tacticalIdentity.width, 0.4, 0.72),
          tempo: clamp(team.tacticalIdentity.tempo, 0.4, 0.8),
        },
  };
}
