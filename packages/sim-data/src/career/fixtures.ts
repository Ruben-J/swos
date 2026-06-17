/**
 * Speelschema-generatie: dubbel round-robin (iedereen thuis én uit tegen
 * iedereen) via de circle-methode. Deterministisch bij gelijke teamvolgorde.
 */

export interface FixturePairing {
  round: number;
  homeId: string;
  awayId: string;
}

/**
 * Genereer een dubbel-round-robin-schema voor een even aantal teams.
 * Eerste helft: enkele ronde (circle-methode). Tweede helft: omgekeerde
 * thuis/uit van dezelfde paringen. Een oneven aantal krijgt een "bye" (wordt
 * genegeerd) — geef bij voorkeur een even aantal teams.
 */
export function buildDoubleRoundRobin(teamIds: string[]): FixturePairing[] {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("__BYE__");
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;

  const fixtures: FixturePairing[] = [];
  // Circle-methode: team 0 vast, de rest roteert.
  const rotation = [...ids];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = rotation[i]!;
      const b = rotation[n - 1 - i]!;
      if (a === "__BYE__" || b === "__BYE__") continue;
      // Wissel thuis/uit af per ronde zodat het redelijk gebalanceerd is.
      const homeFirst = (r + i) % 2 === 0;
      fixtures.push({
        round: r + 1,
        homeId: homeFirst ? a : b,
        awayId: homeFirst ? b : a,
      });
    }
    // Roteer (eerste element vast).
    rotation.splice(1, 0, rotation.pop()!);
  }

  // Tweede seizoenshelft: zelfde paringen, thuis/uit omgedraaid.
  const firstHalf = fixtures.length;
  for (let i = 0; i < firstHalf; i++) {
    const f = fixtures[i]!;
    fixtures.push({ round: f.round + rounds, homeId: f.awayId, awayId: f.homeId });
  }

  return fixtures;
}

/** Aantal speelronden voor n teams (dubbel round-robin). */
export function totalRounds(teamCount: number): number {
  const n = teamCount % 2 === 0 ? teamCount : teamCount + 1;
  return (n - 1) * 2;
}
