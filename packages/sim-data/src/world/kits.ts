import type { Kit, KitPattern } from "@pitch/shared";

/** Relatieve helderheid (0..1) van een #rrggbb-kleur. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Deterministische hash uit een string (team-id). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Effen komt vaker voor dan gestreept/middenstreep.
const PATTERN_POOL: KitPattern[] = ["plain", "plain", "plain", "stripes", "stripes", "centre"];

function patternFrom(h: number): KitPattern {
  return PATTERN_POOL[h % PATTERN_POOL.length]!;
}

/**
 * Maak thuis- en uittenue voor een club. Thuis = clubkleuren; uit = contrastkit
 * (wit bij een donker shirt, donkerblauw bij een licht shirt) met de clubkleur
 * als accent. Patroon per tenue deterministisch uit het team-id.
 */
export function makeKits(idHash: string, primary: string, secondary: string): { home: Kit; away: Kit } {
  const h = hash(idHash);
  const home: Kit = { primary, secondary, pattern: patternFrom(h) };
  const awayPrimary = luminance(primary) < 0.5 ? "#eef1f4" : "#1b2330";
  const away: Kit = { primary: awayPrimary, secondary: primary, pattern: patternFrom(h >>> 5) };
  return { home, away };
}

/** Tenue van een team voor een kant; valt terug op effen clubkleuren. */
export function kitFor(
  team: { kits?: { home: Kit; away: Kit }; colors: { primary: string; secondary: string } },
  side: "home" | "away",
): Kit {
  if (team.kits) return team.kits[side];
  // Oudere saves zonder kits: leid ze af uit de clubkleuren.
  return makeKits(team.colors.primary + team.colors.secondary, team.colors.primary, team.colors.secondary)[side];
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Kleurafstand 0..~441 (euclidisch in RGB). */
function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** Onder deze afstand lijken twee shirts te veel op elkaar (kleurbotsing). */
const CLASH_THRESHOLD = 100;

type KitTeam = { kits?: { home: Kit; away: Kit }; colors: { primary: string; secondary: string } };

/**
 * Kies het tenue van de UITploeg tegen een gegeven thuisploeg. Normaal de uitkit,
 * maar botst die te veel met het thuisshirt, dan switcht de uitploeg naar zijn
 * andere tenue als dat duidelijker contrasteert.
 */
export function pickAwayKitSide(homeTeam: KitTeam, awayTeam: KitTeam): "home" | "away" {
  const homeShirt = kitFor(homeTeam, "home").primary;
  const awayKit = kitFor(awayTeam, "away").primary;
  if (colorDistance(homeShirt, awayKit) >= CLASH_THRESHOLD) return "away";
  // Botsing: pak het tenue (van de twee) dat het verst van het thuisshirt ligt.
  const altKit = kitFor(awayTeam, "home").primary;
  return colorDistance(homeShirt, altKit) > colorDistance(homeShirt, awayKit) ? "home" : "away";
}
