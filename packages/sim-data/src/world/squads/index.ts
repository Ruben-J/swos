import type { ClubSquadMap } from "./types.js";
import { SQUADS_ENG } from "./ENG.js";
import { SQUADS_FRA } from "./FRA.js";
import { SQUADS_GER } from "./GER.js";
import { SQUADS_ITA } from "./ITA.js";
import { SQUADS_ESP } from "./ESP.js";
import { SQUADS_NED } from "./NED.js";

export type { SquadPlayer, ClubSquadMap } from "./types.js";

/** Alle clubselecties (clubnaam -> verbasterde echte selectie), samengevoegd. */
export const CLUB_SQUADS: ClubSquadMap = {
  ...SQUADS_ENG,
  ...SQUADS_FRA,
  ...SQUADS_GER,
  ...SQUADS_ITA,
  ...SQUADS_ESP,
  ...SQUADS_NED,
};
