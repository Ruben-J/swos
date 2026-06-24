import {
  Camera,
  GameLoop,
  KeyboardInput,
  MatchSim,
  type MatchConfig,
  type MatchSnapshot,
  type PlayerIntent,
} from "@pitch/engine";
import { MatchRenderer } from "@pitch/render";
import { PITCH } from "@pitch/shared";
import { MatchAudio } from "./audio.js";

export type HudListener = (snap: MatchSnapshot) => void;

/** Camera-inzoomfactor (1 = heel veld, hoger = ingezoomde tv-shot). Iets lager
 *  uitgezoomd zodat er meer van de tribunes in beeld komt. */
const MATCH_ZOOM = 1.6;

/**
 * Bindt de pure engine aan de browser: maakt sim + renderer + camera + input,
 * draait de vaste-timestep loop en duwt periodiek HUD-snapshots naar React.
 * React raakt de match-tick nooit aan (strikte scheiding shell/runtime).
 */
export class MatchController {
  private sim: MatchSim;
  private renderer: MatchRenderer | null = null;
  private loop: GameLoop;
  private camera: Camera;
  private input: KeyboardInput;
  private hudListener: HudListener | null = null;
  private hudAccumulator = 0;
  private audio: MatchAudio | null = null;
  // Vorige waarden voor event-detectie (goal/redding/fluit/balcontact).
  private prevGoalSeq = 0;
  private prevSaveSeq = 0;
  private prevPhase = "";
  private prevBallSpeed = 0;

  private constructor(sim: MatchSim, camera: Camera, input: KeyboardInput) {
    this.sim = sim;
    this.camera = camera;
    this.input = input;
    this.loop = new GameLoop({
      step: (dt, subStep) => this.onStep(dt, subStep),
      render: (alpha) => this.onRender(alpha),
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    config: MatchConfig,
    hud: HudListener,
  ): Promise<MatchController> {
    const sim = new MatchSim(config);
    const camera = new Camera(70, 46);
    const input = new KeyboardInput();
    const controller = new MatchController(sim, camera, input);
    controller.hudListener = hud;
    controller.renderer = await MatchRenderer.create(canvas, {
      home: { primary: config.home.colorPrimary, secondary: config.home.colorSecondary, pattern: config.home.pattern },
      away: { primary: config.away.colorPrimary, secondary: config.away.colorSecondary, pattern: config.away.pattern },
    });
    controller.fitCamera();
    controller.audio = new MatchAudio();
    controller.audio.start();
    input.attach();
    if (import.meta.env.DEV) {
      (window as unknown as { __match?: MatchController }).__match = controller;
    }
    return controller;
  }

  /** Voer handmatig N sim-stappen + render uit (verificatie zonder rAF). */
  debugAdvance(steps: number): void {
    this.loop.advanceManual(steps);
  }

  /** Huidige snapshot (debug/verificatie). */
  debugSnapshot() {
    return this.sim.snapshot();
  }

  /** Directe sim-toegang voor headless verificatie. */
  debugSim() {
    return this.sim;
  }

  /** Veld staat 90° gedraaid (verticaal): schermbreedte toont de veldbreedte. */
  private fieldRotation(): number {
    return this.sim.currentHalf >= 2 ? Math.PI / 2 : -Math.PI / 2;
  }

  private fitCamera(): void {
    if (!this.renderer) return;
    const w = this.renderer.app.renderer.width;
    const h = this.renderer.app.renderer.height;
    const pxPerUnit = 11;
    // Ingezoomde tv-camera: toon ~de helft van het veld i.p.v. het hele veld.
    // Veld is 90° gedraaid -> schermbreedte/-hoogte mappen op veld-Y/-X (swap).
    this.camera.zoom = MATCH_ZOOM;
    this.camera.setViewSize(h / (pxPerUnit * MATCH_ZOOM), w / (pxPerUnit * MATCH_ZOOM));
  }

  private frameIntent: PlayerIntent | null = null;

  private onStep(dt: number, subStep: number): void {
    // Lees input één keer per frame; consumeer edges alleen op de eerste substep.
    if (subStep === 0) {
      this.frameIntent = this.input.poll();
      // Scherm-input -> wereld-richting: draai mee met de veld-rotatie zodat
      // "omhoog" op het scherm de speler ook omhoog beweegt.
      if (this.frameIntent) {
        const rot = this.fieldRotation();
        this.frameIntent.move = rotateVec(this.frameIntent.move, -rot);
        this.frameIntent.aftertouch = rotateVec(this.frameIntent.aftertouch, -rot);
      }
    }
    const intent = this.frameIntent;
    if (intent) {
      this.sim.step(dt, intent);
      // Edge-acties (release/switch) mogen niet over meerdere substeps herhalen.
      if (subStep === 0) {
        intent.actionReleased = false;
        intent.switchPlayer = false;
      }
    } else {
      this.sim.step(dt);
    }

    // Camera volgt de bal.
    this.camera.follow(this.sim.ball.pos, this.sim.ball.vel, dt);

    // HUD ~10 Hz updaten.
    this.hudAccumulator += dt;
    if (this.hudAccumulator >= 0.1) {
      this.hudAccumulator = 0;
      this.hudListener?.(this.sim.snapshot());
    }
  }

  private onRender(alpha: number): void {
    if (!this.renderer) return;
    this.fitCamera();
    const snap = this.sim.snapshot();
    this.updateAudio(snap);
    this.renderer.render(this.camera.view(), snap, alpha);
  }

  /** Vertaal sim-events naar geluid: goal-gejuich, redding-"oooh", fluit,
   *  balcontact en de publieksintensiteit op basis van de bal bij het doel. */
  private updateAudio(snap: MatchSnapshot): void {
    const a = this.audio;
    if (!a) return;

    // Doelpunt -> gejuich (+ fluit).
    if (snap.goalImpact && snap.goalImpact.seq !== this.prevGoalSeq) {
      this.prevGoalSeq = snap.goalImpact.seq;
      a.whistle(false);
      a.cheer();
    }
    // Keeperredding op een schot -> "oooh".
    if (snap.saveSeq !== this.prevSaveSeq) {
      this.prevSaveSeq = snap.saveSeq;
      a.ooh();
    }
    // Fasewissel -> fluit (overtreding/uit kort, rust/einde lang).
    if (snap.phase !== this.prevPhase) {
      if (snap.phase === "whistle") a.whistle(false);
      else if (snap.phase === "halftime" || snap.phase === "fulltime") a.whistle(true);
      this.prevPhase = snap.phase;
    }
    // Balcontact: een trap/pass zet de balsnelheid plots omhoog.
    const v = this.sim.ball.vel;
    const speed = Math.hypot(v.x, v.y);
    if (speed - this.prevBallSpeed > 6 && speed > 8) {
      a.kick(Math.min(1, (speed - 8) / 28));
    }
    this.prevBallSpeed = speed;
    // Publieksintensiteit: hoe dichter de bal bij een doellijn, hoe meer rumoer.
    const distGoal = Math.min(snap.ball.x, PITCH.width - snap.ball.x);
    a.setIntensity(1 - Math.min(1, distGoal / 35));
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  destroy(): void {
    this.loop.stop();
    this.input.detach();
    this.audio?.dispose();
    this.audio = null;
    this.renderer?.destroy();
    this.renderer = null;
  }
}

export const HALF_LINE_X = PITCH.width / 2;

/** Draai een vector over hoek a (rad). */
function rotateVec(v: { x: number; y: number }, a: number): { x: number; y: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}
