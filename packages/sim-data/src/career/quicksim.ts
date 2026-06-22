import { Rng, clamp, type UUID } from "@pitch/shared";

/**
 * Snelle, attribuut-gebaseerde wedstrijduitslag voor niet-gespeelde wedstrijden.
 * Consistent in geest met de live-engine (sterkere ploeg scoort gemiddeld meer)
 * maar zonder simulatie: verwachte goals uit ratingverschil + thuisvoordeel,
 * daarna een Poisson-trekking. Deterministisch bij gelijke seed.
 */

export interface QuickResult {
  homeGoals: number;
  awayGoals: number;
  possessionHomeApprox: number;
  shotsHome: number;
  shotsAway: number;
}

/**
 * Speelstijl-tilt: vermenigvuldigers op de verwachte goals. `own` schaalt de
 * eigen aanval (homeAtt-multiplier), `opp` de blootstelling achterin (tegenstander
 * scoort makkelijker). Aanvallend = beide hoog (open), afwachtend = beide laag.
 */
export interface QuickTilt {
  own: number;
  opp: number;
}

/** Poisson-trekking (Knuth) met de gegeven RNG. */
function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.range(0, 1);
  } while (p > L);
  return k - 1;
}

/**
 * Simuleer een wedstrijd uit teamratings (0..100-schaal aanbevolen).
 * `homeAdvantage` in ratingpunten (standaard ~6).
 */
export function quickSimulate(
  rng: Rng,
  homeAtt: number,
  homeDef: number,
  awayAtt: number,
  awayDef: number,
  homeAdvantage = 6,
  tilt?: { homeAtt?: number; awayAtt?: number },
): QuickResult {
  // Verwachte goals uit aanval-vs-verdediging: eigen aanval tegen de
  // verdediging van de tegenstander, plus thuisvoordeel.
  const homeEdge = clamp(homeAtt - awayDef + homeAdvantage, -40, 40);
  const awayEdge = clamp(awayAtt - homeDef, -40, 40);
  const base = 1.25;
  const lambdaHome = clamp(base * Math.exp(homeEdge / 28) * (tilt?.homeAtt ?? 1), 0.2, 6);
  const lambdaAway = clamp(base * Math.exp(awayEdge / 28) * (tilt?.awayAtt ?? 1), 0.2, 6);
  const homeGoals = poisson(rng, lambdaHome);
  const awayGoals = poisson(rng, lambdaAway);

  // Balbezit/schoten als sfeercijfers, geschaald met de krachtsverhouding.
  const ctrl = homeAtt + homeDef - awayAtt - awayDef + homeAdvantage;
  const possessionHomeApprox = Math.round(clamp(50 + ctrl * 0.4, 28, 72));
  const shotsHome = Math.max(homeGoals, Math.round(8 + ctrl * 0.12 + rng.range(0, 6)));
  const shotsAway = Math.max(awayGoals, Math.round(8 - ctrl * 0.12 + rng.range(0, 6)));

  return { homeGoals, awayGoals, possessionHomeApprox, shotsHome, shotsAway };
}

/** Compacte container voor team-rating-lookups bij het simuleren van een ronde. */
export type RatingLookup = (teamId: UUID) => number;
