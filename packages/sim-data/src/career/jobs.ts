import { Rng, clamp, type CareerSave, type JobOffer, type UUID } from "@pitch/shared";
import { buildRatings } from "./season.js";

/**
 * Werk de manager-reputatie (resultaatsas) bij op basis van de eindklassering
 * in de eigen divisie. Bovenin een sterke divisie eindigen tilt de reputatie op,
 * onderin een zwakke divisie laat 'm zakken. Muteert de save.
 */
export function updateManagerReputation(
  save: CareerSave,
  finalRank: number,
  divisionSize: number,
  divisionTier: number,
): void {
  const rep = save.manager.reputation;
  // Positie-score 0..1 (1 = kampioen) en niveaubonus (tier 1 telt zwaarder).
  const posScore = divisionSize > 1 ? 1 - (finalRank - 1) / (divisionSize - 1) : 0.5;
  const tierWeight = divisionTier === 1 ? 1 : divisionTier === 2 ? 0.7 : 0.5;
  // Doelreputatie waar de resultaatsas naartoe beweegt.
  const target = clamp(25 + posScore * 70 * tierWeight, 10, 95);
  rep.result = Math.round(clamp(rep.result + (target - rep.result) * 0.45, 5, 99));
}

/**
 * Genereer baanaanbiedingen voor de manager na een seizoen: clubs met een niveau
 * rond (of net boven) de huidige reputatie polsen de manager, mits aantrekkelijker
 * dan zijn huidige club. Hoogstens twee, deterministisch via de RNG.
 */
export function generateJobOffers(save: CareerSave, rng: Rng): JobOffer[] {
  const ws = save.worldState;
  const rep = save.manager.reputation.result;
  const ratings = buildRatings(save);
  const current = ws.teams.find((t) => t.id === save.manager.currentTeamId);
  if (!current) return [];
  const currentAppeal = current.reputation.domestic;

  const divTier = new Map<UUID, number>();
  for (const d of ws.divisions) divTier.set(d.id, d.tier);

  const candidates = ws.teams
    .filter((t) => t.id !== current.id)
    .filter((t) => (divTier.get(t.divisionId) ?? 3) <= 2)
    .map((t) => ({ team: t, appeal: t.reputation.domestic }))
    // Aantrekkelijker dan de huidige club, maar binnen bereik van de reputatie.
    .filter((c) => c.appeal > currentAppeal + 2 && c.appeal <= rep + 12)
    .sort((a, b) => b.appeal - a.appeal);

  const offers: JobOffer[] = [];
  for (const c of candidates) {
    if (offers.length >= 2) break;
    // Hoe dichter bij de reputatie, hoe waarschijnlijker het aanbod.
    const gap = Math.abs(c.appeal - rep);
    const chance = clamp(0.55 - gap * 0.03, 0.08, 0.55);
    if (rng.chance(chance)) {
      offers.push({
        teamId: c.team.id,
        divisionId: c.team.divisionId,
        appeal: c.appeal,
        reason:
          c.appeal >= rep
            ? "Ambitieuze club zoekt een opwaartse stap."
            : "Stabiele club wil jouw aanpak.",
      });
    }
    void ratings;
  }
  return offers;
}

/**
 * Accepteer een baanaanbod: de manager stapt over naar de nieuwe club. Wist de
 * openstaande aanbiedingen. Muteert en geeft de save terug.
 */
export function acceptJobOffer(save: CareerSave, teamId: UUID): CareerSave {
  const offer = (save.manager.pendingOffers ?? []).find((o) => o.teamId === teamId);
  if (!offer) return save;
  save.manager.currentTeamId = teamId;
  save.manager.pendingOffers = [];
  // Trainingsfocus reset naar neutraal bij een nieuwe club.
  save.manager.trainingFocus = "balanced";
  return save;
}

/** Wijs alle openstaande aanbiedingen af (blijf bij de huidige club). */
export function declineJobOffers(save: CareerSave): CareerSave {
  save.manager.pendingOffers = [];
  return save;
}
