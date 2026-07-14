/**
 * Atlas face engine — canvas renderer for the companion ("cute") face and the
 * neural-cluster face. Implements docs/FACE-SPEC.md:
 *  - round smoked-glass navy disc, two eyes, no mouth, no eyebrows
 *  - 8 expression states + TALKING, tweened 250–400 ms (never a hard cut)
 *  - blink every 4–7 s, gaze micro-drift, sleep dim
 *  - swappable "eye pack" themes ("the eyes always match the seam")
 *  - neural mode: pulsating node cluster loosely shaped like the same face
 */

export type FaceState =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "happy"
  | "confused"
  | "excited"
  | "charging"
  | "sleeping"
  | "angry"       // slanted, narrowed eyes (pairs with a red tint)
  | "suspicious"  // narrowed eyes that dart side to side
  | "sad"         // downward arcs
  | "love"        // heart-shaped eyes
  | "wink"        // one eye closed
  | "starstruck"; // star-shaped eyes

export type FaceMode = "atlas" | "neural" | "auto";

export interface FaceTheme {
  id: string;
  name: string;
  /** Eye colour as "r,g,b". null = follow the UI accent ("the seam"). */
  eyeRgb: string | null;
  /** Multiplier on blink interval (codex blinks slower). */
  blinkMult: number;
  /** Idle glow strength 0..1 (stealth is dimmer). */
  idleGlow: number;
  /** Vertical slit pupils (cat pack). */
  slitPupils?: boolean;
  /** Quantised pixel-grid eyes (pixel pack). */
  pixelEyes?: boolean;
}

export const FACE_THEMES: FaceTheme[] = [
  { id: "workshop", name: "MK-01 Workshop", eyeRgb: null, blinkMult: 1, idleGlow: 0.5 },
  { id: "stealth", name: "MK-02 Stealth", eyeRgb: "159,180,200", blinkMult: 1, idleGlow: 0.2 },
  { id: "forge", name: "MK-03 Forge", eyeRgb: "227,181,79", blinkMult: 0.9, idleGlow: 0.6 },
  { id: "codex", name: "MK-04 Codex", eyeRgb: "232,201,138", blinkMult: 1.6, idleGlow: 0.45 },
  { id: "cat", name: "Cat Eyes", eyeRgb: null, blinkMult: 0.8, idleGlow: 0.5, slitPupils: true },
  { id: "pixel", name: "Pixel Eyes", eyeRgb: null, blinkMult: 1, idleGlow: 0.5, pixelEyes: true },
];

export const FACE_DISC_RGB = "30,42,56"; // #1E2A38 smoked-glass navy

// ── Emoji overlay packs ──────────────────────────────────────────────────────
// A future "pack" system (mirrors the eye-pack idea): each pack is a named
// dictionary of short glyphs keyed by a stable semantic name. The face flashes
// one of these near the top as a momentary accent — the eyes stay the star.
// Every pack maps the SAME semantic keys, so any emotion renders in any pack.
export const EMOJI_PACKS: Record<string, { name: string; glyphs: Record<string, string> }> = {
  core: {
    name: "Core",
    glyphs: {
      love: "❤", star: "★", music: "♪", idea: "💡", sparkle: "✨",
      question: "?", exclaim: "!", sleepy: "z", cool: "😎", wink: ";)", ok: "👍",
    },
  },
  emoji: {
    name: "Emoji",
    glyphs: {
      love: "😍", star: "🤩", music: "🎵", idea: "💡", sparkle: "🎉",
      question: "🤔", exclaim: "😮", sleepy: "😴", cool: "😎", wink: "😉", ok: "👍",
    },
  },
  kawaii: {
    name: "Kawaii",
    glyphs: {
      love: "♡", star: "✧", music: "♫", idea: "⭑", sparkle: "＊",
      question: "・・?", exclaim: "!!", sleepy: "…zzz", cool: "▸◂", wink: "^_-", ok: "♪",
    },
  },
  retro: {
    name: "Retro",
    glyphs: {
      love: "<3", star: "*", music: "♬", idea: "¤", sparkle: "::",
      question: "?", exclaim: "!", sleepy: "Zz", cool: "B)", wink: ";)", ok: "[y]",
    },
  },
};

/** The active emoji pack — set from the React layer (localStorage-backed). */
let activeEmojiPack = "core";
export function setActiveEmojiPack(id: string): void {
  if (EMOJI_PACKS[id]) activeEmojiPack = id;
}
export function getActiveEmojiPack(): string {
  return activeEmojiPack;
}

/** Look up a glyph by semantic name; defaults to the active pack, falls back to core. */
export function glyphFor(name: string, pack: string = activeEmojiPack): string | null {
  return EMOJI_PACKS[pack]?.glyphs[name] ?? EMOJI_PACKS["core"]?.glyphs[name] ?? null;
}

// ── Eye geometry per state ───────────────────────────────────────────────────
// All lengths are fractions of the face diameter D. Left/right eyes may differ
// (confused). "shape" crossfades; numeric fields tween.

type EyeShape = "pill" | "arc" | "arcDown" | "dash" | "bolt" | "halfLid" | "heart" | "star";

interface EyeSpec {
  shape: EyeShape;
  w: number;      // width /D
  h: number;      // height /D
  dx: number;     // extra x offset /D
  dy: number;     // extra y offset /D
  rot?: number;   // per-eye rotation (rad), mirrored L/R — the "angry slant"
}

interface PoseSpec {
  left: EyeSpec;
  right: EyeSpec;
  gazeX: number;      // whole-gaze bias /D
  gazeY: number;
  tilt: number;       // whole-face tilt, radians
  blink: boolean;     // whether blinking applies in this state
  duration: number;   // tween-in duration ms (250–400 per spec)
}

const PILL: EyeSpec = { shape: "pill", w: 0.14, h: 0.30, dx: 0, dy: 0 };

const POSES: Record<FaceState, PoseSpec> = {
  idle: { left: PILL, right: PILL, gazeX: 0, gazeY: 0, tilt: 0, blink: true, duration: 320 },
  listening: {
    left: { ...PILL, w: 0.165, h: 0.33 },
    right: { ...PILL, w: 0.165, h: 0.33 },
    gazeX: 0.03, gazeY: -0.01, tilt: 0.02, blink: true, duration: 260,
  },
  thinking: {
    left: { ...PILL, w: 0.115, h: 0.24 },
    right: { ...PILL, w: 0.115, h: 0.24 },
    gazeX: -0.055, gazeY: -0.05, tilt: 0, blink: true, duration: 350,
  },
  talking: { left: PILL, right: PILL, gazeX: 0, gazeY: 0, tilt: 0, blink: true, duration: 250 },
  happy: {
    left: { shape: "arc", w: 0.17, h: 0.10, dx: 0, dy: -0.02 },
    right: { shape: "arc", w: 0.17, h: 0.10, dx: 0, dy: -0.02 },
    gazeX: 0, gazeY: 0, tilt: 0, blink: false, duration: 260,
  },
  confused: {
    left: { ...PILL, h: 0.28 },
    right: { shape: "dash", w: 0.13, h: 0.035, dx: 0.01, dy: -0.075 },
    gazeX: 0.01, gazeY: 0, tilt: -0.07, blink: false, duration: 300,
  },
  excited: {
    left: { shape: "bolt", w: 0.15, h: 0.30, dx: 0, dy: 0 },
    right: { shape: "bolt", w: 0.15, h: 0.30, dx: 0, dy: 0 },
    gazeX: 0, gazeY: 0, tilt: 0, blink: false, duration: 250,
  },
  charging: {
    left: { shape: "halfLid", w: 0.15, h: 0.13, dx: 0, dy: 0.01 },
    right: { shape: "halfLid", w: 0.15, h: 0.13, dx: 0, dy: 0.01 },
    gazeX: 0, gazeY: 0.01, tilt: 0, blink: false, duration: 400,
  },
  sleeping: {
    left: { shape: "dash", w: 0.15, h: 0.032, dx: 0, dy: 0.02 },
    right: { shape: "dash", w: 0.15, h: 0.032, dx: 0, dy: 0.02 },
    gazeX: 0, gazeY: 0.02, tilt: 0, blink: false, duration: 400,
  },
  // Slanted, narrowed eyes — inner-top down (angry brow without eyebrows).
  angry: {
    left: { shape: "pill", w: 0.16, h: 0.15, dx: 0, dy: 0, rot: 0.5 },
    right: { shape: "pill", w: 0.16, h: 0.15, dx: 0, dy: 0, rot: 0.5 },
    gazeX: 0, gazeY: 0.015, tilt: 0, blink: false, duration: 240,
  },
  // Narrowed eyes; the whole gaze darts side to side (handled as a state extra).
  suspicious: {
    left: { shape: "pill", w: 0.15, h: 0.115, dx: 0, dy: 0 },
    right: { shape: "pill", w: 0.15, h: 0.115, dx: 0, dy: 0 },
    gazeX: 0, gazeY: 0, tilt: 0, blink: false, duration: 300,
  },
  // Downward arcs + a slightly lowered gaze.
  sad: {
    left: { shape: "arcDown", w: 0.16, h: 0.09, dx: 0, dy: 0.02 },
    right: { shape: "arcDown", w: 0.16, h: 0.09, dx: 0, dy: 0.02 },
    gazeX: 0, gazeY: 0.03, tilt: 0, blink: false, duration: 320,
  },
  // Heart-shaped eyes — the "smitten" form.
  love: {
    left: { shape: "heart", w: 0.17, h: 0.16, dx: 0, dy: -0.01 },
    right: { shape: "heart", w: 0.17, h: 0.16, dx: 0, dy: -0.01 },
    gazeX: 0, gazeY: 0, tilt: 0, blink: false, duration: 300,
  },
  // A wink — right eye a happy arc (closed), left a lively pill.
  wink: {
    left: { shape: "pill", w: 0.15, h: 0.31, dx: 0, dy: 0 },
    right: { shape: "arc", w: 0.16, h: 0.09, dx: 0, dy: -0.01 },
    gazeX: 0, gazeY: 0, tilt: 0.03, blink: false, duration: 260,
  },
  // Star-shaped eyes — dazzled / starstruck.
  starstruck: {
    left: { shape: "star", w: 0.17, h: 0.17, dx: 0, dy: 0 },
    right: { shape: "star", w: 0.17, h: 0.17, dx: 0, dy: 0 },
    gazeX: 0, gazeY: 0, tilt: 0, blink: false, duration: 280,
  },
};

const EYE_OFFSET_X = 0.155; // eye centre distance from face centre /D
const EYE_BASELINE_Y = -0.05; // eyes sit slightly above midline

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface RenderedEye extends EyeSpec {
  alpha: number;
}

/** Numeric interpolation between eye specs; shape handled by caller crossfade. */
function lerpEye(a: EyeSpec, b: EyeSpec, t: number): EyeSpec {
  return {
    shape: t < 0.5 ? a.shape : b.shape,
    w: lerp(a.w, b.w, t),
    h: lerp(a.h, b.h, t),
    dx: lerp(a.dx, b.dx, t),
    dy: lerp(a.dy, b.dy, t),
    rot: lerp(a.rot ?? 0, b.rot ?? 0, t),
  };
}

// ── Neural cluster ───────────────────────────────────────────────────────────

interface ClusterNode {
  hx: number; hy: number;   // home /D from centre
  x: number; y: number;     // current /D
  vx: number; vy: number;
  phase: number;
  speed: number;
  size: number;             // base radius multiplier
}

interface ClusterEdge {
  a: number;
  b: number;
  phase: number;
}

interface ThoughtPulse {
  edge: number;
  t: number;      // 0..1 along edge
  dir: 1 | -1;
  life: number;
}

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCluster(): { nodes: ClusterNode[]; edges: ClusterEdge[] } {
  const rand = mulberry32(20260712);
  const nodes: ClusterNode[] = [];

  const gauss = () => (rand() + rand() + rand()) / 1.5 - 1; // ~N(0, 0.47)

  const addCluster = (cx: number, cy: number, n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const hx = cx + gauss() * spread;
      const hy = cy + gauss() * spread * 1.35; // eye clusters read as vertical pills
      nodes.push({
        hx, hy, x: hx, y: hy, vx: 0, vy: 0,
        phase: rand() * Math.PI * 2,
        speed: 0.7 + rand() * 1.1,
        size: 0.7 + rand() * 0.9,
      });
    }
  };

  // Two dense "eye" clusters so the graph still reads as the same face.
  addCluster(-EYE_OFFSET_X, EYE_BASELINE_Y, 22, 0.055);
  addCluster(EYE_OFFSET_X, EYE_BASELINE_Y, 22, 0.055);
  // Sparse halo filling the rest of the disc.
  for (let i = 0; i < 20; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 0.18 + rand() * 0.24;
    const hx = Math.cos(ang) * r;
    const hy = Math.sin(ang) * r * 0.9;
    nodes.push({
      hx, hy, x: hx, y: hy, vx: 0, vy: 0,
      phase: rand() * Math.PI * 2,
      speed: 0.5 + rand() * 0.9,
      size: 0.5 + rand() * 0.7,
    });
  }

  // k-nearest edges (2 per node), deduped.
  const edges: ClusterEdge[] = [];
  const seen = new Set<string>();
  nodes.forEach((n, i) => {
    const dists = nodes
      .map((m, j) => ({ j, d: (m.hx - n.hx) ** 2 + (m.hy - n.hy) ** 2 }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { j } of dists) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ a: Math.min(i, j), b: Math.max(i, j), phase: rand() * Math.PI * 2 });
      }
    }
  });
  // A few long cross-links between the eye clusters ("thought highways").
  for (let k = 0; k < 6; k++) {
    const a = Math.floor(rand() * 22);
    const b = 22 + Math.floor(rand() * 22);
    edges.push({ a, b, phase: rand() * Math.PI * 2 });
  }
  return { nodes, edges };
}

// ── Engine ───────────────────────────────────────────────────────────────────

export interface EngineDrawOpts {
  /** Face diameter in CSS px. */
  size: number;
  /** Live audio amplitude 0..~1 (talking bounce). */
  amplitude: number;
  /** External activity hint 0..1 (inference/CPU load drives the cluster). */
  activity: number;
  /** Eye colour "r,g,b" resolved from theme or accent. */
  eyeRgb: string;
  /** Optional disc/rim tint "r,g,b" — e.g. red when angry ("it turns red"). 0..1 strength. */
  tintRgb?: string;
  tintStrength?: number;
  /** Optional momentary glyph flashed above the eyes (an accent, not the eyes). 1–2 chars. */
  emoji?: string | null;
  theme: FaceTheme;
}

/** How long THINKING must persist (ms) before auto mode morphs to neural. */
const AUTO_NEURAL_AFTER_MS = 1500;
/** Activity level above which auto mode morphs to neural regardless of state. */
const AUTO_NEURAL_ACTIVITY = 0.65;

export class AtlasFaceEngine {
  private state: FaceState = "idle";
  private prevPose: PoseSpec = POSES.idle;
  private pose: PoseSpec = POSES.idle;
  private transitionStart = 0;
  private mode: FaceMode = "atlas";

  private blinkAt = 0;
  private blinkProgress = -1; // -1 = not blinking

  private thinkingSince = 0;
  private neuralBlend = 0; // 0 = eyes, 1 = cluster

  private cluster = buildCluster();
  private pulses: ThoughtPulse[] = [];
  private lastT = 0;

  // Emoji overlay — track the current glyph + when it appeared (for fade-in).
  private emojiValue: string | null = null;
  private emojiSince = 0;

  setMode(mode: FaceMode) {
    this.mode = mode;
  }

  getState(): FaceState {
    return this.state;
  }

  setState(next: FaceState, now: number) {
    if (next === this.state) return;
    // Capture current interpolated pose as the new tween origin.
    this.prevPose = this.interpolatedPose(now);
    this.pose = POSES[next];
    this.transitionStart = now;
    this.state = next;
    if (next === "thinking") this.thinkingSince = now;
  }

  private interpolatedPose(now: number): PoseSpec {
    const t = Math.min(1, (now - this.transitionStart) / this.pose.duration);
    const k = easeInOutCubic(t);
    return {
      left: lerpEye(this.prevPose.left, this.pose.left, k),
      right: lerpEye(this.prevPose.right, this.pose.right, k),
      gazeX: lerp(this.prevPose.gazeX, this.pose.gazeX, k),
      gazeY: lerp(this.prevPose.gazeY, this.pose.gazeY, k),
      tilt: lerp(this.prevPose.tilt, this.pose.tilt, k),
      blink: this.pose.blink,
      duration: this.pose.duration,
    };
  }

  /** Main entry — draw one frame. `now` is a monotonic ms clock. */
  draw(ctx: CanvasRenderingContext2D, now: number, opts: EngineDrawOpts) {
    const dt = this.lastT ? Math.min(50, now - this.lastT) : 16;
    this.lastT = now;

    const D = opts.size;
    const cx = D / 2;
    const cy = D / 2;
    const R = D / 2;

    // ── Which face? (auto-morph on sustained thinking / high activity) ──────
    const wantNeural =
      this.mode === "neural" ||
      (this.mode === "auto" &&
        ((this.state === "thinking" && now - this.thinkingSince > AUTO_NEURAL_AFTER_MS) ||
          opts.activity > AUTO_NEURAL_ACTIVITY));
    const blendTarget = wantNeural ? 1 : 0;
    this.neuralBlend += (blendTarget - this.neuralBlend) * Math.min(1, dt / 400);
    if (Math.abs(this.neuralBlend - blendTarget) < 0.01) this.neuralBlend = blendTarget;

    const sleeping = this.state === "sleeping";
    const globalDim = sleeping ? 0.32 : 1;

    ctx.clearRect(0, 0, D, D);
    ctx.save();
    ctx.globalAlpha = globalDim;

    // ── Disc ────────────────────────────────────────────────────────────────
    // A mood tint (e.g. red for anger) blends into the smoked-glass navy.
    const [dr, dg, db] = FACE_DISC_RGB.split(",").map(Number) as [number, number, number];
    let baseInner = `rgb(${FACE_DISC_RGB})`;
    let baseOuter = "rgb(16,24,34)";
    if (opts.tintRgb) {
      const s = Math.min(1, Math.max(0, opts.tintStrength ?? 0.35)) * (0.5 + 0.5 * (0.5 + 0.5 * Math.sin(now * 0.006)));
      const [tr, tg, tb] = opts.tintRgb.split(",").map(Number) as [number, number, number];
      const mix = (a: number, b: number) => Math.round(a + (b - a) * s);
      baseInner = `rgb(${mix(dr, tr)},${mix(dg, tg)},${mix(db, tb)})`;
      baseOuter = `rgb(${mix(16, Math.round(tr * 0.6))},${mix(24, Math.round(tg * 0.6))},${mix(34, Math.round(tb * 0.6))})`;
    }
    const disc = ctx.createRadialGradient(cx, cy - R * 0.25, R * 0.1, cx, cy, R);
    disc.addColorStop(0, baseInner);
    disc.addColorStop(1, baseOuter);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
    ctx.fillStyle = disc;
    ctx.fill();

    // Glass rim + idle glow ("it breathes — the shell glows faintly as it thinks")
    const glowPulse =
      this.state === "thinking" || this.neuralBlend > 0.3
        ? 0.5 + 0.5 * Math.sin(now * 0.0035)
        : 0.5 + 0.5 * Math.sin(now * 0.0012);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${opts.eyeRgb},${(0.12 + 0.14 * glowPulse * opts.theme.idleGlow).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, D * 0.006);
    ctx.stroke();

    const eyeAlpha = 1 - this.neuralBlend;
    if (eyeAlpha > 0.02) this.drawEyes(ctx, now, D, cx, cy, eyeAlpha, opts);
    if (this.neuralBlend > 0.02) this.drawCluster(ctx, now, dt, D, cx, cy, this.neuralBlend, opts);

    // ── Emoji overlay ─────────────────────────────────────────────────────────
    // A momentary accent glyph near the top of the face; the eyes stay the star.
    const emoji = opts.emoji && opts.emoji.trim() ? opts.emoji.trim() : null;
    if (emoji !== this.emojiValue) {
      this.emojiValue = emoji;
      this.emojiSince = now;
    }
    if (emoji) this.drawEmoji(ctx, now, D, cx, emoji, opts);

    ctx.restore();
  }

  // ── Emoji overlay ─────────────────────────────────────────────────────────

  private drawEmoji(
    ctx: CanvasRenderingContext2D,
    now: number,
    D: number,
    cx: number,
    glyph: string,
    opts: EngineDrawOpts,
  ) {
    // Fade-in over ~260 ms, plus a gentle vertical bob so it feels alive.
    const fadeIn = Math.min(1, (now - this.emojiSince) / 260);
    const bob = Math.sin(now * 0.004) * D * 0.012;
    const y = D * 0.18 + bob;
    ctx.save();
    ctx.globalAlpha *= 0.9 * fadeIn;
    ctx.fillStyle = `rgb(${opts.eyeRgb})`;
    ctx.shadowColor = `rgb(${opts.eyeRgb})`;
    ctx.shadowBlur = D * 0.03;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${(D * 0.22).toFixed(1)}px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`;
    ctx.fillText(glyph, cx, y);
    ctx.restore();
  }

  // ── Companion eyes ─────────────────────────────────────────────────────────

  private drawEyes(
    ctx: CanvasRenderingContext2D,
    now: number,
    D: number,
    cx: number,
    cy: number,
    layerAlpha: number,
    opts: EngineDrawOpts,
  ) {
    const pose = this.interpolatedPose(now);
    const { eyeRgb, theme, amplitude } = opts;

    // Blink scheduling (4–7 s randomised, scaled by theme).
    if (this.blinkAt === 0) this.blinkAt = now + (4000 + Math.random() * 3000) * theme.blinkMult;
    let blinkScale = 1;
    if (pose.blink) {
      if (this.blinkProgress < 0 && now >= this.blinkAt) this.blinkProgress = 0;
      if (this.blinkProgress >= 0) {
        this.blinkProgress += 16 / 140;
        if (this.blinkProgress >= 1) {
          this.blinkProgress = -1;
          this.blinkAt = now + (4000 + Math.random() * 3000) * theme.blinkMult;
        } else {
          blinkScale = Math.max(0.08, Math.abs(1 - this.blinkProgress * 2));
        }
      }
    }

    // Gaze micro-drift — two incommensurate sines read as "alive".
    let driftX = (Math.sin(now * 0.00023) * 0.012 + Math.sin(now * 0.00007 + 2) * 0.008) * D;
    const driftY = (Math.sin(now * 0.00019 + 1) * 0.009 + Math.sin(now * 0.00005) * 0.006) * D;
    // Suspicious: eyes dart side to side (shifty side-eye).
    if (this.state === "suspicious") {
      driftX += Math.sin(now * 0.006) * 0.06 * D;
    }

    // Talking bounce synced to TTS amplitude (fallback: gentle cadence).
    let bounce = 0;
    if (this.state === "talking") {
      bounce =
        amplitude > 0.015
          ? -Math.min(amplitude * 2.2, 1) * 0.02 * D
          : Math.sin(now * 0.012) * 0.008 * D;
    } else if (this.state === "happy") {
      bounce = -Math.abs(Math.sin(now * 0.01)) * 0.015 * D;
    }

    ctx.save();
    ctx.globalAlpha *= layerAlpha;
    ctx.translate(cx, cy + bounce);
    ctx.rotate(pose.tilt);
    ctx.translate(pose.gazeX * D + driftX, pose.gazeY * D + driftY);

    ctx.fillStyle = `rgb(${eyeRgb})`;
    ctx.strokeStyle = `rgb(${eyeRgb})`;
    ctx.shadowColor = `rgb(${eyeRgb})`;
    ctx.shadowBlur = D * 0.045;

    const drawEye = (spec: EyeSpec, side: -1 | 1) => {
      const ex = side * EYE_OFFSET_X * D + spec.dx * D;
      const ey = EYE_BASELINE_Y * D + spec.dy * D;
      const w = spec.w * D;
      const h = spec.h * D * (spec.shape === "pill" ? blinkScale : 1);
      ctx.save();
      ctx.translate(ex, ey);
      // Per-eye slant (mirrored left/right) — the angry brow.
      if (spec.rot) ctx.rotate(side * spec.rot);
      switch (spec.shape) {
        case "pill": {
          if (theme.pixelEyes) {
            this.drawPixelPill(ctx, w, h);
          } else {
            ctx.beginPath();
            ctx.roundRect(-w / 2, -h / 2, w, h, w / 2);
            ctx.fill();
            if (theme.slitPupils && blinkScale > 0.5) {
              ctx.fillStyle = `rgba(${FACE_DISC_RGB},0.85)`;
              ctx.beginPath();
              ctx.ellipse(0, 0, w * 0.13, h * 0.38, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = `rgb(${eyeRgb})`;
            }
          }
          break;
        }
        case "arc": {
          // Happy "∩" — stroke, no fill.
          ctx.beginPath();
          ctx.lineWidth = Math.max(2, D * 0.045);
          ctx.lineCap = "round";
          ctx.arc(0, h, w * 0.62, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
          break;
        }
        case "arcDown": {
          // Sad "∪" — downward arc.
          ctx.beginPath();
          ctx.lineWidth = Math.max(2, D * 0.045);
          ctx.lineCap = "round";
          ctx.arc(0, -h, w * 0.62, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
          break;
        }
        case "dash": {
          ctx.beginPath();
          ctx.lineWidth = Math.max(2, h);
          ctx.lineCap = "round";
          ctx.moveTo(-w / 2, 0);
          ctx.lineTo(w / 2, 0);
          ctx.stroke();
          break;
        }
        case "bolt": {
          const flick = 0.7 + 0.3 * Math.sin(now * 0.03 + side);
          ctx.globalAlpha *= flick;
          ctx.beginPath();
          ctx.lineWidth = Math.max(2, D * 0.03);
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.moveTo(w * 0.22, -h / 2);
          ctx.lineTo(-w * 0.18, h * 0.06);
          ctx.lineTo(w * 0.10, h * 0.06);
          ctx.lineTo(-w * 0.22, h / 2);
          ctx.stroke();
          break;
        }
        case "halfLid": {
          // Bottom half of a pill: flat lid on top.
          ctx.beginPath();
          ctx.roundRect(-w / 2, -h * 0.15, w, h, [3, 3, w / 2, w / 2]);
          ctx.fill();
          break;
        }
        case "heart": {
          // A little heart, gently pulsing.
          const pulse = 1 + 0.06 * Math.sin(now * 0.008 + side);
          const s = (w / 2) * pulse;
          ctx.beginPath();
          ctx.moveTo(0, s * 0.38);
          ctx.bezierCurveTo(s * 0.55, -s * 0.35, s * 1.05, s * 0.28, 0, s * 0.98);
          ctx.bezierCurveTo(-s * 1.05, s * 0.28, -s * 0.55, -s * 0.35, 0, s * 0.38);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case "star": {
          // Five-point twinkle star.
          const R = w / 2;
          const r = R * 0.42;
          const tw = 0.85 + 0.15 * Math.sin(now * 0.01 + side * 1.7);
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const ang = (Math.PI / 5) * i - Math.PI / 2;
            const rad = (i % 2 === 0 ? R : r) * tw;
            const px = Math.cos(ang) * rad;
            const py = Math.sin(ang) * rad;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
      ctx.restore();
    };

    drawEye(pose.left, -1);
    drawEye(pose.right, 1);
    ctx.shadowBlur = 0;

    // ── Per-state extras ─────────────────────────────────────────────────────
    switch (this.state) {
      case "listening": {
        ctx.beginPath();
        ctx.setLineDash([D * 0.02, D * 0.018]);
        ctx.lineWidth = Math.max(1.5, D * 0.012);
        ctx.globalAlpha *= 0.7;
        ctx.arc(0, EYE_BASELINE_Y * D, D * 0.30, Math.PI * 1.22, Math.PI * 1.78);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "thinking": {
        // Trail of 3 dots to the lower-right, staggered pulse.
        for (let i = 0; i < 3; i++) {
          const p = 0.5 + 0.5 * Math.sin(now * 0.004 - i * 0.9);
          ctx.beginPath();
          ctx.globalAlpha = 0.25 + 0.55 * p;
          ctx.arc(D * (0.16 + i * 0.075), D * (0.16 + i * 0.075), D * (0.014 + 0.006 * p), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "charging": {
        // Dashed breathing ring below the eyes ("% ring").
        const breath = 0.5 + 0.5 * Math.sin(now * 0.0025);
        ctx.beginPath();
        ctx.setLineDash([D * 0.028, D * 0.02]);
        ctx.lineWidth = Math.max(1.5, D * 0.014);
        ctx.globalAlpha = 0.35 + 0.4 * breath;
        ctx.arc(0, D * 0.16, D * 0.1 + D * 0.008 * breath, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case "sleeping": {
        // Two "z" glyphs drifting up-right on a loop.
        for (let i = 0; i < 2; i++) {
          const cycle = ((now * 0.0004 + i * 0.5) % 1);
          const zx = D * (0.16 + 0.10 * cycle + i * 0.05);
          const zy = D * (-0.12 - 0.14 * cycle - i * 0.04);
          const s = D * (0.030 + i * 0.012);
          ctx.beginPath();
          ctx.globalAlpha = (1 - cycle) * 0.8;
          ctx.lineWidth = Math.max(1.5, D * 0.014);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.moveTo(zx - s, zy - s);
          ctx.lineTo(zx + s, zy - s);
          ctx.lineTo(zx - s, zy + s);
          ctx.lineTo(zx + s, zy + s);
          ctx.stroke();
        }
        break;
      }
      default:
        break;
    }

    ctx.restore();
  }

  private drawPixelPill(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const cols = 4;
    const rows = 7;
    const cw = w / cols;
    const chh = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Round the pill corners by skipping corner cells.
        const corner =
          (r === 0 || r === rows - 1) && (c === 0 || c === cols - 1);
        if (corner) continue;
        ctx.fillRect(-w / 2 + c * cw + 0.5, -h / 2 + r * chh + 0.5, cw - 1, chh - 1);
      }
    }
  }

  // ── Neural cluster ─────────────────────────────────────────────────────────

  private drawCluster(
    ctx: CanvasRenderingContext2D,
    now: number,
    dt: number,
    D: number,
    cx: number,
    cy: number,
    layerAlpha: number,
    opts: EngineDrawOpts,
  ) {
    const { nodes, edges } = this.cluster;
    const activity = Math.max(
      opts.activity,
      this.state === "thinking" ? 0.85 : this.state === "talking" ? 0.5 : 0.15,
    );

    // Whole-cluster slow breathing drift.
    const breatheX = Math.sin(now * 0.0006) * 0.012 * D;
    const breatheY = Math.sin(now * 0.00045 + 1.3) * 0.010 * D;

    // Physics: spring home + gentle wander, velocity damped.
    const k = 0.0022 * dt;
    for (const n of nodes) {
      const wander = 0.00035 * dt * (0.4 + activity);
      n.vx += (n.hx - n.x) * k + Math.sin(now * 0.001 * n.speed + n.phase) * wander;
      n.vy += (n.hy - n.y) * k + Math.cos(now * 0.0012 * n.speed + n.phase * 1.7) * wander;
      n.vx *= 0.90;
      n.vy *= 0.90;
      n.x += n.vx;
      n.y += n.vy;
    }

    ctx.save();
    ctx.globalAlpha *= layerAlpha;
    ctx.translate(cx + breatheX, cy + breatheY);
    ctx.strokeStyle = `rgb(${opts.eyeRgb})`;
    ctx.fillStyle = `rgb(${opts.eyeRgb})`;

    // Edges pulse with activity.
    ctx.lineWidth = Math.max(0.6, D * 0.0035);
    for (const e of edges) {
      const a = nodes[e.a]!;
      const b = nodes[e.b]!;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.0018 + e.phase);
      ctx.globalAlpha = layerAlpha * (0.05 + 0.22 * activity * pulse);
      ctx.beginPath();
      ctx.moveTo(a.x * D, a.y * D);
      ctx.lineTo(b.x * D, b.y * D);
      ctx.stroke();
    }

    // Thought pulses travel along edges while active.
    if (activity > 0.35 && this.pulses.length < 6 && Math.random() < 0.05 * activity) {
      this.pulses.push({
        edge: Math.floor(Math.random() * edges.length),
        t: 0,
        dir: Math.random() < 0.5 ? 1 : -1,
        life: 1,
      });
    }
    this.pulses = this.pulses.filter((p) => p.life > 0);
    ctx.shadowColor = `rgb(${opts.eyeRgb})`;
    for (const p of this.pulses) {
      p.t += dt * 0.0012 * (0.6 + activity);
      if (p.t >= 1) {
        p.life = 0;
        continue;
      }
      const e = edges[p.edge]!;
      const a = nodes[p.dir === 1 ? e.a : e.b]!;
      const b = nodes[p.dir === 1 ? e.b : e.a]!;
      const x = lerp(a.x, b.x, p.t) * D;
      const y = lerp(a.y, b.y, p.t) * D;
      ctx.globalAlpha = layerAlpha * 0.9;
      ctx.shadowBlur = D * 0.03;
      ctx.beginPath();
      ctx.arc(x, y, D * 0.008, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Nodes pulse ("slight moving and pulsating face").
    for (const n of nodes) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.002 * n.speed + n.phase);
      const r = D * (0.0045 + 0.0075 * n.size * (0.35 + 0.65 * activity) * (0.6 + 0.4 * pulse));
      ctx.globalAlpha = layerAlpha * (0.35 + 0.55 * pulse * (0.4 + 0.6 * activity));
      ctx.beginPath();
      ctx.arc(n.x * D, n.y * D, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
