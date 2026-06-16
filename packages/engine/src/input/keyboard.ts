import { normalize, type Vec2 } from "@pitch/shared";
import { emptyIntent, type PlayerIntent } from "../types.js";
import { DEFAULT_BINDINGS, type KeyBindings } from "./bindings.js";
import { pollGamepad } from "./gamepad.js";

/**
 * Vertaalt toetsenbord (en optioneel gamepad) naar een PlayerIntent.
 * Houdt de hold-duur van de actieknop bij en signaleert het release-moment,
 * zodat tap=pass en hold=schot/lange-bal werken. Aftertouch komt uit de
 * bewegingsrichting tijdens het venster na de trap.
 */
export class KeyboardInput {
  private pressed = new Set<string>();
  private bindings: KeyBindings;
  private actionDownAt: number | null = null;
  private actionHeld = 0;
  private releasedEdge = false;
  private switchEdge = false;
  private target: Window | HTMLElement;

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isBound(e.code)) e.preventDefault();
    if (this.pressed.has(e.code)) return;
    this.pressed.add(e.code);
    if (this.matches(this.bindings.action, e.code) && this.actionDownAt === null) {
      this.actionDownAt = performance.now();
    }
    if (this.matches(this.bindings.switchPlayer, e.code)) {
      this.switchEdge = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.code);
    if (this.matches(this.bindings.action, e.code) && this.actionDownAt !== null) {
      this.actionHeld = (performance.now() - this.actionDownAt) / 1000;
      this.actionDownAt = null;
      this.releasedEdge = true;
    }
  };

  constructor(bindings: KeyBindings = DEFAULT_BINDINGS, target: Window | HTMLElement = window) {
    this.bindings = bindings;
    this.target = target;
  }

  attach(): void {
    this.target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.target.addEventListener("keyup", this.onKeyUp as EventListener);
  }

  detach(): void {
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
    this.pressed.clear();
  }

  setBindings(b: KeyBindings): void {
    this.bindings = b;
  }

  /** Lees de huidige intentie. Consumeert release/switch-edges (eenmalig). */
  poll(): PlayerIntent {
    const intent = emptyIntent();
    const move: Vec2 = { x: 0, y: 0 };
    if (this.anyPressed(this.bindings.left)) move.x -= 1;
    if (this.anyPressed(this.bindings.right)) move.x += 1;
    if (this.anyPressed(this.bindings.up)) move.y -= 1;
    if (this.anyPressed(this.bindings.down)) move.y += 1;

    intent.move = move.x !== 0 || move.y !== 0 ? normalize(move) : move;
    intent.aftertouch = { ...intent.move };
    intent.sprint = this.anyPressed(this.bindings.sprint);

    // Actieknop hold-tijd (lopend), of de zojuist vrijgekomen hold.
    if (this.actionDownAt !== null) {
      intent.actionHeld = (performance.now() - this.actionDownAt) / 1000;
    } else if (this.releasedEdge) {
      intent.actionHeld = this.actionHeld;
    }
    intent.actionReleased = this.releasedEdge;
    intent.switchPlayer = this.switchEdge;

    // Voeg gamepad samen (overschrijft beweging als stick wordt gebruikt).
    pollGamepad(intent);

    this.releasedEdge = false;
    this.switchEdge = false;
    return intent;
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((codes) => codes.includes(code));
  }

  private matches(codes: string[], code: string): boolean {
    return codes.includes(code);
  }

  private anyPressed(codes: string[]): boolean {
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }
}
