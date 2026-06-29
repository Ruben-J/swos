import { CARDS, Rng, type CareerSave, type Player, type UUID } from "@pitch/shared";

/** Uitslag van één kaart uit een gespeelde wedstrijd (engine -> career). */
export interface MatchCardResult {
  playerId: UUID;
  type: "yellow" | "red";
}

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
  // Gele kaarten dit seizoen tonen (zichtbaar vanaf de eerste); bij CARDS.yellowsForBan volgt een schorsing.
  if (p.status.yellowCards > 0) return `🟨 ${p.status.yellowCards}`;
  return null;
}

/** Boek een gele kaart; bij een veelvoud van de drempel volgt een schorsing. */
export function bookYellow(p: Player): void {
  p.status.yellowCards += 1;
  if (p.status.yellowCards % CARDS.yellowsForBan === 0) {
    p.status.suspensionMatchesRemaining += 1;
  }
}

/** Boek een rode kaart: schorsing voor de eerstvolgende wedstrijd(en). */
export function bookRed(p: Player): void {
  p.status.suspensionMatchesRemaining += CARDS.redSuspension;
}

/**
 * Verwerk de gevolgen van een speeldag: herstel lopende blessures een week en
 * loot nieuwe blessures voor de eigen selectie (geschaald met
 * blessuregevoeligheid). Schorsingen lopen niet hier maar per gespeelde
 * wedstrijd af (zie processMatchDiscipline in season.ts). Muteert de save.
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

  // Nieuwe blessures voor de eigen selectie.
  for (const p of mine) {
    if (p.status.injury) continue;
    const prone = p.hidden.injuryProneness / 100;
    if (rng.chance(0.018 + prone * 0.05)) {
      p.status.injury = {
        type: rng.pick(INJURY_TYPES),
        daysRemaining: rng.int(7, 49),
      };
      p.status.fitness = Math.min(p.status.fitness, 60);
    }
  }
}
