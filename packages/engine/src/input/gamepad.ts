import { normalize } from "@pitch/shared";
import type { PlayerIntent } from "../types.js";

/**
 * Minimale Gamepad-ondersteuning (Gamepad API). Leest de eerste verbonden
 * controller: linkerstick = beweging, knop0/A = schieten, knop3/Y = passen,
 * knop2/X of RB = sprint, knop1/B = spelerwissel. Edge-detectie voor de actie.
 */
let prevActionDown = false;
let actionDownAt: number | null = null;
let actionKind: "pass" | "shoot" | null = null;
let prevSwitchDown = false;

const DEADZONE = 0.25;

export function pollGamepad(intent: PlayerIntent): void {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  let pad: Gamepad | null = null;
  for (const p of pads) {
    if (p) {
      pad = p;
      break;
    }
  }
  if (!pad) return;

  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  if (Math.abs(ax) > DEADZONE || Math.abs(ay) > DEADZONE) {
    const move = normalize({ x: ax, y: ay });
    intent.move = move;
    intent.aftertouch = { ...move };
  }

  const shootBtn = pad.buttons[0]?.pressed ?? false;
  const passBtn = pad.buttons[3]?.pressed ?? false;
  const action = shootBtn || passBtn;
  const sprint = (pad.buttons[2]?.pressed ?? false) || (pad.buttons[5]?.pressed ?? false);
  const switchBtn = pad.buttons[1]?.pressed ?? false;

  if (action && !prevActionDown) {
    actionDownAt = performance.now();
    actionKind = shootBtn ? "shoot" : "pass";
  }
  if (!action && prevActionDown && actionDownAt !== null) {
    intent.actionHeld = (performance.now() - actionDownAt) / 1000;
    intent.actionReleased = true;
    intent.actionKind = actionKind;
    actionDownAt = null;
  } else if (action && actionDownAt !== null) {
    intent.actionHeld = (performance.now() - actionDownAt) / 1000;
    intent.actionKind = actionKind;
  }
  prevActionDown = action;

  if (sprint) intent.sprint = true;
  if (switchBtn && !prevSwitchDown) intent.switchPlayer = true;
  prevSwitchDown = switchBtn;
}
