import { normalize } from "@pitch/shared";
import type { PlayerIntent } from "../types.js";

/**
 * Minimale Gamepad-ondersteuning (Gamepad API). Leest de eerste verbonden
 * controller: linkerstick = beweging, A/knop0 = actie (tap/hold), knop2/X of
 * RB = sprint, knop1/B = spelerwissel. Edge-detectie voor de actieknop.
 */
let prevActionDown = false;
let actionDownAt: number | null = null;
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

  const action = pad.buttons[0]?.pressed ?? false;
  const sprint = (pad.buttons[2]?.pressed ?? false) || (pad.buttons[5]?.pressed ?? false);
  const switchBtn = pad.buttons[1]?.pressed ?? false;

  if (action && !prevActionDown) {
    actionDownAt = performance.now();
  }
  if (!action && prevActionDown && actionDownAt !== null) {
    intent.actionHeld = (performance.now() - actionDownAt) / 1000;
    intent.actionReleased = true;
    actionDownAt = null;
  } else if (action && actionDownAt !== null) {
    intent.actionHeld = (performance.now() - actionDownAt) / 1000;
  }
  prevActionDown = action;

  if (sprint) intent.sprint = true;
  if (switchBtn && !prevSwitchDown) intent.switchPlayer = true;
  prevSwitchDown = switchBtn;
}
