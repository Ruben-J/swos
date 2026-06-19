import {
  Rng,
  clamp,
  type CareerSave,
  type Contract,
  type Player,
  type Position,
  type UUID,
} from "@pitch/shared";
import { FIRST_NAMES, LAST_NAMES } from "../names.js";
import { generatePlayer, playerOverall } from "../world/squad.js";

/** Posities waaruit jeugdspelers geloot worden (brede dekking). */
const YOUTH_POSITIONS: Position[] = [
  "GK", "CB", "RB", "LB", "DM", "CM", "AM", "RW", "LW", "ST",
];

/** Sterrenwaardering 1..5 uit een (verborgen) potentieel 30..99. */
export function potentialStars(potential: number): number {
  return clamp(Math.round((potential - 45) / 11) + 1, 1, 5);
}

/**
 * Genereer de jeugdlichting van één club: 1..3 talenten (16..18 jaar) met lage
 * huidige waarde maar een potentieel dat meelift met de jeugdreputatie van de
 * club. Geeft de nieuwe spelers + contracten terug.
 */
export function generateClubIntake(
  rng: Rng,
  teamId: UUID,
  nationality: string,
  youthRep: number,
  refYear: number,
  seasonLabelYear: number,
): { players: Player[]; contracts: Contract[] } {
  const n = rng.int(1, 3);
  const players: Player[] = [];
  const contracts: Contract[] = [];
  for (let i = 0; i < n; i++) {
    const age = rng.int(16, 18);
    // Lage huidige kwaliteit; potentieel met grote spreiding rond de jeugdrep.
    const quality = rng.range(0.18, 0.4);
    const potential = clamp(40 + youthRep * 0.45 + rng.range(-12, 30), 42, 93);
    const p = generatePlayer(rng, teamId, {
      quality,
      nationality,
      refYear,
      position: rng.pick(YOUTH_POSITIONS),
      firstName: rng.pick(FIRST_NAMES),
      lastName: rng.pick(LAST_NAMES),
      age,
      potential,
    });
    players.push(p);
    contracts.push({
      id: `c-${p.id}-youth`,
      playerId: p.id,
      teamId,
      startDate: `${seasonLabelYear}-07-01`,
      endDate: `${seasonLabelYear + 3}-06-30`,
      salaryPerWeek: Math.max(800, Math.round(p.market.wageDemand * 0.4)),
      role: "Prospect",
      squadNumber: null,
      releaseClause: null,
      extensionOptionYears: 0,
    });
  }
  return { players, contracts };
}

/**
 * Jaarlijkse jeugdinstroom voor de hele wereld (bij seizoensovergang). Iedere
 * club krijgt een nieuwe lichting; muteert de save en geeft de eigen nieuwe
 * talenten terug zodat de UI ze kan tonen.
 */
export function processYouthIntake(
  save: CareerSave,
  rng: Rng,
  refYear: number,
  seasonLabelYear: number,
): Player[] {
  const ws = save.worldState;
  const myTeamId = save.manager.currentTeamId;
  const mine: Player[] = [];
  for (const team of ws.teams) {
    const { players, contracts } = generateClubIntake(
      rng,
      team.id,
      team.countryCode,
      team.reputation.youth,
      refYear,
      seasonLabelYear,
    );
    ws.players.push(...players);
    ws.contracts.push(...contracts);
    if (team.id === myTeamId) mine.push(...players);
  }
  return mine;
}

/** Eigen jeugdspelers (t/m 19 jaar), gesorteerd op potentieel. */
export function myYouthProspects(save: CareerSave): Player[] {
  return save.worldState.players
    .filter((p) => p.teamId === save.manager.currentTeamId && p.ageYears <= 19)
    .sort((a, b) => b.hidden.potential - a.hidden.potential || playerOverall(b) - playerOverall(a));
}
