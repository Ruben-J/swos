/**
 * Wedstrijd-audio, volledig GESYNTHETISEERD met de WebAudio API (geen
 * geluidsbestanden): een doorlopend publiek-bed waarvan het geroezemoes
 * aanzwelt als de bal bij een doel komt, plus losse events — gejuich bij een
 * goal, een "oooh" bij een redding, balcontact bij passes/schoten en een
 * scheidsrechtersfluit bij overtredingen/rust/einde.
 */

type AC = AudioContext;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class MatchAudio {
  private ctx: AC | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private crowdSrc: AudioBufferSourceNode | null = null;
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
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  /** Hervat de context (autoplay-beleid vereist een user-gesture). */
  private ensureRunning(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** Start het publiek-bed (lus van zacht gefilterde ruis met golving). */
  start(): void {
    if (!this.ctx || !this.master || this.started || this.disposed) return;
    this.started = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeCrowdBuffer(4);
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    this.crowdSrc = src;
    this.crowdFilter = filter;
    this.crowdGain = g;
    // Fade-in van het publiek.
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 1.5);
    // Inschakelen op de eerste gesture als de context nog geblokkeerd is.
    this.ensureRunning();
    if (this.ctx.state === "suspended") {
      this.resumeHandler = () => this.ensureRunning();
      window.addEventListener("pointerdown", this.resumeHandler);
      window.addEventListener("keydown", this.resumeHandler);
    }
  }

  /** 0..1 publieksintensiteit: bal dichter bij een doel = meer geroezemoes. */
  setIntensity(x: number): void {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter) return;
    const v = clamp01(x);
    if (Math.abs(v - this.lastIntensity) < 0.04) return; // throttle de automation
    this.lastIntensity = v;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.035 + v * 0.08, t, 0.5);
    this.crowdFilter.frequency.setTargetAtTime(700 + v * 1700, t, 0.6);
  }

  /** Gejuich bij een doelpunt: een aanzwellende crowd-roar + tijdelijke boost. */
  cheer(): void {
    this.noiseSwell({ dur: 2.6, peak: 0.5, attack: 0.08, type: "lowpass", freq: 500, freqEnd: 2600, q: 0.5 });
    if (this.ctx && this.crowdGain) {
      const t = this.ctx.currentTime;
      this.crowdGain.gain.cancelScheduledValues(t);
      this.crowdGain.gain.setValueAtTime(0.13, t);
      this.crowdGain.gain.linearRampToValueAtTime(0.22, t + 0.3);
      this.crowdGain.gain.setTargetAtTime(0.06, t + 1.4, 1.2);
      this.lastIntensity = -1; // laat setIntensity daarna weer overnemen
    }
  }

  /** "Oooh" van het publiek bij een redding / afgeketst schot. */
  ooh(): void {
    this.noiseSwell({ dur: 0.85, peak: 0.24, attack: 0.12, type: "bandpass", freq: 520, freqEnd: 360, q: 1.3 });
  }

  /** Balcontact (pass/schot/tackle): korte percussieve tik; strength 0..1. */
  kick(strength: number): void {
    if (!this.ctx || !this.master) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    const s = clamp01(strength);
    const peak = 0.1 + s * 0.3;
    // Korte ruis-tik (de "klap").
    const src = this.ctx.createBufferSource();
    src.buffer = this.makeNoiseBuffer(0.08);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + s * 800;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.09);
    // Lage thump eronder.
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.07);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(peak * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Scheidsrechtersfluit: twee licht ontstemde tonen met trilling. */
  whistle(long = false): void {
    if (!this.ctx || !this.master) return;
    this.ensureRunning();
    const t = this.ctx.currentTime;
    const dur = long ? 0.6 : 0.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.setValueAtTime(0.22, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.master);
    for (const f of [2900, 2930]) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = long ? 20 : 28;
      const lfoG = this.ctx.createGain();
      lfoG.gain.value = 55;
      lfo.connect(lfoG).connect(o.frequency);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
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

  // --- synthese-helpers ---

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

  /** Publiek-bed: low-passed ruis met een langzame golving (publieksgolf). */
  private makeCrowdBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.96 + white * 0.04; // leaky low-pass -> 'pink'-achtig
      const env = 0.7 + 0.3 * Math.sin((i / n) * Math.PI * 2 * 3); // golving
      d[i] = last * env;
    }
    return buf;
  }
}
