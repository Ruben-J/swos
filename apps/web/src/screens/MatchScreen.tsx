import { useEffect, useRef, useState } from "react";
import type { MatchConfig, MatchSnapshot, MatchSnapshotPlayer, Side } from "@pitch/engine";
import { RULES } from "@pitch/shared";
import { MatchController } from "../match/MatchController.js";
import { ClubCrest } from "../components/ClubCrest";

interface Props {
  config: MatchConfig;
  onExit: () => void;
  /** Career: vuurt eenmalig bij fulltime met de eindstand. */
  onFinish?: (homeGoals: number, awayGoals: number) => void;
}

const PHASE_LABEL: Record<string, string> = {
  kickoff: "Aftrap",
  goal: "GOAL!",
  halftime: "Rust",
  fulltime: "Einde",
  deadball: "Spelhervatting",
};

export function MatchScreen({ config, onExit, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const finishedRef = useRef(false);

  // Tijdens de opkomst (spelers lopen het veld op) tonen we beide opstellingen.
  const inWalkout = snap?.phase === "walkout";

  useEffect(() => {
    if (!snap || finishedRef.current) return;
    if (snap.phase === "fulltime") {
      finishedRef.current = true;
      onFinish?.(snap.score.home, snap.score.away);
    }
  }, [snap, onFinish]);

  // De wedstrijd verlaten kan met Escape (er is geen zichtbare terugknop meer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let controller: MatchController | null = null;
    let disposed = false;

    MatchController.create(canvas, config, setSnap).then((c) => {
      if (disposed) {
        c.destroy();
        return;
      }
      controller = c;
      c.start();
    });

    return () => {
      disposed = true;
      controller?.destroy();
    };
  }, [config]);

  const clock = snap ? formatClock(snap.matchMinute) : "0'";
  const phaseLabel = snap?.awaitingHumanRestart
    ? "Druk op X of Z om in te nemen"
    : snap && snap.phase in PHASE_LABEL
      ? PHASE_LABEL[snap.phase]
      : null;

  const homeActive = activeOf(snap, "home");
  const awayActive = activeOf(snap, "away");

  return (
    <div className="match-screen">
      <div className="pitch-wrap">
        <canvas ref={canvasRef} />

        {/* TV-scorebug linksboven. */}
        <div className="scorebug">
          <ClubCrest name={config.home.name} primary={config.home.colorPrimary} secondary={config.home.colorSecondary} size={20} />
          <span className="sb-team">{config.home.shortName}</span>
          <span className="sb-score">
            {snap?.score.home ?? 0}&ndash;{snap?.score.away ?? 0}
          </span>
          <span className="sb-team">{config.away.shortName}</span>
          <ClubCrest name={config.away.name} primary={config.away.colorPrimary} secondary={config.away.colorSecondary} size={20} />
          <span className="sb-clock">{clock}</span>
        </div>

        {phaseLabel && <div className="phase-banner">{phaseLabel}</div>}

        {inWalkout && <LineupsOverlay config={config} />}

        {!inWalkout && snap && showBoard(snap) && (
          <RestartBoard config={config} snap={snap} />
        )}

        {/* Geselecteerde spelers + sprint, tv-naamplaatjes onderin. */}
        <PlayerCard
          player={homeActive}
          team={config.home}
          align="left"
          human={config.humanSide === "home"}
          stamina={snap?.activeStamina ?? 1}
          exhausted={snap?.activeExhausted ?? false}
        />
        <PlayerCard
          player={awayActive}
          team={config.away}
          align="right"
          human={config.humanSide === "away"}
          stamina={snap?.activeStamina ?? 1}
          exhausted={snap?.activeExhausted ?? false}
        />

        {snap && snap.phase !== "walkout" && <Radar snap={snap} config={config} />}
      </div>
    </div>
  );
}

/** Radar/minimap: top-down mini-veld met een stip per speler (in teamkleur) en de
 *  bal. Draait met de hoofdcamera mee (1e helft valt home omhoog aan; 2e helft
 *  gespiegeld), zodat "boven op de radar" = "boven op het scherm". */
function Radar({ snap, config }: { snap: MatchSnapshot; config: MatchConfig }) {
  const flip = snap.half >= 2;
  // Sim: x in [0,105] (lengte) -> verticale as; y in [0,68] (breedte) -> horizontaal.
  const rx = (p: { x: number; y: number }): number => (flip ? 68 - p.y : p.y);
  const ry = (p: { x: number; y: number }): number => (flip ? p.x : 105 - p.x);
  const homeCol = config.home.colorPrimary;
  const awayCol = config.away.colorPrimary;
  return (
    <div className="match-radar">
      <svg viewBox="0 0 68 105">
        <rect className="rdr-bg" x="0.6" y="0.6" width="66.8" height="103.8" rx="2" />
        <line className="rdr-ln" x1="0.6" y1="52.5" x2="67.4" y2="52.5" />
        <circle className="rdr-ln" cx="34" cy="52.5" r="9.15" />
        <rect className="rdr-ln" x="13.84" y="0.6" width="40.32" height="16.5" />
        <rect className="rdr-ln" x="13.84" y="87.9" width="40.32" height="16.5" />
        {snap.players.map((p) => {
          const mine = config.humanSide === p.side && p.isActive;
          return (
            <circle
              key={p.id}
              cx={rx(p)}
              cy={ry(p)}
              r={mine ? 3.4 : 2.5}
              fill={p.side === "home" ? homeCol : awayCol}
              className={mine ? "rdr-me" : "rdr-dot"}
            />
          );
        })}
        <circle className="rdr-ball" cx={rx(snap.ball)} cy={ry(snap.ball)} r="1.8" />
      </svg>
    </div>
  );
}

interface CardProps {
  player: MatchSnapshotPlayer | null;
  team: MatchConfig["home"];
  align: "left" | "right";
  human: boolean;
  stamina: number;
  exhausted: boolean;
}

function PlayerCard({ player, team, align, human, stamina, exhausted }: CardProps) {
  if (!player) return null;
  return (
    <div className={`player-card ${align}`}>
      <div
        className="pc-number"
        style={{ background: team.colorPrimary, color: team.colorSecondary }}
      >
        {player.shirtNumber}
      </div>
      <div className="pc-info">
        <div className="pc-name">
          {player.firstName[0]}. {player.lastName}
        </div>
        <div className="pc-line">
          <span className="pc-pos">{player.position}</span>
          {player.hasBall && <span className="pc-ball">●</span>}
        </div>
        {human && (
          <div className="pc-stamina">
            <div className="pc-stamina-track">
              <div
                className={`pc-stamina-fill${exhausted ? " empty" : ""}`}
                style={{ width: `${Math.round(stamina * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function activeOf(snap: MatchSnapshot | null, side: Side): MatchSnapshotPlayer | null {
  if (!snap) return null;
  return snap.players.find((p) => p.side === side && p.isActive) ?? null;
}

function formatClock(minute: number): string {
  return `${Math.min(minute, RULES.matchMinutes)}'`;
}

type LineupTeam = MatchConfig["home"];

/** Opkomst: beide opstellingen links (thuis) en rechts (uit) + formatie-diagram. */
function LineupsOverlay({ config }: { config: MatchConfig }) {
  return (
    <div className="lineups-overlay">
      <TeamLineup team={config.home} align="left" />
      <TeamLineup team={config.away} align="right" />
    </div>
  );
}

function TeamLineup({ team, align }: { team: LineupTeam; align: "left" | "right" }) {
  return (
    <div className={`lineup-card lineup-${align}`}>
      <div className="intro-team">
        <ClubCrest name={team.name} primary={team.colorPrimary} secondary={team.colorSecondary} size={30} />
        <span className="intro-name">{team.name}</span>
      </div>
      <FormationPitch team={team} />
      <ul className="intro-list">
        {team.players.map((p) => (
          <li key={p.id}>
            <span className="intro-num" style={{ background: team.colorPrimary, color: team.colorSecondary }}>
              {p.shirtNumber}
            </span>
            <span className="intro-pos">{p.position}</span>
            <span className="intro-pname">
              {p.firstName[0]}. {p.lastName}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mini-veld met de spelers op hun formatieplek (rugnummers). */
function FormationPitch({ team }: { team: LineupTeam }) {
  const spots = layoutFormation(team.players, team.formationName);
  return (
    <svg className="formation-pitch" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet">
      <rect x="1" y="1" width="98" height="138" rx="3" className="fp-bg" />
      <line x1="1" y1="70" x2="99" y2="70" className="fp-line" />
      <circle cx="50" cy="70" r="11" className="fp-line" fill="none" />
      {spots.map((s) => (
        <g key={s.num} transform={`translate(${s.x} ${s.y})`}>
          <circle r="6.5" style={{ fill: team.colorPrimary }} />
          <text className="fp-num" style={{ fill: team.colorSecondary }} textAnchor="middle" dominantBaseline="central">
            {s.num}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Plaats spelers op een verticaal mini-veld op basis van de FORMATIE (niet het
 * losse positie-label): "4-4-2" -> linies [GK, 4 verdedigers, 4 middenvelders,
 * 2 aanvallers]. De spelerslijst staat in formatie-volgorde (GK eerst), dus we
 * delen die op in opeenvolgende linies. Zo zie je echt 4-4-2 i.p.v. 4 voorin.
 */
function layoutFormation(
  players: LineupTeam["players"],
  formationName: string | undefined,
): { num: number; x: number; y: number }[] {
  const segs = (formationName ?? "4-4-2").split("-").map((n) => parseInt(n, 10)).filter((n) => n > 0);
  const lineSizes = [1, ...(segs.length ? segs : [4, 4, 2])]; // GK + linies
  const xHint = (pos: string): number =>
    pos === "RB" || pos === "RW" ? 1 : pos === "LB" || pos === "LW" ? -1 : 0;
  const nLines = lineSizes.length;
  // y per linie: GK onderaan (122), aanval bovenaan (~26).
  const yAt = (line: number): number => 122 - (line / (nLines - 1)) * 96;

  const out: { num: number; x: number; y: number }[] = [];
  let idx = 0;
  lineSizes.forEach((size, line) => {
    const group = players.slice(idx, idx + size);
    idx += size;
    const sorted = [...group].sort((a, b) => xHint(a.position) - xHint(b.position) || a.shirtNumber - b.shirtNumber);
    const n = sorted.length;
    // Symmetrisch rond het midden (50), met begrensde tussenafstand: zo staan
    // bv. de 2 spitsen in een 4-4-2 netjes gecentreerd i.p.v. aan de zijkanten.
    const spacing = n > 1 ? Math.min(20, 64 / (n - 1)) : 0;
    sorted.forEach((p, i) => {
      const x = 50 + (i - (n - 1) / 2) * spacing;
      out.push({ num: p.shirtNumber, x, y: yAt(line) });
    });
  });
  return out;
}

/** Toon het grote scorebord bij doelpunt, rust, einde en hervattings-aftrap. */
function showBoard(snap: MatchSnapshot): boolean {
  if (snap.phase === "goal" || snap.phase === "halftime" || snap.phase === "fulltime") return true;
  if (snap.phase === "kickoff" && (snap.goals.length > 0 || snap.half > 1)) return true;
  return false;
}

const BOARD_TITLE: Record<string, string> = {
  goal: "GOAL!",
  halftime: "RUST",
  fulltime: "EINDE",
  kickoff: "AFTRAP",
};

function RestartBoard({ config, snap }: { config: MatchConfig; snap: MatchSnapshot }) {
  const homeGoals = snap.goals.filter((g) => g.side === "home");
  const awayGoals = snap.goals.filter((g) => g.side === "away");
  const line = (g: { scorer: string; minute: number; ownGoal: boolean }): string =>
    `${g.scorer}${g.ownGoal ? " (e.d.)" : ""} ${g.minute}'`;
  return (
    <div className="restart-board">
      <div className="rb-title">{BOARD_TITLE[snap.phase] ?? ""}</div>
      <div className="rb-main">
        <div className="rb-team rb-home">
          <ClubCrest name={config.home.name} primary={config.home.colorPrimary} secondary={config.home.colorSecondary} size={30} />
          <span className="rb-name">{config.home.name}</span>
        </div>
        <div className="rb-score">
          {snap.score.home}&ndash;{snap.score.away}
        </div>
        <div className="rb-team rb-away">
          <span className="rb-name">{config.away.name}</span>
          <ClubCrest name={config.away.name} primary={config.away.colorPrimary} secondary={config.away.colorSecondary} size={30} />
        </div>
      </div>
      <div className="rb-scorers">
        <ul className="rb-list rb-list-home">
          {homeGoals.map((g, i) => (
            <li key={i}>{line(g)}</li>
          ))}
        </ul>
        <ul className="rb-list rb-list-away">
          {awayGoals.map((g, i) => (
            <li key={i}>{line(g)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
