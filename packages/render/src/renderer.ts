import { Application, Container, Graphics } from "pixi.js";
import { PITCH, PLAYER, clamp, lerp } from "@pitch/shared";
import type { CameraView, MatchSnapshot, MatchSnapshotPlayer } from "@pitch/engine";

const PX_PER_UNIT = 11;

// SWOS-achtige kanteling: geen echte perspectief, alleen de lengte-as van het
// veld (doel-naar-doel, verticaal op het scherm) wat indrukken zodat het lijkt
// of de camera schuin van bovenaf kijkt. 1 = top-down, lager = sterker gekanteld.
const TILT = 0.72;

export interface TeamColors {
  primary: string;
  secondary: string;
  pattern?: "plain" | "stripes" | "centre";
}

/** Kleurset voor een staand mannetje (speler of official). */
interface PersonLook {
  shirt: number;
  accent: number;
  pattern: "plain" | "stripes" | "centre";
  hair: number;
  skin: number;
  shorts: number;
}

interface PlayerNode {
  container: Container;
  body: Graphics;
  ring: Graphics;
  shadow: Graphics;
  look: PersonLook;
  // Loop-animatie: fase loopt op met afgelegde afstand; vorige pitch-positie.
  phase: number;
  px: number;
  py: number;
  // Laatste schermbeweegrichting (voor de keeper-duik: liggen langs de sprong).
  diveDir: { x: number; y: number };
}

/**
 * PixiJS WebGL-renderer voor de wedstrijd. Tekent een statisch veld en
 * interpoleert speler-/balposities tussen twee sim-snapshots (render-alpha).
 * Bevat géén spel-logica — puur presentatie.
 */
export class MatchRenderer {
  readonly app: Application;
  // `world` draagt het veld zelf: gedraaid (90°) en langs de lengte-as ingedrukt
  // (TILT) zodat het gekanteld oogt. `sprites` is een aparte scherm-ruimte-laag
  // erbovenop: spelers/bal/officials staan daar RECHTOP en onvervormd, geplaatst
  // door hun pitch-positie naar het scherm te projecteren (project()).
  private world = new Container();
  private sprites = new Container();
  private pitchLayer = new Graphics();
  // Doelen: rechtopstaande 3D-kooien in de sprite-laag (één per doellijn, elk
  // met eigen diepte-sortering). Elk frame hertekend i.v.m. net-wobble.
  private goalNear = new Graphics();
  private goalFar = new Graphics();
  private ballShadow = new Graphics();
  private aimArrow = new Graphics();
  private ball = new Graphics(); // voetbal-grafiek (eenmalig getekend, roteert)
  // Huidige frame-projectie (pitch units -> schermpixels), gezet in render().
  private fScrX = 0;
  private fScrY = 0;
  private fCenterX = 0;
  private fCenterY = 0;
  private fScaleX = 1;
  private fScaleY = 1;
  private fCos = 0;
  private fSin = -1;
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
    look: PersonLook;
    phase: number;
  }[] = [];
  // Rol-animatie van de bal: afgelegde afstand + laatste looprichting.
  private ballRoll = 0;
  private lastBallScreen: { x: number; y: number } | null = null;
  private lastBallDir = { x: 1, y: 0 };

  constructor(app: Application, colors: Record<"home" | "away", TeamColors>) {
    this.app = app;
    this.colors = colors;

    this.app.stage.addChild(this.world);
    this.app.stage.addChild(this.sprites);
    // Sprites op scherm-y sorteren: wie lager staat (dichterbij) tekent vóór.
    this.sprites.sortableChildren = true;
    this.world.addChild(this.pitchLayer);
    // Schaduw, richtpijl, bal en de doelkooien leven in de scherm-laag.
    this.ballShadow.zIndex = -1; // altijd op de grond, onder de sprites
    this.aimArrow.zIndex = 100000; // richtpijl als overlay bovenop
    // Bal-zIndex wordt elk frame op zijn grondpositie gezet (diepte-sortering).
    this.sprites.addChild(this.goalFar);
    this.sprites.addChild(this.goalNear);
    this.sprites.addChild(this.ballShadow);
    this.sprites.addChild(this.aimArrow);
    this.sprites.addChild(this.ball);
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

    // Doelen worden elke frame als 3D-kooi in de sprite-laag getekend (drawNets/
    // drawGoalCage), zodat ze rechtop staan en bij een doelpunt meebewegen.
  }

  /**
   * Teken één doel als rechtopstaande 3D-kooi in de sprite-laag (van voor of
   * achter, afhankelijk van waar het op het scherm staat). De voet staat op de
   * geprojecteerde doellijn; de palen/lat lopen recht omhoog (doelhoogte), het
   * net loopt naar achteren weg (depth). Parameter (s,t,h): s = breedte 0..1,
   * t = diepte 0..1 (front->back), h = hoogte 0..1 (grond->lat). `bulge` duwt
   * het achternet bij een doelpunt naar achteren rond `s0`.
   */
  private drawGoalCage(g: Graphics, xLine: number, dir: number, bulge: number, s0: number): void {
    g.clear();
    const u = PX_PER_UNIT;
    const gw = PITCH.goalWidth;
    const cy = PITCH.height / 2;
    const depth = 2.4; // netdiepte achter de lijn (units)
    const zoom = this.fScaleY;
    const Hpx = 2.44 * u * zoom; // doelhoogte, recht omhoog op het scherm

    const pt = (s: number, t: number, h: number): { x: number; y: number } => {
      const extra = bulge * Math.exp(-(((s - s0) / 0.28) ** 2)) * t * t;
      const dpt = depth * t + extra;
      const gr = this.project(xLine + dir * dpt, cy + (s - 0.5) * gw);
      return { x: gr.x, y: gr.y - h * Hpx };
    };

    const NS = 12;
    const fill = { color: 0xffffff, alpha: 0.06 } as const;
    // Net-vlakken licht gevuld (gras/spelers schemeren erdoor).
    const poly = (pts: { x: number; y: number }[]): number[] => pts.flatMap((p) => [p.x, p.y]);
    const backPlane: { x: number; y: number }[] = [];
    for (let i = 0; i <= NS; i++) backPlane.push(pt(i / NS, 1, 0));
    for (let i = NS; i >= 0; i--) backPlane.push(pt(i / NS, 1, 1));
    g.poly(poly(backPlane)).fill(fill);
    const roof: { x: number; y: number }[] = [];
    for (let i = 0; i <= NS; i++) roof.push(pt(i / NS, 0, 1));
    for (let i = NS; i >= 0; i--) roof.push(pt(i / NS, 1, 1));
    g.poly(poly(roof)).fill(fill);
    for (const s of [0, 1]) {
      g.poly(poly([pt(s, 0, 0), pt(s, 1, 0), pt(s, 1, 1), pt(s, 0, 1)])).fill(fill);
    }

    // Maaswerk (alle lijnen in één stroke).
    const mesh = { width: 0.6, color: 0xffffff, alpha: 0.32 } as const;
    const VH = 5; // hoogte-stappen
    // Achtervlak: verticale + horizontale strengen.
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      g.moveTo(pt(s, 1, 0).x, pt(s, 1, 0).y).lineTo(pt(s, 1, 1).x, pt(s, 1, 1).y);
    }
    for (let j = 0; j <= VH; j++) {
      const h = j / VH;
      g.moveTo(pt(0, 1, h).x, pt(0, 1, h).y);
      for (let i = 1; i <= NS; i++) g.lineTo(pt(i / NS, 1, h).x, pt(i / NS, 1, h).y);
    }
    // Dak: strengen langs de diepte.
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      g.moveTo(pt(s, 0, 1).x, pt(s, 0, 1).y).lineTo(pt(s, 1, 1).x, pt(s, 1, 1).y);
    }
    // Zijkanten: diagonalen front->back boven en onder.
    for (const s of [0, 1]) {
      g.moveTo(pt(s, 0, 1).x, pt(s, 0, 1).y).lineTo(pt(s, 1, 1).x, pt(s, 1, 1).y);
      g.moveTo(pt(s, 0, 0).x, pt(s, 0, 0).y).lineTo(pt(s, 1, 0).x, pt(s, 1, 0).y);
    }
    g.stroke(mesh);

    // Achterpalen + achterlat (dun).
    const backBar = { width: 1.5, color: 0xffffff, alpha: 0.8 } as const;
    g.moveTo(pt(0, 1, 0).x, pt(0, 1, 0).y).lineTo(pt(0, 1, 1).x, pt(0, 1, 1).y);
    g.moveTo(pt(1, 1, 0).x, pt(1, 1, 0).y).lineTo(pt(1, 1, 1).x, pt(1, 1, 1).y);
    g.moveTo(pt(0, 1, 1).x, pt(0, 1, 1).y).lineTo(pt(1, 1, 1).x, pt(1, 1, 1).y);
    g.stroke(backBar);

    // Voorpalen + lat (dik wit), bovenop alles.
    const frontBar = { width: 3.0, color: 0xffffff } as const;
    g.moveTo(pt(0, 0, 0).x, pt(0, 0, 0).y).lineTo(pt(0, 0, 1).x, pt(0, 0, 1).y);
    g.moveTo(pt(1, 0, 0).x, pt(1, 0, 0).y).lineTo(pt(1, 0, 1).x, pt(1, 0, 1).y);
    g.moveTo(pt(0, 0, 1).x, pt(0, 0, 1).y).lineTo(pt(1, 0, 1).x, pt(1, 0, 1).y);
    g.stroke(frontBar);
  }

  /**
   * Teken beide doelkooien. Bij een nieuw doelpunt (goalImpact.seq) start een
   * gedempte "wobble": het getroffen achternet bolt naar achteren rond het
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

    const cy = PITCH.height / 2;
    // Diepte-sortering: het doel dat lager op het scherm staat (dichterbij) komt
    // vóór de spelers; het verre doel erachter.
    this.goalNear.zIndex = this.project(0, cy).y;
    this.goalFar.zIndex = this.project(PITCH.width, cy).y;
    this.drawGoalCage(this.goalNear, 0, -1, goalX === 0 ? bulge : 0, s0);
    this.drawGoalCage(this.goalFar, PITCH.width, 1, goalX === PITCH.width ? bulge : 0, s0);
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
    const look: PersonLook = {
      shirt: color,
      accent: color,
      pattern: "plain",
      hair: 0x2e2018,
      skin: 0xe6b48c,
      shorts: 0x1a1a1a,
    };
    const make = (kind: "ref" | "lineA" | "lineB", x: number, y: number, facing: number) => {
      const container = new Container();
      const body = new Graphics();
      const shadow = new Graphics().ellipse(0, 1, 5.2, 2.4).fill({ color: 0x000000, alpha: 0.28 });
      this.drawPerson(body, look, facing);
      container.addChild(shadow, body);
      this.sprites.addChild(container);
      this.officials.push({ kind, container, body, pos: { x, y }, facing, look, phase: 0 });
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
  private updateOfficials(snap: MatchSnapshot, zoom: number): void {
    this.ensureOfficials();
    const rot = snap.half >= 2 ? Math.PI / 2 : -Math.PI / 2;
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
        o.phase += move * 2.2; // loop-fase mee met de afgelegde afstand
      }
      // Scheids kijkt naar de bal; grensrechters het veld in (vaste hoek).
      o.facing = t.face === null ? Math.atan2(by - o.pos.y, bx - o.pos.x) : t.face;
      const s = this.project(o.pos.x, o.pos.y);
      o.container.position.set(s.x, s.y);
      o.container.scale.set(zoom);
      o.container.zIndex = s.y;
      // Staande sprite: niet meedraaien, alleen de kijkrichting hertekenen.
      this.drawPerson(o.body, o.look, o.facing + rot, o.phase);
    }
  }

  private ensurePlayer(p: MatchSnapshotPlayer): PlayerNode {
    let node = this.players.get(p.id);
    if (node) return node;
    const container = new Container();
    const shadow = new Graphics().ellipse(0, 1, 5.2, 2.4).fill({ color: 0x000000, alpha: 0.28 });
    const body = new Graphics();
    const ring = new Graphics();
    const col = this.colors[p.side];
    const look: PersonLook = {
      shirt: p.isKeeper ? 0x2bd06a : hexToNum(col.primary),
      accent: p.isKeeper ? 0x125a30 : hexToNum(col.secondary),
      pattern: p.isKeeper ? "plain" : col.pattern ?? "plain",
      hair: hexToNum(p.hairColor),
      skin: hexToNum(p.skinColor),
      shorts: 0xf0f0f0,
    };
    // Ring onder de sprite (grond), body bovenop.
    container.addChild(shadow, ring, body);
    this.sprites.addChild(container);
    node = { container, body, ring, shadow, look, phase: 0, px: p.x, py: p.y, diveDir: { x: 1, y: 0 } };
    this.players.set(p.id, node);
    return node;
  }

  /**
   * Teken een rechtopstaand SWOS-mannetje. De voeten staan op de oorsprong
   * (0,0), het lichaam loopt omhoog (−y). `face` is de schermhoek van de
   * kijkrichting (0 = rechts, +π/2 = naar de kijker toe / scherm-onder): die
   * bepaalt of we het gezicht of de achterkant van het hoofd zien en welke kant
   * de speler op leunt — de sprite zelf draait NIET mee.
   */
  private drawPerson(
    g: Graphics,
    look: PersonLook,
    face: number,
    phase = 0,
    hold: "throw" | "keeper" | null = null,
  ): void {
    g.clear();
    const fwd = Math.sin(face); // >0 = naar de kijker (gezicht), <0 = van ons af (rug)
    const side = Math.cos(face); // links/rechts-component
    const dark = 0x101010;

    // Loop-cyclus: benen stappen tegengesteld, armen zwaaien tegengesteld aan de
    // benen, en het lijf bobt licht op en neer. `phase` loopt op met de afgelegde
    // afstand, dus stilstaand bevriest de pose.
    const sw = Math.sin(phase); // -1..1
    const bob = -Math.abs(Math.cos(phase)) * 0.5; // lichaam iets omhoog bij de pas

    // Benen (twee): elke voet stapt naar voren/achter (zijwaarts) en heft licht.
    const legSpread = 1.1;
    const legShift = side * 0.5;
    for (const sgn of [-1, 1]) {
      const swing = sgn === 1 ? sw : -sw;
      const lift = Math.max(0, swing) * 1.4; // geheven voet = korter been
      const x = sgn * legSpread - 0.7 + legShift + swing * 0.9;
      g.rect(x, -3.4, 1.4, 3.6 - lift).fill(0x2a2a2a);
    }
    // Korte broek.
    g.roundRect(-2.4, -6.4 + bob, 4.8, 3.4, 1.2).fill(look.shorts).stroke({ width: 0.6, color: dark, alpha: 0.5 });

    // Romp (shirt), licht leunend in de looprichting + bob.
    const lean = side * 0.6;
    g.roundRect(-2.6 + lean, -10.6 + bob, 5.2, 4.6, 1.8)
      .fill(look.shirt)
      .stroke({ width: 0.8, color: dark, alpha: 0.6 });
    // Shirtpatroon.
    if (look.pattern === "centre") {
      g.rect(-0.7 + lean, -10.6 + bob, 1.4, 4.6).fill(look.accent);
    } else if (look.pattern === "stripes") {
      for (const dx of [-1.8, 0, 1.8]) {
        g.rect(dx - 0.45 + lean, -10.6 + bob, 0.9, 4.6).fill(look.accent);
      }
    }
    // Armen: zwaaiend bij het lopen, omhoog bij een ingooi, naar voren bij de keeper.
    const arm = { width: 0.5, color: dark, alpha: 0.5 } as const;
    if (hold === "throw") {
      // Beide armen gestrekt omhoog naast het hoofd (bal komt boven het hoofd).
      g.rect(-2.9 + lean, -16.4 + bob, 1.1, 6.2).fill(look.shirt).stroke(arm);
      g.rect(1.8 + lean, -16.4 + bob, 1.1, 6.2).fill(look.shirt).stroke(arm);
    } else if (hold === "keeper") {
      // Armen naar voren/omhoog om de bal tegen de borst te klemmen.
      g.rect(-3.2 + lean, -9.4 + bob, 1.2, 3.2).fill(look.shirt).stroke(arm);
      g.rect(2.0 + lean, -9.4 + bob, 1.2, 3.2).fill(look.shirt).stroke(arm);
    } else {
      g.rect(-3.4 + lean, -10.2 + bob - sw * 0.8, 1.0, 3.4).fill(look.shirt).stroke(arm);
      g.rect(2.4 + lean, -10.2 + bob + sw * 0.8, 1.0, 3.4).fill(look.shirt).stroke(arm);
    }

    // Hoofd: bol haar als basis, gezicht (huid) verschijnt aan de kant waar de
    // speler heen kijkt. Kijkt hij van ons af (fwd<0) -> alleen achterhoofd/haar.
    const hx = lean + side * 0.6;
    const hy = -12.4 + bob;
    g.circle(hx, hy, 2.4).fill(look.hair).stroke({ width: 0.7, color: dark, alpha: 0.6 });
    if (fwd > -0.25) {
      const faceCx = hx + side * 0.7;
      const faceCy = hy + fwd * 0.7;
      g.circle(faceCx, faceCy, 1.5).fill(look.skin);
    }
  }

  /**
   * Teken een duikende keeper: liggend lichaam langs +x (de container-rotatie
   * zet +x op de sprongrichting), benen slepend achter, armen + handschoenen
   * gestrekt naar de bal toe, hoofd vooraan. Leest als een echte zijwaartse duik.
   */
  private drawKeeperDive(g: Graphics, look: PersonLook): void {
    g.clear();
    const dark = 0x101010;
    const out = { width: 0.6, color: dark, alpha: 0.6 } as const;
    // Benen slepen achter het lichaam (-x).
    g.rect(-8.6, -1.9, 4.4, 1.5).fill(0x2a2a2a).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    g.rect(-8.6, 0.4, 4.4, 1.5).fill(0x2a2a2a).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    // Broek + liggende romp (shirt).
    g.ellipse(-4.2, 0, 2.3, 2.1).fill(look.shorts).stroke(out);
    g.ellipse(-0.6, 0, 3.7, 2.6).fill(look.shirt).stroke(out);
    // Armen gestrekt naar de bal (+x) met handschoenen (huid) aan het eind.
    g.rect(2.0, -1.9, 4.8, 1.2).fill(look.shirt).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    g.rect(2.0, 0.7, 4.8, 1.2).fill(look.shirt).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    g.circle(7.2, -1.3, 1.35).fill(look.skin).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    g.circle(7.2, 1.3, 1.35).fill(look.skin).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    // Hoofd vooraan-boven het lichaam.
    g.circle(2.8, -2.6, 2.3).fill(look.hair).stroke({ width: 0.7, color: dark, alpha: 0.6 });
    g.circle(3.7, -2.3, 1.4).fill(look.skin);
  }

  /**
   * Teken een inglijdende veldspeler: liggend langs +x (container-rotatie zet +x
   * op de glij-richting), één been gestrekt naar voren (de tackle), het andere
   * gebogen, romp + hoofd erachter. Leest als een sliding tackle.
   */
  private drawPlayerSlide(g: Graphics, look: PersonLook): void {
    g.clear();
    const dark = 0x101010;
    const out = { width: 0.6, color: dark, alpha: 0.6 } as const;
    // Gestrekt tackle-been naar voren (+x), schoen aan het eind.
    g.rect(0.5, -0.6, 6.2, 1.4).fill(0x2a2a2a).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    g.circle(7.0, 0.1, 1.1).fill(0x161616);
    // Gebogen tweede been.
    g.rect(-1.2, 1.0, 4.2, 1.3).fill(0x2a2a2a).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    // Broek + liggende romp (shirt).
    g.ellipse(-2.4, -0.2, 2.1, 2.0).fill(look.shorts).stroke(out);
    g.ellipse(-4.6, -0.6, 3.2, 2.4).fill(look.shirt).stroke(out);
    // Steunarm naar achter.
    g.rect(-7.2, -1.8, 2.6, 1.0).fill(look.shirt).stroke({ width: 0.5, color: dark, alpha: 0.5 });
    // Hoofd achteraan.
    g.circle(-6.6, -1.0, 2.2).fill(look.hair).stroke({ width: 0.7, color: dark, alpha: 0.6 });
    g.circle(-6.0, -0.4, 1.3).fill(look.skin);
  }

  /** Projecteer een pitch-positie (units) naar schermpixels met dezelfde
   *  transform als `world` (rotatie + TILT-squash), maar zónder de sprites zelf
   *  te vervormen — die plaatsen we hier op de uitkomst. */
  private project(px: number, py: number): { x: number; y: number } {
    const lx = (px - this.fCenterX) * PX_PER_UNIT * this.fScaleX;
    const ly = (py - this.fCenterY) * PX_PER_UNIT * this.fScaleY;
    return {
      x: this.fScrX + lx * this.fCos - ly * this.fSin,
      y: this.fScrY + lx * this.fSin + ly * this.fCos,
    };
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

    // Wereldcontainer positioneren rond camera-centrum, mét rotatie. De
    // lengte-as van het veld (lokale x) wordt door TILT ingedrukt; na de 90°-
    // rotatie valt die op de verticale schermas -> SWOS-kanteling.
    const scaleX = view.zoom * TILT;
    const scaleY = view.zoom;
    this.world.rotation = rot;
    this.world.scale.set(scaleX, scaleY);
    const vx = view.center.x * u * scaleX;
    const vy = view.center.y * u * scaleY;
    this.world.position.set(
      screenW / 2 - (vx * cos - vy * sin),
      screenH / 2 - (vx * sin + vy * cos),
    );

    // Frame-projectie vastleggen voor de sprite-laag (zelfde transform als hier).
    this.fScrX = screenW / 2;
    this.fScrY = screenH / 2;
    this.fCenterX = view.center.x;
    this.fCenterY = view.center.y;
    this.fScaleX = scaleX;
    this.fScaleY = scaleY;
    this.fCos = cos;
    this.fSin = sin;
    // Sprite-laag staat in absolute schermpixels: geen eigen transform, alleen
    // de zoom bepaalt de sprite-grootte (gelijk met het veld).
    this.sprites.position.set(0, 0);
    this.sprites.rotation = 0;
    this.sprites.scale.set(1);

    // Doelnetten (incl. eventuele goal-wobble) elk frame opnieuw.
    this.drawNets(snap);
    // Cosmetische scheids + grensrechters.
    this.updateOfficials(snap, view.zoom);

    const prev = this.prev;
    const prevById = new Map(prev?.players.map((p) => [p.id, p]));
    const seen = new Set<string>();
    // Een speler die de bal vasthoudt (ingooi/keeper) bepaalt waar de bal komt:
    // in de handen of boven het hoofd i.p.v. op de grond.
    let heldBall: { x: number; y: number; face: number; mode: "throw" | "keeper" } | null = null;

    for (const p of snap.players) {
      seen.add(p.id);
      const node = this.ensurePlayer(p);
      const pp = prevById.get(p.id);
      const ix = pp ? lerp(pp.x, p.x, alpha) : p.x;
      const iy = pp ? lerp(pp.y, p.y, alpha) : p.y;
      const sprev = this.project(node.px, node.py);
      const s = this.project(ix, iy);
      node.container.position.set(s.x, s.y);
      node.container.scale.set(view.zoom);
      node.container.zIndex = s.y;
      // Loop-fase ophogen met de afgelegde afstand (pitch units) -> de pas loopt
      // sneller bij hogere snelheid en bevriest bij stilstand.
      const moved = Math.hypot(ix - node.px, iy - node.py);
      node.phase += moved * 2.2;
      node.px = ix;
      node.py = iy;
      // Schermbeweging -> duikrichting onthouden (voor de keeper-duik-pose).
      const sdx = s.x - sprev.x;
      const sdy = s.y - sprev.y;
      const sm = Math.hypot(sdx, sdy);
      if (sm > 0.3) node.diveDir = { x: sdx / sm, y: sdy / sm };
      // Kijkrichting -> schermhoek (wereldrotatie erbij), bepaalt of we het
      // gezicht of de achterkant van het hoofd zien (geen meedraaiende sprite).
      const pf = pp ? lerpAngle(pp.facing, p.facing, alpha) : p.facing;
      const hold = p.hold;
      if (p.isKeeper && p.state === "dive") {
        // Liggende duik-sprite, door de LUCHT getild op zijn hoogte (z); schaduw
        // blijft op de grond. Oriëntatie: beweegt hij echt (uitlopen/zijwaartse
        // duik) dan langs de sprong; duikt hij ter plekke (reflex) dan naar de bal
        // toe -> zo kan hij ook naar voren of achteren duiken, niet enkel zijwa.
        this.drawKeeperDive(node.body, node.look);
        const ballS = this.project(snap.ball.x, snap.ball.y);
        const da =
          sm > 0.6
            ? Math.atan2(node.diveDir.y, node.diveDir.x)
            : Math.atan2(ballS.y - s.y, ballS.x - s.x);
        node.body.rotation = da;
        node.body.position.set(0, -p.z * u);
        node.shadow.scale.set(1 / (1 + p.z * 0.5));
      } else if (p.state === "slide") {
        // Sliding tackle: liggend langs de glij-richting, been gestrekt naar voren.
        this.drawPlayerSlide(node.body, node.look);
        node.body.rotation = Math.atan2(node.diveDir.y, node.diveDir.x);
        node.body.position.set(0, 0);
        node.shadow.scale.set(1);
      } else {
        node.body.rotation = 0;
        node.body.position.set(0, 0);
        node.shadow.scale.set(1);
        this.drawPerson(node.body, node.look, pf + rot, node.phase, hold);
        if (hold) heldBall = { x: s.x, y: s.y, face: pf + rot, mode: hold };
      }

      // Actieve-speler-ring: lichtcirkel op de grond bij de voeten.
      node.ring.clear();
      if (p.isActive) {
        node.ring.ellipse(0, 1, 6.5, 3).stroke({ width: 1.6, color: 0xffffff, alpha: 0.9 });
      }
    }

    // Verwijder spelers die niet meer bestaan (zou niet moeten gebeuren).
    for (const [id, node] of this.players) {
      if (!seen.has(id)) {
        node.container.destroy();
        this.players.delete(id);
      }
    }

    // Bal met hoogte-schaduw (in scherm-laag: grond projecteren, hoogte = scherm-omhoog).
    const pball = prev?.ball;
    const bux = pball ? lerp(pball.x, snap.ball.x, alpha) : snap.ball.x;
    const buy = pball ? lerp(pball.y, snap.ball.y, alpha) : snap.ball.y;
    const buz = pball ? lerp(pball.z, snap.ball.z, alpha) : snap.ball.z;
    const zoom = view.zoom;
    const ground = heldBall ? { x: heldBall.x, y: heldBall.y } : this.project(bux, buy);
    const liftPx = buz * u * zoom; // hoogte -> recht omhoog op het scherm
    // Schaduw groeit/zachter bij hoogte (bij vasthouden: kleine schaduw bij de voeten).
    const shScale = heldBall ? zoom : (1 + buz * 0.4) * zoom;
    this.ballShadow.clear();
    this.ballShadow
      .ellipse(ground.x, ground.y, 4 * shScale, 2.5 * shScale)
      .fill({ color: 0x000000, alpha: heldBall ? 0.25 : 0.3 / (1 + buz * 0.4) });

    // Voetbal: normaal boven de grond getild; vastgehouden gaat hij naar de
    // handen (keeper) of boven het hoofd met een lichte ingooi-bob (throw).
    let px = ground.x;
    let py = ground.y - liftPx;
    if (heldBall) {
      if (heldBall.mode === "throw") {
        const bob = Math.abs(Math.sin((performance.now() / 1000) * 5)) * 1.6;
        px = heldBall.x;
        py = heldBall.y - (16.8 + bob) * zoom; // boven het hoofd
      } else {
        px = heldBall.x + Math.cos(heldBall.face) * 1.6 * zoom;
        py = heldBall.y - 8.8 * zoom; // tegen de borst/handen
      }
    }
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
    this.ball.scale.set(zoom * (1 + buz * 0.12));
    // Bal diepte-sorteren op zijn grondpositie (+kleine hoogte-bias), zodat een
    // speler die ervóór staat de bal afdekt. Bij een ingooi hangt de bal boven het
    // hoofd -> vóór de werper; in de keepershanden tegen de borst -> ACHTER de
    // keeper (zijn lijf dekt 'm af).
    this.ball.zIndex = heldBall
      ? heldBall.mode === "throw"
        ? heldBall.y + 3
        : heldBall.y - 3
      : ground.y + buz * u * 0.5;

    // Richt-pijltje voor een mikbare hervatting (hoek/vrije trap/penalty).
    this.aimArrow.clear();
    if (snap.restartAim != null) {
      const tip = this.project(bux + Math.cos(snap.restartAim) * 3.1, buy + Math.sin(snap.restartAim) * 3.1);
      this.drawAimArrow(ground.x, ground.y, tip.x, tip.y);
    }

    this.prev = snap;
    this.app.renderer.render(this.app.stage);
  }

  /** Klein geel richt-pijltje van de bal (bx,by) naar het mikpunt (tx,ty), beide
   *  al naar schermpixels geprojecteerd. */
  private drawAimArrow(bx: number, by: number, tx: number, ty: number): void {
    const angle = Math.atan2(ty - by, tx - bx);
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
