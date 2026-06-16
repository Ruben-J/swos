import type { KeyBindings } from "@pitch/engine";
import { DEFAULT_BINDINGS } from "@pitch/engine";

/**
 * Kleine, synchrone settings in localStorage: audio, keybinds, laatste scherm.
 * Career-saves en replays horen in IndexedDB (zie saves.ts).
 */
export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  bindings: KeyBindings;
  lastScreen: string;
}

const KEY = "pitch.settings.v1";

const DEFAULTS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  bindings: DEFAULT_BINDINGS,
  lastScreen: "menu",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed, bindings: { ...DEFAULTS.bindings, ...parsed.bindings } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage kan vol/uitgeschakeld zijn; settings zijn niet kritiek.
  }
}
