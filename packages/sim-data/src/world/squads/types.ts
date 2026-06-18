import type { Position } from "@pitch/shared";

/** Eén speler in een (verbasterde, op de echte selectie gebaseerde) clubselectie. */
export interface SquadPlayer {
  first: string;
  last: string;
  pos: Position;
}

/** Clubnaam (zoals in de catalogus) -> verbasterde echte selectie. */
export type ClubSquadMap = Record<string, SquadPlayer[]>;
