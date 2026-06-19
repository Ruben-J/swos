import {
  Rng,
  type CareerSave,
  type Contract,
  type Player,
  type Position,
  type UUID,
} from "@pitch/shared";
import { playerOverall } from "../world/squad.js";
import { askingPrice } from "./transfers.js";

const MAX_SQUAD = 26;
const MIN_SQUAD = 14;
/** Hoeveel transfers de AI-wereld maximaal per speeldag afhandelt. */
const MAX_TRANSFERS_PER_DAY = 5;
/** Hoeveel kopende clubs we per speeldag bekijken. */
const BUYERS_PER_DAY = 14;

/** Grove positiegroep voor het zoeken naar een vervanger op dezelfde plek. */
function posGroup(pos: Position): "GK" | "DEF" | "MID" | "ATT" {
  if (pos === "GK") return "GK";
  if (pos === "RB" || pos === "LB" || pos === "CB") return "DEF";
  if (pos === "RW" || pos === "LW" || pos === "ST") return "ATT";
  return "MID";
}

function squadCount(players: Player[], teamId: UUID): number {
  return players.filter((p) => p.teamId === teamId).length;
}

/**
 * Voer een transfer uit tussen twee AI-clubs (verplaats speler, verreken geld,
 * vervang het contract). Geen checks meer: de beller heeft die al gedaan.
 */
function executeTransfer(
  save: CareerSave,
  player: Player,
  toTeamId: UUID,
  fee: number,
): void {
  const ws = save.worldState;
  const buyer = ws.teams.find((t) => t.id === toTeamId)!;
  const seller = player.teamId ? ws.teams.find((t) => t.id === player.teamId) : null;

  buyer.finances.transferBudget -= fee;
  buyer.finances.balance -= fee;
  if (seller) {
    seller.finances.transferBudget += Math.round(fee * 0.9);
    seller.finances.balance += fee;
  }

  ws.contracts = ws.contracts.filter((c) => c.playerId !== player.id);
  const season = ws.seasons.find((s) => s.id === ws.activeSeasonId)!;
  const endYear = parseInt(season.label.split("/")[0] ?? "2025", 10) + 3;
  const used = new Set(
    ws.contracts.filter((c) => c.teamId === toTeamId).map((c) => c.squadNumber ?? 0),
  );
  let num = 12;
  while (used.has(num) && num < 40) num++;
  const contract: Contract = {
    id: `c-${player.id}-${ws.contracts.length}`,
    playerId: player.id,
    teamId: toTeamId,
    startDate: season.currentDate,
    endDate: `${endYear}-06-30`,
    salaryPerWeek: player.market.wageDemand,
    role: "Rotation",
    squadNumber: num,
    releaseClause: null,
    extensionOptionYears: 0,
  };
  ws.contracts.push(contract);
  player.teamId = toTeamId;
  player.market.askingPrice = null;
}

/**
 * Laat de AI-clubs onderling handelen tijdens een open transferperiode. Elke
 * bekeken koper zoekt een betaalbare versterking op zijn zwakste positiegroep en
 * koopt die van een club die de speler kan missen. De eigen club blijft buiten
 * schot (de mens beslist zelf). Muteert de save; geeft het aantal transfers terug.
 */
export function processAiTransfers(save: CareerSave, rng: Rng): number {
  const ws = save.worldState;
  const myTeamId = save.manager.currentTeamId;

  // Kandidaat-kopers: AI-clubs met budget en ruimte in de selectie.
  const buyers = ws.teams.filter(
    (t) =>
      t.id !== myTeamId &&
      t.finances.transferBudget > 1_000_000 &&
      squadCount(ws.players, t.id) < MAX_SQUAD,
  );
  rng.shuffle(buyers);

  let done = 0;
  for (const buyer of buyers.slice(0, BUYERS_PER_DAY)) {
    if (done >= MAX_TRANSFERS_PER_DAY) break;

    const squad = ws.players.filter((p) => p.teamId === buyer.id);
    if (squad.length >= MAX_SQUAD) continue;

    // Zwakste positiegroep: laagste beste-overall over de vier groepen.
    const groups: Record<string, Player[]> = { GK: [], DEF: [], MID: [], ATT: [] };
    for (const p of squad) groups[posGroup(p.preferredPositions[0] ?? "CM")]!.push(p);
    let weakest: Player | null = null;
    let weakestOverall = Infinity;
    for (const g of Object.values(groups)) {
      if (g.length === 0) continue;
      const best = Math.max(...g.map(playerOverall));
      if (best < weakestOverall) {
        weakestOverall = best;
        weakest = g.sort((a, b) => playerOverall(a) - playerOverall(b))[0]!;
      }
    }
    if (!weakest) continue;
    const wantGroup = posGroup(weakest.preferredPositions[0] ?? "CM");

    // Zoek een betere, betaalbare speler bij een club die hem kan missen.
    let bestTarget: Player | null = null;
    let bestPrice = 0;
    for (const p of ws.players) {
      if (!p.teamId || p.teamId === buyer.id || p.teamId === myTeamId) continue;
      if (posGroup(p.preferredPositions[0] ?? "CM") !== wantGroup) continue;
      if (playerOverall(p) <= weakestOverall + 2) continue; // duidelijke upgrade
      if (squadCount(ws.players, p.teamId) <= MIN_SQUAD) continue;
      const price = askingPrice(p);
      if (price > buyer.finances.transferBudget) continue;
      // Voorkeur voor de beste haalbare upgrade.
      if (!bestTarget || playerOverall(p) > playerOverall(bestTarget)) {
        bestTarget = p;
        bestPrice = price;
      }
    }

    if (bestTarget && rng.chance(0.7)) {
      executeTransfer(save, bestTarget, buyer.id, bestPrice);
      done++;
    }
  }
  return done;
}
