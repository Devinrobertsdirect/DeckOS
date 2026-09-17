/**
 * showSfx — the stage's sound design, synthesized on the fly with WebAudio.
 *
 * No audio assets: every cue is a few oscillators and a filtered noise burst,
 * so it ships in the normal bundle and never waits on a download. Everything
 * sits well under the voice (master gain ~0.2) and is fire-and-forget. If the
 * page has no AudioContext or it can't be resumed (autoplay policy), every cue
 * is a silent no-op — the show never depends on it.
 *
 * PetShell maps stage scenes to cues (`sfxForScene`): whoosh + skid for the
 * drive-in, chimes for sparkles, bubbles in the lab, ticking gears while the
 * brain works, a rising sweep for the warp, pops for confetti, an arpeggio for
 * the trick's ta-da.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.2;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx.state === "closed" ? null : ctx;
  } catch { return null; }
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = c.sampleRate * 2;
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

interface ToneOpts { type?: OscillatorType; gain?: number; slideTo?: number; attack?: number; release?: number }
/** One enveloped oscillator: freq (optionally sliding to `slideTo`) for `dur` seconds starting `at` seconds from now. */
function tone(freq: number, at: number, dur: number, o: ToneOpts = {}) {
  const c = ac(); if (!c || !master) return;
  try {
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t0 + dur);
    const g = c.createGain();
    const peak = o.gain ?? 1, atk = o.attack ?? 0.006, rel = o.release ?? dur * 0.6;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.setValueAtTime(peak, t0 + Math.max(atk, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch { /* silent */ }
}

interface NoiseOpts { from: number; to: number; gain?: number; q?: number; kind?: BiquadFilterType; attack?: number }
/** Filtered noise burst whose cutoff sweeps from→to over `dur` seconds. */
function noise(at: number, dur: number, o: NoiseOpts) {
  const c = ac(); if (!c || !master) return;
  try {
    const t0 = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = o.kind ?? "bandpass"; f.Q.value = o.q ?? 0.9;
    f.frequency.setValueAtTime(o.from, t0);
    f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const g = c.createGain();
    const peak = o.gain ?? 0.5, atk = o.attack ?? 0.03;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  } catch { /* silent */ }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export const sfx = {
  /** Warm-up: called on the first user gesture / show start so the context exists. */
  prime() { ac(); },
  /** Boot HUD: a low hum rising under three quick blips. */
  hud() {
    tone(90, 0, 1.1, { type: "sawtooth", gain: 0.25, slideTo: 240, release: 0.5 });
    [0.15, 0.32, 0.49].forEach((t, i) => tone(880 + i * 220, t, 0.09, { type: "square", gain: 0.12 }));
    tone(1760, 0.75, 0.35, { gain: 0.18 });
  },
  /** Nebula gathering: a soft, slow swell. */
  boot() {
    noise(0, 2.2, { from: 200, to: 1800, gain: 0.18, q: 0.5, kind: "lowpass", attack: 0.9 });
    tone(110, 0.2, 2.4, { type: "triangle", gain: 0.2, slideTo: 220, attack: 0.8, release: 1.2 });
  },
  /** Drive-in: a whoosh, then (after ~1.3s, when the wheel locks) a skid. */
  drive() {
    noise(0, 1.1, { from: 300, to: 2400, gain: 0.45, q: 0.7, attack: 0.05 });
    tone(140, 0, 1.2, { type: "sawtooth", gain: 0.12, slideTo: 420, release: 0.4 });
    noise(1.25, 0.32, { from: 1900, to: 500, gain: 0.5, q: 1.4, attack: 0.01 });
    tone(220, 1.85, 0.12, { type: "triangle", gain: 0.25, slideTo: 120 });   // the settle "thump"
  },
  /** Sparkle: a little cluster of bright notes. */
  sparkle() {
    for (let i = 0; i < 5; i++) tone(rnd(1800, 3600), i * 0.055, 0.28, { type: "triangle", gain: 0.16 });
  },
  /** Chime: a clean major triad, staggered. */
  chime() {
    [1046.5, 1318.5, 1568].forEach((f, i) => tone(f, i * 0.07, 0.55, { gain: 0.2, release: 0.4 }));
  },
  /** Bubbles: a handful of round little blips sliding upward. */
  bubbles(n = 7) {
    let t = 0;
    for (let i = 0; i < n; i++) { t += rnd(0.1, 0.24); const f = rnd(280, 720); tone(f, t, 0.13, { gain: 0.18, slideTo: f * 1.7 }); }
  },
  /** Pop: a short pitch drop plus a noise tick. */
  pop(at = 0, gain = 0.3) {
    tone(620, at, 0.12, { type: "triangle", gain, slideTo: 150 });
    noise(at, 0.06, { from: 3000, to: 1200, gain: gain * 0.8, attack: 0.005 });
  },
  /** Lab boils over: one big pop, then fizz. */
  labpop() {
    sfx.pop(0, 0.4);
    noise(0.08, 0.7, { from: 2500, to: 900, gain: 0.25, q: 0.6 });
    sfx.bubbles(4);
  },
  /** Confetti: a scatter of pops over a second. */
  confetti() {
    for (let i = 0; i < 7; i++) sfx.pop(i * rnd(0.09, 0.16), 0.2);
  },
  /** Hearts: two soft notes. */
  hearts() {
    tone(659, 0, 0.5, { gain: 0.18, release: 0.35 });
    tone(880, 0.18, 0.7, { gain: 0.16, release: 0.5 });
  },
  /** Warp: a rising sweep with a low engine under it. */
  warp() {
    noise(0, 1.8, { from: 180, to: 5000, gain: 0.3, q: 0.5, kind: "lowpass", attack: 0.3 });
    tone(90, 0, 1.9, { type: "sawtooth", gain: 0.14, slideTo: 700, attack: 0.2, release: 0.6 });
  },
  /** Helmet: a glassy "clunk" as the dome seats. */
  helmet() {
    tone(240, 0, 0.16, { type: "triangle", gain: 0.3, slideTo: 130 });
    tone(2400, 0.02, 0.4, { gain: 0.08, release: 0.35 });
  },
  /** Ta-da: an ascending arpeggio with a held top note. */
  tada() {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.22, { type: "triangle", gain: 0.22 }));
    tone(1046, 0.3, 0.8, { type: "triangle", gain: 0.24, release: 0.6 });
    tone(1318, 0.3, 0.8, { gain: 0.12, release: 0.6 });
  },
  /** A tiny "boop" for a wink or a face pop. */
  boop() { tone(900, 0, 0.08, { gain: 0.14, slideTo: 1300 }); },
  /** Gears: a soft tick every 140ms until the returned stop() is called. */
  gears(): () => void {
    const c = ac(); if (!c) return () => undefined;
    let on = true;
    const step = () => { if (!on) return; tone(1900 + rnd(-150, 150), 0, 0.022, { type: "square", gain: 0.06 }); tone(320, 0, 0.03, { type: "triangle", gain: 0.05 }); };
    const id = window.setInterval(step, 140);
    step();
    return () => { on = false; window.clearInterval(id); };
  },
};

/** Scene → cue. Returns a stop function for looping cues (gears). */
export function sfxForScene(scene: string | null): (() => void) | null {
  switch (scene) {
    case "hud": sfx.hud(); return null;
    case "boot": sfx.boot(); return null;
    case "drive": sfx.drive(); return null;
    case "sparkle": sfx.sparkle(); return null;
    case "bowl": sfx.bubbles(5); return null;
    case "lab": sfx.bubbles(); return null;
    case "labpop": sfx.labpop(); return null;
    case "confetti": sfx.confetti(); return null;
    case "hearts": sfx.hearts(); return null;
    case "warp": case "finale": sfx.warp(); return null;
    case "helmet": sfx.helmet(); return null;
    case "trick": sfx.tada(); return null;
    case "core": case "orbit": sfx.chime(); return null;
    case "gears": return sfx.gears();
    default: return null;
  }
}
