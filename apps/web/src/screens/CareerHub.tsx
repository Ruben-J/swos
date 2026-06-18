import { useMemo } from "react";
import { Rng, hashSeed, type CareerSave, type Match, type UUID } from "@pitch/shared";
import {
  divisionStandings,
  formatShort,
  playMatchday,
  seasonComplete,
  teamNextMatch,
} from "@pitch/sim-data";

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

  const nextMatch = useMemo(() => teamNextMatch(ws.matches, myTeamId), [ws.matches, myTeamId]);
  const standings = useMemo(() => divisionStandings(save, myTeam.divisionId), [save, myTeam.divisionId]);
  const done = useMemo(() => seasonComplete(save), [save]);

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
          <div className="ch-date">{formatShort(season.currentDate)}</div>
          <button className="btn" onClick={onExit}>
            Opslaan &amp; terug
          </button>
        </div>
      </header>

      <div className="ch-body">
        <section className="ch-panel ch-next">
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
                {nextMatch.roundLabel} · {formatShort(nextMatch.date)}
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
