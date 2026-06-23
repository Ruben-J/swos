import { Application, Container, Graphics, Sprite, Texture, TilingSprite } from "pixi.js";
import { PITCH, PLAYER, clamp, lerp } from "@pitch/shared";
import type { CameraView, MatchSnapshot, MatchSnapshotPlayer } from "@pitch/engine";
import {
  getPersonTexture,
  getPoseTexture,
  PERSON_SCALE,
  PERSON_ANCHOR_X,
  PERSON_ANCHOR_Y,
} from "./pixelPerson";

/** Maak een lege speler-/official-sprite met het juiste voet-anchor en schaal. */
function makePersonSprite(): Sprite {
  const sprite = new Sprite();
  sprite.anchor.set(PERSON_ANCHOR_X, PERSON_ANCHOR_Y);
  sprite.scale.set(PERSON_SCALE);
  return sprite;
}

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
  socks: number;
}

interface PlayerNode {
  container: Container;
  // Pixel-art-sprite voor álle poses: staand/lopend (voet-anchor) en de liggende
  // duik-/glijposes (midden-anchor + rotatie).
  sprite: Sprite;
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
  // Stadion (grasrand + reclameborden + publiekstribunes): statisch, in de
  // world-laag zodat het mee draait/tilt met het veld. Eenmalig opgebouwd.
  private stadium = new Container();
  // Crowd-tegels: hun texture wordt elk frame tegen de veldrotatie in gedraaid
  // (tileRotation = -rot) zodat de toeschouwers RECHTOP op het scherm staan.
  private crowdTiles: TilingSprite[] = [];
  // Beveiliging + fotografen op de asfalt-track: pixel-sprites in de world-laag,
  // elk frame tegen rot in gedraaid zodat ze rechtop op het scherm staan.
  private trackFigures: Sprite[] = [];
  // Cornervlaggen: rechtopstaand in de sprite-laag, elk frame geprojecteerd.
  private cornerFlags: { g: Graphics; x: number; y: number }[] = [];
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
    sprite: Sprite;
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
    // Stadion achter het veld, daarna het veld zelf eroverheen.
    this.world.addChild(this.stadium);
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
    this.buildStadium();
    this.buildCornerFlags();
    this.drawPitch();
    this.drawRollingBall(1, 0, 0);
  }

  /**
   * Bouw het stadion rond het veld (eenmalig): een donkere grasrand, een ring
   * van reclameborden, en daarbuiten de publiekstribunes (herhaalbare crowd-
   * texture). Alles in world-lokale pixels, zodat het mee draait/tilt/zoomt.
   */
  private buildStadium(): void {
    const u = PX_PER_UNIT;
    const W = PITCH.width * u;
    const H = PITCH.height * u;
    this.stadium.removeChildren();

    const apron = 3 * u; // grasrand tussen lijn en boarding
    const board = 1.6 * u; // diepte van de reclameborden
    const track = 2.6 * u; // asfalt-perimeter (fotografen/politie) tussen bord en tribune
    const stand = 34 * u; // diepte van de tribunes
    const e0 = apron; // boarding binnenrand
    const e1 = apron + board; // boarding buitenrand / track binnenrand
    const e2 = e1 + track; // track buitenrand / tribune binnenrand
    const e3 = e2 + stand; // tribune buitenrand

    // Donkere basis onder alles (alleen de zichtbare stroken blijven over).
    const base = new Graphics();
    base.rect(-e3, -e3, W + 2 * e3, H + 2 * e3).fill(0x123f22);
    this.stadium.addChild(base);

    // Publiekstribunes: thuispubliek rondom (overwegend thuiskleuren), met een
    // uitvak in de uitclubkleuren. Mensjes ~op veldspeler-formaat.
    const homeCrowd = this.makeCrowdTexture(
      hexToNum(this.colors.home.primary),
      hexToNum(this.colors.home.secondary),
    );
    const awayCrowd = this.makeCrowdTexture(
      hexToNum(this.colors.away.primary),
      hexToNum(this.colors.away.secondary),
    );
    const ts = 1.0; // tegelschaal (toeschouwers ~speler-formaat)
    this.crowdTiles = [];
    const addStand = (tex: Texture, x: number, y: number, w: number, h: number): void => {
      const t = new TilingSprite({ texture: tex, width: w, height: h });
      t.tileScale.set(ts);
      t.position.set(x, y);
      this.stadium.addChild(t);
      this.crowdTiles.push(t); // tileRotation wordt per frame tegen rot in gezet
    };
    addStand(homeCrowd, -e3, -e3, W + 2 * e3, stand); // zijlijn y<0
    addStand(homeCrowd, -e3, H + e2, W + 2 * e3, stand); // zijlijn y>H
    addStand(homeCrowd, -e3, -e2, stand, H + 2 * e2); // achter doel x<0
    addStand(homeCrowd, W + e2, -e2, stand, H + 2 * e2); // achter doel x>W
    // Uitvak: blok in de tribune achter het x=W-doel, aan de y=H-kant — valt na de
    // veld-rotatie (1e helft) rechtsboven in beeld.
    const awayLen = 0.42 * H;
    const awayY0 = H + e2 - awayLen; // grens tussen uit- en thuisvak
    addStand(awayCrowd, W + e2, awayY0, stand, awayLen);

    // Tribune-voorwand ("onderkant van de tribune"): een betonnen wand aan de
    // binnenrand van elke tribune (over de voorste crowd-rijen), met een lichte
    // reling aan de veldzijde — zo zitten de voorste toeschouwers er bovenop
    // i.p.v. hard af te kappen.
    const wall = 2.2 * u;
    const ew = e2 + wall;
    const front = new Graphics();
    const WALL = 0x42454c;
    const RAIL = 0x6a6e77;
    front.rect(-ew, -ew, W + 2 * ew, wall).fill(WALL); // boven
    front.rect(-ew, H + e2, W + 2 * ew, wall).fill(WALL); // onder
    front.rect(-ew, -e2, wall, H + 2 * e2).fill(WALL); // links
    front.rect(W + e2, -e2, wall, H + 2 * e2).fill(WALL); // rechts
    // Reling (lichte rand) aan de veldzijde van elke wand.
    front.rect(-ew, -e2 - 2, W + 2 * ew, 2).fill(RAIL); // boven
    front.rect(-ew, H + e2, W + 2 * ew, 2).fill(RAIL); // onder
    front.rect(-e2 - 2, -e2, 2, H + 2 * e2).fill(RAIL); // links
    front.rect(W + e2, -e2, 2, H + 2 * e2).fill(RAIL); // rechts
    this.stadium.addChild(front);

    // Asfalt-perimeter tussen de boarding en de tribunes.
    const asph = new Graphics();
    const ASF = 0x3b3e44;
    asph.rect(-e2, -e2, W + 2 * e2, track).fill(ASF); // y<0
    asph.rect(-e2, H + e1, W + 2 * e2, track).fill(ASF); // y>H
    asph.rect(-e2, -e1, track, H + 2 * e1).fill(ASF); // x<0
    asph.rect(W + e1, -e1, track, H + 2 * e1).fill(ASF); // x>W
    this.stadium.addChild(asph);

    // Reclameborden: ring van afwisselend gekleurde segmenten net buiten de lijn.
    const boards = new Graphics();
    const adCols = [0xe8e8e8, 0xcf2030, 0x1f53b0, 0xf0b020, 0x16a05a];
    const seg = 7 * u; // breedte van één bord
    const drawBoardRun = (x0: number, y0: number, horiz: boolean, len: number): void => {
      let p = 0;
      let i = 0;
      while (p < len) {
        const s = Math.min(seg, len - p);
        const col = adCols[i % adCols.length]!;
        if (horiz) boards.rect(x0 + p, y0, s, board).fill(col);
        else boards.rect(x0, y0 + p, board, s).fill(col);
        p += s;
        i++;
      }
    };
    drawBoardRun(-e0, -e1, true, W + 2 * e0); // boven
    drawBoardRun(-e0, H + e0, true, W + 2 * e0); // onder
    drawBoardRun(-e1, -e0, false, H + 2 * e0); // links
    drawBoardRun(W + e0, -e0, false, H + 2 * e0); // rechts
    this.stadium.addChild(boards);

    // Scheidslijn tussen uit- en thuisvak (donkere balk dwars door de tribune).
    const divider = new Graphics();
    divider.rect(W + e2, awayY0 - 0.9, stand, 1.8).fill(0x0e0e0e);
    this.stadium.addChild(divider);

    // Beveiliging + fotografen als upright pixel-figuren op de asfalt-track.
    this.trackFigures = [];
    const polTex = this.makeFigureTexture("police");
    const camTex = this.makeFigureTexture("camera");
    const place = (tex: Texture, x: number, y: number): void => {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 0.86); // voeten op de track
      s.scale.set(1.1);
      s.position.set(x, y);
      this.stadium.addChild(s);
      this.trackFigures.push(s); // rotation = -rot per frame -> rechtop
    };
    const tMid = (e1 + e2) / 2; // hart van de asfalt-track
    // Fotografen achter beide doelen.
    const nP = 8;
    for (let i = 0; i < nP; i++) {
      const y = H * (0.16 + (0.68 * i) / (nP - 1));
      place(camTex, -tMid, y);
      place(camTex, W + tMid, y);
    }
    // Politie langs beide zijlijnen.
    const nQ = 9;
    for (let i = 0; i < nQ; i++) {
      const x = W * (0.08 + (0.84 * i) / (nQ - 1));
      place(polTex, x, -tMid);
      place(polTex, x, H + tMid);
    }
    // Politie-cluster tussen uit- en thuisvak (op de x>W-track bij de grens).
    for (let k = -2; k <= 2; k++) place(polTex, W + tMid, awayY0 + k * 4.2);
  }

  /** Klein upright pixel-figuurtje voor de track: een steward/agent (geel hesje)
   *  of een fotograaf (camera tegen het gezicht). SWOS-achtig blokkerig. */
  private makeFigureTexture(kind: "police" | "camera"): Texture {
    const W = 11;
    const H = 15;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const px = (x: number, y: number, w: number, h: number, c: string): void => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    const OUT = "#101012";
    if (kind === "police") {
      px(2, 5, 7, 10, OUT); // outline lijf
      px(3, 11, 2, 3, "#1a1f33"); // benen
      px(6, 11, 2, 3, "#1a1f33");
      px(3, 5, 5, 6, "#f2cf1c"); // geel hesje
      px(3, 8, 5, 1, "#caa800"); // hesje-schaduwlijn
      px(2, 6, 1, 4, "#1a2a55"); // armen (mouwen)
      px(8, 6, 1, 4, "#1a2a55");
      px(3, 1, 5, 5, OUT); // outline hoofd
      px(4, 2, 3, 3, "#e6b48c"); // gezicht
      px(3, 0, 5, 2, "#16204a"); // politiepet
    } else {
      px(2, 5, 7, 10, OUT); // outline lijf
      px(3, 11, 2, 3, "#23262c"); // benen
      px(6, 11, 2, 3, "#23262c");
      px(3, 6, 5, 6, "#33373f"); // donkere jas
      px(2, 7, 1, 4, "#33373f"); // armen omhoog naar de camera
      px(8, 7, 1, 4, "#33373f");
      px(4, 3, 3, 3, "#e6b48c"); // hoofd
      px(2, 2, 7, 4, OUT); // camera-outline (voor het gezicht gehouden)
      px(3, 3, 5, 2, "#0c0c0c"); // camera-body
      px(7, 3, 2, 2, "#3a3d42"); // lens-tube
      px(4, 3, 2, 2, "#bfe0ff"); // lens-glans
    }
    const tex = Texture.from(canvas);
    tex.source.scaleMode = "nearest";
    return tex;
  }

  /** Genereer een herhaalbare publiek-texture: rijen GROTE toeschouwers (~speler-
   *  formaat) die naar het veld kijken — hoofd, lijf in teamkleur, vaak een
   *  sjaal, soms opgestoken armen of een zwaaiende vlag. `primary` zaait ook de
   *  variatie zodat thuis/uit verschillen. De texture wordt in de renderer tegen
   *  de veldrotatie in gedraaid zodat de mensen rechtop staan. */
  private makeCrowdTexture(primary: number, secondary: number): Texture {
    const cols = 8;
    const rows = 9;
    const cw = 14; // celbreedte
    const ch = 10; // celhoogte < lijfhoogte -> rijen schuiven áchter elkaar (getrapt)
    const T_W = cols * cw;
    const T_H = rows * ch;
    const canvas = document.createElement("canvas");
    canvas.width = T_W;
    canvas.height = T_H;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#15181d"; // donkere tribune-achtergrond
    ctx.fillRect(0, 0, T_W, T_H);
    let seed = (primary ^ 0x9e3779b1) >>> 0;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const hx = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;
    const px = (x: number, y: number, w: number, h: number, c: string): void => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    // Lijf-/sjaalkleuren: overwegend de teamkleuren, met wat neutrale variatie.
    const team = hx(primary);
    const team2 = hx(secondary);
    const bodies = [team, team, team, team, team2, team2, "#2b2b2b", "#cfcfcf", "#2a4a8a"];
    const skins = ["#f0c79c", "#d9a877", "#b07c4e", "#8a5a32"];
    const hairs = ["#241810", "#0e0e0e", "#5a3a1a", "#7a5a36", "#b9b9b9"];

    // Achterste rijen eerst (vóór-rijen overlappen ze -> diepte).
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = c * cw + 1 + ((rnd() * 2) | 0);
        const top = r * ch + 1;
        const body = bodies[(rnd() * bodies.length) | 0]!;
        const skin = skins[(rnd() * skins.length) | 0]!;
        const hair = hairs[(rnd() * hairs.length) | 0]!;
        const armsUp = rnd() < 0.32;
        const scarf = rnd() < 0.4;
        const flag = rnd() < 0.07;
        // Romp (schouders + bovenlijf), naar de kijker/het veld toe.
        px(cx, top + 6, 12, 8, body);
        px(cx, top + 6, 12, 1, "rgba(255,255,255,0.12)"); // schouder-highlight
        // Sjaal: gekleurde band onder de hals (vaak in de andere teamkleur).
        if (scarf) px(cx, top + 6, 12, 2, rnd() < 0.5 ? team2 : team);
        // Hoofd: haar + gezicht.
        px(cx + 3, top, 6, 4, hair);
        px(cx + 4, top + 3, 4, 3, skin);
        // Armen: opgestoken (juichend) of langs het lijf.
        if (armsUp) {
          px(cx, top + 1, 2, 6, skin); // linkerarm omhoog
          px(cx + 10, top + 1, 2, 6, skin); // rechterarm omhoog
          if (scarf) px(cx, top, 12, 2, rnd() < 0.5 ? team : team2); // sjaal omhoog gehouden
        } else {
          px(cx, top + 7, 2, 5, skin); // armen langs het lijf
          px(cx + 10, top + 7, 2, 5, skin);
        }
        // Vlag: paal + wapperend doek boven het hoofd.
        if (flag) {
          px(cx + 9, top - 7, 1, 9, "#caa46a");
          px(cx + 10, top - 7, 6, 4, rnd() < 0.5 ? team : team2);
        }
      }
    }
    const tex = Texture.from(canvas);
    tex.source.scaleMode = "nearest";
    tex.source.addressMode = "repeat";
    return tex;
  }

  /** Maak vier cornervlaggen (paal + driehoekvlag) in de sprite-laag. */
  private buildCornerFlags(): void {
    const W = PITCH.width;
    const H = PITCH.height;
    const dark = 0x121212;
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
      const g = new Graphics();
      // Blokkerige (pixel-art) cornervlag: paal recht omhoog vanaf de hoek
      // (scherm-omhoog = -y) met een getrapt geel-rood vaantje aan de top.
      const px = (rx: number, ry: number, w: number, h: number, c: number): void => {
        g.rect(rx, ry, w, h).fill(c);
      };
      px(-1.4, -15, 2.6, 15, dark); // paal-outline
      px(-0.8, -15, 1.4, 14, 0xcfcfcf); // paal
      // Vaantje: donkere outline + gestapelde rijen (blokpixels), geel/rood.
      px(0.6, -16, 8.4, 7, dark);
      px(0.6, -15, 7, 1.4, 0xf2c01e);
      px(0.6, -13.6, 6, 1.4, 0xd8392a);
      px(0.6, -12.2, 4.6, 1.4, 0xf2c01e);
      px(0.6, -10.8, 3, 1.4, 0xd8392a);
      this.sprites.addChild(g);
      this.cornerFlags.push({ g, x, y });
    }
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
      socks: 0x1a1a1a,
    };
    const make = (kind: "ref" | "lineA" | "lineB", x: number, y: number, facing: number) => {
      const container = new Container();
      const sprite = makePersonSprite();
      const shadow = new Graphics().ellipse(0, 1, 5.2, 2.4).fill({ color: 0x000000, alpha: 0.28 });
      sprite.texture = getPersonTexture(look, facing, 0, null);
      container.addChild(shadow, sprite);
      this.sprites.addChild(container);
      this.officials.push({ kind, container, sprite, pos: { x, y }, facing, look, phase: 0 });
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
      // Staande sprite: kijkrichting + loopframe op de pixel-art zetten.
      const moving = dist > 0.001;
      const frame = moving ? (Math.floor(o.phase * 0.5) % 2) + 1 : 0;
      o.sprite.texture = getPersonTexture(o.look, o.facing + rot, frame, null);
    }
  }

  private ensurePlayer(p: MatchSnapshotPlayer): PlayerNode {
    let node = this.players.get(p.id);
    if (node) return node;
    const container = new Container();
    const shadow = new Graphics().ellipse(0, 1, 5.2, 2.4).fill({ color: 0x000000, alpha: 0.28 });
    const sprite = makePersonSprite();
    const ring = new Graphics();
    const col = this.colors[p.side];
    const primary = hexToNum(col.primary);
    const secondary = hexToNum(col.secondary);
    const look: PersonLook = {
      shirt: p.isKeeper ? 0x2bd06a : primary,
      accent: p.isKeeper ? 0x125a30 : secondary,
      pattern: p.isKeeper ? "plain" : col.pattern ?? "plain",
      hair: hexToNum(p.hairColor),
      skin: hexToNum(p.skinColor),
      shorts: p.isKeeper ? 0x161616 : pickShorts(primary, secondary),
      socks: p.isKeeper ? 0x0e4423 : secondary,
    };
    // Ring/schaduw onder de sprite (grond), sprite bovenop.
    container.addChild(shadow, ring, sprite);
    this.sprites.addChild(container);
    node = { container, sprite, ring, shadow, look, phase: 0, px: p.x, py: p.y, diveDir: { x: 1, y: 0 } };
    this.players.set(p.id, node);
    return node;
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
    // Crowd-texture + track-figuren tegen de veldrotatie in draaien -> rechtop.
    for (const t of this.crowdTiles) t.tileRotation = -rot;
    for (const s of this.trackFigures) s.rotation = -rot;
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
    // Cornervlaggen: rechtopstaand op de geprojecteerde hoekpunten.
    for (const f of this.cornerFlags) {
      const s = this.project(f.x, f.y);
      f.g.position.set(s.x, s.y);
      f.g.scale.set(view.zoom);
      f.g.zIndex = s.y;
    }

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
      const sp = node.sprite;
      if (p.isKeeper && p.state === "dive") {
        // Liggende duik-pixelsprite, door de LUCHT getild op zijn hoogte (z);
        // schaduw blijft op de grond. Oriëntatie: beweegt hij echt dan langs de
        // sprong; duikt hij ter plekke (reflex) dan naar de bal toe.
        sp.texture = getPoseTexture(node.look, "dive");
        sp.anchor.set(0.5, 0.5);
        const ballS = this.project(snap.ball.x, snap.ball.y);
        sp.rotation =
          sm > 0.6
            ? Math.atan2(node.diveDir.y, node.diveDir.x)
            : Math.atan2(ballS.y - s.y, ballS.x - s.x);
        sp.position.set(0, -p.z * u);
        node.shadow.scale.set(1 / (1 + p.z * 0.5));
      } else if (p.state === "slide") {
        // Sliding tackle: liggende pixelsprite langs de glij-richting.
        sp.texture = getPoseTexture(node.look, "slide");
        sp.anchor.set(0.5, 0.5);
        sp.rotation = Math.atan2(node.diveDir.y, node.diveDir.x);
        sp.position.set(0, 0);
        node.shadow.scale.set(1);
      } else {
        // Staand/lopend: voet-anchor, geen rotatie.
        sp.anchor.set(PERSON_ANCHOR_X, PERSON_ANCHOR_Y);
        sp.rotation = 0;
        sp.position.set(0, 0);
        node.shadow.scale.set(1);
        const moving = moved > 0.04;
        const frame = moving ? (Math.floor(node.phase * 0.5) % 2) + 1 : 0;
        sp.texture = getPersonTexture(node.look, pf + rot, frame, hold);
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

/** Waargenomen helderheid (0..1) van een 0xRRGGBB-kleur. */
function luminance(c: number): number {
  return (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
}

/** Donkerdere tint van een kleur (factor < 1). */
function darken(c: number, f: number): number {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/** Broekkleur per team: heeft het team een echte tweede kleur (geen wit/licht),
 *  dan die als broek; anders een donkerder tint van het shirt — zo is geen
 *  enkel broekje meer standaard wit. */
function pickShorts(shirt: number, secondary: number): number {
  return luminance(secondary) < 0.8 ? secondary : darken(shirt, 0.6);
}

/** Interpoleer een hoek via de kortste weg (geen 360°-flip bij de wrap). */
function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
