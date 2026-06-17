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
  homeRating: number,
  awayRating: number,
  homeAdvantage = 6,
): QuickResult {
  const diff = clamp(homeRating + homeAdvantage - awayRating, -40, 40);
  // Basis ~1.35 goals per ploeg; ratingverschil schuift de verwachting.
  const base = 1.35;
  const lambdaHome = clamp(base * Math.exp(diff / 28), 0.2, 5.5);
  const lambdaAway = clamp(base * Math.exp(-diff / 28), 0.2, 5.5);
  const homeGoals = poisson(rng, lambdaHome);
  const awayGoals = poisson(rng, lambdaAway);

  // Balbezit/schoten als sfeercijfers, geschaald met rating en uitslag.
  const possessionHomeApprox = Math.round(clamp(50 + diff * 0.8, 28, 72));
  const shotsHome = Math.max(homeGoals, Math.round(8 + diff * 0.15 + rng.range(0, 6)));
  const shotsAway = Math.max(awayGoals, Math.round(8 - diff * 0.15 + rng.range(0, 6)));

  return { homeGoals, awayGoals, possessionHomeApprox, shotsHome, shotsAway };
}

/** Compacte container voor team-rating-lookups bij het simuleren van een ronde. */
export type RatingLookup = (teamId: UUID) => number;
