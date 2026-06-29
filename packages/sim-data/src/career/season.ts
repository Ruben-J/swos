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
import { bookRed, bookYellow, processMatchdayEvents, type MatchCardResult } from "./events.js";
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

// Positie-gewichten: wie maakt de goals (spitsen/vleugels), wie geeft de assists.
const POS_SCORE_WEIGHT: Record<Position, number> = {
  GK: 0.01, RB: 0.25, LB: 0.25, CB: 0.4, DM: 0.55, CM: 0.95, AM: 1.6, RW: 1.7, LW: 1.7, ST: 2.7,
};
const POS_ASSIST_WEIGHT: Record<Position, number> = {
  GK: 0.02, RB: 0.7, LB: 0.7, CB: 0.35, DM: 0.85, CM: 1.45, AM: 1.9, RW: 1.8, LW: 1.8, ST: 1.0,
};

function posWeight(p: Player, table: Record<Position, number>): number {
  return table[p.preferredPositions[0] ?? "CM"];
}

/** Gewogen keuze uit een niet-lege lijst (deterministisch via de Rng). */
function pickWeighted(rng: Rng, items: Player[], weight: (p: Player) => number): Player | null {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return items[0] ?? null;
  let r = rng.next() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1] ?? null;
}

/**
 * Ken de doelpunten van een gespeelde wedstrijd toe aan spelers, zodat er een
 * topscorers-/assistlijst per seizoen ontstaat. Goedkoop: een paar gewogen
 * trekkingen per goal (op finishing/positie), met ~65% kans op een assist van
 * een teamgenoot. Voor de live gespeelde wedstrijd worden de ECHTE makers
 * (`real`) gebruikt i.p.v. een gewogen trekking; assists blijven statistisch
 * (de engine houdt geen assists bij). Eigen doelpunten zitten niet in `real`.
 */
function attributeScorers(
  rng: Rng,
  save: CareerSave,
  match: Match,
  real?: { home: UUID[]; away: UUID[] },
): void {
  const players = save.worldState.players;
  const scorers: UUID[] = [];
  const assists: UUID[] = [];
  const addAssist = (squad: Player[], scorerId: UUID): void => {
    if (!rng.chance(0.65)) return;
    const mates = squad.filter((p) => p.id !== scorerId);
    const assister = pickWeighted(
      rng,
      mates,
      (p) => posWeight(p, POS_ASSIST_WEIGHT) * (0.5 + (p.attributes.passing + p.attributes.flair) / 200),
    );
    if (assister) assists.push(assister.id);
  };
  const attribute = (teamId: UUID, goals: number, realIds?: UUID[]): void => {
    const squad = players.filter((p) => p.teamId === teamId);
    if (squad.length === 0) return;
    if (realIds) {
      // Echte makers uit de gespeelde wedstrijd (eigen doelpunten zitten er niet
      // in, dus mogelijk minder dan `goals` — die blijven dan zonder maker).
      for (const id of realIds) {
        if (!squad.some((p) => p.id === id)) continue;
        scorers.push(id);
        addAssist(squad, id);
      }
      return;
    }
    for (let g = 0; g < goals; g++) {
      const scorer = pickWeighted(
        rng,
        squad,
        (p) => posWeight(p, POS_SCORE_WEIGHT) * (0.5 + (p.attributes.finishing + p.attributes.shooting) / 200),
      );
      if (!scorer) continue;
      scorers.push(scorer.id);
      addAssist(squad, scorer.id);
    }
  };
  attribute(match.homeTeamId, match.score.home, real?.home);
  attribute(match.awayTeamId, match.score.away, real?.away);
  match.goalScorers = scorers;
  match.goalAssists = assists;
}

// Wie pakt een kaart: verdedigers/controleurs vaker dan aanvallers.
const POS_FOUL_WEIGHT: Record<Position, number> = {
  GK: 0.1, CB: 1.5, RB: 1.2, LB: 1.2, DM: 1.6, CM: 1.0, AM: 0.7, RW: 0.6, LW: 0.6, ST: 0.7,
};

/** Kaart-aanleg van een speler: agressie + positie (verdedigend = vaker). */
function foulWeight(p: Player): number {
  const aggro = 0.5 + (p.attributes.aggression ?? 50) / 100; // 0.5..1.5
  return posWeight(p, POS_FOUL_WEIGHT) * aggro;
}

/**
 * Genereer kaarten voor een gesimuleerde (niet live gespeelde) ploeg en boek de
 * gevolgen (gele accumulatie -> schorsing, rood -> schorsing). `played` zijn de
 * spelers die daadwerkelijk meededen (fit en niet geschorst). Goedkoop: een paar
 * gewogen trekkingen per wedstrijd.
 */
function generateQuickSimCards(rng: Rng, played: Player[]): void {
  if (played.length === 0) return;
  // Aantal gele kaarten deze wedstrijd (~1.5 gemiddeld).
  const nY = rng.chance(0.15) ? 3 : rng.chance(0.4) ? 2 : rng.chance(0.7) ? 1 : 0;
  for (let i = 0; i < nY; i++) {
    const p = pickWeighted(rng, played, foulWeight);
    if (p) bookYellow(p);
  }
  // Zeldzame directe rode kaart.
  if (rng.chance(0.03)) {
    const p = pickWeighted(rng, played, foulWeight);
    if (p) bookRed(p);
  }
}

/**
 * Tucht rond één gespeelde wedstrijd: tel lopende schorsingen van beide ploegen
 * af (zij zaten deze wedstrijd uit), boek daarna de nieuwe kaarten. Voor de live
 * gespeelde wedstrijd komen de kaarten uit de engine (`liveCards`); voor
 * gesimuleerde wedstrijden worden ze statistisch gegenereerd. Muteert de save.
 */
export function processMatchDiscipline(
  rng: Rng,
  save: CareerSave,
  match: Match,
  liveCards?: MatchCardResult[],
): void {
  const players = save.worldState.players;
  const teamIds = [match.homeTeamId, match.awayTeamId];
  // Wie deed mee (vóór het aftellen): fit en niet geschorst.
  const playedByTeam = teamIds.map((id) =>
    players.filter(
      (p) => p.teamId === id && p.status.injury === null && p.status.suspensionMatchesRemaining === 0,
    ),
  );
  // Schorsingen aftellen: de wedstrijd is uitgezeten.
  for (const id of teamIds) {
    for (const p of players) {
      if (p.teamId === id && p.status.suspensionMatchesRemaining > 0) {
        p.status.suspensionMatchesRemaining -= 1;
      }
    }
  }
  // Nieuwe kaarten boeken.
  if (liveCards) {
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const c of liveCards) {
      const p = byId.get(c.playerId);
      if (!p) continue;
      if (c.type === "yellow") bookYellow(p);
      else bookRed(p);
    }
  } else {
    for (const played of playedByTeam) generateQuickSimCards(rng, played);
  }
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
  /** Kaarten uit de live gespeelde wedstrijd (beide ploegen), voor schorsingen. */
  liveCards?: MatchCardResult[];
  /** Echte doelpuntenmakers (speler-id's) van de live wedstrijd, per ploeg. */
  liveScorers?: { home: UUID[]; away: UUID[] };
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
    // Doelpuntenmakers/assists toekennen voor de topscorerslijst. Voor de live
    // gespeelde wedstrijd de ECHTE makers gebruiken (anders statistisch).
    const isLive = opts.liveMatchId != null && m.id === opts.liveMatchId;
    attributeScorers(rng, save, m, isLive ? opts.liveScorers : undefined);
    // Tucht: schorsingen aftellen + nieuwe kaarten (live uit de engine, anders
    // statistisch). De live wedstrijd levert kaarten voor beide ploegen.
    processMatchDiscipline(rng, save, m, isLive ? (opts.liveCards ?? []) : undefined);
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
