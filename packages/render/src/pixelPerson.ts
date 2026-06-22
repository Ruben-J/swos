import { Texture } from "pixi.js";

/** Kleurset voor een pixel-mannetje (speler, keeper of official). Getallen zijn
 *  0xRRGGBB. Structureel identiek aan `PersonLook` in de renderer. */
export interface PixelLook {
  shirt: number;
  accent: number;
  pattern: "plain" | "stripes" | "centre";
  hair: number;
  skin: number;
  shorts: number;
  socks: number;
}

export type HoldPose = "throw" | "keeper" | null;

// Native pixel-resolutie van een staande sprite. Ruimer dan een SWOS-tegel zodat
// er detail in kan (grote haarbos, gezicht, korte mouwen). Met de camera-zoom +
// nearest-neighbour opschaling blijven het grove blokpixels.
const ART_W = 20;
const ART_H = 24;
// Voeten staan onderaan-midden; dit punt valt op de container-oorsprong (0,0).
const FOOT_Y = ART_H - 1;
const CX = 10;

// Aantal kijkrichtingen waarop we de sprite "vastklikken" (SWOS draaide ook in
// stappen). 8 = N, NE, E, SE, S, SW, W, NW.
const DIRS = 8;

const OUTLINE = 0x141414;
const BOOT = 0x161616;
const WHITE = 0xffffff;

// De pixel-art is ~FOOT_Y px hoog; map dat naar deze schermhoogte (eenheden) in
// de renderer. Iets groter/breder dan voorheen — meer SWOS-aanwezigheid.
export const PERSON_SCALE = 19 / FOOT_Y;
// Anchor (fractie) zodat het voetpunt (CX, FOOT_Y) op de container-oorsprong valt.
export const PERSON_ANCHOR_X = (CX + 0.5) / ART_W;
export const PERSON_ANCHOR_Y = (FOOT_Y + 0.5) / ART_H;

function dirBucket(face: number): number {
  const step = (Math.PI * 2) / DIRS;
  return ((Math.round(face / step) % DIRS) + DIRS) % DIRS;
}

/** Tint een kleur: f<1 donkerder, f>1 lichter. */
function shade(c: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

const standCache = new Map<string, Texture>();
const poseCache = new Map<string, Texture>();

function lookKey(l: PixelLook): string {
  return `${l.shirt}|${l.accent}|${l.pattern}|${l.hair}|${l.skin}|${l.shorts}|${l.socks}`;
}

/**
 * Haal (of genereer) de pixel-art-texture voor een staand/lopend mannetje dat
 * een bepaalde kant op kijkt. Gecachet per palet + richting + loopframe +
 * houding, dus per wedstrijd maar enkele tientallen kleine textures.
 */
export function getPersonTexture(
  look: PixelLook,
  face: number,
  frame: number,
  hold: HoldPose,
): Texture {
  const dir = dirBucket(face);
  const fr = hold ? 0 : ((frame % 2) + 2) % 2;
  const key = `${lookKey(look)}|${dir}|${fr}|${hold ?? "_"}`;
  let tex = standCache.get(key);
  if (tex) return tex;
  tex = build(ART_W, ART_H, (ctx) => drawPerson(ctx, look, dir, fr, hold));
  standCache.set(key, tex);
  return tex;
}

export type PoseKind = "dive" | "slide";

/** Liggende actie-pose (keeperduik / sliding tackle), als losse texture. Wordt
 *  in de renderer geroteerd op de actie-richting en op zijn midden geankerd. */
export function getPoseTexture(look: PixelLook, pose: PoseKind): Texture {
  const key = `${lookKey(look)}|${pose}`;
  let tex = poseCache.get(key);
  if (tex) return tex;
  const dims = POSE_DIMS[pose];
  tex = build(dims.w, dims.h, (ctx) =>
    pose === "dive" ? drawDive(ctx, look) : drawSlide(ctx, look),
  );
  poseCache.set(key, tex);
  return tex;
}

const POSE_DIMS: Record<PoseKind, { w: number; h: number }> = {
  dive: { w: 30, h: 16 },
  slide: { w: 30, h: 15 },
};

function build(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = "nearest";
  return tex;
}

type Rect = { x: number; y: number; w: number; h: number; c: number };

/** Eerst elk blok 1px groter in de outline-kleur (SWOS-contour), daarna de
 *  kleurvlakken eroverheen in dezelfde volgorde. */
function paintRects(ctx: CanvasRenderingContext2D, w: number, h: number, rects: Rect[]): void {
  for (const r of rects) fillRect(ctx, w, h, r.x - 1, r.y - 1, r.w + 2, r.h + 2, OUTLINE);
  for (const r of rects) fillRect(ctx, w, h, r.x, r.y, r.w, r.h, r.c);
}

function drawPerson(
  ctx: CanvasRenderingContext2D,
  look: PixelLook,
  dir: number,
  frame: number,
  hold: HoldPose,
): void {
  const ang = (dir / DIRS) * Math.PI * 2;
  const fwd = Math.sin(ang); // >0 = gezicht naar de kijker, <0 = rug
  const side = Math.cos(ang); // >0 = naar rechts gericht
  const facing = fwd > 0.35; // duidelijk naar ons toe -> gezicht + ogen
  const back = fwd < -0.35; // van ons af -> achterhoofd (alleen haar)
  const profile = Math.abs(side) > 0.6 && Math.abs(fwd) < 0.85;

  const step = frame === 1 ? 1 : -1;
  const moving = hold === null;
  const lean = Math.round(side); // hele sprite leunt iets mee in de looprichting

  const shirtDk = shade(look.shirt, 0.78);
  const shortsDk = shade(look.shorts, 0.85);
  const hairHi = shade(look.hair, 1.5);

  const rects: Rect[] = [];
  const add = (x: number, y: number, w: number, h: number, c: number): void => {
    rects.push({ x, y, w, h, c });
  };

  const bodyX = CX - 4 + lean; // 6; breed/gedrongen lijf
  const bodyW = 8;

  // --- Benen: blote dij -> sok -> schoen, met brede dynamische pas ----------
  const legTopY = 17;
  const lead = moving ? step : 0; // +1: linkerbeen voor, -1: rechterbeen voor
  const drawLeg = (x0: number, d: number): void => {
    const x = x0 + d; // voorste been spreidt naar buiten
    const lift = d < 0 ? 2 : 0; // achterste been heft (stride)
    const y = legTopY - lift;
    add(x, y, 3, 2, look.skin); // dij (bloot)
    add(x, y + 2, 3, 2, look.socks); // sok
    add(x, y + 4, 3, 2, BOOT); // schoen
  };
  drawLeg(bodyX, lead);
  drawLeg(bodyX + 5, -lead);

  // --- Broek (brede witte SWOS-short, met shade) ---------------------------
  const shortsY = legTopY - 3; // 14
  add(bodyX, shortsY, bodyW, 3, look.shorts);
  add(bodyX + bodyW - 2, shortsY, 2, 3, shortsDk); // schaduwzijde

  // --- Romp (shirt): breed blok, korte mouwen, shade -----------------------
  const shirtH = 6;
  const shirtY = shortsY - shirtH; // 8
  add(bodyX, shirtY, bodyW, shirtH, look.shirt);
  add(bodyX + bodyW - 2, shirtY, 2, shirtH, shirtDk); // schaduwzijde
  if (look.pattern === "stripes") {
    for (let i = 0; i < bodyW; i += 2) add(bodyX + i, shirtY, 1, shirtH, look.accent);
  } else if (look.pattern === "centre") {
    add(bodyX + bodyW / 2 - 1, shirtY, 2, shirtH, look.accent);
  }
  add(bodyX, shortsY - 1, bodyW, 1, OUTLINE); // donkere broekzoom (wit-op-wit leesbaar)

  // --- Armen: LOSSE huidkleurige armen (korte mouwen) met een spleet tussen
  // arm en romp, zodat ze als aparte zwaaiende ledematen lezen (zoals SWOS). --
  const armY = shirtY + 1;
  const sw = moving ? step : 0;
  const leftAx = bodyX - 3; // 1px donkere spleet (x = bodyX-1) tot het lijf
  const rightAx = bodyX + bodyW + 1; // idem aan de rechterkant
  // Arm = lange mouw (shirtkleur) over (bijna) de hele arm + huidkleurige hand.
  const drawArm = (ax: number, dy: number): void => {
    add(ax, armY + dy, 2, 4, look.shirt); // lange mouw
    add(ax, armY + dy + 4, 2, 1, look.skin); // hand
  };
  if (hold === "throw") {
    add(leftAx, shirtY - 6, 2, 8, look.shirt); // lange mouw omhoog
    add(rightAx, shirtY - 6, 2, 8, look.shirt);
    add(leftAx, shirtY - 7, 2, 1, look.skin); // hand bovenaan
    add(rightAx, shirtY - 7, 2, 1, look.skin);
  } else if (hold === "keeper") {
    add(bodyX - 1, shirtY + 3, 2, 3, look.shirt); // lange mouw naar voren
    add(bodyX + bodyW - 1, shirtY + 3, 2, 3, look.shirt);
    add(bodyX + 1, shirtY + 6, bodyW - 2, 2, look.skin); // handen samen vooraan
  } else if (profile) {
    // Zij-aanzicht: de nabije arm hangt vóór het MIDDEN van de romp (niet aan de
    // voor-/achterrand) en zwaait naar voren/achter mee met de pas.
    add(bodyX + 3 + sw, armY, 2, 4, look.shirt); // lange mouw
    add(bodyX + 3 + sw, armY + 4, 2, 1, look.skin); // hand
  } else {
    drawArm(leftAx, sw);
    drawArm(rightAx, -sw);
  }

  // --- Hoofd: GROTE ronde donkere haarbos + gezicht met witte oogjes -------
  // De forse haarkop is hét SWOS-kenmerk. Naar de kijker: gezicht + 2 ogen;
  // van ons af: enkel de haarbos.
  const headW = 7;
  const headH = 6;
  const headX = bodyX; // iets smaller dan de schouders
  const headY = shirtY - headH + 1; // 3, overlapt de schouders 1px
  const hairH = facing ? 3 : back ? 5 : 4;
  // Ronde haarbos: smalle kruin, brede onderkant (geen vierkant "helm"-blok).
  add(headX + 2, headY, headW - 4, 1, look.hair); // kruin (smal)
  add(headX, headY + 1, headW, hairH - 1, look.hair); // rest (breed)
  add(headX + 2, headY + 1, 2, 1, hairHi); // highlight
  const faceTop = headY + hairH;
  const faceH = headH - hairH;
  if (faceH > 0) {
    add(headX + 1, faceTop, headW - 2, faceH, look.skin); // gezicht/nek
    if (facing) {
      add(headX + 2, faceTop, 1, 1, WHITE); // twee ogen
      add(headX + headW - 3, faceTop, 1, 1, WHITE);
    } else if (profile) {
      add(side > 0 ? headX + headW - 3 : headX + 2, faceTop, 1, 1, WHITE); // één oog
    }
  }

  paintRects(ctx, ART_W, ART_H, rects);
}

/** Duikende keeper: liggend langs +x (renderer roteert op de sprongrichting),
 *  benen slepend (-x), armen + handschoenen gestrekt naar +x. */
function drawDive(ctx: CanvasRenderingContext2D, look: PixelLook): void {
  const { w, h } = POSE_DIMS.dive;
  const rects: Rect[] = [];
  const add = (x: number, y: number, ww: number, hh: number, c: number): void =>
    void rects.push({ x, y, w: ww, h: hh, c });
  // Slepende benen (-x).
  add(4, 5, 7, 2, look.socks);
  add(1, 5, 3, 2, BOOT);
  add(4, 10, 7, 2, look.socks);
  add(1, 10, 3, 2, BOOT);
  // Broek + liggende romp.
  add(10, 5, 4, 7, look.shorts);
  add(13, 4, 8, 8, look.shirt);
  add(13, 9, 8, 3, shade(look.shirt, 0.8));
  // Armen gestrekt naar +x met handschoenen (huid).
  add(20, 4, 7, 2, look.shirt);
  add(20, 10, 7, 2, look.shirt);
  add(26, 3, 3, 3, look.skin);
  add(26, 10, 3, 3, look.skin);
  // Hoofd vooraan-boven, met haar + gezicht + wit oogje.
  add(17, 0, 5, 4, look.hair);
  add(18, 3, 3, 2, look.skin);
  add(20, 3, 1, 1, 0xffffff);
  paintRects(ctx, w, h, rects);
}

/** Inglijdende veldspeler: liggend langs +x, tackle-been gestrekt naar +x,
 *  romp + hoofd slepend (-x). */
function drawSlide(ctx: CanvasRenderingContext2D, look: PixelLook): void {
  const { w, h } = POSE_DIMS.slide;
  const rects: Rect[] = [];
  const add = (x: number, y: number, ww: number, hh: number, c: number): void =>
    void rects.push({ x, y, w: ww, h: hh, c });
  // Gestrekt tackle-been (+x): sok + schoen aan de punt.
  add(15, 6, 10, 2, look.socks);
  add(25, 6, 3, 2, BOOT);
  // Gebogen steunbeen.
  add(11, 10, 6, 2, look.socks);
  add(16, 10, 3, 2, BOOT);
  // Broek + liggende romp.
  add(9, 5, 4, 6, look.shorts);
  add(3, 4, 7, 7, look.shirt);
  add(3, 8, 7, 3, shade(look.shirt, 0.8));
  // Steunarm naar -x.
  add(1, 3, 3, 2, look.shirt);
  // Hoofd achteraan (-x), met haar + gezicht + wit oogje.
  add(0, 6, 5, 5, look.hair);
  add(1, 7, 3, 2, look.skin);
  add(1, 7, 1, 1, 0xffffff);
  paintRects(ctx, w, h, rects);
}

function fillRect(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(cw, x + w);
  const y1 = Math.min(ch, y + h);
  if (x1 <= x0 || y1 <= y0) return;
  ctx.fillStyle = `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}
