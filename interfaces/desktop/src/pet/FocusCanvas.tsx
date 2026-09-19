/**
 * FocusCanvas — the Focus Companion's face, drawn around his eyes.
 *
 * Focus is the one app on this robot whose whole job is to be ignored. Someone
 * is working two feet away, so every choice below is made against the same
 * question: would this take my eye if I were trying to think? If the answer is
 * yes it is either slowed down, dimmed, or not drawn at all.
 *
 * Three rules the server payload sets and this file keeps:
 *
 *   1. NO NUMERALS while `showClock` is false. A countdown in peripheral vision
 *      is the single most distracting thing a focus app can put on a desk, so
 *      this renderer never draws a numeral at all — the phone has the time, and
 *      the shell already prints `face.big` on the frames where the server has
 *      decided a number is allowed. `showClock` additionally gates the faint
 *      progress ring, which is the only other mark here that could be *read*
 *      rather than glanced at.
 *   2. The face is still a face. Nothing is drawn over his eyes. A generous
 *      eye-safe box is reserved in the middle of the disc; fills are clipped out
 *      of it and moving points fade down as they pass behind it (see `eyeFade`)
 *      rather than popping off at a hard edge, because a pop is exactly the kind
 *      of motion that takes an eye.
 *   3. Colour comes from `palette` and nowhere else, so a break really does look
 *      like a different kind of time.
 *
 * WHY A <canvas> AND NOT SVG. MeteorCanvas is SVG because the server owns its
 * positions and a repaint happens only when a frame arrives — a handful of DOM
 * nodes moving twice a second. This one is the opposite: it runs its own 60fps
 * clock off absolute timestamps, so an SVG version would either re-render React
 * sixty times a second or mutate attributes by hand through a pile of refs. A
 * canvas with one requestAnimationFrame loop is less machinery for more frames,
 * it makes the soft gradients (waterlight, candle glow) cheap, and it is what
 * AtlasFace itself already does, so the two renderers behave the same way when
 * the tab is hidden. The cost is that nothing here is inspectable in devtools,
 * which for a drawing with no interaction is a fair trade.
 *
 * THE CLOCK. `endsAt` and `anchor` are absolute epoch milliseconds precisely so
 * the face does not have to step on the server's frames. The server ticks twice
 * a second; anything animated off its `remainingMs` snapshot would judder badly
 * at these speeds. So every position below is computed from Date.now() against
 * those two timestamps, and the snapshot fields are used only when there is no
 * live deadline to work from (idle, paused, done) — which is also what makes the
 * drawing come back in the right place after a reconnect rather than restarting.
 */

import { useEffect, useRef } from "react";

/**
 * The canvas payload, as documented in core/server/src/lib/games/focus.ts.
 *
 * Every field is optional here although the server sends all of them on every
 * frame. That is deliberate: a robot can be running a face build that is newer
 * or older than its brain, and the right response to a payload from last month
 * is a calm picture, not a blank screen or a crash in a render loop.
 */
export interface FocusCanvasData {
  kind: string;
  anim?: string;
  mode?: string;
  phase?: string;
  anchor?: number | null;
  endsAt?: number | null;
  blockMs?: number;
  remainingMs?: number;
  elapsedMs?: number;
  progress?: number;
  clock?: string;
  showClock?: boolean;
  brightness?: number;
  dimMs?: number;
  cycleMs?: number;
  palette?: { base?: string; accent?: string; glow?: string } | null;
  audio?: { bed?: string; volume?: number; cue?: string | null } | null;
  lifetime?: number;
  today?: number;
  detail?: Record<string, unknown> | null;
}

/* ─── geometry ─────────────────────────────────────────────────────────────
   Same 100-unit square and the same rim as MeteorCanvas, so the two games sit
   at identical size on the disc and anyone reading both files is reading one
   coordinate system. */
const CX = 50;
const CY = 50;
const RIM = 46;

/**
 * The eye-safe box: nothing is ever drawn inside it.
 *
 * Deliberately larger than his eyes actually are. Being a few units too
 * generous costs a sliver of drawing area; being a unit too tight puts a leaf
 * on his pupil, and then he is a widget with a plant on it rather than a
 * creature sitting on the desk.
 */
const EYE = { x0: 22, y0: 27, x1: 78, y1: 64 } as const;

/* ─── small maths ─────────────────────────────────────────────────────────── */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Hermite ease. Used everywhere instead of a linear ramp: linear motion starts
 *  and stops abruptly, and an abrupt stop reads as an event. */
function smooth(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** A number off an untyped payload, with a floor, a ceiling and a way out. */
function num(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** `detail` is typed as an open record by the server, so read it defensively. */
function detailOf(data: FocusCanvasData): Record<string, unknown> {
  const d = data.detail;
  return d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
}

/* ─── colour ───────────────────────────────────────────────────────────────
   The palette arrives as hex and everything here wants alpha, so parse once and
   cache. The cache is keyed on the string and holds three entries in practice
   (one palette per mode), so it never grows. */
const rgbCache = new Map<string, [number, number, number]>();

function rgb(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  // An unreadable colour falls back to the focus accent rather than to black,
  // because black on a black disc is indistinguishable from "the app is broken".
  const n = m ? parseInt(m[1], 16) : 0x7a9bff;
  const out: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, out);
  return out;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(a, 0, 1).toFixed(3)})`;
}

/**
 * How visible a mark at (x, y) is allowed to be.
 *
 * 1 well clear of his eyes, falling to a whisper inside the eye box. Moving
 * things (the orbiting bodies, a swaying leaf) use this instead of being
 * clipped, so a body crossing behind his face dims and returns rather than
 * being sliced in half by an invisible edge.
 */
function eyeFade(x: number, y: number): number {
  const d = Math.max(EYE.x0 - x, x - EYE.x1, EYE.y0 - y, y - EYE.y1);
  if (d >= 3) return 1;
  if (d <= -2) return 0.12;
  return 0.12 + (0.88 * (d + 2)) / 5;
}

/** The disc with his eyes punched out of it, for anything that fills area. */
function faceClip(ctx: CanvasRenderingContext2D): void {
  const p = new Path2D();
  p.arc(CX, CY, RIM, 0, Math.PI * 2);
  // Rounded, because a rectangular hole in a wash of water has corners and
  // corners are the sort of detail an idle eye lands on.
  p.roundRect(EYE.x0, EYE.y0, EYE.x1 - EYE.x0, EYE.y1 - EYE.y0, 16);
  ctx.clip(p, "evenodd");
}

/** Polar, as in MeteorCanvas: degrees clockwise from the top, radius 0..1. */
function pt(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [CX + Math.cos(rad) * RIM * radius, CY + Math.sin(rad) * RIM * radius];
}

/**
 * Smooth pseudo-noise in 0..1 from three incommensurable sines.
 *
 * Not Math.random(): a random number per frame is white noise, and white noise
 * on a flame height is a flame that jumps. Summed slow sines never step, which
 * is what "flickers within a few percent and never jumps" actually requires.
 */
function wobble(t: number, seed: number): number {
  const a = Math.sin(t / 430 + seed * 1.7);
  const b = Math.sin(t / 970 + seed * 3.1);
  const c = Math.sin(t / 1730 + seed * 5.9);
  return (a * 0.5 + b * 0.32 + c * 0.18 + 1) / 2;
}

/* ─── the live clock ───────────────────────────────────────────────────────── */

interface Frame {
  now: number;
  /** 0..1 through the block, recomputed every frame from `endsAt`. */
  p: number;
  /** Milliseconds since `anchor`, live. What the cyclic animations run on. */
  since: number;
  base: string;
  accent: string;
  glow: string;
  phase: string;
  mode: string;
  detail: Record<string, unknown>;
  blockMs: number;
  cycleMs: number;
  showClock: boolean;
}

/**
 * Build the frame's timing from absolute timestamps where we have them.
 *
 * While running, `endsAt` is the truth and the snapshot is ignored — that is the
 * whole reason the server bothers to send a deadline. Paused and done there is
 * no deadline, so `remainingMs`/`progress` are correct and the snapshot is right
 * to trust; it is not moving anyway.
 */
function timing(d: FocusCanvasData, now: number): { p: number; since: number } {
  const blockMs = Math.max(1, num(d.blockMs, 25 * 60_000, 1));
  const phase = str(d.phase, "idle");
  const endsAt = typeof d.endsAt === "number" ? d.endsAt : null;
  const anchor = typeof d.anchor === "number" ? d.anchor : null;

  if (phase === "running" && endsAt !== null) {
    const left = clamp(endsAt - now, 0, blockMs);
    const p = clamp((blockMs - left) / blockMs, 0, 1);
    // Prefer the anchor for the cyclic animations so a breath or an orbit stays
    // phase-locked across a reconnect; fall back to the deadline arithmetic if
    // an older build sent no anchor.
    const since = anchor !== null ? Math.max(0, now - anchor) : blockMs - left;
    return { p, since };
  }

  const p = clamp(num(d.progress, 0, 0, 1), 0, 1);
  // Idle, paused and done still want a gently moving clock — a candle that
  // freezes solid on pause looks broken, whereas one that keeps breathing looks
  // like it is waiting. So the cyclic time falls back to the wall clock itself
  // (never a modulus of it, which would put a jump in the breath every time it
  // wrapped); only the block's own progress is held still.
  return { p, since: now };
}

/* ─── the five animations ──────────────────────────────────────────────────── */

/**
 * breathe — a rhythm to borrow.
 *
 * A ring that swells on the in-breath, holds, settles, and rests, on the box
 * pattern the payload carries. Nothing here encodes the time; the point is that
 * you stop watching it and start copying it.
 */
function drawBreathe(ctx: CanvasRenderingContext2D, f: Frame): void {
  const det = f.detail;
  const raw = Array.isArray(det.pattern) ? (det.pattern as unknown[]) : [];
  // No pattern at all (an older payload) still gets a box breath, taken from
  // the envelope's `cycleMs` so it keeps whatever rhythm that build intended.
  // Clamped to a breath a human could actually take, because an unknown `anim`
  // lands here too and its `cycleMs` may describe something else entirely (the
  // grove's cycle is the whole block).
  const quarter = clamp(f.cycleMs / 4, 1500, 8000);
  const pattern = [0, 1, 2, 3].map((i) => Math.max(200, num(raw[i], quarter, 200)));
  const cycle = pattern[0] + pattern[1] + pattern[2] + pattern[3];
  const scaleMin = num(det.scaleMin, 0.86, 0.3, 1);
  const scaleMax = num(det.scaleMax, 1.0, scaleMin, 1.2);
  const lidMin = num(det.lidMin, 0.1, 0, 1);
  const lidMax = num(det.lidMax, 0.78, lidMin, 1);

  // Recomputed from the live clock rather than read off `detail.stage`, exactly
  // as the payload's comment asks: the snapshot stage is a half-second old and
  // would make the swell tick instead of flow.
  const at = ((f.since % cycle) + cycle) % cycle;
  let open: number;
  if (at < pattern[0]) open = smooth(at / pattern[0]);
  else if (at < pattern[0] + pattern[1]) open = 1;
  else if (at < pattern[0] + pattern[1] + pattern[2]) open = 1 - smooth((at - pattern[0] - pattern[1]) / pattern[2]);
  else open = 0;

  const scale = scaleMin + (scaleMax - scaleMin) * open;
  const r = RIM * scale;

  // The body of the breath: a wash that is strongest at the rim and gone well
  // before it reaches his face, so the swell is felt at the edge of vision.
  const g = ctx.createRadialGradient(CX, CY, r * 0.45, CX, CY, r);
  g.addColorStop(0, alpha(f.base, 0));
  g.addColorStop(1, alpha(f.accent, 0.16 + 0.14 * open));
  ctx.save();
  faceClip(ctx);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(CX, CY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = alpha(f.glow, 0.28 + 0.32 * open);
  ctx.lineWidth = 0.9 + 0.7 * open;
  ctx.beginPath();
  ctx.arc(CX, CY, r, 0, Math.PI * 2);
  ctx.stroke();

  // Eyelids, sort of.
  //
  // This renderer cannot actually close his eyes — the lids belong to AtlasFace
  // and there is no prop to reach them through. So the lid is drawn as two soft
  // shades that settle onto the top and bottom edges of the eye-safe box and
  // deepen on the exhale: it reads as eyes softening from across a room, and it
  // never crosses into the box. Worth a proper lid prop one day.
  const lid = lidMin + (lidMax - lidMin) * (1 - open);
  const span = (EYE.x1 - EYE.x0) * 0.78;
  const x0 = CX - span / 2;
  const x1 = CX + span / 2;
  ctx.strokeStyle = alpha(f.glow, 0.1 + 0.3 * lid);
  ctx.lineWidth = 1.2 + 2.6 * lid;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x0, EYE.y0 - 1.5);
  ctx.quadraticCurveTo(CX, EYE.y0 - 1.5 + 4 * lid, x1, EYE.y0 - 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x0, EYE.y1 + 1.5);
  ctx.quadraticCurveTo(CX, EYE.y1 + 1.5 - 4 * lid, x1, EYE.y1 + 1.5);
  ctx.stroke();
}

/**
 * tide — a slow sea.
 *
 * The waterline is the block: it creeps up the disc as you work, and on a break
 * it drains back out. There is no number anywhere, and you can read "most of the
 * way" off it from the other side of the room without stopping what you are
 * doing, which is the entire idea.
 */
function drawTide(ctx: CanvasRenderingContext2D, f: Frame): void {
  const det = f.detail;
  const direction = str(det.direction, f.mode === "break" ? "fall" : "rise");
  const swellAmp = num(det.swellAmp, 0.018, 0, 0.08);
  const swellMs = Math.max(2000, num(det.swellMs, 11_000, 2000));
  // `detail.level` is the server's snapshot and would step twice a second, so
  // the level is rebuilt from the live progress and only its DIRECTION is read
  // off the payload.
  const level = clamp(direction === "fall" ? 1 - f.p : f.p, 0, 1);

  const swell = Math.sin((f.now / swellMs) * Math.PI * 2) * swellAmp * RIM;
  const waterY = CY + RIM - level * 2 * RIM + swell;

  ctx.save();
  faceClip(ctx);

  // The body of water. A gradient rather than a flat fill so the depth reads,
  // and so the waterline itself is the brightest thing rather than the mass.
  const g = ctx.createLinearGradient(0, waterY, 0, CY + RIM);
  g.addColorStop(0, alpha(f.accent, 0.3));
  g.addColorStop(1, alpha(f.base, 0.08));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.rect(CX - RIM, waterY, RIM * 2, RIM * 2);
  ctx.fill();

  // The surface: one long wavelength, a few tenths of a unit tall. Any more and
  // it becomes a thing moving in the corner of your eye.
  ctx.strokeStyle = alpha(f.glow, 0.5);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let x = CX - RIM; x <= CX + RIM; x += 2) {
    const ripple = Math.sin(x / 13 + f.now / 3400) * 0.45 + Math.sin(x / 7 - f.now / 5200) * 0.2;
    const y = waterY + ripple;
    if (x === CX - RIM) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();

  // Two buoys riding the surface under where his eyes are, so the water has
  // something to lift. They are drawn only while the waterline is clear of the
  // eye box, which is also the honest reading of the payload's `eyeLine`: once
  // the sea is up around his face, his eyes ARE the buoys and drawing two more
  // would be one detail too many.
  const eyeLine = num(det.eyeLine, 0.58, 0, 1);
  const eyeY = CY + RIM - eyeLine * 2 * RIM;
  if (waterY > EYE.y1 + 2) {
    for (const bx of [CX - 15, CX + 15]) {
      const bob = Math.sin(f.now / 3400 + (bx < CX ? 0 : 1.1)) * 0.5;
      ctx.strokeStyle = alpha(f.glow, 0.34 * eyeFade(bx, waterY + bob));
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(bx, waterY + bob, 4.2, 1.1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // A hairline at the height his eyes sit, so you can see the water coming for
  // them long before it arrives. Only when a mark is allowed to be read at all.
  if (f.showClock && Math.abs(waterY - eyeY) > 3) {
    ctx.strokeStyle = alpha(f.accent, 0.12);
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(CX - RIM * 0.5, eyeY);
    ctx.lineTo(CX - RIM * 0.32, eyeY);
    ctx.moveTo(CX + RIM * 0.32, eyeY);
    ctx.lineTo(CX + RIM * 0.5, eyeY);
    ctx.stroke();
  }
}

interface Body { radius: number; periodMs: number; phase: number; size: number; }

/**
 * orbit — one still point and two moons.
 *
 * The heavy body goes round once per block, so where it sits IS the time: half
 * past the top is half way through, and you never read anything. The light one
 * sweeps once a minute and is there to prove the picture is alive.
 */
function drawOrbit(ctx: CanvasRenderingContext2D, f: Frame): void {
  const raw = Array.isArray(f.detail.bodies) ? (f.detail.bodies as unknown[]) : [];
  const bodies: Body[] = raw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .map((b) => ({
      radius: num(b.radius, 0.8, 0.2, 1),
      periodMs: Math.max(4000, num(b.periodMs, 60_000, 4000)),
      phase: num(b.phase, 0, -1, 1),
      // `size` is in face pixels on a 480 screen, and the 100-unit box is that
      // screen, so the conversion is a fifth. Kept explicit because getting it
      // wrong gives you a moon the size of his head.
      size: num(b.size, 7, 1, 40) / 4.8,
    }));

  // An empty or malformed list still gets a sky: one slow body is a perfectly
  // calm thing to look at and much better than an unexplained blank disc.
  const list: Body[] = bodies.length > 0
    ? bodies
    : [{ radius: 0.66, periodMs: Math.max(60_000, f.blockMs), phase: 0, size: 13 / 4.8 }];

  // The still point. Twelve o'clock on the rim, so the heavy body's angle from
  // it is legible without anything being written down.
  const [mx, my] = pt(0, 0.97);
  ctx.fillStyle = alpha(f.glow, 0.3);
  ctx.beginPath();
  ctx.arc(mx, my, 0.8, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const turns = b.phase + f.since / b.periodMs;
    const angle = (turns % 1) * 360;
    const [x, y] = pt(angle, b.radius);
    const fade = eyeFade(x, y);
    const heavy = i === list.length - 1;

    // The track, and for the heavy body the arc it has already covered. That
    // arc is the clock face; the ring behind it is what makes it readable.
    ctx.strokeStyle = alpha(f.accent, 0.08);
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.arc(CX, CY, RIM * b.radius, 0, Math.PI * 2);
    ctx.stroke();

    if (heavy && f.p > 0.001) {
      ctx.strokeStyle = alpha(f.accent, 0.22);
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(CX, CY, RIM * b.radius, -Math.PI / 2, -Math.PI / 2 + (angle * Math.PI) / 180);
      ctx.stroke();
    }

    const halo = ctx.createRadialGradient(x, y, 0, x, y, b.size * 3);
    halo.addColorStop(0, alpha(f.glow, 0.42 * fade));
    halo.addColorStop(1, alpha(f.glow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, b.size * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alpha(f.glow, 0.9 * fade);
    ctx.beginPath();
    ctx.arc(x, y, b.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * grove — something growing.
 *
 * The stem climbs the inside of the rim rather than straight up the middle: a
 * vertical stem from the bottom of a round screen goes through his nose and out
 * of the top of his head. Climbing the left of the rim keeps the whole plant in
 * the margin where it belongs, and the arc reads as growth just as well.
 *
 * The only motion in a whole block is a leaf fading in, which is why this is the
 * one to pick for deep work.
 */
function drawGrove(ctx: CanvasRenderingContext2D, f: Frame): void {
  const det = f.detail;
  const total = Math.round(num(det.totalLeaves, 6, 1, 24));
  const sway = num(det.sway, 1.5, 0, 6);
  const budOpen = det.budOpen === true || f.phase === "done";
  // Live, for the same reason as everywhere else; `detail.stem` is the snapshot.
  const stem = clamp(num(det.stem, 0.12 + f.p * 0.88, 0, 1), 0.06, 1);

  const R = 0.9;
  const START = 190;   // just left of straight down
  const SWEEP = 165;   // up the left side, finishing near the top
  const drift = Math.sin(f.now / 9000) * sway;

  // The stem itself, as a run of short segments along the rim. Drawn as a path
  // rather than an arc so the drift can bend it slightly near the tip, which is
  // what stops it looking like a piece of UI chrome.
  ctx.strokeStyle = alpha(f.accent, 0.5);
  ctx.lineWidth = 0.75;
  ctx.lineCap = "round";
  ctx.beginPath();
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const angle = START - SWEEP * stem * k + drift * k * k;
    const [x, y] = pt(angle, R);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  const tipAngle = START - SWEEP * stem + drift;

  for (let i = 0; i < total; i++) {
    // Leaf i belongs at this fraction of the block. Its own fade is worked out
    // from how far past its due moment we are, over three seconds, so it
    // ARRIVES rather than appearing between two frames.
    const due = (i + 1) / (total + 1);
    const age = (f.p - due) * f.blockMs;
    if (age < 0) continue;
    const grow = smooth(age / 3000);

    const at = START - SWEEP * stem * ((i + 1) / (total + 1)) + drift * 0.4;
    const [x, y] = pt(at, R);
    const fade = eyeFade(x, y) * grow;
    if (fade <= 0.02) continue;

    // Blades point inward, alternating either side of the stem, each with its
    // own slow drift so the plant is never quite symmetrical.
    const side = i % 2 === 0 ? 1 : -1;
    const lean = Math.sin(f.now / 7000 + i) * sway * 0.4;
    const dir = ((at + 90 * side + lean) * Math.PI) / 180;
    const len = 5 * grow;
    const ex = x + Math.cos(dir) * len;
    const ey = y + Math.sin(dir) * len;

    ctx.fillStyle = alpha(f.accent, 0.4 * fade);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(dir - 0.6) * len, y + Math.sin(dir - 0.6) * len, ex, ey);
    ctx.quadraticCurveTo(x + Math.cos(dir + 0.6) * len, y + Math.sin(dir + 0.6) * len, x, y);
    ctx.fill();
  }

  // The bud. Closed all block, open at the end — the one moment this animation
  // is allowed to be a small event, because by then the block is over and
  // taking your eye is the point.
  const [bx, by] = pt(tipAngle, R);
  const budFade = eyeFade(bx, by);
  const open = budOpen ? smooth(((f.now % 4000) / 4000) * 0.5 + 0.5) : 0;
  ctx.fillStyle = alpha(f.glow, (0.45 + 0.35 * open) * budFade);
  ctx.beginPath();
  ctx.ellipse(bx, by, 1.5 + 1.2 * open, 2.2 + 0.6 * open, (tipAngle * Math.PI) / 180, 0, Math.PI * 2);
  ctx.fill();
  if (open > 0) {
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, 8);
    halo.addColorStop(0, alpha(f.glow, 0.28 * open * budFade));
    halo.addColorStop(1, alpha(f.glow, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * candle — something spending itself.
 *
 * The column sits low on the disc, under his eyes, and burns down as the block
 * does. The flame varies by the `jitter` fraction and no more: a real candle in
 * a still room barely moves, and a guttering cartoon flame two feet from someone
 * working would be unbearable within a minute.
 */
function drawCandle(ctx: CanvasRenderingContext2D, f: Frame): void {
  const det = f.detail;
  const jitter = num(det.jitter, 0.05, 0, 0.2);
  const ember = det.ember === true;
  const strength = num(det.flame, f.phase === "running" ? 1 : 0, 0, 1);
  // Live again: the wax should sink continuously, not in half-second drops.
  const wax = clamp(f.phase === "running" ? 1 - f.p : num(det.wax, 1 - f.p, 0, 1), 0, 1);

  const BASE_Y = 95;        // the foot of the candle, just inside the rim
  const FULL_H = 19;        // full height, chosen so a lit wick clears the eyes
  const HALF_W = 4.5;
  const topY = BASE_Y - FULL_H * wax;

  // The column. Flat and dim: it is a measure, not an ornament.
  const g = ctx.createLinearGradient(CX - HALF_W, 0, CX + HALF_W, 0);
  g.addColorStop(0, alpha(f.base, 0.55));
  g.addColorStop(0.45, alpha(f.glow, 0.22));
  g.addColorStop(1, alpha(f.base, 0.55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(CX - HALF_W, topY, HALF_W * 2, BASE_Y - topY, [1.6, 1.6, 2.4, 2.4]);
  ctx.fill();
  ctx.strokeStyle = alpha(f.glow, 0.2);
  ctx.lineWidth = 0.35;
  ctx.stroke();

  const flick = (wobble(f.now, 1) - 0.5) * 2;       // -1..1, never stepping
  const lean = (wobble(f.now, 7) - 0.5) * 2;
  const wickY = topY - 0.6;

  if (strength > 0.02) {
    const h = (5.5 + 3.5 * strength) * (1 + jitter * flick);
    const w = 1.5 + 0.9 * strength;
    const tipX = CX + lean * jitter * 8;
    const tipY = wickY - h;
    const fade = eyeFade(tipX, tipY);

    // The pool of light the candle throws. Most of what makes this read as a
    // flame rather than a yellow leaf.
    const pool = ctx.createRadialGradient(CX, wickY, 0, CX, wickY, 16 + 3 * flick * jitter * 10);
    pool.addColorStop(0, alpha(f.glow, 0.3 * strength * fade));
    pool.addColorStop(1, alpha(f.glow, 0));
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(CX, wickY, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = alpha(f.glow, 0.85 * strength * fade);
    ctx.beginPath();
    ctx.moveTo(CX, wickY);
    ctx.quadraticCurveTo(CX - w, wickY - h * 0.55, tipX, tipY);
    ctx.quadraticCurveTo(CX + w, wickY - h * 0.55, CX, wickY);
    ctx.fill();

    // The hot core, a paler teardrop inside the first.
    ctx.fillStyle = alpha(f.accent, 0.5 * strength * fade);
    ctx.beginPath();
    ctx.moveTo(CX, wickY);
    ctx.quadraticCurveTo(CX - w * 0.45, wickY - h * 0.4, tipX * 0.5 + CX * 0.5, wickY - h * 0.6);
    ctx.quadraticCurveTo(CX + w * 0.45, wickY - h * 0.4, CX, wickY);
    ctx.fill();
  } else if (ember) {
    // Gutters out and leaves a warm point that breathes about once every four
    // seconds. Something is still there; nothing is asking for attention.
    const pulse = 0.35 + 0.25 * (wobble(f.now, 3) * 0.6 + 0.4 * Math.sin(f.now / 4000) * 0.5 + 0.5);
    const glow = ctx.createRadialGradient(CX, wickY, 0, CX, wickY, 7);
    glow.addColorStop(0, alpha(f.glow, 0.34 * pulse));
    glow.addColorStop(1, alpha(f.glow, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(CX, wickY, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = alpha(f.glow, 0.7 * pulse);
    ctx.beginPath();
    ctx.arc(CX, wickY, 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Unlit: just the wick, so an idle candle is plainly a candle waiting.
    ctx.strokeStyle = alpha(f.base, 0.6);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(CX, topY);
    ctx.lineTo(CX, topY - 1.4);
    ctx.stroke();
  }
}

/* ─── the frame ────────────────────────────────────────────────────────────── */

function draw(ctx: CanvasRenderingContext2D, d: FocusCanvasData, now: number): void {
  const pal = d.palette ?? {};
  const f: Frame = {
    now,
    ...timing(d, now),
    base: str(pal.base, "#101527"),
    accent: str(pal.accent, "#7a9bff"),
    glow: str(pal.glow, "#cfe0ff"),
    phase: str(d.phase, "idle"),
    mode: str(d.mode, "focus"),
    detail: detailOf(d),
    blockMs: Math.max(1, num(d.blockMs, 25 * 60_000, 1)),
    cycleMs: Math.max(1, num(d.cycleMs, 16_000, 1)),
    // Missing means missing, not false: an older build that never sent the flag
    // should get the quieter behaviour, so this defaults to hiding the readable
    // marks rather than showing them.
    showClock: d.showClock === true,
  };

  ctx.lineJoin = "round";

  switch (str(d.anim, "breathe")) {
    case "tide": drawTide(ctx, f); break;
    case "orbit": drawOrbit(ctx, f); break;
    case "grove": drawGrove(ctx, f); break;
    case "candle": drawCandle(ctx, f); break;
    case "breathe": drawBreathe(ctx, f); break;
    // An animation this build has never heard of gets the breath. It needs no
    // `detail` at all to look right, so it is the safe thing to fall back to.
    default: drawBreathe(ctx, f); break;
  }

  // The progress ring: a single faint arc around the rim. Suppressed entirely in
  // deep focus along with the numerals, because it is the one mark here you
  // could sit and *read* rather than glance at.
  if (f.showClock && f.p > 0.001 && f.phase !== "idle") {
    ctx.strokeStyle = alpha(f.accent, 0.3);
    ctx.lineWidth = 0.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(CX, CY, RIM + 1.4, -Math.PI / 2, -Math.PI / 2 + f.p * Math.PI * 2);
    ctx.stroke();
  }
}

/* ─── sound ────────────────────────────────────────────────────────────────
   There are no audio files in this repo and this component does not add or
   fetch any. What exists here is the seam:

   BEDS ARE A DOCUMENTED NO-OP. `audio.bed` names one of air/waves/drone/forest/
   fire, and a real bed wants a proper recorded loop rather than something
   synthesised, so `playBed` is left deliberately empty with the shape it will
   need. Wiring it up later is a matter of loading a buffer and crossfading it.

   THE CUE IS REAL, and is generated rather than loaded: two quiet sine partials
   with a long fade, about a second and a half end to end. It fires only on the
   one frame the server sets `cue`, which by design is only ever a block
   boundary — so the only sound this app can make is at the moment the work has
   already stopped. */

let ctxAudio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (ctxAudio) return ctxAudio;
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctxAudio = new Ctor();
    return ctxAudio;
  } catch {
    // No audio device, or no user gesture yet. Silence is a perfectly good
    // outcome for this app and must never take the drawing down with it.
    return null;
  }
}

/** A soft two-note chime. Nothing percussive: no click, no attack you could jump at. */
function chime(kind: "start" | "end", volume: number): void {
  const ac = audioContext();
  if (!ac) return;
  try {
    if (ac.state === "suspended") void ac.resume();
    // Rising for a start, settling for an end. A fifth apart either way, which
    // is about as neutral as two notes get.
    const notes = kind === "start" ? [329.63, 493.88] : [493.88, 329.63];
    const t0 = ac.currentTime + 0.02;
    const peak = clamp(volume, 0, 1) * 0.12;
    notes.forEach((hz, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      const start = t0 + i * 0.22;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + 1.7);
    });
  } catch {
    /* Sound is a nicety here; the picture is the app. */
  }
}

/** Reserved for a recorded ambience bed. Deliberately does nothing today. */
function playBed(_bed: string, _volume: number): void {
  /* no-op: see the block comment above. */
}

function useFocusAudio(data: FocusCanvasData): void {
  const lastCue = useRef<string | null>(null);

  useEffect(() => {
    const a = data.audio;
    // null means the preference is off, and off means silent — not quiet, not
    // "only the important ones". Nothing at all.
    if (!a) { lastCue.current = null; return; }

    playBed(str(a.bed, "none"), num(a.volume, 0, 0, 1));

    const cue = typeof a.cue === "string" ? a.cue : null;
    // The payload arrives about twice a second and a cue lives for one server
    // frame, but a reconnect or a duplicated poll could show it twice, so the
    // edge is tracked here rather than trusted.
    if (cue !== lastCue.current) {
      if (cue === "start" || cue === "end") chime(cue, num(a.volume, 0.3, 0, 1));
      lastCue.current = cue;
    }
  }, [data.audio]);
}

/* ─── the component ────────────────────────────────────────────────────────── */

export default function FocusCanvas({ data }: { data: FocusCanvasData }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // The loop reads the latest payload through a ref, the way AtlasFace does, so
  // a frame arriving from the server never restarts the animation — it just
  // changes what the next repaint reads.
  const dataRef = useRef(data);
  dataRef.current = data;

  useFocusAudio(data);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    // Starts AT the target rather than fading up from black on mount, so
    // switching to this game does not read as a flash.
    let bright = num(dataRef.current.brightness, 0.8, 0, 1);
    let w = 0;
    let h = 0;

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(120, Math.max(0, t - last));
      last = t;

      const d = dataRef.current;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const cw = Math.round(cv.clientWidth * dpr);
      const ch = Math.round(cv.clientHeight * dpr);
      if (cw <= 0 || ch <= 0) return;
      if (cw !== w || ch !== h) { cv.width = cw; cv.height = ch; w = cw; h = ch; }

      // Brightness is eased exponentially toward its target over `dimMs`. An
      // exponential rather than a linear ramp because it has no arrival: the
      // light never "lands", which is what lets a six second fade into deep
      // focus go completely unnoticed.
      const target = num(d.brightness, 0.8, 0, 1);
      const tau = Math.max(120, num(d.dimMs, 1200, 120)) / 3;
      bright += (target - bright) * (1 - Math.exp(-dt / tau));

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (bright < 0.01) return;

      // Square the drawing inside the shorter side and centre it, so the same
      // 100-unit artwork fits a round 480 screen and a letterboxed desktop
      // window without the maths changing.
      const s = Math.min(w, h) / 100;
      ctx.setTransform(s, 0, 0, s, (w - 100 * s) / 2, (h - 100 * s) / 2);
      ctx.globalAlpha = bright;
      draw(ctx, d, Date.now());
      ctx.globalAlpha = 1;
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Guard last, after the hooks, so the hook order never changes on a payload
  // switching between games.
  if (data.kind !== "focus") return null;

  return (
    <canvas
      ref={ref}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
