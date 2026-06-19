import { useMemo, useState } from "react";
import { Rng, hashSeed, type CareerSave, type Match, type Player, type TrainingFocus, type UUID } from "@pitch/shared";
import {
  askingPrice,
  buyPlayer,
  canBuy,
  divisionStandings,
  formatShort,
  acceptJobOffer,
  computeStandings,
  declineJobOffers,
  knockoutChampion,
  myYouthProspects,
  playMatchday,
  playerOverall,
  potentialStars,
  simulateRemaining,
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

  const [tab, setTab] = useState<
    "overzicht" | "selectie" | "training" | "jeugd" | "kalender" | "transfers" | "competities"
  >("overzicht");

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
              className={`ch-tab${tab === "training" ? " sel" : ""}`}
              onClick={() => setTab("training")}
            >
              Training
            </button>
            <button
              className={`ch-tab${tab === "jeugd" ? " sel" : ""}`}
              onClick={() => setTab("jeugd")}
            >
              Jeugd
            </button>
            <button
              className={`ch-tab${tab === "kalender" ? " sel" : ""}`}
              onClick={() => setTab("kalender")}
            >
              Kalender
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

      {tab === "training" && <TrainingView focus={focus} setFocus={setFocus} />}

      {tab === "jeugd" && <YouthView save={save} />}

      {tab === "kalender" && <CalendarView save={save} />}

      {tab === "competities" && <CompetitionsView save={save} />}

      {tab === "transfers" && <TransfersView save={save} onUpdate={onUpdate} />}

      <div className="ch-body" style={tab !== "overzicht" ? { display: "none" } : undefined}>
        <section className="ch-panel ch-next">
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
          <div className={`ch-objective${objective.met ? " ok" : " behind"}`}>
            <span className="ch-obj-label">Bestuursdoel</span>
            <span className="ch-obj-text">{objective.text}</span>
            <span className="ch-obj-rank">
              nu {objective.currentRank ?? "?"}e · doel ≤ {objective.targetRank}e
            </span>
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
              <h3 className="ch-recent-title">
                Ook deze speeldag — {compName(nextMatch.competitionId)}
              </h3>
              <ul className="ch-dayfix">
                {ws.matches
                  .filter(
                    (m) =>
                      m.competitionId === nextMatch.competitionId &&
                      m.date === nextMatch.date &&
                      m.id !== nextMatch.id,
                  )
                  .slice(0, 8)
                  .map((m) => (
                    <li key={m.id}>
                      <span className="ch-dayfix-h">{teamShort(m.homeTeamId)}</span>
                      <span className="ch-vs">–</span>
                      <span className="ch-dayfix-a">{teamShort(m.awayTeamId)}</span>
                    </li>
                  ))}
              </ul>
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
            <div className="ch-season-end">
              <div className="ch-done">
                Geen eigen wedstrijd meer, maar er lopen nog toernooien.
              </div>
              <button className="btn primary" onClick={simulateRest}>
                Speel resterende wedstrijden
              </button>
            </div>
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
        return <td key={c.key}>{typeof v === "number" ? Math.round(v) : "-"}</td>;
      })}
      <td className="ch-pts">{ovr}</td>
    </tr>
  );
}

/** Trainingstab: kies de wekelijkse focus + uitleg wat training doet. */
function TrainingView({
  focus,
  setFocus,
}: {
  focus: TrainingFocus;
  setFocus: (f: TrainingFocus) => void;
}) {
  const active = TRAINING_OPTS.find((o) => o.id === focus)!;
  return (
    <div className="ch-body ch-traintab">
      <section className="ch-panel">
        <h2>Training</h2>
        <p className="ch-train-intro">
          Elke speelweek traint je selectie. Spelers groeien richting hun verborgen{" "}
          <strong>potentieel</strong>: jonge spelers stijgen het snelst, rond hun piek (±27 jaar,
          keepers later) vlakt het af en daarna lopen ze langzaam terug — fysiek het eerst.
          Professionaliteit bepaalt hoe hard iemand groeit. De gekozen focus stuurt{" "}
          <strong>welke</strong> eigenschappen sneller stijgen; conditie, scherpte en vorm herstellen
          na elke wedstrijd.
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
    </div>
  );
}

/** Kalender: alle speelrondes van alle competities, gegroepeerd per datum. */
function CalendarView({ save }: { save: CareerSave }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const teamShort = (id: UUID): string => ws.teams.find((t) => t.id === id)?.shortName ?? "?";
  const compName = (id: UUID): string =>
    ws.competitions.find((c) => c.id === id)?.name ?? "?";

  // Groepeer per datum -> per competitie (ronde + of mijn club speelt).
  const byDate = useMemo(() => {
    const map = new Map<
      string,
      Map<UUID, { round: string; mine: Match | null; count: number }>
    >();
    for (const m of ws.matches.filter((x) => x.seasonId === ws.activeSeasonId)) {
      const comps = map.get(m.date) ?? new Map();
      const entry = comps.get(m.competitionId) ?? { round: m.roundLabel, mine: null, count: 0 };
      entry.count += 1;
      if (m.homeTeamId === myId || m.awayTeamId === myId) entry.mine = m;
      comps.set(m.competitionId, entry);
      map.set(m.date, comps);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ws.matches, ws.activeSeasonId, myId]);

  const today = save.worldState.seasons.find((s) => s.id === ws.activeSeasonId)?.currentDate ?? "";

  return (
    <div className="ch-body">
      <section className="ch-panel ch-cal">
        <h2>Kalender — {save.worldState.seasons.find((s) => s.id === ws.activeSeasonId)?.label}</h2>
        <ul className="cal-list">
          {byDate.map(([date, comps]) => (
            <li key={date} className={`cal-day${date === today ? " now" : ""}`}>
              <div className="cal-date">{formatShort(date)}</div>
              <ul className="cal-comps">
                {[...comps.entries()].map(([cid, e]) => (
                  <li key={cid} className={e.mine ? "cal-mine" : ""}>
                    <span className="cal-cname">{compName(cid)}</span>
                    <span className="cal-round">{e.round}</span>
                    {e.mine ? (
                      <span className="cal-fix">
                        {teamShort(e.mine.homeTeamId)}
                        {e.mine.state === "played"
                          ? ` ${e.mine.score.home}–${e.mine.score.away} `
                          : " – "}
                        {teamShort(e.mine.awayTeamId)}
                      </span>
                    ) : (
                      <span className="cal-count">{e.count} wedstrijden</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
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
  const teamShort = (id: UUID): string => ws.teams.find((t) => t.id === id)?.shortName ?? "?";

  // Mijn hoofdcompetitie eerst, dan mijn beker/Europese toernooien.
  const myComps = useMemo(() => {
    const mine = ws.competitions.filter(
      (c) => c.seasonId === ws.activeSeasonId && c.teamIds.includes(myId),
    );
    const order = (c: (typeof mine)[number]): number =>
      c.scope === "league" ? 0 : c.scope === "cl" ? 1 : c.scope === "el" ? 2 : c.scope === "ecl" ? 3 : 4;
    return mine.sort((a, b) => order(a) - order(b));
  }, [ws.competitions, ws.activeSeasonId, myId]);

  const [selId, setSelId] = useState<UUID>(myComps[0]?.id ?? "");
  const comp = myComps.find((c) => c.id === selId) ?? myComps[0];

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

  return (
    <div className="ch-body ch-compdetail">
      <section className="ch-panel ch-complist">
        <h2>Competities</h2>
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
                  <td className="ch-tn">{teamName(r.teamId)}</td>
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
                      <span className="cd-h">{teamShort(m.homeTeamId)}</span>
                      <span className="cd-score">
                        {played ? `${m.score.home}–${m.score.away}${pens}` : "–"}
                      </span>
                      <span className="cd-a">{teamShort(m.awayTeamId)}</span>
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

function TransfersView({ save, onUpdate }: { save: CareerSave; onUpdate: (s: CareerSave) => void }) {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const myTeam = ws.teams.find((t) => t.id === myId)!;
  const [posFilter, setPosFilter] = useState<string>("");
  const [detail, setDetail] = useState<Player | null>(null);
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
              <button className="tr-name tr-link" onClick={() => setDetail(p)}>
                {p.firstName[0]}. {p.lastName}
              </button>
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
                <button className="tr-name tr-link" onClick={() => setDetail(p)}>
                  {p.firstName[0]}. {p.lastName}
                </button>
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
