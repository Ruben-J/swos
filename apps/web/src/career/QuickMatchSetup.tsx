import { useMemo, useState } from "react";
import type { MatchConfig } from "@pitch/engine";
import { Rng, type UUID } from "@pitch/shared";
import { buildWorld } from "@pitch/sim-data";
import { worldMatchConfig } from "./careerMatch.js";

interface Props {
  onStart: (config: MatchConfig) => void;
  onCancel: () => void;
}

export function QuickMatchSetup({ onStart, onCancel }: Props) {
  const [seed] = useState(() => (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1);
  const world = useMemo(() => buildWorld(new Rng(seed), 2025), [seed]);

  // Teams gegroepeerd per land/divisie, gesorteerd op rating.
  const options = useMemo(() => {
    const divName = (id: UUID): string => world.divisions.find((d) => d.id === id)?.name ?? "";
    const divTier = (id: UUID): number => world.divisions.find((d) => d.id === id)?.tier ?? 9;
    const divCountry = (id: UUID): string => world.divisions.find((d) => d.id === id)?.countryName ?? "";
    return world.teams
      .map((t) => ({ id: t.id, name: t.name, div: divName(t.divisionId), country: divCountry(t.divisionId), tier: divTier(t.divisionId), rating: world.ratings.get(t.id) ?? 50 }))
      .sort((a, b) => a.country.localeCompare(b.country) || a.tier - b.tier || b.rating - a.rating);
  }, [world]);

  const [homeId, setHomeId] = useState(options[0]?.id ?? "");
  const [awayId, setAwayId] = useState(options[1]?.id ?? "");

  const label = (o: (typeof options)[number]): string => `${o.name} — ${o.div} (${o.country}) · ${o.rating}`;

  const start = () => {
    if (!homeId || !awayId || homeId === awayId) return;
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

      <div className="qm-pickers">
        <div className="qm-side">
          <label className="cs-label">Thuis</label>
          <select className="cs-input qm-select" value={homeId} onChange={(e) => setHomeId(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </div>
        <div className="qm-vs">vs</div>
        <div className="qm-side">
          <label className="cs-label">Uit</label>
          <select className="cs-input qm-select" value={awayId} onChange={(e) => setAwayId(e.target.value)}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {label(o)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cs-foot">
        <button className="btn primary" disabled={!homeId || !awayId || homeId === awayId} onClick={start}>
          Speel wedstrijd
        </button>
      </div>
    </div>
  );
}
