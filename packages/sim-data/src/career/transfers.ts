import type { CareerSave, Contract, Player, UUID } from "@pitch/shared";
import { playerOverall } from "../world/squad.js";
import { parseISO } from "./dates.js";

/** Is er momenteel een transferperiode open (op de seizoensdatum)? */
export function transferWindowOpen(save: CareerSave): boolean {
  const season = save.worldState.seasons.find((s) => s.id === save.worldState.activeSeasonId);
  if (!season) return false;
  const now = parseISO(season.currentDate);
  return season.transferWindows.some(
    (w) => now >= parseISO(w.startDate) && now <= parseISO(w.endDate),
  );
}

/** Vraagprijs van een speler (op basis van geschatte waarde). */
export function askingPrice(p: Player): number {
  const base = p.market.askingPrice ?? p.market.estimatedValue;
  return Math.round(base * 1.05);
}

/** Aantal spelers in een clubselectie. */
export function squadSize(save: CareerSave, teamId: UUID): number {
  return save.worldState.players.filter((p) => p.teamId === teamId).length;
}

/**
 * Besteedbaar transferbudget. Minstens de bestuurs-toewijzing (transferBudget),
 * maar het groeit mee met het saldo: je mag je cash inzetten, minus een reserve
 * voor de lopende loonkosten (~8 speelweken). Zo loopt je slagkracht op naarmate
 * de club verdient, i.p.v. vast te blijven op de begin-toewijzing.
 */
export function effectiveTransferBudget(save: CareerSave, teamId: UUID): number {
  const team = save.worldState.teams.find((t) => t.id === teamId);
  if (!team) return 0;
  const reserve = weeklyWageBill(save, teamId) * 8;
  const fromBalance = Math.round(team.finances.balance - reserve);
  return Math.max(team.finances.transferBudget, fromBalance, 0);
}

export interface TransferCheck {
  ok: boolean;
  reason?: string;
}

const MAX_SQUAD = 26;
const MIN_SQUAD = 14;

/** Mag de manager deze speler kopen? */
export function canBuy(save: CareerSave, playerId: UUID): TransferCheck {
  const buyerId = save.manager.currentTeamId;
  const player = save.worldState.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, reason: "Speler bestaat niet" };
  if (player.teamId === buyerId) return { ok: false, reason: "Al van jouw club" };
  if (!transferWindowOpen(save)) return { ok: false, reason: "Transferperiode gesloten" };
  const price = askingPrice(player);
  if (effectiveTransferBudget(save, buyerId) < price) return { ok: false, reason: "Te duur (budget)" };
  if (squadSize(save, buyerId) >= MAX_SQUAD) return { ok: false, reason: "Selectie vol" };
  if (player.teamId && squadSize(save, player.teamId) <= MIN_SQUAD) {
    return { ok: false, reason: "Verkoper kan niet kleiner" };
  }
  return { ok: true };
}

/** Koop een speler: verplaats hem, verreken de transfersom, werk contracten bij. */
export function buyPlayer(save: CareerSave, playerId: UUID): TransferCheck {
  const check = canBuy(save, playerId);
  if (!check.ok) return check;
  const ws = save.worldState;
  const buyerId = save.manager.currentTeamId;
  const player = ws.players.find((p) => p.id === playerId)!;
  const buyer = ws.teams.find((t) => t.id === buyerId)!;
  const price = askingPrice(player);

  // Geld verrekenen.
  buyer.finances.transferBudget -= price;
  buyer.finances.balance -= price;
  if (player.teamId) {
    const seller = ws.teams.find((t) => t.id === player.teamId);
    if (seller) {
      seller.finances.transferBudget += Math.round(price * 0.9);
      seller.finances.balance += price;
    }
  }

  // Oud contract verwijderen, nieuw contract aanmaken.
  ws.contracts = ws.contracts.filter((c) => c.playerId !== playerId);
  const season = ws.seasons.find((s) => s.id === ws.activeSeasonId)!;
  const endYear = parseInt(season.label.split("/")[0] ?? "2025", 10) + 3;
  const usedNumbers = new Set(
    ws.contracts.filter((c) => c.teamId === buyerId).map((c) => c.squadNumber ?? 0),
  );
  let num = 12;
  while (usedNumbers.has(num) && num < 40) num++;
  const contract: Contract = {
    id: `c-${playerId}-${ws.contracts.length}`,
    playerId,
    teamId: buyerId,
    startDate: season.currentDate,
    endDate: `${endYear}-06-30`,
    salaryPerWeek: player.market.wageDemand,
    role: "Rotation",
    squadNumber: num,
    releaseClause: null,
    extensionOptionYears: 0,
  };
  ws.contracts.push(contract);
  player.teamId = buyerId;
  player.market.askingPrice = null;
  return { ok: true };
}

/** Verkoop/transfervrij maken van een eigen speler voor ~zijn waarde. */
export function sellPlayer(save: CareerSave, playerId: UUID): TransferCheck {
  const ws = save.worldState;
  const buyerId = save.manager.currentTeamId;
  const player = ws.players.find((p) => p.id === playerId);
  if (!player || player.teamId !== buyerId) return { ok: false, reason: "Niet van jouw club" };
  if (squadSize(save, buyerId) <= MIN_SQUAD) return { ok: false, reason: "Selectie te klein" };
  if (!transferWindowOpen(save)) return { ok: false, reason: "Transferperiode gesloten" };

  const fee = Math.round(player.market.estimatedValue * 0.9);
  const team = ws.teams.find((t) => t.id === buyerId)!;
  team.finances.transferBudget += fee;
  team.finances.balance += fee;
  ws.contracts = ws.contracts.filter((c) => c.playerId !== playerId);
  player.teamId = null; // transfervrij (verlaat de competitie-selectie)
  return { ok: true };
}

/** Wekelijkse loonsom van een club (uit de contracten). */
export function weeklyWageBill(save: CareerSave, teamId: UUID): number {
  return save.worldState.contracts
    .filter((c) => c.teamId === teamId)
    .reduce((s, c) => s + c.salaryPerWeek, 0);
}

/** Koopbare spelers (van andere clubs), gesorteerd op overall. */
export function transferTargets(save: CareerSave, opts: { position?: string; limit?: number } = {}): Player[] {
  const buyerId = save.manager.currentTeamId;
  let list = save.worldState.players.filter((p) => p.teamId && p.teamId !== buyerId);
  if (opts.position) list = list.filter((p) => p.preferredPositions[0] === opts.position);
  list.sort((a, b) => playerOverall(b) - playerOverall(a));
  return opts.limit ? list.slice(0, opts.limit) : list;
}
