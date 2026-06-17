import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { PITCH, lerp } from "@pitch/shared";
import type { CameraView, MatchSnapshot, MatchSnapshotPlayer } from "@pitch/engine";

const PX_PER_UNIT = 11;

export interface TeamColors {
  primary: string;
  secondary: string;
}

interface PlayerNode {
  container: Container;
  body: Graphics;
  ring: Graphics;
  shadow: Graphics;
  label: Text;
}

/**
 * PixiJS WebGL-renderer voor de wedstrijd. Tekent een statisch veld en
 * interpoleert speler-/balposities tussen twee sim-snapshots (render-alpha).
 * Bevat géén spel-logica — puur presentatie.
 */
export class MatchRenderer {
  readonly app: Application;
  private world = new Container();
  private pitchLayer = new Graphics();
  private ballShadow = new Graphics();
  private aimArrow = new Graphics();
  private ball = new Graphics();
  private players = new Map<string, PlayerNode>();
  private colors: Record<"home" | "away", TeamColors>;
  private labelStyle: TextStyle;

  private prev: MatchSnapshot | null = null;

  constructor(app: Application, colors: Record<"home" | "away", TeamColors>) {
    this.app = app;
    this.colors = colors;
    this.labelStyle = new TextStyle({
      fill: "#ffffff",
      fontSize: 9,
      fontFamily: "monospace",
      fontWeight: "700",
    });

    this.app.stage.addChild(this.world);
    this.world.addChild(this.pitchLayer);
    this.world.addChild(this.ballShadow);
    this.world.addChild(this.aimArrow);
    this.world.addChild(this.ball);
    this.drawPitch();
  }

  static async create(
    canvas: HTMLCanvasElement,
    colors: Record<"home" | "away", TeamColors>,
  ): Promise<MatchRenderer> {
    const app = new Application();
    await app.init({
      canvas,
      antialias: false,
      background: "#1c6b34",
      resizeTo: canvas.parentElement ?? undefined,
      autoStart: false,
    });
    return new MatchRenderer(app, colors);
  }

  private drawPitch(): void {
    const g = this.pitchLayer;
    const W = PITCH.width;
    const H = PITCH.height;
    const u = PX_PER_UNIT;
    g.clear();

    // Gestreept gras.
    const stripes = 14;
    for (let i = 0; i < stripes; i++) {
      const x = (i / stripes) * W;
      const w = W / stripes;
      g.rect(x * u, 0, w * u, H * u).fill(i % 2 === 0 ? 0x1f7a3a : 0x1c6b34);
    }

    const line = { width: 2, color: 0xffffff, alpha: 0.85 };
    // Buitenlijnen.
    g.rect(0, 0, W * u, H * u).stroke(line);
    // Middenlijn.
    g.moveTo((W / 2) * u, 0).lineTo((W / 2) * u, H * u).stroke(line);
    // Middencirkel.
    g.circle((W / 2) * u, (H / 2) * u, PITCH.centerCircleRadius * u).stroke(line);
    g.circle((W / 2) * u, (H / 2) * u, 1.5).fill(0xffffff);

    // Strafschopgebieden.
    const boxW = PITCH.penaltyBoxDepth;
    const boxH = PITCH.penaltyBoxWidth;
    const by = (H - boxH) / 2;
    g.rect(0, by * u, boxW * u, boxH * u).stroke(line);
    g.rect((W - boxW) * u, by * u, boxW * u, boxH * u).stroke(line);

    // Doelgebieden (5-meter).
    const gaW = PITCH.goalAreaDepth;
    const gaH = PITCH.goalAreaWidth;
    const gaY = (H - gaH) / 2;
    g.rect(0, gaY * u, gaW * u, gaH * u).stroke(line);
    g.rect((W - gaW) * u, gaY * u, gaW * u, gaH * u).stroke(line);

    // Strafschopstippen.
    const spot = PITCH.penaltySpotDist;
    g.circle(spot * u, (H / 2) * u, 1.5).fill(0xffffff);
    g.circle((W - spot) * u, (H / 2) * u, 1.5).fill(0xffffff);

    // Losse boog tekenen — eerst naar het startpunt (anders verbindt Pixi de
    // boog met het vorige pad-punt en krijg je een stray lijn over het veld).
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
      g.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0));
      g.arc(cx, cy, r, a0, a1).stroke(line);
    };

    // Strafschopbogen ("D") buiten het gebied, gecentreerd op de stip.
    const ar = PITCH.penaltyArcRadius;
    const sweep = Math.acos((boxW - spot) / ar); // hoek waar de boog buiten de box komt
    arc(spot * u, (H / 2) * u, ar * u, -sweep, sweep);
    arc((W - spot) * u, (H / 2) * u, ar * u, Math.PI - sweep, Math.PI + sweep);

    // Hoekbogen.
    const cr = PITCH.cornerArcRadius;
    arc(0, 0, cr * u, 0, Math.PI / 2);
    arc(W * u, 0, cr * u, Math.PI / 2, Math.PI);
    arc(0, H * u, cr * u, -Math.PI / 2, 0);
    arc(W * u, H * u, cr * u, Math.PI, (3 * Math.PI) / 2);

    // Doelen met net.
    this.drawGoalNet(g, 0, -1);
    this.drawGoalNet(g, W, 1);
  }

  /** Teken een doel als een net (maaswerk + frame) achter de doellijn. */
  private drawGoalNet(g: Graphics, xLine: number, dir: number): void {
    const u = PX_PER_UNIT;
    const depth = PITCH.goalDepth;
    const gw = PITCH.goalWidth;
    const gy0 = (PITCH.height - gw) / 2;
    const gy1 = gy0 + gw;
    const xBack = xLine + dir * depth;
    const left = Math.min(xLine, xBack);
    const right = Math.max(xLine, xBack);

    // Netvlak (licht gevuld) + maaswerk.
    g.rect(left * u, gy0 * u, (right - left) * u, gw * u).fill({ color: 0xffffff, alpha: 0.08 });
    const mesh = { width: 1, color: 0xffffff, alpha: 0.32 } as const;
    const step = 0.9;
    for (let x = left; x <= right + 1e-3; x += step) {
      g.moveTo(x * u, gy0 * u).lineTo(x * u, gy1 * u).stroke(mesh);
    }
    for (let y = gy0; y <= gy1 + 1e-3; y += step) {
      g.moveTo(left * u, y * u).lineTo(right * u, y * u).stroke(mesh);
    }
    // Frame (palen + lat + achterkant).
    g.rect(left * u, gy0 * u, (right - left) * u, gw * u).stroke({ width: 2.5, color: 0xffffff });
  }

  private ensurePlayer(p: MatchSnapshotPlayer): PlayerNode {
    let node = this.players.get(p.id);
    if (node) return node;
    const container = new Container();
    const shadow = new Graphics().ellipse(0, 0, 7, 4).fill({ color: 0x000000, alpha: 0.25 });
    const body = new Graphics();
    const ring = new Graphics();
    const col = this.colors[p.side];
    const fill = p.isKeeper ? 0xffd23f : hexToNum(col.primary);
    body.circle(0, 0, p.isKeeper ? 6 : 6.5).fill(fill).stroke({ width: 1.5, color: 0x101010 });
    const label = new Text({ text: String(p.shirtNumber), style: this.labelStyle });
    label.anchor.set(0.5);
    container.addChild(shadow, ring, body, label);
    this.world.addChild(container);
    node = { container, body, ring, shadow, label };
    this.players.set(p.id, node);
    return node;
  }

  /** Render één frame met interpolatie tussen vorige en huidige snapshot. */
  render(view: CameraView, snap: MatchSnapshot, alpha: number): void {
    const u = PX_PER_UNIT;
    const screenW = this.app.renderer.width;
    const screenH = this.app.renderer.height;

    // Wereldcontainer positioneren rond camera-centrum.
    this.world.scale.set(view.zoom);
    this.world.position.set(
      screenW / 2 - view.center.x * u * view.zoom,
      screenH / 2 - view.center.y * u * view.zoom,
    );

    const prev = this.prev;
    const prevById = new Map(prev?.players.map((p) => [p.id, p]));
    const seen = new Set<string>();

    for (const p of snap.players) {
      seen.add(p.id);
      const node = this.ensurePlayer(p);
      const pp = prevById.get(p.id);
      const x = (pp ? lerp(pp.x, p.x, alpha) : p.x) * u;
      const y = (pp ? lerp(pp.y, p.y, alpha) : p.y) * u;
      node.container.position.set(x, y);

      // Actieve-speler-ring.
      node.ring.clear();
      if (p.isActive) {
        node.ring.circle(0, 0, 9).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
      }
    }

    // Verwijder spelers die niet meer bestaan (zou niet moeten gebeuren).
    for (const [id, node] of this.players) {
      if (!seen.has(id)) {
        node.container.destroy();
        this.players.delete(id);
      }
    }

    // Bal met hoogte-schaduw.
    const pball = prev?.ball;
    const bx = (pball ? lerp(pball.x, snap.ball.x, alpha) : snap.ball.x) * u;
    const by = (pball ? lerp(pball.y, snap.ball.y, alpha) : snap.ball.y) * u;
    const bz = (pball ? lerp(pball.z, snap.ball.z, alpha) : snap.ball.z) * u;
    this.ballShadow.clear();
    this.ballShadow.ellipse(bx, by, 4, 2.5).fill({ color: 0x000000, alpha: 0.3 });
    this.ball.clear();
    this.ball.circle(bx, by - bz, 3.4).fill(0xffffff).stroke({ width: 1, color: 0x111111 });

    // Richt-pijltje voor een mikbare hervatting (hoek/vrije trap/penalty).
    this.aimArrow.clear();
    if (snap.restartAim != null) {
      this.drawAimArrow(bx, by, snap.restartAim);
    }

    this.prev = snap;
    this.app.renderer.render(this.app.stage);
  }

  /** Klein geel richt-pijltje vanaf de bal in de mikrichting. */
  private drawAimArrow(bx: number, by: number, angle: number): void {
    const len = 34;
    const tx = bx + Math.cos(angle) * len;
    const ty = by + Math.sin(angle) * len;
    const g = this.aimArrow;
    g.moveTo(bx, by).lineTo(tx, ty).stroke({ width: 2.5, color: 0xffe14d, alpha: 0.95 });
    // Punt.
    const head = 7;
    const a1 = angle + Math.PI * 0.82;
    const a2 = angle - Math.PI * 0.82;
    g.moveTo(tx, ty)
      .lineTo(tx + Math.cos(a1) * head, ty + Math.sin(a1) * head)
      .lineTo(tx + Math.cos(a2) * head, ty + Math.sin(a2) * head)
      .lineTo(tx, ty)
      .fill({ color: 0xffe14d, alpha: 0.95 });
  }

  resize(): void {
    this.app.resize();
  }

  destroy(): void {
    // removeView:false — React bezit de canvas; verwijder 'm niet uit de DOM
    // (belangrijk bij StrictMode mount/unmount/mount).
    this.app.destroy({ removeView: false }, { children: true });
  }
}

function hexToNum(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}
