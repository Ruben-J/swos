import {
  Rng,
  clamp,
  type CareerSave,
  type Player,
  type TrainingFocus,
  type UUID,
} from "@pitch/shared";
import { playerOverall, playerOverallExact } from "../world/squad.js";

/** Attribuutsleutels die door training kunnen veranderen. */
type AttrKey = keyof Player["attributes"];

/** Per focus: welke attributen extra meegroeien (multiplier per attribuut). */
const FOCUS_WEIGHTS: Record<TrainingFocus, Partial<Record<AttrKey, number>>> = {
  balanced: {},
  attack: { shooting: 1.6, finishing: 1.6, passing: 1.3, ballControl: 1.3, flair: 1.3 },
  defense: { tackling: 1.6, heading: 1.5, composure: 1.3, aggression: 1.2 },
  fitness: { stamina: 1.7, pace: 1.4, consistency: 1.2 },
  youth: {}, // youth verbreedt geen attributen maar verschuift de leeftijdscurve
};

/** Piekleeftijd waarna een speler langzaam terugloopt (keepers later). */
function peakAge(p: Player): number {
  return p.preferredPositions[0] === "GK" ? 30 : 27;
}

/**
 * Leeftijdscurve voor groei (0..1): jonge spelers groeien snel, rond de piek
 * vlakt het af, daarna negatief (verval). `youthBoost` rekt de jonge fase op.
 */
function ageCurve(age: number, peak: number, youthBoost: number): number {
  if (age <= peak) {
    // 1.0 bij heel jong -> ~0 bij de piek.
    const t = clamp((peak - age) / 10, 0, 1);
    return t * youthBoost;
  }
  // Verval voorbij de piek (sterker naarmate ouder).
  return -clamp((age - peak) / 8, 0, 1);
}

const ATTR_KEYS: AttrKey[] = [
  "pace",
  "stamina",
  "ballControl",
  "passing",
  "shooting",
  "finishing",
  "heading",
  "tackling",
  "composure",
  "aggression",
  "consistency",
  "flair",
];

/**
 * Pas één week training/veroudering toe op één speler. Groei beweegt richting
 * het verborgen potentieel en wordt geremd/versneld door leeftijd,
 * professionaliteit en (voor de eigen club) de trainingsfocus.
 */
function trainPlayer(
  rng: Rng,
  p: Player,
  focus: TrainingFocus | null,
): void {
  const a = p.attributes;
  const peak = peakAge(p);
  const youthBoost = focus === "youth" && p.ageYears <= 21 ? 1.6 : 1;
  const curve = ageCurve(p.ageYears, peak, youthBoost);
  const prof = p.hidden.professionalism / 75; // ~0.4..1.27
  const overall = playerOverall(p);

  // Hoeveel ruimte naar het potentieel toe (alleen relevant bij groei).
  const room = clamp((p.hidden.potential - overall) / 40, 0, 1);
  const weights = focus ? FOCUS_WEIGHTS[focus] : {};

  for (const key of ATTR_KEYS) {
    const cur = a[key];
    if (typeof cur !== "number") continue;
    let delta: number;
    if (curve >= 0) {
      // Groei: schaalt met ruimte, leeftijdscurve, professionaliteit, focus.
      const focusMult = weights[key] ?? (focus && focus !== "balanced" ? 0.55 : 1);
      delta = curve * room * prof * focusMult * 0.16;
      // Lichte ruis zodat niet alles uniform stijgt.
      delta *= 0.7 + rng.range(0, 0.6);
    } else {
      // Verval: fysieke attributen lopen het hardst terug.
      const physical = key === "pace" || key === "stamina";
      const mult = physical ? 1.5 : 0.7;
      delta = curve * mult * (1.3 - prof * 0.3) * 0.12;
      delta *= 0.7 + rng.range(0, 0.6);
    }
    a[key] = clamp(cur + delta, 18, 97);
  }

  // Keeperskwaliteit volgt dezelfde curve (apart, want geen veld-attribuut).
  if (typeof a.goalkeeping === "number" && p.preferredPositions[0] === "GK") {
    const focusMult = focus === "balanced" || !focus ? 1 : 0.6;
    const delta =
      curve >= 0
        ? curve * room * prof * focusMult * 0.16 * (0.7 + rng.range(0, 0.6))
        : curve * 0.7 * (1.3 - prof * 0.3) * 0.12 * (0.7 + rng.range(0, 0.6));
    a.goalkeeping = clamp(a.goalkeeping + delta, 25, 97);
  }
}

/** Herstel conditie/scherpte/vorm na een speelweek. */
function recover(rng: Rng, p: Player, fitnessFocus: boolean): void {
  const s = p.status;
  if (s.injury) {
    s.fitness = clamp(s.fitness - 2, 20, 100); // geblesseerd: zakt licht weg
    return;
  }
  const rest = fitnessFocus ? 14 : 10;
  s.fitness = clamp(s.fitness + rest + rng.range(-2, 4), 40, 100);
  s.sharpness = clamp(s.sharpness + 3 + rng.range(-2, 4), 30, 100);
  // Vorm dwaalt richting een neutrale 55 (resultaten duwen dit later bij).
  s.form = clamp(s.form + (55 - s.form) * 0.12 + rng.range(-4, 4), 20, 95);
}

/**
 * Verwerk één trainingsweek voor de hele wereld: alle spelers verouderen/groeien
 * een fractie richting hun potentieel, de eigen club krijgt de gekozen focus.
 * Recalibreert daarna marktwaarde grof op de nieuwe overall. Muteert de save.
 */
export function processTraining(
  save: CareerSave,
  rng: Rng,
  myTeamId: UUID,
  focus: TrainingFocus,
): void {
  const fitnessFocus = focus === "fitness";

  // Houd cumulatieve groei van de eigen selectie bij; reset bij een nieuw seizoen.
  const m = save.manager;
  if (m.seasonDevSeasonId !== save.worldState.activeSeasonId) {
    m.seasonDev = {};
    m.seasonDevSeasonId = save.worldState.activeSeasonId;
  }
  const dev = (m.seasonDev ??= {});

  for (const p of save.worldState.players) {
    if (!p.teamId) continue;
    const mine = p.teamId === myTeamId;
    const teamFocus = mine ? focus : null;
    const before = mine ? playerOverallExact(p) : 0;
    trainPlayer(rng, p, teamFocus);
    if (mine) {
      dev[p.id] = (dev[p.id] ?? 0) + (playerOverallExact(p) - before);
      recover(rng, p, fitnessFocus);
    }
    // Marktwaarde grof bijtrekken op de actuele overall (jong talent stijgt).
    const ov = playerOverall(p);
    const target = clamp((ov - 40) / 50, 0, 1) ** 1.8 * 70_000_000 + 50_000;
    p.market.estimatedValue = Math.round(
      p.market.estimatedValue * 0.9 + target * 0.1,
    );
  }
}

/** Ontwikkelingsrichting van een speler (prognose op leeftijd vs piek/potentieel). */
export type DevTrend = "up" | "down" | "flat";
export function developmentTrend(p: Player): DevTrend {
  const peak = peakAge(p);
  if (p.ageYears > peak + 1) return "down";
  const room = p.hidden.potential - playerOverall(p);
  if (p.ageYears <= peak && room > 2) return "up";
  return "flat";
}

export interface TrainingResult {
  player: Player;
  ovr: number;
  /** Afgeronde overall-groei dit seizoen (kan negatief zijn bij verval). */
  delta: number;
  trend: DevTrend;
}

/** Trainingsresultaten van de eigen selectie: groei dit seizoen + prognose. */
export function trainingResults(save: CareerSave): TrainingResult[] {
  const myId = save.manager.currentTeamId;
  const dev =
    save.manager.seasonDevSeasonId === save.worldState.activeSeasonId
      ? save.manager.seasonDev ?? {}
      : {};
  return save.worldState.players
    .filter((p) => p.teamId === myId)
    .map((p) => ({
      player: p,
      ovr: playerOverall(p),
      delta: Math.round(dev[p.id] ?? 0),
      trend: developmentTrend(p),
    }))
    .sort((a, b) => b.delta - a.delta || b.ovr - a.ovr);
}
