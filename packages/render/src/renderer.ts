import { Application, Container, Graphics } from "pixi.js";
import { PITCH, lerp } from "@pitch/shared";
import type { CameraView, MatchSnapshot, MatchSnapshotPlayer } from "@pitch/engine";

const PX_PER_UNIT = 11;

export interface TeamColors {
  primary: string;
  secondary: string;
  pattern?: "plain" | "stripes" | "centre";
}

interface PlayerNode {
  container: Container;
  body: Graphics;
  ring: Graphics;
  shadow: Graphics;
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
  private ball = new Graphics(); // voetbal-grafiek (eenmalig getekend, roteert)
  private players = new Map<string, PlayerNode>();
  private colors: Record<"home" | "away", TeamColors>;

  private prev: MatchSnapshot | null = null;
  // Rol-animatie van de bal: afgelegde afstand + laatste looprichting.
  private ballRoll = 0;
  private lastBallScreen: { x: number; y: number } | null = null;
  private lastBallDir = { x: 1, y: 0 };

  constructor(app: Application, colors: Record<"home" | "away", TeamColors>) {
    this.app = app;
    this.colors = colors;

    this.app.stage.addChild(this.world);
    this.world.addChild(this.pitchLayer);
    this.world.addChild(this.ballShadow);
    this.world.addChild(this.aimArrow);
    this.world.addChild(this.ball);
    this.drawPitch();
    this.drawRollingBall(1, 0, 0);
  }

  /**
   * Teken de voetbal die in de looprichting ROLT: zwarte panelen lopen als op
   * een bol (orthografische projectie) over de bal mee — ze komen klein aan de
   * achterkant op, groeien over de top en verdwijnen vooraan in de looprichting.
   */
  private drawRollingBall(dirX: number, dirY: number, rolled: number): void {
    const g = this.ball;
    const R = 2.8;
    g.clear();
    g.circle(0, 0, R).fill(0xf4f4f4).stroke({ width: 0.9, color: 0x222222, alpha: 0.6 });
    // Loodrecht op de looprichting (de "as" waarom de bal rolt).
    const perpX = -dirY;
    const perpY = dirX;
    const black = 0x1a1a1a;
    // Panelen verdeeld over de bol in ringen ({ l = positie langs de rol-as,
    // o = fase-offset, s = relatieve grootte }). Meer panelen = vollere voetbal.
    const panels: { l: number; o: number; s: number }[] = [];
    // Twee middenringen (groot) + twee buitenringen (kleiner), elk verspringend.
    const rings = [
      { l: 0.0, n: 4, s: 1.0, phase: 0 },
      { l: 0.45, n: 3, s: 0.85, phase: 0.7 },
      { l: -0.45, n: 3, s: 0.85, phase: 0.7 },
      { l: 0.76, n: 2, s: 0.6, phase: 1.4 },
      { l: -0.76, n: 2, s: 0.6, phase: 1.4 },
    ];
    for (const ring of rings) {
      for (let k = 0; k < ring.n; k++) {
        panels.push({ l: ring.l, o: ring.phase + (k / ring.n) * Math.PI * 2, s: ring.s });
      }
    }
    for (const pan of panels) {
      const th = rolled / R + pan.o;
      const c = Math.cos(th); // >0 = voorkant (zichtbaar), <0 = achterkant
      if (c < -0.1) continue;
      const latR = R * pan.l;
      const along = Math.sin(th) * Math.sqrt(Math.max(0, R * R - latR * latR));
      const cx = dirX * along + perpX * latR;
      const cy = dirY * along + perpY * latR;
      const size = R * 0.26 * pan.s * (0.45 + 0.55 * Math.max(0, c));
      g.circle(cx, cy, size).fill({ color: black, alpha: 0.5 + 0.5 * Math.max(0, c) });
    }
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

  /**
   * Teken een doel top-down: een rechthoekig, fijnmazig net achter de lijn.
   * Alleen op de doellijn een dikke witte lijn (de lat); naar achteren is alles
   * dun net (geen kader eromheen).
   */
  private drawGoalNet(g: Graphics, xLine: number, dir: number): void {
    const u = PX_PER_UNIT;
    const gw = PITCH.goalWidth;
    const cy = PITCH.height / 2;
    const depth = 2.8; // diepte van het net achter de lijn
    const dip = 0.6; // hoe ver de achterkant in het midden naar binnen holt
    const fan = 0.55; // lichte verbreding naar achteren

    // Parametrisch net: s = breedte (0..1), t = diepte (0..1). De doellijn (t=0)
    // is recht; naar achteren holt het net in het midden naar binnen (hangt door
    // naar het doel) i.p.v. kaarsrecht of bol te staan.
    const P = (s: number, t: number): [number, number] => {
      const half = gw / 2 + fan * t;
      const back = depth * t - dip * Math.sin(Math.PI * s) * t * t;
      return [(xLine + dir * back) * u, (cy + (s - 0.5) * 2 * half) * u];
    };

    // Heel licht gevuld vlak (gras schemert door het net).
    const outline: number[] = [];
    const NS = 14;
    for (let i = 0; i <= NS; i++) outline.push(...P(i / NS, 0));
    for (let i = 1; i <= NS; i++) outline.push(...P(1, i / NS));
    for (let i = NS - 1; i >= 0; i--) outline.push(...P(i / NS, 1));
    for (let i = NS - 1; i >= 1; i--) outline.push(...P(0, i / NS));
    g.poly(outline).fill({ color: 0xffffff, alpha: 0.05 });

    // Fijn maaswerk dat de welving volgt (even dichte mazen beide richtingen).
    const mesh = { width: 0.7, color: 0xffffff, alpha: 0.32 } as const;
    const cell = 0.42;
    const wL = Math.round(gw / cell); // strengen langs de breedte (front->back)
    for (let i = 0; i <= wL; i++) {
      const s = i / wL;
      g.moveTo(...P(s, 0));
      for (let tj = 1; tj <= 8; tj++) g.lineTo(...P(s, tj / 8));
      g.stroke(mesh);
    }
    const dL = Math.max(3, Math.round(depth / cell)); // strengen langs de diepte
    for (let j = 0; j <= dL; j++) {
      const t = j / dL;
      g.moveTo(...P(0, t));
      for (let sj = 1; sj <= NS; sj++) g.lineTo(...P(sj / NS, t));
      g.stroke(mesh);
    }

    // Dikke witte lat alleen op de doellijn.
    g.moveTo(...P(0, 0)).lineTo(...P(1, 0)).stroke({ width: 2.8, color: 0xffffff });
  }

  private ensurePlayer(p: MatchSnapshotPlayer): PlayerNode {
    let node = this.players.get(p.id);
    if (node) return node;
    const container = new Container();
    const shadow = new Graphics().ellipse(0, 0, 5.2, 3).fill({ color: 0x000000, alpha: 0.25 });
    const body = new Graphics();
    const ring = new Graphics();
    const col = this.colors[p.side];
    const shirt = p.isKeeper ? 0x2bd06a : hexToNum(col.primary);
    const accent = p.isKeeper ? 0x125a30 : hexToNum(col.secondary);
    const pattern = p.isKeeper ? "plain" : col.pattern ?? "plain";
    this.drawPlayerSprite(body, shirt, accent, pattern, hexToNum(p.hairColor), hexToNum(p.skinColor));
    container.addChild(shadow, ring, body);
    this.world.addChild(container);
    node = { container, body, ring, shadow };
    this.players.set(p.id, node);
    return node;
  }

  /**
   * Teken een top-down spelersprite, lokaal kijkend naar +x. Shirt-romp met
   * schouders, daarboven een hoofd (haarkleur) met een gezicht (huidtint) dat
   * naar voren wijst, zodat je de kijkrichting ziet.
   */
  private drawPlayerSprite(
    g: Graphics,
    shirt: number,
    accent: number,
    pattern: "plain" | "stripes" | "centre",
    hair: number,
    skin: number,
  ): void {
    g.clear();
    // Romp/schouders (breder dwars op de kijkrichting). +x = kijkrichting.
    g.ellipse(-0.3, 0, 4.1, 4.8).fill(shirt).stroke({ width: 1.2, color: 0x101010, alpha: 0.8 });
    // Shirtpatroon (binnen de romp-ellips, dus geen overloop). Verticale banden
    // (dwars op de kijkrichting) in de accentkleur.
    if (pattern === "centre") {
      g.ellipse(-0.3, 0, 0.95, 4.3).fill(accent);
    } else if (pattern === "stripes") {
      for (const d of [-2.4, -1.2, 0, 1.2, 2.4]) {
        const ry = 4.3 * Math.sqrt(Math.max(0, 1 - (d / 3.9) ** 2));
        g.ellipse(-0.3 + d, 0, 0.42, ry).fill(accent);
      }
    }
    // Korte broek-hint achteraan.
    g.ellipse(-2.3, 0, 1.9, 3.5).fill({ color: 0x20242b, alpha: 0.55 });
    // Hoofd: haar (kruin) met gezicht (huid) naar voren.
    g.circle(1.0, 0, 2.6).fill(hair).stroke({ width: 0.9, color: 0x101010, alpha: 0.7 });
    g.circle(2.0, 0, 1.7).fill(skin);
  }

  /** Render één frame met interpolatie tussen vorige en huidige snapshot. */
  render(view: CameraView, snap: MatchSnapshot, alpha: number): void {
    const u = PX_PER_UNIT;
    const screenW = this.app.renderer.width;
    const screenH = this.app.renderer.height;

    // Veld verticaal: 1e helft valt home omhoog aan, 2e helft 180° gedraaid
    // (teams wisselen van kant). Puur presentatie — de sim blijft horizontaal.
    const rot = snap.half >= 2 ? Math.PI / 2 : -Math.PI / 2;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    // Wereldcontainer positioneren rond camera-centrum, mét rotatie.
    this.world.rotation = rot;
    this.world.scale.set(view.zoom);
    const vx = view.center.x * u * view.zoom;
    const vy = view.center.y * u * view.zoom;
    this.world.position.set(
      screenW / 2 - (vx * cos - vy * sin),
      screenH / 2 - (vx * sin + vy * cos),
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
      // Sprite draait mee met de kijkrichting (facing is een wereldhoek; de
      // wereld-rotatie wordt door de parent toegevoegd).
      const pf = pp ? lerpAngle(pp.facing, p.facing, alpha) : p.facing;
      node.body.rotation = pf;

      // Actieve-speler-ring.
      node.ring.clear();
      if (p.isActive) {
        node.ring.circle(0, 0, 7).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
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
    // Schaduw groeit/zachter bij hoogte.
    const shScale = 1 + bz * 0.04;
    this.ballShadow.clear();
    this.ballShadow
      .ellipse(bx, by, 4 * shScale, 2.5 * shScale)
      .fill({ color: 0x000000, alpha: 0.3 / shScale });

    // Voetbal: positioneer (hoogte/loft naar scherm-boven) en laat 'm rollen.
    const liftX = -bz * sin;
    const liftY = -bz * cos;
    const px = bx + liftX;
    const py = by + liftY;
    if (this.lastBallScreen) {
      const dx = px - this.lastBallScreen.x;
      const dy = py - this.lastBallScreen.y;
      const moved = Math.hypot(dx, dy);
      if (moved > 0.05) {
        this.lastBallDir = { x: dx / moved, y: dy / moved };
        // Rol over de bol mee met de afstand (gestileerd, niet fysisch-snel).
        this.ballRoll += Math.min(moved * 0.5, 2.5);
      }
    }
    this.lastBallScreen = { x: px, y: py };
    this.drawRollingBall(this.lastBallDir.x, this.lastBallDir.y, this.ballRoll);
    this.ball.position.set(px, py);
    this.ball.rotation = 0;
    this.ball.scale.set(1 + bz * 0.012);

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

/** Interpoleer een hoek via de kortste weg (geen 360°-flip bij de wrap). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
