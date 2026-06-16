import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root ontbreekt");

// Bewust geen StrictMode: de dubbele mount/unmount botst met de imperatieve
// WebGL-canvas + gameloop (dubbele Pixi-init op dezelfde canvas, gelekte rAF).
createRoot(rootEl).render(<App />);
