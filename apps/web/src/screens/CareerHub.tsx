import { useMemo, useState, type DragEvent } from "react";
import { Rng, hashSeed, type CareerSave, type Match, type Player, type TrainingFocus, type UUID } from "@pitch/shared";
import { FORMATIONS } from "@pitch/engine";
import {
  askingPrice,
  buyPlayer,
  canBuy,
  divisionStandings,
  effectiveTransferBudget,
  formatShort,
  acceptJobOffer,
  computeStandings,
  declineJobOffers,
  knockoutChampion,
  myYouthProspects,
  pickBestEleven,
  playMatchday,
  playerOverall,
  potentialStars,
  simulateRemaining,
  seasonComplete,
  seasonObjective,
  sellPlayer,
  squadSize,
  statusLabel,
  teamFormationName,
  teamNextMatch,
  trainingResults,
  transferTargets,
  transferWindowOpen,
  weeklyWageBill,
} from "@pitch/sim-data";
import { ClubCrest, ClubLabel } from "../components/ClubCrest";

const TRAINING_OPTS: { id: TrainingFocus; label: string; hint: string; detail: string }[] = [
  {
    id: "balanced",
    label: "Gebalanceerd",
    hint: "Gelijkmatige groei over alle attributen",
    detail: "Alle eigenschappen groeien gelijkmatig. Veilige keuze zonder zwakke plekken.",
  },
  {
    id: "attack",
    label: "Aanval",
    hint: "Schot, afronding, techniek en passing",
    detail: "Versnelt schot, afwerking, passing, balcontrole en flair. Andere eigenschappen groeien trager.",
  },
  {
    id: "defense",
    label: "Verdediging",
    hint: "Tackelen, koppen, rust aan de bal",
    detail: "Versnelt tackelen, koppen, beheersing en agressie. Andere eigenschappen groeien trager.",
  },
  {
    id: "fitness",
    label: "Fysiek",
    hint: "Conditie en snelheid + sneller herstel",
    detail: "Versnelt conditie en snelheid en geeft elke week extra conditieherstel. Goed tegen een drukke kalender.",
  },
  {
    id: "youth",
    label: "Jeugd",
    hint: "Extra groei voor spelers t/m 21 jaar",
    detail: "Talenten t/m 21 jaar groeien duidelijk sneller richting hun potentieel; routiniers profiteren minder.",
  },
];

type TabKey =
  | "overzicht"
  | "selectie"
  | "tactiek"
  | "training"
  | "jeugd"
  | "kalender"
  | "transfers"
  | "competities"
  | "financien";

// Verticale icoon-navigatie (SVG-paden, stroke = currentColor).
function NavIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

const NAV: { key: TabKey; label: string; icon: string }[] = [
  { key: "overzicht", label: "Hub", icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>' },
  {
    key: "selectie",
    label: "Selectie",
    icon: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3 3 0 0 1 0 5.6"/><path d="M17.5 14.4A5.5 5.5 0 0 1 20.5 19.5"/>',
  },
  { key: "tactiek", label: "Tactiek", icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 12h16"/><circle cx="12" cy="12" r="2.4"/>' },
  {
    key: "training",
    label: "Training",
    icon: '<path d="M6.5 6.5l11 11"/><rect x="2.5" y="8.5" width="4" height="7" rx="1" transform="rotate(-45 4.5 12)"/><rect x="17.5" y="8.5" width="4" height="7" rx="1" transform="rotate(-45 19.5 12)"/>',
  },
  { key: "jeugd", label: "Jeugd", icon: '<path d="M12 3l2.5 5.5 6 .6-4.5 4 1.3 5.9L12 21l-5.3 3 1.3-5.9-4.5-4 6-.6z"/>' },
  { key: "kalender", label: "Kalender", icon: '<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9h17M8 3v3M16 3v3"/>' },
  { key: "transfers", label: "Transfers", icon: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>' },
  {
    key: "competities",
    label: "Comp.",
    icon: '<path d="M7 4h10v3a5 5 0 0 1-10 0z"/><path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3M9.5 15h5l.7 4h-6.4z"/>',
  },
  {
    key: "financien",
    label: "Geld",
    icon: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  },
];
const SAVE_ICON = '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>';

// Initialen uit een naam ("J. de Vries" -> "JV").
function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "M"
  );
}

// Eén ploeg in het VS-blok van de wedstrijdkaart: clubembleem + naam + stand.
function TeamBlock({
  save,
  teamId,
  myTeamId,
  standRow,
  away,
}: {
  save: CareerSave;
  teamId: UUID;
  myTeamId: UUID;
  standRow: (id: UUID) => { rank: number; points: number } | undefined;
  away?: boolean;
}) {
  const team = save.worldState.teams.find((t) => t.id === teamId)!;
  const row = standRow(teamId);
  const sub = row ? `${row.rank}e · ${row.points} ptn` : "—";
  const mine = teamId === myTeamId;
  const crest = (
    <div className="ch-crest">
      <ClubCrest name={team.name} primary={team.colors.primary} secondary={team.colors.secondary} size={40} />
    </div>
  );
  const text = (
    <div style={{ minWidth: 0 }}>
      <div className="ch-vsname" style={mine ? { color: "#f4f6ef" } : undefined}>
        {team.name}
      </div>
      <div className="ch-vssub">{sub}</div>
    </div>
  );
  return (
    <div className={`ch-vsteam${away ? " away" : ""}`}>
      {away ? text : crest}
      {away ? crest : text}
    </div>
  );
}

// Plaats de basiself op een verticaal mini-veld (100×140) op basis van de
// FORMATIE: GK onderaan, aanval bovenaan. Per linie sorteren we op vleugel
// (RB/RW rechts, LB/LW links) zodat een 4-4-2 er echt als 4-4-2 uitziet.
function pitchSpots(
  formationName: string,
  lineup: UUID[],
  slots: string[],
): { id: UUID; x: number; y: number }[] {
  const segs = formationName.split("-").map((n) => parseInt(n, 10)).filter((n) => n > 0);
  const lineSizes = [1, ...(segs.length ? segs : [4, 4, 2])];
  const nLines = lineSizes.length;
  const yAt = (line: number): number => 122 - (line / (nLines - 1)) * 96;
  const xHint = (pos: string): number =>
    pos === "RB" || pos === "RW" ? 1 : pos === "LB" || pos === "LW" ? -1 : 0;
  const out: { id: UUID; x: number; y: number }[] = [];
  let idx = 0;
  lineSizes.forEach((size, line) => {
    const group: { id: UUID; slot: string }[] = [];
    for (let k = 0; k < size && idx < lineup.length; k++, idx++) {
      group.push({ id: lineup[idx]!, slot: slots[idx] ?? "CM" });
    }
    group.sort((a, b) => xHint(a.slot) - xHint(b.slot));
    const n = group.length;
    const spacing = n > 1 ? Math.min(20, 64 / (n - 1)) : 0;
    group.forEach((g, i) => {
      out.push({ id: g.id, x: 50 + (i - (n - 1) / 2) * spacing, y: yAt(line) });
    });
  });
  return out;
}

// Disckleur per linie, in lijn met het ontwerp.
function posMark(pos: string): string {
  if (pos === "GK") return "#ffd23e";
  if (pos === "RB" || pos === "LB" || pos === "CB") return "#5b9bd6";
  if (pos === "DM" || pos === "CM" || pos === "AM") return "#b6ff3a";
  return "#ff7a5b";
}

interface Props {
  save: CareerSave;
  onUpdate: (save: CareerSave) => void;
  onPlayMatch: (match: Match) => void;
  onNextSeason: () => void;
  onExit: () => void;
}

export function CareerHub({ save, onUpdate, onPlayMatch, onNextSeason, onExit }: Props) {
  const ws = save.worldState;
  const myTeamId = save.manager.currentTeamId;
  const myTeam = ws.teams.find((t) => t.id === myTeamId)!;
  const myDivision = ws.divisions.find((d) => d.id === myTeam.divisionId)!;
  const season = ws.seasons.find((s) => s.id === ws.activeSeasonId)!;

  const [tab, setTab] = useState<TabKey>("overzicht");

  const compName = (id: UUID): string => ws.competitions.find((c) => c.id === id)?.name ?? "";
  const nextMatch = useMemo(() => teamNextMatch(ws.matches, myTeamId), [ws.matches, myTeamId]);
  const standings = useMemo(() => divisionStandings(save, myTeam.divisionId), [save, myTeam.divisionId]);
  const done = useMemo(() => seasonComplete(save), [save]);
  const objective = useMemo(() => seasonObjective(save, myTeamId), [save, myTeamId]);

  const squad = useMemo(() => {
    const order: Record<string, number> = { GK: 0, RB: 1, CB: 2, LB: 3, DM: 4, CM: 5, AM: 6, RW: 7, LW: 8, ST: 9 };
    return ws.players
      .filter((p) => p.teamId === myTeamId)
      .map((p) => ({ p, ovr: playerOverall(p) }))
      .sort((a, b) => (order[a.p.preferredPositions[0] ?? "CM"]! - order[b.p.preferredPositions[0] ?? "CM"]!) || b.ovr - a.ovr);
  }, [ws.players, myTeamId]);

  const teamName = (id: UUID): string => ws.teams.find((t) => t.id === id)?.name ?? "?";

  const myResults = useMemo(
    () =>
      ws.matches
        .filter((m) => m.state === "played" && (m.homeTeamId === myTeamId || m.awayTeamId === myTeamId))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6)
        .reverse(),
    [ws.matches, myTeamId],
  );

  // Simuleer de hele speeldag inclusief de eigen wedstrijd (quicksim).
  const simulate = () => {
    if (!nextMatch) return;
    const rng = new Rng(hashSeed(`${save.id}:${nextMatch.date}`));
    const updated = playMatchday(structuredClone(save), rng, nextMatch.date, {});
    onUpdate(updated);
  };

  // Geen eigen wedstrijd meer, maar beker/Europa loopt nog: speel de rest uit.
  const simulateRest = () => {
    const rng = new Rng(hashSeed(`${save.id}:rest:${season.currentDate}`));
    onUpdate(simulateRemaining(structuredClone(save), rng));
  };

  const focus: TrainingFocus = save.manager.trainingFocus ?? "balanced";
  const setFocus = (f: TrainingFocus) => {
    const s = structuredClone(save);
    s.manager.trainingFocus = f;
    onUpdate(s);
  };

  const offers = save.manager.pendingOffers ?? [];
  const acceptOffer = (teamId: UUID) => onUpdate(acceptJobOffer(structuredClone(save), teamId));
  const declineOffers = () => onUpdate(declineJobOffers(structuredClone(save)));

  const promoCut = myDivision.tier > 1 ? myDivision.promotionSlots : 0;
  const relCut = myDivision.relegationSlots;

  const mgrIni = initials(save.manager.name);
  const standRow = (id: UUID) => standings.find((r) => r.teamId === id);
  const homeStadium = (nextMatch && ws.teams.find((t) => t.id === nextMatch.homeTeamId)?.stadium) || {
    name: "—",
    capacity: 0,
  };

  return (
    <div className="career-hub">
      <aside className="ch-nav">
        <div className="ch-nav-logo">
          <ClubCrest name={myTeam.name} primary={myTeam.colors.primary} secondary={myTeam.colors.secondary} size={44} />
        </div>
        <div className="ch-nav-items">
          {NAV.map((item) => (
            <button
              key={item.key}
              className={`ch-navbtn${tab === item.key ? " sel" : ""}`}
              onClick={() => setTab(item.key)}
              title={item.label}
            >
              <NavIcon d={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button className="ch-nav-save" onClick={onExit} title="Opslaan & terug">
          <NavIcon d={SAVE_ICON} />
          <span>Opslaan</span>
        </button>
      </aside>

      <div className="ch-main">
        <header className="ch-head">
          <div className="ch-club">
            <span className="ch-chip" style={{ background: myTeam.colors.primary }} />
            <div>
              <div className="ch-sub">
                {myDivision.name} · {myDivision.countryName} · seizoen {season.label}
              </div>
              <div className="ch-club-name">{myTeam.name}</div>
            </div>
          </div>
          <div className="ch-right">
            {nextMatch && (
              <div className="ch-matchday">
                <span className="dot" />
                <span>Matchday · {formatShort(nextMatch.date)}</span>
              </div>
            )}
            <div className="ch-date">{formatShort(season.currentDate)}</div>
            <div className="ch-manager">
              <span className="ch-mgr-ini">{mgrIni}</span>
              <div>
                <div className="ch-mgr-name">{save.manager.name}</div>
                <div className="ch-mgr-role">Manager</div>
              </div>
            </div>
          </div>
        </header>

      {tab === "selectie" && (
        <div className="ch-body">
          <section className="ch-panel ch-squad">
            <h2>Selectie — {myTeam.name}</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="ch-tn">Naam</th>
                  <th>Pos</th>
                  <th>Lft</th>
                  <th title="Beschikbaarheid">St</th>
                  {ATTR_COLS.map((c) => (
                    <th key={c.key} title={c.full}>
                      {c.label}
                    </th>
                  ))}
                  <th>OVR</th>
                </tr>
              </thead>
              <tbody>
                {squad.map(({ p, ovr }, i) => (
                  <SquadRow key={p.id} p={p} ovr={ovr} num={i + 1} />
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "tactiek" && <TacticsView save={save} onUpdate={onUpdate} />}

      {tab === "training" && <TrainingView save={save} focus={focus} setFocus={setFocus} />}

      {tab === "jeugd" && <YouthView save={save} />}

      {tab === "kalender" && <CalendarView save={save} />}

      {tab === "competities" && <CompetitionsView save={save} />}

      {tab === "transfers" && <TransfersView save={save} onUpdate={onUpdate} />}
      {tab === "financien" && <FinancesView save={save} />}

      <div className="ch-body ch-overview" style={tab !== "overzicht" ? { display: "none" } : undefined}>
        <div className="ch-ov-left">
          {offers.length > 0 && (
            <div className="ch-offers">
              <span className="ch-offers-title">📨 Baanaanbiedingen</span>
              {offers.map((o) => (
                <div key={o.teamId} className="ch-offer">
                  <div className="ch-offer-club">
                    <strong>{teamName(o.teamId)}</strong>
                    <span className="ch-offer-reason">{o.reason}</span>
                  </div>
                  <button className="btn primary sm" onClick={() => acceptOffer(o.teamId)}>
                    Tekenen
                  </button>
                </div>
              ))}
              <button className="ch-offer-decline" onClick={declineOffers}>
                Aanbiedingen afslaan — blijf bij {myTeam.name}
              </button>
            </div>
          )}

          {nextMatch ? (
            <div className="ch-next-card">
              <div className="ch-next-top">
                <span>Volgende wedstrijd · {compName(nextMatch.competitionId)}</span>
                <span className="muted">
                  {nextMatch.roundLabel} · {nextMatch.homeTeamId === myTeamId ? "thuis" : "uit"}
                </span>
              </div>
              <div className="ch-vsrow">
                <TeamBlock save={save} teamId={nextMatch.homeTeamId} myTeamId={myTeamId} standRow={standRow} />
                <span className="ch-vsx">VS</span>
                <TeamBlock save={save} teamId={nextMatch.awayTeamId} myTeamId={myTeamId} standRow={standRow} away />
              </div>
              <div className="ch-led">
                <span className="ch-led-seg blink">{formatShort(nextMatch.date).toUpperCase()}</span>
                <span className="ch-led-div" />
                <span className="ch-led-seg dim">{homeStadium.name.toUpperCase()}</span>
              </div>
              <div className="ch-actions">
                <button className="btn primary" onClick={() => onPlayMatch(nextMatch)}>
                  ▶ Speel wedstrijd
                </button>
                <button className="btn" onClick={simulate}>
                  Simuleer
                </button>
              </div>
            </div>
          ) : done ? (
            <div className="ch-panel ch-season-end">
              <div className="ch-done">
                Seizoen afgelopen — kampioen <strong>{teamName(standings[0]?.teamId ?? "")}</strong>.
              </div>
              <div className="ch-myrank">
                {myTeam.name} eindigde als{" "}
                <strong>{standings.find((r) => r.teamId === myTeamId)?.rank ?? "?"}e</strong> in{" "}
                {myDivision.name}.
              </div>
              <button className="btn primary" onClick={onNextSeason}>
                Volgend seizoen
              </button>
            </div>
          ) : (
            <div className="ch-panel ch-season-end">
              <div className="ch-done">Geen eigen wedstrijd meer, maar er lopen nog toernooien.</div>
              <button className="btn primary" onClick={simulateRest}>
                Speel resterende wedstrijden
              </button>
            </div>
          )}

          <div className="ch-ov-cols">
            <section className="ch-panel ch-sub">
              <h3 className="ch-recent-title">Recente uitslagen</h3>
              <ul className="ch-recent">
                {myResults.map((m) => {
                  const home = m.homeTeamId === myTeamId;
                  const gf = home ? m.score.home : m.score.away;
                  const ga = home ? m.score.away : m.score.home;
                  const res = gf > ga ? "W" : gf < ga ? "V" : "G";
                  const opp = teamName(home ? m.awayTeamId : m.homeTeamId);
                  return (
                    <li key={m.id} className={`ch-res ch-res-${res}`}>
                      <span className="ch-res-tag">{res}</span>
                      <span className="ch-res-opp">
                        <span className="ch-res-ha">{home ? "thuis" : "uit"}</span> {opp}
                      </span>
                      <span className="ch-res-score">
                        {gf}–{ga}
                      </span>
                    </li>
                  );
                })}
                {myResults.length === 0 && <li className="ch-res">Nog niets gespeeld.</li>}
              </ul>
            </section>
            {nextMatch && (
              <section className="ch-panel ch-sub">
                <h3 className="ch-recent-title">Ook deze speeldag</h3>
                <ul className="ch-dayfix">
                  {ws.matches
                    .filter(
                      (m) =>
                        m.competitionId === nextMatch.competitionId &&
                        m.date === nextMatch.date &&
                        m.id !== nextMatch.id,
                    )
                    .slice(0, 7)
                    .map((m) => (
                      <li key={m.id}>
                        <span className="ch-dayfix-h">{teamName(m.homeTeamId)}</span>
                        <span className="ch-vs">–</span>
                        <span className="ch-dayfix-a">{teamName(m.awayTeamId)}</span>
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <div className="ch-ov-right">
          <div className={`ch-objective${objective.met ? " ok" : " behind"}`}>
            <span className="ch-obj-label">Bestuursdoel</span>
            <span className="ch-obj-text">{objective.text}</span>
            <span className="ch-obj-rank">
              nu {objective.currentRank ?? "?"}e · doel ≤ {objective.targetRank}e
            </span>
          </div>
          <section className="ch-panel ch-table">
            <h2>{myDivision.name}</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th className="ch-tn">Club</th>
                  <th>G</th>
                  <th>W</th>
                  <th>L</th>
                  <th>V</th>
                  <th>DS</th>
                  <th>Ptn</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r) => {
                  const promo = promoCut > 0 && r.rank <= promoCut;
                  const releg = relCut > 0 && r.rank > standings.length - relCut;
                  return (
                    <tr
                      key={r.teamId}
                      className={`${r.teamId === myTeamId ? "ch-me" : ""}${promo ? " ch-promo" : ""}${
                        releg ? " ch-releg" : ""
                      }`}
                    >
                      <td>{r.rank}</td>
                      <td className="ch-tn">
                        {(() => {
                          const t = save.worldState.teams.find((x) => x.id === r.teamId);
                          return t ? <ClubLabel team={t} size={15} /> : teamName(r.teamId);
                        })()}
                      </td>
                      <td>{r.played}</td>
                      <td>{r.won}</td>
                      <td>{r.drawn}</td>
                      <td>{r.lost}</td>
                      <td>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                      <td className="ch-pts">{r.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>
      </div>
      </div>
    </div>
  );
}

// Alle spelerseigenschappen (afkorting + volledige naam voor de tooltip).
const ATTR_COLS: { key: keyof Player["attributes"]; label: string; full: string }[] = [
  { key: "pace", label: "Pac", full: "Snelheid" },
  { key: "stamina", label: "Sta", full: "Conditie" },
  { key: "ballControl", label: "Ctl", full: "Balcontrole" },
  { key: "passing", label: "Pas", full: "Passing" },
  { key: "shooting", label: "Sho", full: "Schot" },
  { key: "finishing", label: "Fin", full: "Afwerking" },
  { key: "heading", label: "Kop", full: "Koppen" },
  { key: "tackling", label: "Tac", full: "Tackelen" },
  { key: "composure", label: "Rust", full: "Beheersing" },
  { key: "aggression", label: "Agr", full: "Agressie" },
  { key: "consistency", label: "Cst", full: "Constantheid" },
  { key: "flair", label: "Fla", full: "Flair" },
  { key: "goalkeeping", label: "Kpr", full: "Keepen" },
];

function SquadRow({ p, ovr, num }: { p: Player; ovr: number; num: number }) {
  const a = p.attributes;
  return (
    <tr>
      <td>{num}</td>
      <td className="ch-tn">
        {p.firstName[0]}. {p.lastName}
      </td>
      <td>{p.preferredPositions[0]}</td>
      <td>{p.ageYears}</td>
      <td className="ch-status">{statusLabel(p) ?? ""}</td>
      {ATTR_COLS.map((c) => {
        const v = a[c.key];
        return <td key={c.key}>{typeof v === "number" ? Math.round(v) : "-"}</td>;
      })}
      <td className="ch-pts">{ovr}</td>
    </tr>
  );
}

const SHAPE_SLIDERS: { key: "lineHeight" | "press" | "width" | "tempo"; label: string; lo: string; hi: string }[] = [
  { key: "lineHeight", label: "Verdedigingslinie", lo: "laag", hi: "hoog" },
  { key: "press", label: "Pressing", lo: "afwachtend", hi: "agressief" },
  { key: "width", label: "Breedte", lo: "smal", hi: "breed" },
  { key: "tempo", label: "Tempo", lo: "rustig", hi: "snel" },
];

/** Tactiek: kies formatie, basiself en speelstijl voor de eigen club. */
function TacticsView({ save, onUpdate }: { save: CareerSave; onUpdate: (s: CareerSave) => void }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const team = ws.teams.find((t) => t.id === myId)!;
  const squad = useMemo(() => ws.players.filter((p) => p.teamId === myId), [ws.players, myId]);

  const [dragging, setDragging] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [sub, setSub] = useState<"selectie" | "stijl">("selectie");

  const tac = save.manager.tactics;
  const formation = tac?.formation || teamFormationName(myId);
  const slots = FORMATIONS[formation] ?? FORMATIONS["4-4-2"]!;
  const defaultLineup = useMemo(
    () => pickBestEleven(squad, formation).map((c) => c.player.id),
    [squad, formation],
  );
  const lineup = tac?.lineup && tac.lineup.length === slots.length ? tac.lineup : defaultLineup;
  const shape = tac?.shape ?? {
    lineHeight: team.tacticalIdentity.press,
    press: team.tacticalIdentity.press,
    width: team.tacticalIdentity.width,
    tempo: team.tacticalIdentity.tempo,
  };

  const write = (next: { formation?: string; lineup?: UUID[]; shape?: typeof shape }) => {
    const s = structuredClone(save);
    s.manager.tactics = {
      formation: next.formation ?? formation,
      lineup: next.lineup ?? lineup,
      shape: next.shape ?? shape,
    };
    onUpdate(s);
  };

  const changeFormation = (f: string) => {
    const newDefault = pickBestEleven(squad, f).map((c) => c.player.id);
    write({ formation: f, lineup: newDefault });
  };

  const setSlot = (i: number, pid: UUID) => {
    const next = [...lineup];
    const j = next.indexOf(pid);
    if (j >= 0 && j !== i) next[j] = next[i]!; // wissel om om duplicaten te voorkomen
    next[i] = pid;
    write({ lineup: next });
  };

  const setShape = (key: typeof SHAPE_SLIDERS[number]["key"], val: number) => {
    write({ shape: { ...shape, [key]: val } });
  };

  const reset = () => {
    const s = structuredClone(save);
    s.manager.tactics = undefined;
    onUpdate(s);
  };

  const starters = new Set(lineup);
  const bench = squad
    .filter((p) => !starters.has(p.id))
    .sort((a, b) => playerOverall(b) - playerOverall(a));
  const playerById = (id: UUID): Player | undefined => squad.find((p) => p.id === id);

  // Versleep spelers tussen slots onderling en tussen slot <-> bank.
  const onDragStart = (src: string) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", src);
    e.dataTransfer.effectAllowed = "move";
    setDragging(src);
  };
  const allowDrop = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const apply = (src: string, target: { kind: "slot"; i: number } | { kind: "bench"; pid: UUID }) => {
    if (src.startsWith("bench:")) {
      const id = src.slice(6);
      if (target.kind === "slot") setSlot(target.i, id);
    } else if (src.startsWith("slot:")) {
      const i = parseInt(src.slice(5), 10);
      if (target.kind === "slot") {
        const next = [...lineup];
        const tmp = next[target.i]!;
        next[target.i] = next[i]!;
        next[i] = tmp;
        write({ lineup: next });
      } else {
        setSlot(i, target.pid); // basisspeler ruilt met deze bankspeler
      }
    }
  };
  const dropOnSlot = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    apply(e.dataTransfer.getData("text/plain"), { kind: "slot", i });
    setDragging(null);
    setOverSlot(null);
  };
  const dropOnBench = (pid: UUID) => (e: DragEvent) => {
    e.preventDefault();
    apply(e.dataTransfer.getData("text/plain"), { kind: "bench", pid });
    setDragging(null);
  };

  const spots = pitchSpots(formation, lineup, slots);

  return (
    <div className="ch-body ch-tactiek">
      <section className="ch-panel ch-tac-field">
        <div className="tac-head">
          <div>
            <div className="tac-head-sub">Opstelling · {formation} · {lineup.length} spelers</div>
            <h2>OPSTELLING</h2>
          </div>
          <div className="tac-forms">
            {Object.keys(FORMATIONS).map((f) => (
              <button
                key={f}
                className={`tac-form-btn${f === formation ? " sel" : ""}`}
                onClick={() => changeFormation(f)}
              >
                {f}
              </button>
            ))}
            <button className="tac-form-btn tac-reset" onClick={reset} title="Herstel automatisch">
              ↺
            </button>
          </div>
        </div>

        <div className="tac-pitch">
          <svg className="tac-pitch-lines" viewBox="0 0 100 140" preserveAspectRatio="none">
            {[1, 3, 5].map((i) => (
              <rect key={i} className="tp-stripe" x="0" y={i * 20} width="100" height="20" />
            ))}
            <rect className="tp-line" x="3" y="3" width="94" height="134" rx="2" />
            <line className="tp-line" x1="3" y1="70" x2="97" y2="70" />
            <circle className="tp-line" cx="50" cy="70" r="11" />
            <circle cx="50" cy="70" r="0.9" fill="rgba(255,255,255,.55)" />
            <rect className="tp-line" x="28" y="3" width="44" height="20" />
            <rect className="tp-line" x="40" y="3" width="20" height="8" />
            <rect className="tp-line" x="28" y="117" width="44" height="20" />
            <rect className="tp-line" x="40" y="129" width="20" height="8" />
          </svg>
          {spots.map((s) => {
            const p = playerById(s.id);
            if (!p) return null;
            const i = lineup.indexOf(s.id);
            const pos = p.preferredPositions[0] ?? "CM";
            const st = statusLabel(p);
            return (
              <div
                key={s.id}
                className={`tac-marker${st ? " unavail" : ""}${dragging === `slot:${i}` ? " drag" : ""}${
                  overSlot === i ? " over" : ""
                }`}
                style={{ left: `${s.x}%`, top: `${(s.y / 140) * 100}%` }}
                draggable
                onDragStart={onDragStart(`slot:${i}`)}
                onDragEnd={() => { setDragging(null); setOverSlot(null); }}
                onDragOver={allowDrop}
                onDragEnter={() => setOverSlot(i)}
                onDragLeave={() => setOverSlot((cur) => (cur === i ? null : cur))}
                onDrop={dropOnSlot(i)}
                title={`${p.firstName} ${p.lastName}${st ? ` · ${st}` : ""}`}
              >
                <span className="tac-disc" style={{ background: posMark(pos) }}>
                  {playerOverall(p)}
                </span>
                <span className="tac-mname">{p.lastName}</span>
              </div>
            );
          })}
        </div>

        <div className="tac-bench">
          <div className="tac-bench-label">Wisselspelers — sleep naar het veld</div>
          <div className="tac-bench-row">
            {bench.map((p) => {
              const st = statusLabel(p);
              return (
                <div
                  key={p.id}
                  className={`tac-chip${dragging === `bench:${p.id}` ? " drag" : ""}${st ? " unavail" : ""}`}
                  draggable
                  onDragStart={onDragStart(`bench:${p.id}`)}
                  onDragEnd={() => { setDragging(null); setOverSlot(null); }}
                  onDragOver={allowDrop}
                  onDrop={dropOnBench(p.id)}
                  title={`${p.firstName} ${p.lastName}${st ? ` · ${st}` : ""}`}
                >
                  <span className="tac-chip-pos">{p.preferredPositions[0]}</span>
                  <span className="tac-chip-name">{p.lastName}</span>
                  <span className="tac-chip-ovr">{playerOverall(p)}</span>
                </div>
              );
            })}
            {bench.length === 0 && <span className="ch-done">Geen reserves.</span>}
          </div>
        </div>
      </section>

      <section className="ch-panel ch-tac-side">
        <div className="tac-subtabs">
          <button
            className={`tac-subtab${sub === "selectie" ? " sel" : ""}`}
            onClick={() => setSub("selectie")}
          >
            Selectie
          </button>
          <button
            className={`tac-subtab${sub === "stijl" ? " sel" : ""}`}
            onClick={() => setSub("stijl")}
          >
            Speelstijl
          </button>
        </div>

        {sub === "selectie" ? (
          <div className="tac-squad">
            {[...squad]
              .sort((a, b) => playerOverall(b) - playerOverall(a))
              .map((p) => {
                const st = statusLabel(p);
                const starter = starters.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={`tac-srow${starter ? " starter" : ""}${dragging === `bench:${p.id}` ? " drag" : ""}`}
                    draggable
                    onDragStart={onDragStart(`bench:${p.id}`)}
                    onDragEnd={() => { setDragging(null); setOverSlot(null); }}
                  >
                    <span className="tac-spos">{p.preferredPositions[0]}</span>
                    <span className="tac-sname">{p.firstName[0]}. {p.lastName}</span>
                    {st && <span className="tac-sst ch-status">{st}</span>}
                    <span className="tac-sovr" style={{ color: starter ? "var(--accent)" : "#cfd6c8" }}>
                      {playerOverall(p)}
                    </span>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="tac-sliders">
            {SHAPE_SLIDERS.map((s) => (
              <div key={s.key} className="tac-slider">
                <div className="tac-slider-top">
                  <span>{s.label}</span>
                  <span className="tac-slider-val">{Math.round(shape[s.key] * 100)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={shape[s.key]}
                  onChange={(e) => setShape(s.key, parseFloat(e.target.value))}
                />
                <div className="tac-slider-ends">
                  <span>{s.lo}</span>
                  <span>{s.hi}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Trainingstab: kies de wekelijkse focus + uitleg wat training doet. */
const TREND_ICON: Record<string, string> = { up: "▲", down: "▼", flat: "—" };

function TrainingView({
  save,
  focus,
  setFocus,
}: {
  save: CareerSave;
  focus: TrainingFocus;
  setFocus: (f: TrainingFocus) => void;
}) {
  const active = TRAINING_OPTS.find((o) => o.id === focus)!;
  const results = useMemo(() => trainingResults(save), [save]);
  const risers = results.filter((r) => r.delta > 0).length;
  const fallers = results.filter((r) => r.delta < 0).length;
  const tracked = results.some((r) => r.delta !== 0);

  return (
    <div className="ch-body ch-traintab">
      <section className="ch-panel ch-train-left">
        <h2>Training</h2>
        <p className="ch-train-intro">
          Elke speelweek groeit je selectie richting het verborgen <strong>potentieel</strong>:
          jonge spelers stijgen het snelst, rond de piek (±27 jaar, keepers later) vlakt het af en
          daarna lopen ze terug — fysiek het eerst. De focus stuurt <strong>welke</strong>
          eigenschappen sneller stijgen.
        </p>
        <div className="ch-train-cards">
          {TRAINING_OPTS.map((o) => (
            <button
              key={o.id}
              className={`ch-train-card${focus === o.id ? " sel" : ""}`}
              onClick={() => setFocus(o.id)}
            >
              <span className="ch-train-card-h">{o.label}</span>
              <span className="ch-train-card-d">{o.detail}</span>
            </button>
          ))}
        </div>
        <div className="ch-train-current">
          Huidige focus: <strong>{active.label}</strong> — {active.hint}
        </div>
      </section>

      <section className="ch-panel ch-train-right">
        <div className="comp-head">
          <h2>Ontwikkeling dit seizoen</h2>
          <span className="tr-count">
            <span style={{ color: "var(--accent)" }}>{risers}▲</span> ·{" "}
            <span style={{ color: "var(--danger)" }}>{fallers}▼</span>
          </span>
        </div>
        <div className="tr-head trn-row">
          <span>Pos</span>
          <span>Speler</span>
          <span className="tr-c">Lft</span>
          <span className="tr-c">OVR</span>
          <span className="tr-c">Groei</span>
          <span className="tr-r">Prognose</span>
        </div>
        <div className="tr-list">
          {results.map((r) => {
            const sign = r.delta > 0 ? "up" : r.delta < 0 ? "down" : "flat";
            const deltaText = r.delta > 0 ? `+${r.delta}` : r.delta < 0 ? `${r.delta}` : "0";
            return (
              <div key={r.player.id} className="tr-row trn-row">
                <span className="tr-pos">{r.player.preferredPositions[0]}</span>
                <span className="tr-name">
                  {r.player.firstName[0]}. {r.player.lastName}
                </span>
                <span className="tr-age">{r.player.ageYears}</span>
                <span className="tr-ovr">{r.ovr}</span>
                <span className={`trn-delta ${sign}`}>{deltaText}</span>
                <span className={`trn-trend trend-${r.trend}`} title="Prognose op basis van leeftijd & potentieel">
                  {TREND_ICON[r.trend]}
                </span>
              </div>
            );
          })}
        </div>
        {!tracked && (
          <div className="ch-train-note">
            Groei wordt geteld vanaf nu — speel of simuleer speeldagen en je ziet hier per speler de
            verandering. De <strong>prognose</strong> toont nu al wie stijgt of (door leeftijd) daalt.
          </div>
        )}
      </section>
    </div>
  );
}

/** Kalender: het volledige speelschema van de eigen club over alle competities. */
function CalendarView({ save }: { save: CareerSave }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const teamName = (id: UUID): string => ws.teams.find((t) => t.id === id)?.name ?? "?";
  const compName = (id: UUID): string => ws.competitions.find((c) => c.id === id)?.name ?? "?";

  const myMatches = useMemo(
    () =>
      ws.matches
        .filter(
          (m) =>
            m.seasonId === ws.activeSeasonId &&
            (m.homeTeamId === myId || m.awayTeamId === myId),
        )
        .sort((a, b) => a.date.localeCompare(b.date)),
    [ws.matches, ws.activeSeasonId, myId],
  );

  const today = ws.seasons.find((s) => s.id === ws.activeSeasonId)?.currentDate ?? "";

  return (
    <div className="ch-body">
      <section className="ch-panel ch-cal">
        <h2>Speelschema — {ws.seasons.find((s) => s.id === ws.activeSeasonId)?.label}</h2>
        <ul className="myc-list">
          {myMatches.map((m) => {
            const home = m.homeTeamId === myId;
            const opp = teamName(home ? m.awayTeamId : m.homeTeamId);
            const played = m.state === "played";
            const gf = home ? m.score.home : m.score.away;
            const ga = home ? m.score.away : m.score.home;
            const res = played ? (gf > ga ? "W" : gf < ga ? "V" : "G") : "";
            const pens =
              played && m.score.home === m.score.away && m.score.pensHome !== undefined
                ? ` (${home ? m.score.pensHome : m.score.pensAway}-${home ? m.score.pensAway : m.score.pensHome} p)`
                : "";
            return (
              <li
                key={m.id}
                className={`myc-row${m.date === today && !played ? " now" : ""}${
                  played ? ` myc-${res}` : ""
                }`}
              >
                <span className="myc-date">{formatShort(m.date)}</span>
                <span className="myc-comp">{compName(m.competitionId)}</span>
                <span className="myc-round">{m.roundLabel}</span>
                <span className="myc-ha">{home ? "thuis" : "uit"}</span>
                <span className="myc-opp">{opp}</span>
                <span className="myc-res">
                  {played ? (
                    <>
                      <span className={`myc-tag myc-tag-${res}`}>{res}</span> {gf}–{ga}
                      {pens}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Jeugdacademie: eigen talenten (t/m 19) met potentieel-inschatting. */
function YouthView({ save }: { save: CareerSave }) {
  const prospects = myYouthProspects(save);
  return (
    <div className="ch-body">
      <section className="ch-panel ch-squad">
        <h2>Jeugdacademie — {save.worldState.teams.find((t) => t.id === save.manager.currentTeamId)?.name}</h2>
        {prospects.length === 0 ? (
          <div className="ch-done">Geen jeugdspelers. Na elk seizoen komt er een nieuwe lichting.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="ch-tn">Naam</th>
                <th>Pos</th>
                <th>Lft</th>
                <th>Nu</th>
                <th title="Ingeschat potentieel">Potentieel</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => {
                const stars = potentialStars(p.hidden.potential);
                return (
                  <tr key={p.id}>
                    <td className="ch-tn">{p.firstName[0]}. {p.lastName}</td>
                    <td>{p.preferredPositions[0]}</td>
                    <td>{p.ageYears}</td>
                    <td className="ch-pts">{playerOverall(p)}</td>
                    <td className="ch-stars" title={`${stars}/5`}>
                      {"★".repeat(stars)}<span className="ch-stars-dim">{"★".repeat(5 - stars)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Competities: kies een competitie en zie clubs, stand en alle wedstrijden. */
function CompetitionsView({ save }: { save: CareerSave }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const teamName = (id: UUID): string => ws.teams.find((t) => t.id === id)?.name ?? "?";

  // Mijn hoofdcompetitie eerst, dan mijn beker/Europese toernooien.
  const myComps = useMemo(() => {
    const mine = ws.competitions.filter(
      (c) => c.seasonId === ws.activeSeasonId && c.teamIds.includes(myId),
    );
    const order = (c: (typeof mine)[number]): number =>
      c.scope === "league" ? 0 : c.scope === "cl" ? 1 : c.scope === "el" ? 2 : c.scope === "ecl" ? 3 : 4;
    return mine.sort((a, b) => order(a) - order(b));
  }, [ws.competitions, ws.activeSeasonId, myId]);

  // Alle competitie-divisies (ook waar ik niet in zit), gegroepeerd per land —
  // zo kun je doorklikken hoe het er elders voor staat.
  const otherLeaguesByCountry = useMemo(() => {
    const div = (cid: UUID | null): (typeof ws.divisions)[number] | undefined =>
      ws.divisions.find((d) => d.id === cid);
    const leagues = ws.competitions
      .filter((c) => c.seasonId === ws.activeSeasonId && c.format === "league")
      .sort(
        (a, b) =>
          (div(a.divisionId)?.countryName ?? "").localeCompare(div(b.divisionId)?.countryName ?? "") ||
          (div(a.divisionId)?.tier ?? 0) - (div(b.divisionId)?.tier ?? 0),
      );
    const groups = new Map<string, typeof leagues>();
    for (const c of leagues) {
      const country = div(c.divisionId)?.countryName ?? "Overig";
      const arr = groups.get(country) ?? [];
      arr.push(c);
      groups.set(country, arr);
    }
    return [...groups.entries()];
  }, [ws.competitions, ws.activeSeasonId, ws.divisions]);

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [selId, setSelId] = useState<UUID>(myComps[0]?.id ?? "");
  // Zoek de geselecteerde competitie in álle competities (werkt voor beide modi).
  const comp =
    ws.competitions.find((c) => c.id === selId && c.seasonId === ws.activeSeasonId) ?? myComps[0];

  if (!comp) {
    return (
      <div className="ch-body">
        <section className="ch-panel"><div className="ch-done">Geen competities dit seizoen.</div></section>
      </div>
    );
  }

  const compMatches = ws.matches
    .filter((m) => m.competitionId === comp.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.roundLabel.localeCompare(b.roundLabel));

  // Groepeer wedstrijden per ronde.
  const rounds = new Map<string, Match[]>();
  for (const m of compMatches) {
    const arr = rounds.get(m.roundLabel) ?? [];
    arr.push(m);
    rounds.set(m.roundLabel, arr);
  }

  const isLeague = comp.format === "league";
  const standings = isLeague ? computeStandings(comp.teamIds, compMatches) : [];
  const champ = isLeague ? null : knockoutChampion(save, comp.id);

  // Topscorers van deze competitie dit seizoen (goals + assists per speler).
  const tally = new Map<UUID, { goals: number; assists: number }>();
  for (const m of compMatches) {
    if (m.state !== "played") continue;
    for (const id of m.goalScorers ?? []) {
      const e = tally.get(id) ?? { goals: 0, assists: 0 };
      e.goals += 1;
      tally.set(id, e);
    }
    for (const id of m.goalAssists ?? []) {
      const e = tally.get(id) ?? { goals: 0, assists: 0 };
      e.assists += 1;
      tally.set(id, e);
    }
  }
  const topScorers = [...tally.entries()]
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
    .slice(0, 15);

  return (
    <div className="ch-body ch-compdetail">
      <section className="ch-panel ch-complist">
        <h2>Competities</h2>
        <div className="cd-scope">
          <button className={`cd-scope-btn${scope === "mine" ? " sel" : ""}`} onClick={() => setScope("mine")}>
            Mijn
          </button>
          <button className={`cd-scope-btn${scope === "all" ? " sel" : ""}`} onClick={() => setScope("all")}>
            Alle competities
          </button>
        </div>
        {scope === "mine" ? (
          <ul className="cd-tabs">
            {myComps.map((c) => (
              <li key={c.id}>
                <button
                  className={`cd-tab${c.id === comp.id ? " sel" : ""}`}
                  onClick={() => setSelId(c.id)}
                >
                  <span>{c.name}</span>
                  <span className="cd-tab-meta">
                    {c.scope === "league" ? "competitie" : "knock-out"} · {c.teamIds.length} clubs
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="cd-allcountries">
            {otherLeaguesByCountry.map(([country, comps]) => (
              <div key={country} className="cd-country">
                <div className="cd-country-h">{country}</div>
                <ul className="cd-tabs">
                  {comps.map((c) => (
                    <li key={c.id}>
                      <button
                        className={`cd-tab${c.id === comp.id ? " sel" : ""}`}
                        onClick={() => setSelId(c.id)}
                      >
                        <span>
                          {c.name}
                          {c.teamIds.includes(myId) ? " ★" : ""}
                        </span>
                        <span className="cd-tab-meta">{c.teamIds.length} clubs</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="ch-panel ch-comppanel">
        <div className="comp-head">
          <h2>{comp.name}</h2>
          {champ && <span className="comp-status win">🏆 {teamName(champ)}</span>}
        </div>

        {isLeague ? (
          <table className="cd-standings">
            <thead>
              <tr>
                <th>#</th>
                <th className="ch-tn">Club</th>
                <th>G</th><th>W</th><th>L</th><th>V</th><th>DS</th><th>Ptn</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((r) => (
                <tr key={r.teamId} className={r.teamId === myId ? "ch-me" : ""}>
                  <td>{r.rank}</td>
                  <td className="ch-tn">
                    {(() => {
                      const t = ws.teams.find((x) => x.id === r.teamId);
                      return t ? <ClubLabel team={t} size={15} /> : teamName(r.teamId);
                    })()}
                  </td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.drawn}</td>
                  <td>{r.lost}</td>
                  <td>{r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}</td>
                  <td className="ch-pts">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="cd-teams">
            <span className="cd-teams-label">Deelnemers:</span>{" "}
            {comp.teamIds.map((id) => teamName(id)).join(", ")}
          </div>
        )}

        {isLeague && topScorers.length > 0 && (
          <>
            <h3 className="ch-recent-title">Topscorers</h3>
            <table className="cd-standings cd-scorers">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="ch-tn">Speler</th>
                  <th className="ch-tn">Club</th>
                  <th>G</th>
                  <th>A</th>
                </tr>
              </thead>
              <tbody>
                {topScorers.map((s, i) => {
                  const pl = ws.players.find((p) => p.id === s.id);
                  const name = pl ? `${pl.firstName.charAt(0)}. ${pl.lastName}` : "—";
                  const club = pl?.teamId ? teamName(pl.teamId) : "—";
                  return (
                    <tr key={s.id} className={pl?.teamId === myId ? "ch-me" : ""}>
                      <td>{i + 1}</td>
                      <td className="ch-tn">{name}</td>
                      <td className="ch-tn">{club}</td>
                      <td className="ch-pts">{s.goals}</td>
                      <td>{s.assists}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        <h3 className="ch-recent-title">Wedstrijden</h3>
        <div className="cd-rounds">
          {[...rounds.entries()].map(([round, ms]) => (
            <div key={round} className="cd-round">
              <div className="cd-round-h">{round} · {formatShort(ms[0]!.date)}</div>
              <ul className="cd-fixtures">
                {ms.map((m) => {
                  const mine = m.homeTeamId === myId || m.awayTeamId === myId;
                  const played = m.state === "played";
                  const pens =
                    played && m.score.home === m.score.away && m.score.pensHome !== undefined
                      ? ` (${m.score.pensHome}-${m.score.pensAway} pen)`
                      : "";
                  return (
                    <li key={m.id} className={mine ? "cd-mine" : ""}>
                      <span className="cd-h">{teamName(m.homeTeamId)}</span>
                      <span className="cd-score">
                        {played ? `${m.score.home}–${m.score.away}${pens}` : "–"}
                      </span>
                      <span className="cd-a">{teamName(m.awayTeamId)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Korte geldnotatie: €12,3 mln / €450 k. */
function money(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)} mln`;
  if (Math.abs(n) >= 1_000) return `€${Math.round(n / 1_000)} k`;
  return `€${Math.round(n)}`;
}

const POSITIONS = ["GK", "RB", "LB", "CB", "DM", "CM", "AM", "RW", "LW", "ST"];

function FinancesView({ save }: { save: CareerSave }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const myTeam = ws.teams.find((t) => t.id === myId)!;
  const fin = myTeam.finances;
  const s = fin.season;
  const last = fin.lastMatchday;
  const seasonNet = s ? s.gate + s.sponsor + s.prize - s.wages : 0;

  return (
    <div className="ch-body">
      <section className="ch-panel ch-fin">
        <h2>Financiën</h2>
        <div className="fin-grid">
          <div><span>Saldo</span><strong>{money(fin.balance)}</strong></div>
          <div><span>Transferbudget</span><strong>{money(effectiveTransferBudget(save, myId))}</strong></div>
          <div><span>Loon/week</span><strong>{money(weeklyWageBill(save, myId))}</strong></div>
          <div><span>Sponsortier</span><strong>{fin.sponsorTier}/5</strong></div>
        </div>

        <h3 className="ch-recent-title">Dit seizoen</h3>
        <div className="fin-grid">
          <div><span>Recettes</span><strong>{money(s?.gate ?? 0)}</strong></div>
          <div><span>Sponsor/TV</span><strong>{money(s?.sponsor ?? 0)}</strong></div>
          <div><span>Lonen</span><strong>−{money(s?.wages ?? 0)}</strong></div>
          <div><span>Prijzengeld</span><strong>{money(s?.prize ?? 0)}</strong></div>
          <div><span>Saldo dit seizoen</span><strong>{seasonNet >= 0 ? "+" : "−"}{money(Math.abs(seasonNet))}</strong></div>
        </div>

        {last ? (
          <div className="fin-last">
            Laatste speeldag ({last.date}): recette {money(last.gate)} + sponsor {money(last.sponsor)} − lonen{" "}
            {money(last.wages)} = <strong>{last.net >= 0 ? "+" : "−"}{money(Math.abs(last.net))}</strong>
          </div>
        ) : (
          <div className="fin-last">Nog geen speeldag afgewerkt dit seizoen.</div>
        )}
      </section>
    </div>
  );
}

// Kernattributen die in de transfer-rijen worden getoond (compact).
const TR_STATS: { key: keyof Player["attributes"]; label: string }[] = [
  { key: "pace", label: "SNH" },
  { key: "shooting", label: "SCH" },
  { key: "passing", label: "PAS" },
  { key: "tackling", label: "TAC" },
];

function statVal(p: Player, key: keyof Player["attributes"]): string {
  const v = p.attributes[key];
  return typeof v === "number" ? String(Math.round(v)) : "–";
}

const AGE_OPTS = [
  { v: 0, label: "Alle leeftijden" },
  { v: 21, label: "t/m 21 jr" },
  { v: 24, label: "t/m 24 jr" },
  { v: 27, label: "t/m 27 jr" },
  { v: 30, label: "t/m 30 jr" },
];
const PRICE_OPTS = [
  { v: 0, label: "Alle prijzen" },
  { v: 2_000_000, label: "≤ €2 mln" },
  { v: 5_000_000, label: "≤ €5 mln" },
  { v: 10_000_000, label: "≤ €10 mln" },
  { v: 25_000_000, label: "≤ €25 mln" },
];
const SORT_OPTS = [
  { v: "ovr", label: "Beste (OVR)" },
  { v: "cheap", label: "Goedkoopst" },
  { v: "exp", label: "Duurst" },
  { v: "young", label: "Jongste" },
];

function TransfersView({ save, onUpdate }: { save: CareerSave; onUpdate: (s: CareerSave) => void }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const myTeam = ws.teams.find((t) => t.id === myId)!;
  const [posFilter, setPosFilter] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [maxAge, setMaxAge] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(0);
  const [sort, setSort] = useState<"ovr" | "cheap" | "exp" | "young">("ovr");
  const [affordable, setAffordable] = useState<boolean>(false);
  const [detail, setDetail] = useState<Player | null>(null);
  const windowOpen = transferWindowOpen(save);
  const budget = effectiveTransferBudget(save, myId);

  const clubName = (id: UUID | null): string =>
    id ? (ws.teams.find((t) => t.id === id)?.name ?? "?") : "vrij";

  // Ruime pool ophalen op positie; naam/leeftijd/prijs/sortering doen we client-side.
  const pool = useMemo(
    () => transferTargets(save, { position: posFilter || undefined, limit: 200 }),
    [save, posFilter],
  );
  const market = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = pool
      .filter((p) => !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
      .filter((p) => !maxAge || p.ageYears <= maxAge)
      .filter((p) => !maxPrice || askingPrice(p) <= maxPrice)
      .filter((p) => !affordable || askingPrice(p) <= budget);
    const sorted = [...list];
    if (sort === "cheap") sorted.sort((a, b) => askingPrice(a) - askingPrice(b));
    else if (sort === "exp") sorted.sort((a, b) => askingPrice(b) - askingPrice(a));
    else if (sort === "young") sorted.sort((a, b) => a.ageYears - b.ageYears);
    else sorted.sort((a, b) => playerOverall(b) - playerOverall(a));
    return sorted.slice(0, 80);
  }, [pool, query, maxAge, maxPrice, affordable, budget, sort]);

  const mySquad = useMemo(
    () =>
      ws.players
        .filter((p) => p.teamId === myId)
        .map((p) => ({ p, ovr: playerOverall(p) }))
        .sort((a, b) => b.ovr - a.ovr),
    [ws.players, myId],
  );

  const buy = (id: UUID) => {
    const s = structuredClone(save);
    if (buyPlayer(s, id).ok) onUpdate(s);
  };
  const sell = (id: UUID) => {
    const s = structuredClone(save);
    if (sellPlayer(s, id).ok) onUpdate(s);
  };

  return (
    <div className="ch-body ch-transfers">
      <section className="ch-panel ch-tr-left">
        <h2>Financiën</h2>
        <div className="tr-fin-tiles">
          <div className="tr-fin-tile">
            <span>Budget</span>
            <strong style={{ color: "var(--accent-2)" }}>{money(budget)}</strong>
          </div>
          <div className="tr-fin-tile">
            <span>Saldo</span>
            <strong>{money(myTeam.finances.balance)}</strong>
          </div>
          <div className="tr-fin-tile">
            <span>Loon/week</span>
            <strong>{money(weeklyWageBill(save, myId))}</strong>
          </div>
          <div className="tr-fin-tile">
            <span>Selectie</span>
            <strong>{squadSize(save, myId)}</strong>
          </div>
        </div>
        <div className={`fin-window${windowOpen ? " open" : ""}`}>
          Transferperiode {windowOpen ? "open" : "gesloten"}
        </div>

        <h3 className="ch-recent-title">Mijn selectie — verkopen</h3>
        <div className="tr-head tr-row-sell">
          <span>Pos</span>
          <span>Speler</span>
          <span className="tr-c">Lft</span>
          <span className="tr-c">OVR</span>
          <span className="tr-r">Waarde</span>
          <span />
        </div>
        <div className="tr-list">
          {mySquad.map(({ p, ovr }) => (
            <div key={p.id} className="tr-row tr-row-sell">
              <span className="tr-pos">{p.preferredPositions[0]}</span>
              <button className="tr-name tr-link" onClick={() => setDetail(p)}>
                {p.firstName[0]}. {p.lastName}
              </button>
              <span className="tr-age">{p.ageYears}</span>
              <span className="tr-ovr">{ovr}</span>
              <span className="tr-val">{money(p.market.estimatedValue)}</span>
              <button
                className="tr-btn"
                disabled={!windowOpen || squadSize(save, myId) <= 14}
                onClick={() => sell(p.id)}
              >
                Verkoop
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="ch-panel ch-tr-right">
        <div className="tr-market-head">
          <h2>Transfermarkt</h2>
          <span className="tr-count">{market.length} spelers</span>
        </div>
        <div className="tr-filters">
          <div className="tr-search">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek speler op naam…"
            />
            {query && (
              <button className="tr-search-clear" onClick={() => setQuery("")} title="Wissen">
                ✕
              </button>
            )}
          </div>
          <button
            className={`tr-toggle${affordable ? " on" : ""}`}
            onClick={() => setAffordable((v) => !v)}
            title="Toon alleen spelers binnen je budget"
          >
            Betaalbaar
          </button>
        </div>
        <div className="tr-filters">
          <select className="tr-pos-select" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
            <option value="">Alle posities</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="tr-pos-select" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}>
            {AGE_OPTS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
          <select className="tr-pos-select" value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))}>
            {PRICE_OPTS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
          <select className="tr-pos-select" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            {SORT_OPTS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="tr-head tr-row-buy">
          <span>Pos</span>
          <span>Speler</span>
          <span className="tr-c">Lft</span>
          <span>Club</span>
          <span className="tr-c">OVR</span>
          {TR_STATS.map((s) => (
            <span key={s.key} className="tr-c">{s.label}</span>
          ))}
          <span className="tr-r">Waarde</span>
          <span />
        </div>
        <div className="tr-list tr-market-list">
          {market.map((p) => {
            const can = canBuy(save, p.id);
            return (
              <div key={p.id} className="tr-row tr-row-buy">
                <span className="tr-pos">{p.preferredPositions[0]}</span>
                <button className="tr-name tr-link" onClick={() => setDetail(p)}>
                  {p.firstName[0]}. {p.lastName}
                </button>
                <span className="tr-age">{p.ageYears}</span>
                <span className="tr-club">{clubName(p.teamId)}</span>
                <span className="tr-ovr">{playerOverall(p)}</span>
                {TR_STATS.map((s) => (
                  <span key={s.key} className="tr-stat">{statVal(p, s.key)}</span>
                ))}
                <span className="tr-val">{money(askingPrice(p))}</span>
                <button className="tr-btn" disabled={!can.ok} title={can.reason ?? ""} onClick={() => buy(p.id)}>
                  Koop
                </button>
              </div>
            );
          })}
          {market.length === 0 && <div className="ch-done">Geen spelers gevonden.</div>}
        </div>
      </section>

      {detail && (
        <PlayerDetailModal
          p={detail}
          clubName={clubName(detail.teamId)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

const FOOT_LABEL: Record<string, string> = { R: "rechts", L: "links", B: "tweebenig" };

/** Detailkaart van een speler: volledige eigenschappen, waarde, status, potentieel. */
function PlayerDetailModal({
  p,
  clubName,
  onClose,
}: {
  p: Player;
  clubName: string;
  onClose: () => void;
}) {
  const stars = potentialStars(p.hidden.potential);
  const status = statusLabel(p);
  return (
    <div className="pd-overlay" onClick={onClose}>
      <div className="pd-card" onClick={(e) => e.stopPropagation()}>
        <div className="pd-head">
          <div>
            <div className="pd-name">{p.firstName} {p.lastName}</div>
            <div className="pd-sub">
              {p.preferredPositions.join("/")} · {p.ageYears} jr · {clubName}
            </div>
          </div>
          <button className="pd-close" onClick={onClose}>✕</button>
        </div>
        <div className="pd-meta">
          <div><span>Overall</span><strong>{playerOverall(p)}</strong></div>
          <div><span>Potentieel</span><strong className="ch-stars">{"★".repeat(stars)}<span className="ch-stars-dim">{"★".repeat(5 - stars)}</span></strong></div>
          <div><span>Waarde</span><strong>{money(p.market.estimatedValue)}</strong></div>
          <div><span>Loon/week</span><strong>{money(p.market.wageDemand)}</strong></div>
          <div><span>Voorkeursvoet</span><strong>{FOOT_LABEL[p.foot] ?? p.foot}</strong></div>
          <div><span>Nationaliteit</span><strong>{p.nationality}</strong></div>
          <div><span>Conditie</span><strong>{Math.round(p.status.fitness)}</strong></div>
          <div><span>Vorm</span><strong>{Math.round(p.status.form)}</strong></div>
          {status && <div><span>Status</span><strong>{status}</strong></div>}
        </div>
        <div className="pd-attrs">
          {ATTR_COLS.filter((c) => c.key !== "goalkeeping" || p.preferredPositions[0] === "GK").map((c) => {
            const v = p.attributes[c.key];
            if (typeof v !== "number") return null;
            const val = Math.round(v);
            return (
              <div key={c.key} className="pd-attr">
                <span className="pd-attr-l">{c.full}</span>
                <span className="pd-attr-bar">
                  <span className="pd-attr-fill" style={{ width: `${val}%` }} />
                </span>
                <span className="pd-attr-v">{val}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
