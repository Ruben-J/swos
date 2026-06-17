import { useCallback, useState } from "react";
import type { MatchConfig } from "@pitch/engine";
import { Rng, hashSeed, type CareerSave, type Match } from "@pitch/shared";
import { playMatchday, quickMatchSetup } from "@pitch/sim-data";
import { MainMenu } from "./screens/MainMenu.js";
import { MatchScreen } from "./screens/MatchScreen.js";
import { CareerSetup } from "./career/CareerSetup.js";
import { CareerHub } from "./screens/CareerHub.js";
import { buildMatchConfig } from "./career/careerMatch.js";
import { putSave } from "./storage/saves.js";

type Screen = "menu" | "match" | "careerSetup" | "careerHub";

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [career, setCareer] = useState<CareerSave | null>(null);
  // De career-wedstrijd die live gespeeld wordt (voor toepassen eindstand).
  const [careerMatch, setCareerMatch] = useState<Match | null>(null);

  const startQuickMatch = useCallback(() => {
    const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0).toString();
    const { seed: numSeed, home, away } = quickMatchSetup(seed);
    setConfig({ seed: numSeed, home, away, humanSide: "home" });
    setCareerMatch(null);
    setScreen("match");
  }, []);

  const startLocalVersus = useCallback(() => {
    const { seed, home, away } = quickMatchSetup(`versus-${Date.now()}`);
    setConfig({ seed, home, away, humanSide: "home" });
    setCareerMatch(null);
    setScreen("match");
  }, []);

  const persist = useCallback((save: CareerSave) => {
    setCareer(save);
    void putSave(save);
  }, []);

  const startCareer = useCallback(
    (save: CareerSave) => {
      persist(save);
      setScreen("careerHub");
    },
    [persist],
  );

  const playCareerMatch = useCallback(
    (match: Match) => {
      if (!career) return;
      setConfig(buildMatchConfig(career, match, career.manager.currentTeamId));
      setCareerMatch(match);
      setScreen("match");
    },
    [career],
  );

  const finishCareerMatch = useCallback(
    (homeGoals: number, awayGoals: number) => {
      if (!career || !careerMatch) return;
      const rng = new Rng(hashSeed(`${career.id}:${careerMatch.date}`));
      const updated = playMatchday(structuredClone(career), rng, careerMatch.date, {
        liveMatchId: careerMatch.id,
        liveHomeGoals: homeGoals,
        liveAwayGoals: awayGoals,
      });
      persist(updated);
      setCareerMatch(null);
      setConfig(null);
      setScreen("careerHub");
    },
    [career, careerMatch, persist],
  );

  const exitMatch = useCallback(() => {
    // Verlaten zonder uit te spelen: career-wedstrijd niet toepassen.
    setConfig(null);
    setCareerMatch(null);
    setScreen(career ? "careerHub" : "menu");
  }, [career]);

  if (screen === "match" && config) {
    return (
      <MatchScreen
        config={config}
        onExit={exitMatch}
        onFinish={careerMatch ? finishCareerMatch : undefined}
      />
    );
  }

  if (screen === "careerSetup") {
    return <CareerSetup onStart={startCareer} onCancel={() => setScreen("menu")} />;
  }

  if (screen === "careerHub" && career) {
    return (
      <CareerHub
        save={career}
        onUpdate={persist}
        onPlayMatch={playCareerMatch}
        onExit={() => setScreen("menu")}
      />
    );
  }

  return (
    <MainMenu
      onQuickMatch={startQuickMatch}
      onLocalVersus={startLocalVersus}
      onCareer={() => setScreen("careerSetup")}
    />
  );
}
