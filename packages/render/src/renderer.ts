import { Application, Container, Graphics } from "pixi.js";
import { PITCH, PLAYER, clamp, lerp } from "@pitch/shared";
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
  private netLayer = new Graphics(); // doelnetten (elk frame hertekend i.v.m. wobble)
  private ballShadow = new Graphics();
  private aimArrow = new Graphics();
  private ball = new Graphics(); // voetbal-grafiek (eenmalig getekend, roteert)
  private players = new Map<string, PlayerNode>();
  private colors: Record<"home" | "away", TeamColors>;

  private prev: MatchSnapshot | null = null;
  // Net-animatie: actieve inslag + welk doelpunt (seq) al getoond is.
  private lastGoalSeq = 0;
  private netWobble: { goalX: number; s0: number; intensity: number; t0: number } | null = null;
  // Traag meebewegend richtpunt voor de scheids (lagt de bal, niet er direct aan
  // gekoppeld) + tijdstempel vorige frame voor dt-gebaseerde loopsnelheid.
  private refAnchor: { x: number; y: number } | null = null;
  private lastOfficialNow = 0;
  // Cosmetische officials: scheidsrechter + 2 grensrechters (geen sim-rol).
  private officials: {
    kind: "ref" | "lineA" | "lineB";
    container: Container;
    body: Graphics;
    pos: { x: number; y: number };
    facing: number;
  }[] = [];
  // Rol-animatie van de bal: afgelegde afstand + laatste looprichting.
  private ballRoll = 0;
  private lastBallScreen: { x: number; y: number } | null = null;
  private lastBallDir = { x: 1, y: 0 };

  constructor(app: Application, colors: Record<"home" | "away", TeamColors>) {
    this.app = app;
    this.colors = colors;

    this.app.stage.addChild(this.world);
    this.world.addChild(this.pitchLayer);
    this.world.addChild(this.netLayer);
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

    // Gemaaid gras: verticale maaibanen, een subtiele horizontale dwarsmaai
    // (schaakbordeffect) en fijne spikkeling zodat het op echt gazon lijkt.
    const stripes = 16;
    for (let i = 0; i < stripes; i++) {
      const x = (i / stripes) * W;
      const w = W / stripes;
      g.rect(x * u, 0, w * u, H * u).fill(i % 2 === 0 ? 0x1f7a3a : 0x1c6b34);
    }
    // Lichte dwarsmaai -> schaakbordpatroon van het gazon.
    const rows = 10;
    for (let j = 0; j < rows; j++) {
      const y = (j / rows) * H;
      const h = H / rows;
      g.rect(0, y * u, W * u, h * u).fill({ color: j % 2 === 0 ? 0xffffff : 0x000000, alpha: 0.035 });
    }
    // Fijne spikkeling (bladmottel), deterministisch zodat de textuur stabiel is.
    let seed = 0x12345678 >>> 0;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const tones = [0x2a8f48, 0x176030, 0x238b42, 0x1a6634];
    for (let k = 0; k < 1600; k++) {
      const px = rnd() * W * u;
      const py = rnd() * H * u;
      const rr = (0.22 + rnd() * 0.55) * u;
      g.ellipse(px, py, rr, rr * (0.55 + rnd() * 0.5)).fill({
        color: tones[(rnd() * tones.length) | 0]!,
        alpha: 0.05 + rnd() * 0.06,
      });
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

    // Doelnetten worden elke frame in netLayer getekend (zie drawNets), zodat ze
    // bij een doelpunt kunnen meebewegen.
  }

  /**
   * Teken een doel top-down: een rechthoekig, fijnmazig net achter de lijn.
   * Alleen op de doellijn een dikke witte lijn (de lat); naar achteren is alles
   * dun net (geen kader eromheen).
   */
  private drawGoalNet(g: Graphics, xLine: number, dir: number, bulge = 0, s0 = 0.5): void {
    const u = PX_PER_UNIT;
    const gw = PITCH.goalWidth;
    const cy = PITCH.height / 2;
    const depth = 2.8; // diepte van het net achter de lijn
    const dip = 0.32; // hoe ver de achterkant in het midden naar binnen holt
    const fan = 0; // zijkanten lopen recht naar achter (geen verbreding)

    // Parametrisch net: s = breedte (0..1), t = diepte (0..1). De doellijn (t=0)
    // is recht; de zijkanten lopen recht naar achter, alleen de achterkant holt
    // licht naar binnen. `bulge` (u) duwt het net bij een doelpunt naar achteren,
    // plaatselijk rond `s0` en sterker naar achteren (de bal-inslag).
    const P = (s: number, t: number): [number, number] => {
      const half = gw / 2 + fan * t;
      const bump = bulge * Math.exp(-(((s - s0) / 0.28) ** 2)) * t * t;
      const back = depth * t - dip * Math.sin(Math.PI * s) * t * t + bump;
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
    const mesh = { width: 0.5, color: 0xffffff, alpha: 0.3 } as const;
    const cell = 0.26;
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

  /**
   * Teken beide doelnetten in netLayer. Bij een nieuw doelpunt (goalImpact.seq)
   * start een gedempte "wobble": het getroffen net bolt naar achteren rond het
   * inslagpunt en veert uit. Puur presentatie; leest alleen de snapshot.
   */
  private drawNets(snap: MatchSnapshot): void {
    const gi = snap.goalImpact;
    if (gi && gi.seq !== this.lastGoalSeq) {
      this.lastGoalSeq = gi.seq;
      const cy = PITCH.height / 2;
      const gw = PITCH.goalWidth;
      const s0 = Math.min(1, Math.max(0, (gi.y - (cy - gw / 2)) / gw));
      const intensity = Math.min(1, Math.max(0.4, gi.speed / 32));
      this.netWobble = { goalX: gi.goalX, s0, intensity, t0: performance.now() };
    }

    let bulge = 0;
    let s0 = 0.5;
    let goalX = -1;
    if (this.netWobble) {
      const tau = (performance.now() - this.netWobble.t0) / 1000;
      const DURATION = 0.9;
      if (tau > DURATION) {
        this.netWobble = null;
      } else {
        const MAX = 1.5; // max uitslag (u) naar achteren
        const DECAY = 0.22;
        const OMEGA = 22;
        bulge = this.netWobble.intensity * MAX * Math.exp(-tau / DECAY) * Math.cos(OMEGA * tau);
        s0 = this.netWobble.s0;
        goalX = this.netWobble.goalX;
      }
    }

    const g = this.netLayer;
    g.clear();
    this.drawGoalNet(g, 0, -1, goalX === 0 ? bulge : 0, s0);
    this.drawGoalNet(g, PITCH.width, 1, goalX === PITCH.width ? bulge : 0, s0);
  }

  /** Klein official-spritetje (scheids/grensrechter), kop wijst naar +x. */
  private drawOfficialSprite(g: Graphics, shirt: number): void {
    // Zelfde maat als een speler-sprite (drawPlayerSprite).
    g.clear();
    g.ellipse(-0.3, 0, 4.1, 4.8).fill(shirt).stroke({ width: 1.2, color: 0x101010, alpha: 0.8 });
    g.ellipse(-2.3, 0, 1.9, 3.5).fill({ color: 0x20242b, alpha: 0.55 });
    g.circle(1.0, 0, 2.6).fill(0x2e2018).stroke({ width: 0.9, color: 0x101010, alpha: 0.7 });
    g.circle(2.0, 0, 1.7).fill(0xe6b48c);
  }

  /** Officialkleur die het meest contrasteert met beide teamshirts (felle kit,
   *  lijkt nooit op een teamgenoot — als een team zwart is, dragen ze neongeel). */
  private pickOfficialColor(): number {
    const palette = [0xe6ff00, 0xff6a00, 0xff1493, 0x14ff5a, 0x00e5ff];
    const rgb = (n: number): [number, number, number] => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const dist = (a: number, b: number): number => {
      const [r1, g1, b1] = rgb(a);
      const [r2, g2, b2] = rgb(b);
      return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
    };
    const home = hexToNum(this.colors.home.primary);
    const away = hexToNum(this.colors.away.primary);
    let best = palette[0]!;
    let bestScore = -1;
    for (const c of palette) {
      const s = Math.min(dist(c, home), dist(c, away));
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  private ensureOfficials(): void {
    if (this.officials.length) return;
    const cx = PITCH.width / 2;
    const cy = PITCH.height / 2;
    const color = this.pickOfficialColor();
    const make = (kind: "ref" | "lineA" | "lineB", x: number, y: number, facing: number) => {
      const container = new Container();
      const body = new Graphics();
      this.drawOfficialSprite(body, color);
      body.rotation = facing;
      container.addChild(body);
      this.world.addChild(container);
      this.officials.push({ kind, container, body, pos: { x, y }, facing });
    };
    // Scheids start bij de tunnel (middenlijn, buiten de bovenlijn) en loopt mee
    // het veld op tijdens de walkout — niet zomaar op de middenstip.
    make("ref", cx - 2, -3.5, Math.PI / 2);
    make("lineA", cx, -1.4, Math.PI / 2); // bovenlijn, kijkt het veld in
    make("lineB", cx, PITCH.height + 1.4, -Math.PI / 2);
  }

  /**
   * Plaats de cosmetische official-sprites op basis van de snapshot. De scheids
   * volgt het spel rond het midden, blijft uit de strafschopgebieden en bij de
   * bal vandaan; de grensrechters lopen aan de zijlijn mee met de achterste
   * veldspeler van de kant waarvoor ze vlaggen. Posities worden gladgestreken
   * zodat ze "lopen" i.p.v. springen.
   */
  private updateOfficials(snap: MatchSnapshot): void {
    this.ensureOfficials();
    const u = PX_PER_UNIT;
    const W = PITCH.width;
    const H = PITCH.height;
    const cx = W / 2;
    const cy = H / 2;
    const box = PITCH.penaltyBoxDepth; // 16.5

    // dt (s) voor frame-onafhankelijke loopsnelheid; geklemd tegen sprongen.
    const now = performance.now();
    const dt = this.lastOfficialNow ? Math.min(0.05, (now - this.lastOfficialNow) / 1000) : 0.016;
    this.lastOfficialNow = now;
    const walk = PLAYER.baseSpeed * dt; // zelfde wandel/loop-snelheid als spelers, geen sprint

    // Richtpunt scheids: een TRAAG meebewegend anker dat de bal lagt — zo schiet
    // hij niet mee als de bal hard wordt gespeeld, maar drentelt hij ernaartoe.
    const bx = snap.ball.x;
    const by = snap.ball.y;
    if (!this.refAnchor) this.refAnchor = { x: bx, y: by };
    const ease = Math.min(1, dt * 1.4); // tijdconstante ~0.7s
    this.refAnchor.x += (bx - this.refAnchor.x) * ease;
    this.refAnchor.y += (by - this.refAnchor.y) * ease;
    // Lengte (op/neer): loopt vooral met de bal mee over het veld, lichte bias.
    const rx = clamp(this.refAnchor.x * 0.85 + cx * 0.15, box + 3, W - box - 3);
    // Breedte (zijwaarts, diagonaalsysteem): ligt de bal in het midden, dan staat
    // hij opzij; ligt de bal aan een zijkant, dan trekt hij naar het midden. De
    // zijde volgt de helft waarin de bal ligt ("wat uitkomt").
    const halfW = H / 2;
    const lateral = clamp((this.refAnchor.y - cy) / halfW, -1, 1);
    const diag = this.refAnchor.x >= cx ? 1 : -1;
    const ry = clamp(cy + diag * 11 * (1 - Math.abs(lateral)), 6, H - 6);

    // Grensrechters: achterste veldspeler (geen keeper) van de verdedigende kant.
    const homeOut = snap.players.filter((p) => p.side === "home" && !p.isKeeper);
    const awayOut = snap.players.filter((p) => p.side === "away" && !p.isKeeper);
    const homeDeep = homeOut.length ? Math.min(...homeOut.map((p) => p.x)) : cx;
    const awayDeep = awayOut.length ? Math.max(...awayOut.map((p) => p.x)) : cx;

    // Doel + vaste kijkrichting (grensrechters kijken het veld in en blijven dat
    // doen; de scheids krijgt zijn richting uit de LOOPbeweging).
    const targets: Record<string, { x: number; y: number; face: number | null }> = {
      ref: { x: rx, y: ry, face: null },
      lineA: { x: clamp(homeDeep, 4, cx), y: -1.4, face: Math.PI / 2 },
      lineB: { x: clamp(awayDeep, cx, W - 4), y: H + 1.4, face: -Math.PI / 2 },
    };

    for (const o of this.officials) {
      const t = targets[o.kind]!;
      const dxs = t.x - o.pos.x;
      const dys = t.y - o.pos.y;
      const dist = Math.hypot(dxs, dys);
      if (dist > 0.001) {
        const move = Math.min(dist, walk); // nooit sneller dan een speler loopt
        o.pos.x += (dxs / dist) * move;
        o.pos.y += (dys / dist) * move;
      }
      // Scheids kijkt naar de bal; grensrechters het veld in (vaste hoek).
      o.facing = t.face === null ? Math.atan2(by - o.pos.y, bx - o.pos.x) : t.face;
      o.container.position.set(o.pos.x * u, o.pos.y * u);
      o.body.rotation = o.facing;
    }
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
    // Shirtpatroon (binnen de romp-ellips). Verticale strepen = banden langs de
    // lengte-as van het shirt (de kijkrichting), gespreid over de breedte.
    if (pattern === "centre") {
      g.ellipse(-0.3, 0, 4.0, 0.95).fill(accent);
    } else if (pattern === "stripes") {
      for (const d of [-2.7, -1.35, 0, 1.35, 2.7]) {
        const rx = 4.0 * Math.sqrt(Math.max(0, 1 - (d / 4.6) ** 2));
        g.ellipse(-0.3, d, rx, 0.38).fill(accent);
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

    // Doelnetten (incl. eventuele goal-wobble) elk frame opnieuw.
    this.drawNets(snap);
    // Cosmetische scheids + grensrechters.
    this.updateOfficials(snap);

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
