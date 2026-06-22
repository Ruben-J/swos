import { useEffect, useState } from "react";
import type { CareerSave } from "@pitch/shared";
import { divisionStandings, effectiveTransferBudget, seasonObjective } from "@pitch/sim-data";
import { listSaves } from "../storage/saves.js";

interface Props {
  onQuickMatch: () => void;
  onCareer: () => void;
  onLoadCareer: () => void;
  onContinue: (save: CareerSave) => void;
}

const TICKER =
  "TRANSFER: M. OKAFOR → HULL €2.4M   ///   UITSLAG: HULL 6-1 IPSWICK   ///   J. HALVORSEN TEKENT BIJ T/M 2028   ///   BLESSURE: L. PEREIRA 2 WKN   ///   NORWICK PAKT KOPPOSITIE   ///   SCOUT: 17-JARIG TALENT GESPOT   ///   ";

// Compacte SVG-iconen (stroke = currentColor) voor de menukaarten.
function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

interface Item {
  label: string;
  icon: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}

/** Korte geldnotatie: €4.2M / €450k. */
function money(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `€${Math.round(n / 1_000)}k`;
  return `€${Math.round(n)}`;
}

interface Summary {
  name: string;
  abbr: string;
  primary: string;
  secondary: string;
  sub: string;
  form: string;
  budget: string;
  goal: string;
}

// Vat de laatste save samen voor de doorgaan-kaart — met echte clubdata.
function summarize(save: CareerSave): Summary {
  const ws = save.worldState;
  const myId = save.manager.currentTeamId;
  const team = ws.teams.find((t) => t.id === myId);
  const season = ws.seasons.find((s) => s.id === ws.activeSeasonId);
  const fallback: Summary = {
    name: team?.name ?? "Onbekend",
    abbr: (team?.shortName ?? "??").slice(0, 3).toUpperCase(),
    primary: team?.colors.primary ?? "#3a4a32",
    secondary: team?.colors.secondary ?? "#b6ff3a",
    sub: season?.label ?? "",
    form: "—",
    budget: team ? money(effectiveTransferBudget(save, myId)) : "—",
    goal: "—",
  };
  if (!team) return fallback;

  // Stand → huidige positie.
  let rank: number | undefined;
  try {
    rank = divisionStandings(save, team.divisionId).find((r) => r.teamId === myId)?.rank;
  } catch {
    rank = undefined;
  }

  // Vorm: laatste vijf gespeelde wedstrijden.
  const recent = ws.matches
    .filter((m) => m.state === "played" && (m.homeTeamId === myId || m.awayTeamId === myId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);
  let w = 0;
  let d = 0;
  let v = 0;
  for (const m of recent) {
    const home = m.homeTeamId === myId;
    const gf = home ? m.score.home : m.score.away;
    const ga = home ? m.score.away : m.score.home;
    if (gf > ga) w++;
    else if (gf < ga) v++;
    else d++;
  }
  const form = recent.length ? `${w}W ${d > 0 ? `${d}G ` : ""}${v}V` : "—";

  // Doel: bestuursdoel (target-positie).
  let goal = "—";
  try {
    const obj = seasonObjective(save, myId);
    goal = obj.targetRank ? `Top ${obj.targetRank}` : obj.text;
  } catch {
    goal = "—";
  }

  return {
    ...fallback,
    sub: `${season?.label ?? ""}${rank ? ` · ${rank}e plaats` : ""}`,
    form,
    goal,
  };
}

export function MainMenu({ onQuickMatch, onCareer, onLoadCareer, onContinue }: Props) {
  const [saves, setSaves] = useState<CareerSave[]>([]);

  useEffect(() => {
    listSaves()
      .then(setSaves)
      .catch(() => setSaves([]));
  }, []);

  const latest = saves[0] ?? null;
  const summary = latest ? summarize(latest) : null;

  const items: Item[] = [
    { label: "Nieuwe carrière", icon: '<path d="M12 5v14M5 12h14"/>', onClick: onCareer, primary: true },
    { label: "Carrière laden", icon: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7"/>', onClick: onLoadCareer },
    { label: "Snelle wedstrijd", icon: '<path d="M8 5v14l11-7z"/>', onClick: onQuickMatch },
    {
      label: "Opties",
      icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
      disabled: true,
    },
  ];

  return (
    <div className="menu">
      <svg className="menu-pitch" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <rect x="40" y="40" width="1360" height="820" />
        <circle cx="720" cy="450" r="150" />
        <line x1="720" y1="40" x2="720" y2="860" />
        <rect x="40" y="300" width="180" height="300" />
        <rect x="1220" y="300" width="180" height="300" />
      </svg>

      <div className={`menu-center${summary ? "" : " solo"}`}>
        <div className="menu-left">
          <div className="menu-badge">
            <span />
            <span>Manager · seizoen 2025/26</span>
          </div>

          <h1>
            PITCH
            <br />
            <span className="lime">LEGEND</span>
          </h1>

          <p className="tagline">Bouw een dynastie. Eén wedstrijd per keer.</p>

          <div className="menu-buttons">
            {items.map((m) => (
              <button
                key={m.label}
                className={`menu-card${m.primary ? " primary" : ""}`}
                onClick={m.onClick}
                disabled={m.disabled}
                title={m.disabled ? "Komt in een latere fase" : undefined}
              >
                <span className="menu-card-icon">
                  <Icon d={m.icon} />
                </span>
                <span className="menu-card-label">{m.label}</span>
                <span className="menu-card-chev">›</span>
              </button>
            ))}
          </div>
        </div>

        {summary && latest && (
          <div className="menu-right">
            <div className="continue-card">
              <div className="cc-label">Doorgaan · laatste opslag</div>
              <div className="cc-team">
                <div
                  className="cc-crest"
                  style={{
                    background: `linear-gradient(135deg, ${summary.primary}, ${summary.secondary})`,
                    color: summary.secondary,
                  }}
                >
                  {summary.abbr}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="cc-name">{summary.name}</div>
                  <div className="cc-sub">{summary.sub}</div>
                </div>
              </div>
              <div className="cc-tiles">
                <div className="cc-tile">
                  <div className="cc-tile-label">Vorm</div>
                  <div className="cc-tile-val" style={{ color: "var(--accent)" }}>
                    {summary.form}
                  </div>
                </div>
                <div className="cc-tile">
                  <div className="cc-tile-label">Budget</div>
                  <div className="cc-tile-val" style={{ color: "var(--accent-2)" }}>
                    {summary.budget}
                  </div>
                </div>
                <div className="cc-tile">
                  <div className="cc-tile-label">Doel</div>
                  <div className="cc-tile-val" style={{ color: "#f4f6ef" }}>
                    {summary.goal}
                  </div>
                </div>
              </div>
              <button className="cc-btn" onClick={() => onContinue(latest)}>
                ▶ Doorgaan
              </button>
            </div>
            <div className="cc-foot">
              {saves.length} opgeslagen {saves.length === 1 ? "carrière" : "carrières"}
            </div>
          </div>
        )}
      </div>

      <div className="menu-ticker">
        <div className="menu-ticker-track">
          <span>{TICKER}</span>
          <span>{TICKER}</span>
        </div>
      </div>
    </div>
  );
}
