import { PITCH, clamp, type Vec2 } from "@pitch/shared";
import type { Position, Side } from "./types.js";

/** Rolcategorie per veldpositie — stuurt hoe ver een speler op-/terugschuift. */
export type RoleCategory = "keeper" | "defender" | "midfielder" | "attacker";

export function roleCategory(position: Position): RoleCategory {
  switch (position) {
    case "GK":
      return "keeper";
    case "RB":
    case "LB":
    case "CB":
      return "defender";
    case "DM":
    case "CM":
    case "AM":
      return "midfielder";
    case "RW":
    case "LW":
    case "ST":
      return "attacker";
  }
}

/**
 * Hoe ver een rol opschuift tussen verdedigen (-1) en aanvallen (+1), als
 * fractie van een vaste verplaatsing langs de aanvalsas. Hoger = agressiever.
 */
export function roleAdvance(position: Position): number {
  switch (position) {
    case "GK":
      return 0.02;
    case "CB":
      return 0.12;
    case "RB":
    case "LB":
      return 0.24;
    case "DM":
      return 0.2;
    case "CM":
      return 0.34;
    case "AM":
      return 0.46;
    case "RW":
    case "LW":
      return 0.5;
    case "ST":
      return 0.52;
  }
}

/** Hoe graag een rol pressing uitvoert (0..1). */
export function rolePressing(position: Position): number {
  const cat = roleCategory(position);
  if (cat === "attacker") return 0.85;
  if (cat === "midfielder") return 0.7;
  if (cat === "defender") return 0.5;
  return 0.2;
}

export interface TeamTactics {
  /** 0..1 hoe hoog de ploeg verdedigt (compactheid/lijnhoogte). */
  lineHeight: number;
  /** 0..1 pressing-intensiteit. */
  press: number;
  /** 0..1 breedte van het blok. */
  width: number;
  /** 0..1 tempo/directheid van opbouw. */
  tempo: number;
}

export const DEFAULT_TACTICS: TeamTactics = {
  lineHeight: 0.5,
  press: 0.6,
  width: 0.55,
  tempo: 0.55,
};

/** Bekende formatie-presets (lichte formatie-editor). */
export const FORMATIONS: Record<string, Position[]> = {
  "4-4-2": ["GK", "RB", "CB", "CB", "LB", "RW", "CM", "CM", "LW", "ST", "ST"],
  "4-3-3": ["GK", "RB", "CB", "CB", "LB", "DM", "CM", "CM", "RW", "ST", "LW"],
  "4-5-1": ["GK", "RB", "CB", "CB", "LB", "RW", "CM", "DM", "CM", "LW", "ST"],
  "3-5-2": ["GK", "CB", "CB", "CB", "RW", "DM", "CM", "CM", "LW", "ST", "ST"],
};

/**
 * Tactische laag: positionele basisdoelpositie van een speler.
 * `phase` (≈ -1 verdedigen .. +1 aanvallen, 0 = losse/neutrale bal) stuurt
 * de op-/terugschuiving. Aanvallers "leven hoog": bij aanval ver op, bij
 * verdedigen zakken ze nauwelijks terug (blijven dreiging) — zo lopen de
 * opstellingen door elkaar i.p.v. te spiegelen.
 */
export function tacticalTarget(
  anchor: Vec2,
  position: Position,
  side: Side,
  ball: Vec2,
  phase: number,
  tactics: TeamTactics,
): Vec2 {
  if (position === "GK") return anchor;

  const attackDirX = side === "home" ? 1 : -1;
  const cat = roleCategory(position);

  // Verplaatsing langs de aanvalsas (units). De ploeg blijft gestrekt over het
  // veld i.p.v. samen te klitten: verdedigers achter, middenvelders midden,
  // aanvallers diep vooruit — ook bij verdedigen (outlet voor een voorwaartse bal).
  // Ligt de bal in de aanvallende derde (in balbezit)?
  const ownGoalX = side === "home" ? 0 : PITCH.width;
  const ballAdvance = Math.abs(ball.x - ownGoalX) / PITCH.width; // 0..1, hoger = dieper
  const finalThird = phase >= 0.5 && ballAdvance > 0.62;

  let along: number;
  if (phase >= 0.5) {
    // Aanval: iedereen op; in de laatste derde duiken aanvallers de box in.
    along = roleAdvance(position) * 20 + (finalThird && cat === "attacker" ? 12 : 0);
  } else if (phase <= -0.3) {
    along = cat === "attacker" ? 2 : cat === "midfielder" ? -6 : -5; // verdedigen (compact)
  } else {
    along = roleAdvance(position) * 5; // losse/neutrale bal
  }
  const advance = along * attackDirX;

  // Territoriaal meeschuiven met de bal (compactheid), sterker in balbezit.
  const compact = phase >= 0.5 ? 0.34 + tactics.lineHeight * 0.16 : 0.18 + tactics.lineHeight * 0.1;
  const ballShiftX = (ball.x - PITCH.width / 2) * compact;
  // Het blok schuift in de breedte mee met de bal — maar AANVALLERS houden hun
  // breedte (minder meeschuiven) zodat ze de box spreiden en de verre paal
  // bezetten i.p.v. samen te klitten aan de balzijde.
  const widthHold = cat === "attacker" ? 0.4 : 1;
  const ballShiftY =
    (ball.y - PITCH.height / 2) * (0.32 + (1 - tactics.width) * 0.18) * widthHold;

  const x = clamp(anchor.x + advance + ballShiftX, 2, PITCH.width - 2);
  const y = clamp(anchor.y + ballShiftY, 2, PITCH.height - 2);
  return { x, y };
}
