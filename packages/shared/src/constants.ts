/**
 * Globale constanten. Veldcoördinaten zijn in "pitch units" (meters-achtig):
 * de simulatie rekent in deze units, de renderer schaalt naar pixels.
 * Oorsprong (0,0) = linkerbovenhoek van het speelveld; +x naar rechts, +y omlaag.
 */

/** Simulatie draait op een vaste timestep van 60 Hz. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ; // seconden per sim-tick

/** Maximaal aantal sim-stappen per frame (spiral-of-death-bescherming). */
export const MAX_STEPS_PER_FRAME = 5;

/** Veldafmetingen in pitch units (≈ meters). */
export const PITCH = {
  width: 105,
  height: 68,
  /** Marge buiten de lijnen (uit-zone) waar de bal/spelers mogen komen. */
  margin: 5,
  goalWidth: 7.32,
  goalDepth: 2,
  centerCircleRadius: 9.15,
  penaltyBoxWidth: 40.32,
  penaltyBoxDepth: 16.5,
  goalAreaWidth: 18.32,
  goalAreaDepth: 5.5,
  /** Afstand strafschopstip tot doellijn. */
  penaltySpotDist: 11,
  /** Straal van de strafschopboog (de "D"), gecentreerd op de stip. */
  penaltyArcRadius: 9.15,
  cornerArcRadius: 1,
} as const;

/** Afgeleide handige punten. */
export const PITCH_CENTER = { x: PITCH.width / 2, y: PITCH.height / 2 };

/** Balfysica-defaults (spel-specifiek, "muzikaal bestuurbaar", niet realistisch). */
export const BALL = {
  radius: 0.35,
  /** Grondwrijving per seconde als fractie van snelheid (rolweerstand). */
  groundFriction: 0.62,
  /** Luchtweerstand voor de grondvector wanneer de bal in de lucht is. Niet te
   *  laag t.o.v. groundFriction, anders lijkt een geloft schot te "versnellen"
   *  (het remt dan veel minder af dan een rollende bal). */
  airDrag: 0.24,
  /** Zwaartekracht op de hoogte-as (z), in units/s^2. */
  gravity: 22,
  /** Restitutie (stuiterbehoud) bij grondcontact op de z-as. */
  bounce: 0.55,
  /** Aftertouch-venster na een trap, in seconden. */
  aftertouchWindow: 0.55,
  /** Hoeveel curve aftertouch maximaal toevoegt (zijwaartse acceleratie). */
  aftertouchCurve: 70,
  /** Hoeveel hoogte (loft) aftertouch toevoegt bij tégen de bal in sturen (lob). */
  aftertouchLoft: 36,
  /** Maximale grondsnelheid van de bal. */
  maxSpeed: 42,
  /** Controle-/dribbelafstand: binnen deze straal "kleeft" de bal licht. */
  controlRadius: 1.4,
} as const;

/** Spelerbeweging. */
export const PLAYER = {
  radius: 0.6,
  /** Loopsnelheid (units/s) bij attribuut 50; schaalt met pace. */
  baseSpeed: 6.5,
  sprintMultiplier: 1.35,
  /** Acceleratie naar doelsnelheid (units/s^2). */
  accel: 28,
  /** Tackle-bereik. */
  tackleRange: 1.6,
  /** Header-bereik (horizontale afstand tot luchtbal). */
  headerRange: 1.4,
  /** Sprintmeter: verbruik/herstel per seconde (korte burst, trager herstel). */
  sprintDrainPerSec: 0.28,
  sprintRecoverPerSec: 0.13,
  /** Onder deze waarde raakt de speler "leeg"; pas boven re-engage weer sprinten. */
  sprintEmptyThreshold: 0.02,
  sprintReengageThreshold: 0.35,
} as const;

/** Modern ruleset (geen VAR in v1). */
export const RULES = {
  matchMinutes: 90,
  /** Versnelde wedstrijdklok: hoeveel sim-seconden = 1 wedstrijdminuut. */
  secondsPerMatchMinute: 4,
  maxSubstitutions: 5,
  halfTimeMinute: 45,
  /** Verplichte stilstand (s) bij een spelhervatting voordat ingenomen mag worden. */
  restartPause: 1.6,
  /** Afstand (units) die tegenstanders moeten houden bij een hervatting. */
  restartKeepOut: 7,
  /** Afstand (units) die tegenstanders houden als de keeper de bal vastheeft. */
  keeperHoldKeepOut: 4.5,
} as const;

/** Tucht: gele/rode kaarten en de daaruit volgende schorsingen. */
export const CARDS = {
  /** Aantal gele kaarten in een seizoen voordat een wedstrijd schorsing volgt. */
  yellowsForBan: 5,
  /** Aantal wedstrijden schorsing na een rode kaart. */
  redSuspension: 1,
} as const;

/** Save-schema versie. Verhoog bij elke breaking change + voeg migratie toe. */
export const SAVE_VERSION = 2;
