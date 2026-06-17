import { useMemo, useState } from "react";
import { Rng, type CareerSave } from "@pitch/shared";
import { buildWorld, createCareer } from "@pitch/sim-data";

interface Props {
  onStart: (save: CareerSave) => void;
  onCancel: () => void;
}

export function CareerSetup({ onStart, onCancel }: Props) {
  // Eén wereld per setup-sessie (vaste seed zodat de keuzelijst stabiel blijft).
  const [seed] = useState(() => (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1);
  const world = useMemo(() => buildWorld(new Rng(seed), 2025), [seed]);

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
  const activeDivision = divisions.find((d) => d.id === divisionId) ?? divisions[0];

  const teams = useMemo(() => {
    const divId = activeDivision?.id;
    return world.teams
      .filter((t) => t.divisionId === divId)
      .map((t) => ({ team: t, rating: world.ratings.get(t.id) ?? 50 }))
      .sort((a, b) => b.rating - a.rating);
  }, [world, activeDivision]);

  const [teamId, setTeamId] = useState("");
  const [manager, setManager] = useState("");

  // Houd selecties geldig bij wisselen van land/divisie.
  const effectiveDivisionId = divisions.some((d) => d.id === divisionId) ? divisionId : divisions[0]?.id ?? "";
  if (effectiveDivisionId !== divisionId) setDivisionId(effectiveDivisionId);

  const canStart = teamId && manager.trim().length > 0;

  const start = () => {
    if (!canStart) return;
    const save = createCareer(world, {
      seed,
      managerName: manager.trim(),
      teamId,
    });
    onStart(save);
  };

  return (
    <div className="career-setup">
      <div className="cs-head">
        <h1>Nieuwe carrière</h1>
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
          <label className="cs-label">Divisie</label>
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
          <label className="cs-label">Club</label>
          <div className="cs-list cs-clubs">
            {teams.map(({ team, rating }) => (
              <button
                key={team.id}
                className={`cs-item${team.id === teamId ? " sel" : ""}`}
                onClick={() => setTeamId(team.id)}
              >
                <span className="cs-chip" style={{ background: team.colors.primary }} />
                <span className="cs-club-name">{team.name}</span>
                <span className="cs-rating">{rating}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cs-foot">
        <input
          className="cs-input"
          placeholder="Naam manager"
          value={manager}
          onChange={(e) => setManager(e.target.value)}
        />
        <button className="btn primary" disabled={!canStart} onClick={start}>
          Start carrière
        </button>
      </div>
    </div>
  );
}
