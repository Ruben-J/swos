/**
 * Keybindings op basis van KeyboardEvent.code (fysieke toets, layout-onafhankelijk).
 * Volledig rebindbaar; dit zijn de defaults.
 */
export interface KeyBindings {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  pass: string[];
  shoot: string[];
  sprint: string[];
  switchPlayer: string[];
}

export const DEFAULT_BINDINGS: KeyBindings = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  pass: ["KeyX"],
  shoot: ["KeyZ"],
  sprint: ["ShiftLeft", "ShiftRight", "KeyK"],
  switchPlayer: ["KeyL", "Tab"],
};
