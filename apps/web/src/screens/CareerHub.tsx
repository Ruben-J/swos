import { useMemo, useState } from "react";
import { Rng, hashSeed, type CareerSave, type Match, type Player, type TrainingFocus, type UUID } from "@pitch/shared";
import {
  askingPrice,
  buyPlayer,
  canBuy,
  divisionStandings,
  formatShort,
  knockoutChampion,
  playMatchday,
  playerOverall,
  seasonComplete,
  seasonObjective,
  sellPlayer,
  squadSize,
  statusLabel,
  teamNextMatch,
  transferTargets,
  transferWindowOpen,
  weeklyWageBill,
} from "@pitch/sim-data";

const TRAINING_OPTS: { id: TrainingFocus; label: string; hint: string }[] = [
  { id: "balanced", label: "Gebalanceerd", hint: "Gelijkmatige groei over alle attributen" },
  { id: "attack", label: "Aanval", hint: "Schot, afronding, techniek en passing" },
  { id: "defense", label: "Verdediging", hint: "Tackelen, koppen, rust aan de bal" },
  { id: "fitness", label: "Fysiek", hint: "Conditie en snelheid + sneller herstel" },
  { id: "youth", label: "Jeugd", hint: "Extra groei voor spelers t/m 21 jaar" },
];

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

  const [tab, setTab] = useState<"overzicht" | "selectie" | "transfers" | "competities">("overzicht");

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
  const teamShort = (id: UUID): string => ws.teams.find((t) => t.id === id)?.shortName ?? "?";

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

  const focus: TrainingFocus = save.manager.trainingFocus ?? "balanced";
  const setFocus = (f: TrainingFocus) => {
    const s = structuredClone(save);
    s.manager.trainingFocus = f;
    onUpdate(s);
  };

  const promoCut = myDivision.tier > 1 ? myDivision.promotionSlots : 0;
  const relCut = myDivision.relegationSlots;

  return (
    <div className="career-hub">
      <header className="ch-head">
        <div className="ch-club">
          <span className="ch-chip" style={{ background: myTeam.colors.primary }} />
          <div>
            <div className="ch-club-name">{myTeam.name}</div>
            <div className="ch-sub">
              {myDivision.name} · {myDivision.countryName} · seizoen {season.label}
            </div>
          </div>
        </div>
        <div className="ch-right">
          <div className="ch-tabs">
            <button
              className={`ch-tab${tab === "overzicht" ? " sel" : ""}`}
              onClick={() => setTab("overzicht")}
            >
              Overzicht
            </button>
            <button
              className={`ch-tab${tab === "selectie" ? " sel" : ""}`}
              onClick={() => setTab("selectie")}
            >
              Selectie
            </button>
            <button
              className={`ch-tab${tab === "competities" ? " sel" : ""}`}
              onClick={() => setTab("competities")}
            >
              Competities
            </button>
            <button
              className={`ch-tab${tab === "transfers" ? " sel" : ""}`}
              onClick={() => setTab("transfers")}
            >
              Transfers
            </button>
          </div>
          <div className="ch-date">{formatShort(season.currentDate)}</div>
          <button className="btn" onClick={onExit}>
            Opslaan &amp; terug
          </button>
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

      {tab === "competities" && <CompetitionsView save={save} />}

      {tab === "transfers" && <TransfersView save={save} onUpdate={onUpdate} />}

      <div className="ch-body" style={tab !== "overzicht" ? { display: "none" } : undefined}>
        <section className="ch-panel ch-next">
          <div className={`ch-objective${objective.met ? " ok" : " behind"}`}>
            <span className="ch-obj-label">Bestuursdoel</span>
            <span className="ch-obj-text">{objective.text}</span>
            <span className="ch-obj-rank">
              nu {objective.currentRank ?? "?"}e · doel ≤ {objective.targetRank}e
            </span>
          </div>
          <div className="ch-training">
            <span className="ch-train-label">Training</span>
            <div className="ch-train-opts">
              {TRAINING_OPTS.map((o) => (
                <button
                  key={o.id}
                  className={`ch-train-btn${focus === o.id ? " sel" : ""}`}
                  title={o.hint}
                  onClick={() => setFocus(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <h2>Volgende wedstrijd</h2>
          {nextMatch ? (
            <>
              <div className="ch-fixture">
                <span className={nextMatch.homeTeamId === myTeamId ? "ch-strong" : ""}>
                  {teamName(nextMatch.homeTeamId)}
                </span>
                <span className="ch-vs">vs</span>
                <span className={nextMatch.awayTeamId === myTeamId ? "ch-strong" : ""}>
                  {teamName(nextMatch.awayTeamId)}
                </span>
              </div>
              <div className="ch-fixture-meta">
                {compName(nextMatch.competitionId)} · {nextMatch.roundLabel} · {formatShort(nextMatch.date)}
              </div>
              <div className="ch-actions">
                <button className="btn primary" onClick={() => onPlayMatch(nextMatch)}>
                  Speel wedstrijd
                </button>
                <button className="btn" onClick={simulate}>
                  Simuleer speeldag
                </button>
              </div>
            </>
          ) : done ? (
            <div className="ch-season-end">
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
            <div className="ch-done">Geen wedstrijd ingepland.</div>
          )}

          <h3 className="ch-recent-title">Recente uitslagen</h3>
          <ul className="ch-recent">
            {myResults.map((m) => {
              const home = m.homeTeamId === myTeamId;
              const gf = home ? m.score.home : m.score.away;
              const ga = home ? m.score.away : m.score.home;
              const res = gf > ga ? "W" : gf < ga ? "V" : "G";
              const opp = teamShort(home ? m.awayTeamId : m.homeTeamId);
              return (
                <li key={m.id} className={`ch-res ch-res-${res}`}>
                  <span className="ch-res-tag">{res}</span>
                  <span>{home ? "thuis" : "uit"} vs {opp}</span>
                  <span className="ch-res-score">
                    {gf}–{ga}
                  </span>
                </li>
              );
            })}
            {myResults.length === 0 && <li className="ch-res">Nog niets gespeeld.</li>}
          </ul>
        </section>

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
                    <td className="ch-tn">{teamName(r.teamId)}</td>
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
        return <td key={c.key}>{typeof v === "number" ? v : "-"}</td>;
      })}
      <td className="ch-pts">{ovr}</td>
    </tr>
  );
}

/** Overzicht van alle competities waar de eigen club in zit (beker + Europa). */
function CompetitionsView({ save }: { save: CareerSave }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const teamName = (id: UUID): string => ws.teams.find((t) => t.id === id)?.name ?? "?";

  const knockouts = ws.competitions
    .filter((c) => c.format === "knockout" && c.seasonId === ws.activeSeasonId && c.teamIds.includes(myId))
    .sort((a, b) => (a.scope === "cup" ? 1 : 0) - (b.scope === "cup" ? 1 : 0));

  return (
    <div className="ch-body ch-comps">
      {knockouts.map((comp) => {
        const myMatches = ws.matches
          .filter((m) => m.competitionId === comp.id && (m.homeTeamId === myId || m.awayTeamId === myId))
          .sort((a, b) => a.date.localeCompare(b.date));
        const champ = knockoutChampion(save, comp.id);
        const lastPlayed = [...myMatches].reverse().find((m) => m.state === "played");
        let statusOut = false;
        if (lastPlayed) {
          const home = lastPlayed.homeTeamId === myId;
          const gf = home ? lastPlayed.score.home : lastPlayed.score.away;
          const ga = home ? lastPlayed.score.away : lastPlayed.score.home;
          const pf = home ? lastPlayed.score.pensHome ?? 0 : lastPlayed.score.pensAway ?? 0;
          const pa = home ? lastPlayed.score.pensAway ?? 0 : lastPlayed.score.pensHome ?? 0;
          statusOut = gf < ga || (gf === ga && pf < pa);
        }
        const status = champ === myId ? "🏆 Gewonnen!" : statusOut ? "Uitgeschakeld" : myMatches.some((m) => m.state === "scheduled") ? "Actief" : "—";
        return (
          <section key={comp.id} className="ch-panel ch-comp">
            <div className="comp-head">
              <h2>{comp.name}</h2>
              <span className={`comp-status${champ === myId ? " win" : statusOut ? " out" : ""}`}>{status}</span>
            </div>
            <ul className="comp-list">
              {myMatches.map((m) => {
                const home = m.homeTeamId === myId;
                const opp = teamName(home ? m.awayTeamId : m.homeTeamId);
                const played = m.state === "played";
                const gf = home ? m.score.home : m.score.away;
                const ga = home ? m.score.away : m.score.home;
                const pens =
                  played && m.score.home === m.score.away && m.score.pensHome !== undefined
                    ? ` (${home ? m.score.pensHome : m.score.pensAway}-${home ? m.score.pensAway : m.score.pensHome} pen)`
                    : "";
                return (
                  <li key={m.id}>
                    <span className="comp-round">{m.roundLabel}</span>
                    <span className="comp-opp">{home ? "thuis" : "uit"} vs {opp}</span>
                    <span className="comp-res">{played ? `${gf}–${ga}${pens}` : formatShort(m.date)}</span>
                  </li>
                );
              })}
            </ul>
            {champ && champ !== myId && (
              <div className="comp-champ">Winnaar: {teamName(champ)}</div>
            )}
          </section>
        );
      })}
      {knockouts.length === 0 && (
        <section className="ch-panel"><div className="ch-done">Geen beker-/Europese deelname dit seizoen.</div></section>
      )}
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

function TransfersView({ save, onUpdate }: { save: CareerSave; onUpdate: (s: CareerSave) => void }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const myTeam = ws.teams.find((t) => t.id === myId)!;
  const [posFilter, setPosFilter] = useState<string>("");
  const windowOpen = transferWindowOpen(save);

  const clubName = (id: UUID | null): string =>
    id ? (ws.teams.find((t) => t.id === id)?.name ?? "?") : "vrij";

  const market = useMemo(
    () => transferTargets(save, { position: posFilter || undefined, limit: 40 }),
    [save, posFilter],
  );
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
      <section className="ch-panel ch-fin">
        <h2>Financiën</h2>
        <div className="fin-grid">
          <div><span>Saldo</span><strong>{money(myTeam.finances.balance)}</strong></div>
          <div><span>Transferbudget</span><strong>{money(myTeam.finances.transferBudget)}</strong></div>
          <div><span>Loon/week</span><strong>{money(weeklyWageBill(save, myId))}</strong></div>
          <div><span>Selectie</span><strong>{squadSize(save, myId)}</strong></div>
        </div>
        <div className={`fin-window${windowOpen ? " open" : ""}`}>
          Transferperiode {windowOpen ? "open" : "gesloten"}
        </div>

        <h3 className="ch-recent-title">Mijn selectie — verkopen</h3>
        <ul className="tr-sell">
          {mySquad.map(({ p, ovr }) => (
            <li key={p.id}>
              <span className="tr-pos">{p.preferredPositions[0]}</span>
              <span className="tr-name">{p.firstName[0]}. {p.lastName}</span>
              <span className="tr-ovr">{ovr}</span>
              <span className="tr-val">{money(p.market.estimatedValue)}</span>
              <button
                className="btn tr-btn"
                disabled={!windowOpen || squadSize(save, myId) <= 14}
                onClick={() => sell(p.id)}
              >
                Verkoop
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="ch-panel ch-market">
        <div className="market-head">
          <h2>Transfermarkt</h2>
          <select className="cs-input tr-filter" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
            <option value="">Alle posities</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <ul className="tr-market">
          {market.map((p) => {
            const can = canBuy(save, p.id);
            return (
              <li key={p.id}>
                <span className="tr-pos">{p.preferredPositions[0]}</span>
                <span className="tr-name">{p.firstName[0]}. {p.lastName}</span>
                <span className="tr-club">{clubName(p.teamId)}</span>
                <span className="tr-ovr">{playerOverall(p)}</span>
                <span className="tr-val">{money(askingPrice(p))}</span>
                <button className="btn tr-btn" disabled={!can.ok} title={can.reason ?? ""} onClick={() => buy(p.id)}>
                  Koop
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
