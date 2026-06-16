import { MAX_STEPS_PER_FRAME, TICK_DT } from "@pitch/shared";

export interface LoopCallbacks {
  /** Eén vaste sim-stap (TICK_DT seconden). */
  step: (dt: number, subStep: number) => void;
  /** Render met interpolatie-alpha in [0,1) tussen vorige en huidige sim-state. */
  render: (alpha: number) => void;
}

/**
 * Vaste-timestep gameloop met accumulator en render-interpolatie.
 * Sim draait altijd op TICK_DT (60 Hz), onafhankelijk van schermfrequentie.
 * Render via requestAnimationFrame, losgekoppeld van de simulatie. Browsers
 * pauzeren rAF wanneer het tabblad verborgen is — dat is gewenst (CPU sparen).
 */
export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  constructor(private cb: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      let frameTime = (now - this.lastTime) / 1000;
      this.lastTime = now;
      // Clamp tegen lange pauzes (tab inactief) -> geen spiral of death.
      if (frameTime > 0.25) frameTime = 0.25;
      this.accumulator += frameTime;

      let steps = 0;
      while (this.accumulator >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
        this.cb.step(TICK_DT, steps);
        this.accumulator -= TICK_DT;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.accumulator = 0;

      const alpha = this.accumulator / TICK_DT;
      this.cb.render(alpha);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Handmatig N vaste stappen uitvoeren + één render. Bedoeld voor tests en
   * headless verificatie waar requestAnimationFrame niet loopt.
   */
  advanceManual(steps: number): void {
    for (let i = 0; i < steps; i++) this.cb.step(TICK_DT, 0);
    this.cb.render(0);
  }
}
