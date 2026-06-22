import { useMemo, useState } from "react";
import type { MatchConfig } from "@pitch/engine";
import { Rng } from "@pitch/shared";
import { buildWorld } from "@pitch/sim-data";
import { worldMatchConfig } from "./careerMatch.js";

interface Props {
  onStart: (config: MatchConfig) => void;
  onCancel: () => void;
}

export function QuickMatchSetup({ onStart, onCancel }: Props) {
  const [seed] = useState(() => (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1);
  const world = useMemo(() => buildWorld(new Rng(seed), 2025), [seed]);

  // Land -> divisie (competitie) -> clubs (zoals bij de carrière-setup).
  const countries = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>();
    for (const d of world.divisions) map.set(d.countryCode, { code: d.countryCode, name: d.countryName });
    return [...map.values()];
  }, [world]);

  const [countryCode, setCountryCode] = useState(countries[0]?.code ?? "");
  const divisions = useMemo(
    () => world.divisions.filter((d) => d.countryCode === countryCode).sort((a, b) => a.tier - b.tier),
    [world, countryCode],
  );
  const [divisionId, setDivisionId] = useState(divisions[0]?.id ?? "");
  const effectiveDivisionId = divisions.some((d) => d.id === divisionId) ? divisionId : divisions[0]?.id ?? "";
  if (effectiveDivisionId !== divisionId) setDivisionId(effectiveDivisionId);

  const teams = useMemo(() => {
    return world.teams
      .filter((t) => t.divisionId === effectiveDivisionId)
      .map((t) => ({ team: t, rating: world.ratings.get(t.id) ?? 50 }))
      .sort((a, b) => b.rating - a.rating);
  }, [world, effectiveDivisionId]);

  const [homeId, setHomeId] = useState("");
  const [awayId, setAwayId] = useState("");

  // Klikken kiest eerst de thuisclub, daarna de uitclub; opnieuw klikken op de
  // gekozen club maakt 'm weer vrij.
  const pick = (id: string) => {
    if (id === homeId) return setHomeId("");
    if (id === awayId) return setAwayId("");
    if (!homeId) return setHomeId(id);
    setAwayId(id);
  };

  const canStart = homeId && awayId && homeId !== awayId;
  const start = () => {
    if (!canStart) return;
    onStart(worldMatchConfig(world, homeId, awayId, seed));
  };

  return (
    <div className="career-setup">
      <div className="cs-head">
        <h1>Snelle wedstrijd</h1>
        <button className="btn" onClick={onCancel}>
          Terug
        </button>
      </div>

      <div className="cs-grid">
        <div className="cs-col">
          <label className="cs-label">Land</label>
          <div className="cs-list">
            {countries.map((c) => (
              <button
                key={c.code}
                className={`cs-item${c.code === countryCode ? " sel" : ""}`}
                onClick={() => setCountryCode(c.code)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="cs-col">
          <label className="cs-label">Competitie</label>
          <div className="cs-list">
            {divisions.map((d) => (
              <button
                key={d.id}
                className={`cs-item${d.id === effectiveDivisionId ? " sel" : ""}`}
                onClick={() => setDivisionId(d.id)}
              >
                {d.name} <span className="cs-tier">tier {d.tier}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cs-col cs-col-wide">
          <label className="cs-label">
            Clubs <span className="cs-tier">{homeId ? (awayId ? "thuis vs uit" : "kies de uitclub") : "kies de thuisclub"}</span>
          </label>
          <div className="cs-list cs-clubs">
            {teams.map(({ team, rating }) => {
              const role = team.id === homeId ? " home" : team.id === awayId ? " away" : "";
              return (
                <button
                  key={team.id}
                  className={`cs-item${role ? " sel" : ""}${role}`}
                  onClick={() => pick(team.id)}
                >
                  <span className="cs-chip" style={{ background: team.colors.primary }} />
                  <span className="cs-club-name">{team.name}</span>
                  {team.id === homeId && <span className="cs-tier">THUIS</span>}
                  {team.id === awayId && <span className="cs-tier">UIT</span>}
                  <span className="cs-rating">{rating}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="cs-foot">
        <button className="btn primary" disabled={!canStart} onClick={start}>
          Speel wedstrijd
        </button>
      </div>
    </div>
  );
}
