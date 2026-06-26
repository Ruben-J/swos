/**
 * Wedstrijd-audio op basis van echte samples (mp3's in /public/audio), met
 * synthese als terugval als een bestand niet laadt:
 *  - een doorlopend stadion-bed waarvan het volume aanzwelt als de bal bij een
 *    doel komt;
 *  - gejuich (met opbouw -> piek) bij een doelpunt;
 *  - losse scheidsrechtersfluitjes (uit één bestand met meerdere fluiten);
 *  - balcontact-tikjes (uit één bestand met meerdere trappen);
 *  - een "oooh" bij een redding (gesynthetiseerd; daar is geen sample voor).
 * De audiocontext wordt op de eerste user-gesture hervat (autoplay-beleid).
 */

type AC = AudioContext;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Segmenten (start in s, lengte in s) van de losse geluiden, bepaald met
// stilte-detectie op de bronbestanden.
const WHISTLES: [number, number][] = [
  [0.83, 0.5],
  [3.75, 0.85],
  [6.8, 0.66],
  [9.54, 0.45],
  [12.78, 0.83],
  [18.52, 0.72],
];
const KICK_STARTS = [0.58, 1.98, 3.68, 4.99, 6.41, 7.84, 9.06, 10.41, 11.67, 13.12];
const KICK_DUR = 0.24;

export class MatchAudio {
  private ctx: AC | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdSrc: AudioBufferSourceNode | null = null;
  private buffers: Partial<Record<"ambience" | "cheer" | "whistle" | "kick", AudioBuffer>> = {};
  private started = false;
  private disposed = false;
  private lastIntensity = -1;
  private resumeHandler: (() => void) | null = null;

  constructor() {
    const Ctor =
      (window.AudioContext as typeof AudioContext | undefined) ??
      ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
  }

  private ensureRunning(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  start(): void {
    if (!this.ctx || !this.master || this.started || this.disposed) return;
    this.started = true;
    // Intensiteit-gain voor het bed (zwelt aan bij het doel).
    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.0001;
    this.crowdGain.connect(this.master);
    // Samples laden; bij gereed het bed starten. Synthese als terugval.
    void this.load();
    // Inschakelen op de eerste gesture als de context nog geblokkeerd is.
    this.ensureRunning();
    if (this.ctx.state === "suspended") {
      this.resumeHandler = () => this.ensureRunning();
      window.addEventListener("pointerdown", this.resumeHandler);
      window.addEventListener("keydown", this.resumeHandler);
    }
  }

  private async load(): Promise<void> {
    if (!this.ctx) return;
    const base = import.meta.env.BASE_URL || "/";
    const files: Record<"ambience" | "cheer" | "whistle" | "kick", string> = {
      ambience: `${base}audio/crowd-ambience.mp3`,
      cheer: `${base}audio/crowd-cheer.mp3`,
      whistle: `${base}audio/whistle.mp3`,
      kick: `${base}audio/ball-kick.mp3`,
    };
    await Promise.all(
      (Object.keys(files) as (keyof typeof files)[]).map(async (key) => {
        try {
          const res = await fetch(files[key]);
          const arr = await res.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(arr);
          if (this.disposed) return;
          this.buffers[key] = buf;
          if (key === "ambience") this.startAmbience(buf);
        } catch {
          /* terugval op synthese */
        }
      }),
    );
    // Als het bed-sample niet kwam, gebruik een gesynthetiseerd bed.
    if (!this.disposed && !this.crowdSrc) this.startSynthAmbience();
  }

  private startAmbience(buf: AudioBuffer): void {
    if (!this.ctx || !this.crowdGain || this.crowdSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.crowdGain);
    src.start();
    this.crowdSrc = src;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setValueAtTime(0.0001, t);
    this.crowdGain.gain.linearRampToValueAtTime(0.5, t + 1.5);
  }

  /** 0..1 publieksintensiteit: bal dichter bij een doel = luider/meer rumoer. */
  setIntensity(x: number): void {
    if (!this.ctx || !this.crowdGain) return;
    const v = clamp01(x);
    if (Math.abs(v - this.lastIntensity) < 0.04) return; // throttle de automation
    this.lastIntensity = v;
    const t = this.ctx.currentTime;
    // Stevig hoorbaar bed; duidelijke zwelling naar het doel.
    this.crowdGain.gain.setTargetAtTime(0.5 + v * 0.3, t, 0.5);
  }

  /** Gejuich bij een doelpunt (opbouw -> piek), met een tijdelijke bed-duck. */
  cheer(): void {
    const buf = this.buffers.cheer;
    if (!this.ctx || !this.master || !buf) {
      this.synthCheer();
      return;
    }
    this.ensureRunning();
    const t = this.ctx.currentTime;
    const offset = 2.0; // begin pal op de piek (eerste seconde opbouw eraf)
    const dur = 7.5;
    // Speelt TEGELIJK met het stadion-bed (geen duck): het gejuich ligt er als
    // extra laag bovenop, op een bescheiden niveau zodat het niet overheerst.
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.15);
    g.gain.setValueAtTime(0.4, t + dur - 2.0);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g).connect(this.master);
    src.start(t, offset, dur + 0.1);
    src.stop(t + dur + 0.15);
  }

  /** "Oooh" bij een redding (gesynthetiseerd; geen sample beschikbaar). */
  ooh(): void {
    this.noiseSwell({ dur: 0.85, peak: 0.22, attack: 0.12, type: "bandpass", freq: 520, freqEnd: 360, q: 1.3 });
  }

  /** Balcontact (pass/schot/tackle): één los baltik-sample; strength 0..1. */
  kick(strength: number): void {
    const buf = this.buffers.kick;
    if (!buf) {
      this.synthKick(strength);
      return;
    }
    const s = clamp01(strength);
    const start = KICK_STARTS[Math.floor(Math.random() * KICK_STARTS.length)]!;
    this.playSegment(buf, Math.max(0, start - 0.02), KICK_DUR, 0.4 + s * 0.45);
  }

  /** Scheidsrechtersfluit: één los fluit-sample (lang = twee blazen). */
  whistle(long = false): void {
    const buf = this.buffers.whistle;
    if (!buf) {
      this.synthWhistle(long);
      return;
    }
    const seg = WHISTLES[Math.floor(Math.random() * WHISTLES.length)]!;
    this.playSegment(buf, seg[0], seg[1], 0.6);
    if (long) {
      const seg2 = WHISTLES[Math.floor(Math.random() * WHISTLES.length)]!;
      this.playSegment(buf, seg2[0], seg2[1], 0.6, seg[1] + 0.12);
    }
  }

  /** Pauzeer/hervat alle audio (bij wedstrijd-pauze). */
  setSuspended(suspended: boolean): void {
    if (!this.ctx) return;
    if (suspended) {
      if (this.ctx.state === "running") void this.ctx.suspend();
    } else if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.resumeHandler) {
      window.removeEventListener("pointerdown", this.resumeHandler);
      window.removeEventListener("keydown", this.resumeHandler);
      this.resumeHandler = null;
    }
    try {
      this.crowdSrc?.stop();
    } catch {
      /* al gestopt */
    }
    this.crowdSrc = null;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }

  // --- sample-playback ---

  /** Speel een deel [offset, offset+dur] van een buffer met fade in/uit af. */
  private playSegment(buf: AudioBuffer, offset: number, dur: number, gain: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    this.ensureRunning();
    const t = this.ctx.currentTime + delay;
    const fade = Math.min(0.02, dur * 0.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + fade);
    g.gain.setValueAtTime(gain, t + Math.max(fade, dur - fade));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g).connect(this.master);
    src.start(t, offset, dur + 0.05);
    src.stop(t + dur + 0.06);
  }

  // --- synthese-terugval ---

  private startSynthAmbience(): void {
    if (!this.ctx || !this.crowdGain || this.crowdSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeCrowdBuffer(4);
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 1100;
    src.connect(filt).connect(this.crowdGain);
    src.start();
    this.crowdSrc = src;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setValueAtTime(0.0001, t);
    this.crowdGain.gain.linearRampToValueAtTime(0.18, t + 1.5);
  }

  private synthCheer(): void {
    this.noiseSwell({ dur: 2.6, peak: 0.5, attack: 0.08, type: "lowpass", freq: 500, freqEnd: 2600, q: 0.5 });
  }

  private synthKick(strength: number): void {
    if (!this.ctx || !this.master) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    const s = clamp01(strength);
    const peak = 0.1 + s * 0.3;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.08);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + s * 800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.09);
  }

  private synthWhistle(long: boolean): void {
    if (!this.ctx || !this.master) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    const dur = long ? 0.55 : 0.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 2300;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseSwell(opts: {
    dur: number;
    peak: number;
    attack: number;
    type: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(opts.dur + 0.1);
    const filt = this.ctx.createBiquadFilter();
    filt.type = opts.type;
    filt.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd !== undefined) filt.frequency.linearRampToValueAtTime(opts.freqEnd, t + opts.dur);
    filt.Q.value = opts.q ?? 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.peak, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + opts.dur + 0.05);
  }

  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeCrowdBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      const env = 0.7 + 0.3 * Math.sin((i / n) * Math.PI * 2 * 3);
      d[i] = last * env;
    }
    return buf;
  }
}
