import { Rng, type CareerSave, type Player, type UUID } from "@pitch/shared";

const INJURY_TYPES = [
  "spierblessure",
  "hamstring",
  "enkelbandletsel",
  "knieblessure",
  "kuitblessure",
  "lichte verrekking",
];

/** Is een speler inzetbaar (niet geblesseerd en niet geschorst)? */
export function isAvailable(p: Player): boolean {
  return p.status.injury === null && p.status.suspensionMatchesRemaining === 0;
}

/** Korte status-tekst voor de UI, of null als fit. */
export function statusLabel(p: Player): string | null {
  if (p.status.injury) {
    const wks = Math.max(1, Math.round(p.status.injury.daysRemaining / 7));
    return `🤕 ${wks}w`;
  }
  if (p.status.suspensionMatchesRemaining > 0) return `🚫 ${p.status.suspensionMatchesRemaining}`;
  return null;
}

/**
 * Verwerk de gevolgen van een speeldag: herstel lopende blessures een week,
 * tik schorsingen van de eigen ploeg af, en loot nieuwe blessures/schorsingen
 * voor de eigen selectie (geschaald met blessuregevoeligheid). Muteert de save.
 */
export function processMatchdayEvents(save: CareerSave, rng: Rng, myTeamId: UUID): void {
  const ws = save.worldState;

  // Herstel: elke speeldag ~een week.
  for (const p of ws.players) {
    if (p.status.injury) {
      p.status.injury.daysRemaining -= 7;
      if (p.status.injury.daysRemaining <= 0) p.status.injury = null;
    }
  }

  const mine = ws.players.filter((p) => p.teamId === myTeamId);

  // Schorsingen van de eigen ploeg lopen een wedstrijd af (zat de wedstrijd uit).
  for (const p of mine) {
    if (p.status.suspensionMatchesRemaining > 0) p.status.suspensionMatchesRemaining -= 1;
  }

  // Nieuwe blessures/schorsingen voor de eigen selectie.
  for (const p of mine) {
    if (p.status.injury) continue;
    const prone = p.hidden.injuryProneness / 100;
    if (rng.chance(0.018 + prone * 0.05)) {
      p.status.injury = {
        type: rng.pick(INJURY_TYPES),
        daysRemaining: rng.int(7, 49),
      };
      p.status.fitness = Math.min(p.status.fitness, 60);
    } else if (p.status.suspensionMatchesRemaining === 0 && rng.chance(0.012)) {
      p.status.suspensionMatchesRemaining = rng.chance(0.25) ? 2 : 1;
    }
  }
}
