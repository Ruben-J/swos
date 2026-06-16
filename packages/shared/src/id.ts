import type { Rng } from "./rng.js";
import type { UUID } from "./types.js";

const HEX = "0123456789abcdef";

/**
 * Deterministische UUID-achtige id uit een RNG. Niet RFC-4122-conform maar
 * uniek genoeg en reproduceerbaar bij gelijke seed (belangrijk voor save-diffs
 * en tests). Gebruik crypto.randomUUID alleen voor niet-deterministische ids.
 */
export function rngId(rng: Rng): UUID {
  let out = "";
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += "-";
    out += HEX[rng.int(0, 15)];
  }
  return out;
}
