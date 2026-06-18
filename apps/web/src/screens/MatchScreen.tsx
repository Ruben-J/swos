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

type IntroStage = "home" | "away" | "done";

export function MatchScreen({ config, onExit, onFinish }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snap, setSnap] = useState<MatchSnapshot | null>(null);
  const finishedRef = useRef(false);
  const [intro, setIntro] = useState<IntroStage>("home");
  const introStarted = useRef(false);

  // Opkomst-intro: eerst de thuisopstelling, dan de uitopstelling, dan weg.
  // Pas starten zodra de wedstrijd geladen is (eerste snapshot), zodat de intro
  // niet al tijdens het laden van de renderer wegtikt.
  useEffect(() => {
    if (!snap || introStarted.current) return;
    introStarted.current = true;
    const t1 = setTimeout(() => setIntro("away"), 2600);
    const t2 = setTimeout(() => setIntro("done"), 5200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [snap]);

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

        {intro !== "done" && (
          <IntroOverlay config={config} stage={intro} onSkip={() => setIntro("done")} />
        )}

        {intro === "done" && snap && showBoard(snap) && (
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

/** Opkomst-intro: opstelling van één ploeg, links (thuis) of rechts (uit). */
function IntroOverlay({
  config,
  stage,
  onSkip,
}: {
  config: MatchConfig;
  stage: IntroStage;
  onSkip: () => void;
}) {
  const team = stage === "home" ? config.home : config.away;
  const side = stage === "home" ? "left" : "right";
  return (
    <div className={`intro-overlay intro-${side}`} onClick={onSkip}>
      <div className="intro-card">
        <div className="intro-team">
          <span className="intro-chip" style={{ background: team.colorPrimary }} />
          <span className="intro-name">{team.name}</span>
        </div>
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
    </div>
  );
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
