import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In productie draait de site als GitHub Pages project-site onder /swos/.
// Tijdens lokaal ontwikkelen blijft de base gewoon "/".
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/swos/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
}));
