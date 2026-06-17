import { PITCH, type Vec2 } from "@pitch/shared";
import type { Position, Side } from "./types.js";

/**
 * Basis-ankerposities per veldpositie, uitgedrukt als fracties van het veld
 * vanuit het perspectief "valt naar rechts aan" (home). x: 0=eigen doel,
 * 1=tegendoel. y: 0=boven, 1=onder. Voor away spiegelen we x.
 */
// Compactere band: verdediging ~0.26, aanval ~0.65 i.p.v. de hele veldlengte,
// zodat de linies dichter bij elkaar blijven (het blok schuift mee met de fase).
const ANCHORS: Record<Position, Vec2> = {
  GK: { x: 0.06, y: 0.5 },
  RB: { x: 0.28, y: 0.12 },
  CB: { x: 0.26, y: 0.38 },
  LB: { x: 0.28, y: 0.88 },
  DM: { x: 0.38, y: 0.5 },
  CM: { x: 0.46, y: 0.32 },
  AM: { x: 0.54, y: 0.5 },
  RW: { x: 0.61, y: 0.15 },
  LW: { x: 0.61, y: 0.85 },
  ST: { x: 0.66, y: 0.5 },
};

/**
 * Bereken de ankerpositie (pitch units) voor een speler. Bij meerdere spelers
 * op dezelfde positie schuiven we ze met `slot` uit elkaar over de breedte.
 */
export function anchorFor(side: Side, position: Position, slot = 0, slotCount = 1): Vec2 {
  const base = ANCHORS[position]!;
  const fx = base.x;
  let fy = base.y;

  // Verdeel meerdere spelers met dezelfde positie over de y-as.
  if (slotCount > 1) {
    const spread = 0.34;
    fy = 0.5 + ((slot - (slotCount - 1) / 2) / Math.max(1, slotCount - 1)) * spread;
    if (position === "CB" || position === "ST" || position === "CM") {
      fy = base.y + (slot - (slotCount - 1) / 2) * 0.18;
    }
  }

  // home valt naar rechts aan (x groeit); away spiegelt.
  const x = side === "home" ? fx * PITCH.width : (1 - fx) * PITCH.width;
  const y = fy * PITCH.height;
  return { x, y };
}
