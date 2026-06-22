import {
  Rng,
  clamp,
  type CareerSave,
  type Match,
  type Player,
  type Position,
  type StandingRow,
  type Team,
  type UUID,
} from "@pitch/shared";
import { FORMATIONS } from "@pitch/engine";
import {
  pickBestEleven,
  playerOverall,
  playerOverallExact,
  positionFit,
  teamFormationName,
} from "../world/squad.js";
import { quickSimulate, type QuickTilt } from "./quicksim.js";
import { computeStandings } from "./standings.js";
import { processMatchdayEvents } from "./events.js";
import { processKnockouts } from "./knockout.js";
import { processTraining } from "./training.js";
import { processAiTransfers } from "./aitransfers.js";
import { transferWindowOpen } from "./transfers.js";
import { applyMatchdayFinances } from "./finances.js";

/** Bereken team-ratings (0..100) uit de spelers in de save. */
export function buildRatings(save: CareerSave): Map<UUID, number> {
  const byTeam = new Map<UUID, number[]>();
  for (const p of save.worldState.players) {
    if (!p.teamId) continue;
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(playerOverall(p));
    byTeam.set(p.teamId, arr);
  }
  const ratings = new Map<UUID, number>();
  for (const [teamId, overalls] of byTeam) {
    overalls.sort((a, b) => b - a);
    const xi = overalls.slice(0, 11);
    ratings.set(teamId, Math.round(xi.reduce((s, v) => s + v, 0) / Math.max(1, xi.length)));
  }
  // De eigen club telt niet als "beste 11" maar als de werkelijk gekozen
  // opstelling: spelers uit positie, lage conditie/vorm of een geblesseerde in de
  // basis verlagen de effectieve rating. Zo straft een slechte keuze ook af.
  const myId = save.manager.currentTeamId;
  if (byTeam.has(myId)) {
    ratings.set(myId, Math.round(lineupRating(save, myId)));
  }
  return ratings;
}

/** Match-gereedheid van een speler (0.5..~1.1) uit conditie, scherpte en vorm. */
function readiness(p: Player): number {
  const s = p.status;
  if (s.injury || s.suspensionMatchesRemaining > 0) return 0.55; // hoort eigenlijk niet te spelen
  const fit = 0.7 + 0.3 * clamp(s.fitness / 100, 0, 1); // 0.7..1.0
  const shp = 0.92 + 0.08 * clamp(s.sharpness / 100, 0, 1);
  const frm = 0.9 + 0.2 * clamp(s.form / 100, 0, 1); // vorm ~55 => ~1.0
  return fit * shp * frm;
}

/** Verlies aan effectiviteit als een speler buiten zijn positie staat. */
function posFactor(p: Player, slot: Position): number {
  const fit = positionFit(p, slot); // 0 exact, 1 zelfde linie, 2 verkeerde linie
  return fit === 0 ? 1 : fit === 1 ? 0.9 : 0.78;
}

/**
 * Bepaal de basiself + bijbehorende slots van een club. Voor de eigen club de
 * door de manager gekozen opstelling (indien geldig), anders de automatische
 * beste elf in de vaste clubformatie.
 */
function lineupPairs(
  save: CareerSave,
  teamId: UUID,
  squad: Player[],
  mine: boolean,
): { player: Player; slot: Position }[] {
  const tac = mine ? save.manager.tactics : undefined;
  const formationName = tac?.formation || teamFormationName(teamId);
  const slots = (FORMATIONS[formationName] ?? FORMATIONS["4-4-2"]!) as Position[];
  if (tac?.lineup && tac.lineup.length === slots.length) {
    return tac.lineup
      .map((id, i) => ({ player: squad.find((p) => p.id === id), slot: slots[i]! }))
      .filter((x): x is { player: Player; slot: Position } => Boolean(x.player));
  }
  return pickBestEleven(squad, formationName);
}

/** Effectieve sterkte van een basisspeler op zijn slot. */
function effOf(player: Player, slot: Position, mine: boolean): number {
  return playerOverallExact(player) * posFactor(player, slot) * (mine ? readiness(player) : 1);
}

/**
 * Effectieve sterkte van de eigen club uit de gekozen opstelling: gemiddelde van
 * de basiself (overall × positiegeschiktheid × match-gereedheid). Gebruikt voor
 * het algemene rating-getal (board, baanaanbiedingen, penalty's).
 */
function lineupRating(save: CareerSave, teamId: UUID): number {
  const squad = save.worldState.players.filter((p) => p.teamId === teamId);
  if (squad.length === 0) return 55;
  const pairs = lineupPairs(save, teamId, squad, teamId === save.manager.currentTeamId);
  if (pairs.length === 0) return 55;
  const sum = pairs.reduce((acc, { player, slot }) => acc + effOf(player, slot, true), 0);
  return sum / pairs.length;
}

/** Aanval/verdediging per club, zodat de formatie een echte trade-off wordt. */
export interface TeamStrength {
  att: number;
  def: number;
}

// Hoeveel een speler op een slot bijdraagt aan aanval resp. verdediging (0..1).
const ATT_W: Record<Position, number> = {
  GK: 0, CB: 0.1, RB: 0.18, LB: 0.18, DM: 0.35, CM: 0.5, AM: 0.72, RW: 0.8, LW: 0.8, ST: 0.92,
};
const DEF_W: Record<Position, number> = {
  GK: 0, CB: 0.95, RB: 0.82, LB: 0.82, DM: 0.75, CM: 0.5, AM: 0.3, RW: 0.22, LW: 0.22, ST: 0.12,
};
// Vaste delers zodat een gebalanceerde 4-4-2 ~de teamsterkte oplevert; meer
// aanvallers => hogere att/lagere def, meer verdedigers => omgekeerd.
const ATT_DEN = 5.0;
const DEF_DEN = 6.5;
const GK_DEF_W = 1.3;

function teamStrength(save: CareerSave, teamId: UUID, squad: Player[], mine: boolean): TeamStrength {
  const pairs = lineupPairs(save, teamId, squad, mine);
  if (pairs.length === 0) return { att: 55, def: 55 };
  let attRaw = 0;
  let defRaw = 0;
  for (const { player, slot } of pairs) {
    const eff = effOf(player, slot, mine);
    if (slot === "GK") {
      defRaw += eff * GK_DEF_W;
      continue;
    }
    attRaw += eff * ATT_W[slot];
    defRaw += eff * DEF_W[slot];
  }
  return { att: attRaw / ATT_DEN, def: defRaw / DEF_DEN };
}

/** Aanval/verdediging-sterkte per club voor het simuleren van wedstrijden. */
export function buildTeamStrengths(save: CareerSave): Map<UUID, TeamStrength> {
  const myId = save.manager.currentTeamId;
  const byTeam = new Map<UUID, Player[]>();
  for (const p of save.worldState.players) {
    if (!p.teamId) continue;
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(p);
    byTeam.set(p.teamId, arr);
  }
  const out = new Map<UUID, TeamStrength>();
  for (const [teamId, squad] of byTeam) {
    out.set(teamId, teamStrength(save, teamId, squad, teamId === myId));
  }
  return out;
}

/** Speelstijl-tilt: hoe aanvallend/afwachtend de eigen club speelt. */
function tacticTilt(save: CareerSave, team: Team): QuickTilt {
  const tac = save.manager.tactics?.shape;
  const id = team.tacticalIdentity;
  const lineHeight = tac?.lineHeight ?? id.press;
  const press = tac?.press ?? id.press;
  const tempo = tac?.tempo ?? id.tempo;
  // Aanvalslust 0..1; aanvallend = open spel (beide ploegen scoren iets meer),
  // afwachtend = gecontroleerd (minder goals over en weer).
  const aggr = clamp((tempo + press + lineHeight) / 3, 0, 1);
  const factor = 0.9 + aggr * 0.2; // 0.9..1.1
  return { own: factor, opp: factor };
}

/** Eerstvolgende geplande wedstrijd van een team (op datum). */
export function teamNextMatch(matches: Match[], teamId: UUID): Match | null {
  let best: Match | null = null;
  for (const m of matches) {
    if (m.state !== "scheduled") continue;
    if (m.homeTeamId !== teamId && m.awayTeamId !== teamId) continue;
    if (!best || m.date < best.date) best = m;
  }
  return best;
}

/** Pas een uitslag toe op een wedstrijd (markeer gespeeld). */
export function applyResult(
  match: Match,
  homeGoals: number,
  awayGoals: number,
  meta?: Partial<Match["xArcadeMeta"]>,
): void {
  match.score = { home: homeGoals, away: awayGoals };
  match.state = "played";
  match.xArcadeMeta = {
    possessionHomeApprox: meta?.possessionHomeApprox ?? 50,
    shotsHome: meta?.shotsHome ?? homeGoals + 3,
    shotsAway: meta?.shotsAway ?? awayGoals + 3,
    motmPlayerId: meta?.motmPlayerId ?? null,
  };
}

/** Quicksim één wedstrijd uit aanval/verdediging-sterktes (met speelstijl-tilt). */
export function simulateMatch(
  rng: Rng,
  strengths: Map<UUID, TeamStrength>,
  match: Match,
  tilt?: { homeAtt?: number; awayAtt?: number },
): void {
  const h = strengths.get(match.homeTeamId) ?? { att: 55, def: 55 };
  const a = strengths.get(match.awayTeamId) ?? { att: 55, def: 55 };
  const r = quickSimulate(rng, h.att, h.def, a.att, a.def, 6, tilt);
  applyResult(match, r.homeGoals, r.awayGoals, {
    possessionHomeApprox: r.possessionHomeApprox,
    shotsHome: r.shotsHome,
    shotsAway: r.shotsAway,
  });
}

export interface PlayMatchdayOptions {
  /** De wedstrijd die de mens zelf speelt (krijgt de live-uitslag), of null. */
  liveMatchId?: UUID | null;
  liveHomeGoals?: number;
  liveAwayGoals?: number;
}

/** Werk één kalenderdatum af: alle geplande wedstrijden op `date` (alle
 *  competities), daarna knockouts, blessures, training en AI-transfers. */
function simulateDate(
  save: CareerSave,
  rng: Rng,
  date: string,
  opts: PlayMatchdayOptions,
): void {
  const strengths = buildTeamStrengths(save);
  const myId = save.manager.currentTeamId;
  const myTeam = save.worldState.teams.find((t) => t.id === myId);
  const myTilt = myTeam ? tacticTilt(save, myTeam) : null;
  for (const m of save.worldState.matches) {
    if (m.state !== "scheduled" || m.date !== date) continue;
    if (opts.liveMatchId && m.id === opts.liveMatchId) {
      applyResult(m, opts.liveHomeGoals ?? 0, opts.liveAwayGoals ?? 0);
    } else {
      // Mijn speelstijl beïnvloedt alleen mijn eigen wedstrijden.
      let tilt: { homeAtt?: number; awayAtt?: number } | undefined;
      if (myTilt && m.homeTeamId === myId) tilt = { homeAtt: myTilt.own, awayAtt: myTilt.opp };
      else if (myTilt && m.awayTeamId === myId) tilt = { homeAtt: myTilt.opp, awayAtt: myTilt.own };
      simulateMatch(rng, strengths, m, tilt);
    }
  }
  // Knockout-rondes: beslis gelijke duels (pens) en loot volgende rondes.
  processKnockouts(save, rng);
  // Blessures/schorsingen (herstel + nieuwe).
  processMatchdayEvents(save, rng, save.manager.currentTeamId);
  // Training/veroudering: hele wereld groeit/loopt terug, eigen club met focus.
  processTraining(save, rng, save.manager.currentTeamId, save.manager.trainingFocus ?? "balanced");
  // AI-clubs handelen onderling als de transferperiode open is.
  if (transferWindowOpen(save)) processAiTransfers(save, rng);
  // Boek de seizoenseconomie van de club van de speler voor deze speeldag.
  applyMatchdayFinances(save, rng, date);
}

/** Zet de seizoensdatum op de eerstvolgende nog te spelen wedstrijd. */
function advanceDate(save: CareerSave, fallback: string): void {
  const upcoming = save.worldState.matches
    .filter((m) => m.state === "scheduled")
    .map((m) => m.date)
    .sort();
  const season = save.worldState.seasons.find((s) => s.id === save.worldState.activeSeasonId);
  if (season) season.currentDate = upcoming[0] ?? fallback;
}

/**
 * Werk alle openstaande speeldagen af t/m `date` (in datumvolgorde), zodat ook
 * tussenliggende beker-/Europa-rondes waarop de eigen club niet speelt worden
 * gespeeld. De live-uitslag geldt voor de eigen wedstrijd op `date`. Muteert en
 * geeft de save terug.
 */
export function playMatchday(
  save: CareerSave,
  rng: Rng,
  date: string,
  opts: PlayMatchdayOptions = {},
): CareerSave {
  const dates = [
    ...new Set(
      save.worldState.matches
        .filter((m) => m.state === "scheduled" && m.date <= date)
        .map((m) => m.date),
    ),
  ].sort();
  // Niets vóór `date` gepland (of `date` zelf leeg): werk in elk geval `date` af.
  if (dates.length === 0) dates.push(date);
  for (const d of dates) {
    simulateDate(save, rng, d, d === date ? opts : {});
  }
  advanceDate(save, date);
  return save;
}

/**
 * Speel alle resterende wedstrijden van het seizoen uit (alle competities),
 * bijvoorbeeld als de eigen club is uitgeschakeld maar beker/Europa nog lopen.
 * Muteert en geeft de save terug.
 */
export function simulateRemaining(save: CareerSave, rng: Rng): CareerSave {
  let guard = 0;
  while (!seasonComplete(save) && guard < 400) {
    const next = save.worldState.matches
      .filter((m) => m.state === "scheduled")
      .map((m) => m.date)
      .sort()[0];
    if (!next) break;
    simulateDate(save, rng, next, {});
    guard++;
  }
  advanceDate(save, save.worldState.seasons.find((s) => s.id === save.worldState.activeSeasonId)?.currentDate ?? "");
  return save;
}

/** Stand van een divisie (afgeleid uit de wedstrijden van die competitie). */
export function divisionStandings(save: CareerSave, divisionId: UUID): StandingRow[] {
  const comp = save.worldState.competitions.find(
    (c) => c.divisionId === divisionId && c.seasonId === save.worldState.activeSeasonId,
  );
  if (!comp) return [];
  const matches = save.worldState.matches.filter((m) => m.competitionId === comp.id);
  return computeStandings(comp.teamIds, matches);
}

/** Zijn alle competitiewedstrijden van het actieve seizoen gespeeld? */
export function seasonComplete(save: CareerSave): boolean {
  return save.worldState.matches
    .filter((m) => m.seasonId === save.worldState.activeSeasonId)
    .every((m) => m.state === "played");
}
