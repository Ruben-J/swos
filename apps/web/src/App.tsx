import { useCallback, useState } from "react";
import type { MatchConfig } from "@pitch/engine";
import { quickMatchSetup } from "@pitch/sim-data";
import { MainMenu } from "./screens/MainMenu.js";
import { MatchScreen } from "./screens/MatchScreen.js";

type Screen = "menu" | "match";

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [config, setConfig] = useState<MatchConfig | null>(null);

  const startQuickMatch = useCallback(() => {
    const seed = (Math.floor(Math.random() * 0xffffffff) >>> 0).toString();
    const { seed: numSeed, home, away } = quickMatchSetup(seed);
    setConfig({ seed: numSeed, home, away, humanSide: "home" });
    setScreen("match");
  }, []);

  const startLocalVersus = useCallback(() => {
    // Lokale multiplayer: voorlopig zelfde scherm, beide kanten human (placeholder).
    const { seed, home, away } = quickMatchSetup(`versus-${Date.now()}`);
    setConfig({ seed, home, away, humanSide: "home" });
    setScreen("match");
  }, []);

  const exitMatch = useCallback(() => {
    setScreen("menu");
    setConfig(null);
  }, []);

  if (screen === "match" && config) {
    return <MatchScreen config={config} onExit={exitMatch} />;
  }

  return <MainMenu onQuickMatch={startQuickMatch} onLocalVersus={startLocalVersus} />;
}
