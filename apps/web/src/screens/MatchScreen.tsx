import { useEffect, useRef, useState } from "react";
import type { MatchConfig, MatchSnapshot, MatchSnapshotPlayer, Side } from "@pitch/engine";
import { RULES } from "@pitch/shared";
import { MatchController } from "../match/MatchController.js";

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
          <span className="sb-chip" style={{ background: config.home.colorPrimary }} />
          <span className="sb-team">{config.home.shortName}</span>
          <span className="sb-score">
            {snap?.score.home ?? 0}&ndash;{snap?.score.away ?? 0}
          </span>
          <span className="sb-team">{config.away.shortName}</span>
          <span className="sb-chip" style={{ background: config.away.colorPrimary }} />
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

        <div className="match-topbar">
          <button className="btn" onClick={onExit}>
            Terug
          </button>
        </div>
      </div>
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
        <span className="intro-chip" style={{ background: team.colorPrimary }} />
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
  const spots = layoutFormation(team.players);
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

/** Plaats spelers op een verticaal mini-veld (GK onder, aanval boven). */
function layoutFormation(players: LineupTeam["players"]): { num: number; x: number; y: number }[] {
  const lineOf = (pos: string): number =>
    pos === "GK" ? 0 : "RB LB CB".includes(pos) ? 1 : pos === "DM" ? 2 : pos === "AM" ? 3 : "RW LW ST".includes(pos) ? 4 : 2.6;
  const xHint = (pos: string): number =>
    pos === "RB" || pos === "RW" ? 1 : pos === "LB" || pos === "LW" ? -1 : 0;
  const yForLine = [122, 100, 80, 55, 28];
  const yAt = (line: number): number => {
    const lo = yForLine[Math.floor(line)] ?? 70;
    const hi = yForLine[Math.ceil(line)] ?? lo;
    return lo + (hi - lo) * (line - Math.floor(line));
  };

  const byLine = new Map<number, LineupTeam["players"]>();
  for (const p of players) {
    const ln = lineOf(p.position);
    const arr = byLine.get(ln) ?? [];
    arr.push(p);
    byLine.set(ln, arr);
  }
  const out: { num: number; x: number; y: number }[] = [];
  for (const [ln, group] of byLine) {
    const sorted = [...group].sort((a, b) => xHint(a.position) - xHint(b.position) || a.shirtNumber - b.shirtNumber);
    const n = sorted.length;
    sorted.forEach((p, i) => {
      const x = n === 1 ? 50 : 18 + (64 * i) / (n - 1);
      out.push({ num: p.shirtNumber, x, y: yAt(ln) });
    });
  }
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
          <span className="rb-chip" style={{ background: config.home.colorPrimary }} />
          <span className="rb-name">{config.home.name}</span>
        </div>
        <div className="rb-score">
          {snap.score.home}&ndash;{snap.score.away}
        </div>
        <div className="rb-team rb-away">
          <span className="rb-name">{config.away.name}</span>
          <span className="rb-chip" style={{ background: config.away.colorPrimary }} />
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
