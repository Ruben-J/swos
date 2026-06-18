import { useEffect, useState } from "react";
import type { CareerSave } from "@pitch/shared";
import { deleteSave, listSaves } from "../storage/saves.js";

interface Props {
  onLoad: (save: CareerSave) => void;
  onCancel: () => void;
}

export function CareerLoad({ onLoad, onCancel }: Props) {
  const [saves, setSaves] = useState<CareerSave[] | null>(null);

  const refresh = () => {
    listSaves().then(setSaves).catch(() => setSaves([]));
  };
  useEffect(refresh, []);

  const remove = (id: string) => {
    void deleteSave(id).then(refresh);
  };

  const clubName = (s: CareerSave): string =>
    s.worldState.teams.find((t) => t.id === s.manager.currentTeamId)?.name ?? "?";
  const seasonLabel = (s: CareerSave): string =>
    s.worldState.seasons.find((se) => se.id === s.worldState.activeSeasonId)?.label ?? "";

  return (
    <div className="career-setup">
      <div className="cs-head">
        <h1>Carrière laden</h1>
        <button className="btn" onClick={onCancel}>
          Terug
        </button>
      </div>

      <div className="cl-list">
        {saves === null && <div className="ch-done">Laden…</div>}
        {saves !== null && saves.length === 0 && (
          <div className="ch-done">Nog geen opgeslagen carrières.</div>
        )}
        {saves?.map((s) => (
          <div key={s.id} className="cl-item">
            <button className="cl-main" onClick={() => onLoad(s)}>
              <div className="cl-club">{clubName(s)}</div>
              <div className="cl-meta">
                {s.manager.name} · seizoen {seasonLabel(s)} ·{" "}
                {new Date(s.updatedAt).toLocaleDateString("nl-NL")}
              </div>
            </button>
            <button className="btn cl-del" onClick={() => remove(s.id)} title="Verwijder">
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
