import { useEffect, useRef } from "react";
import type * as THREE from "three";
import qrcode from "qrcode-generator";

/**
 * ShowcaseOverlay — Nobi's stage. A Three.js layer over (or instead of) the
 * face for the built-in shows, driven by the `scene` prop from PetShell's show
 * runner (which narrates, moves the eyes, and pauses to listen).
 *
 * Opaque scenes (the face is hidden):
 *   boot    nebula gathers into a glowing core with orbit rings
 *   core    wireframe neural core, pulsing nodes, signals racing the edges
 *   orbit   a low-poly planet with three satellites on tilted orbits
 *   warp    a starfield rushing past
 *   finale  warp, then the bot's name assembles from gold particles and bursts
 *   bowl    the round screen becomes a fishbowl: Nobi's whole mini body (the
 *           Mark 1) bobs inside with bubbles and a small fish friend
 *   drive   the Mark 1 glides in from the left, skids, turns to camera, settles
 *   desk    the Mark 1 at home on the desk (lamp, mug); a light bulb, a note and
 *           a question mark float up from his antenna in turn
 * Transparent scenes (the real eyes show through — props around them):
 *   hud     a robotic boot HUD: rotating arc rings, ticks, an orbiting scan dot
 *   gears   "thinking" — meshing gears turn around the eyes while the brain works
 *   name    a guest's name (the `nameTag` prop) assembles from gold above the eyes
 *   faces   a ring of emotion orbs circles the rim while the eyes tour moods
 *   helmet  a glass space helmet with a rim, highlight streaks and an antenna
 *   lab     a bubbling green test tube slides in beside the face
 *   labpop  …and boils over (green burst); the tube shakes
 *   sparkle a burst of sparkles behind the eyes (repeats)
 *   hearts  heart sprites float up around the face
 *   confetti confetti falls
 *   trick   a rainbow ring spins around the eyes with sparkles
 *   out     everything fades; the parent unmounts on the next beat
 *
 * three.js is `import()`ed on mount so it lives in its own chunk — the robot's
 * cold-boot bundle never pays for it. Pixel ratio is pinned to 1 and every
 * scene stays small (well under 10k vertices), inside the Pi 4's V3D budget.
 * Only the props of the ACTIVE scene are updated. If WebGL or the chunk fails
 * the overlay stays quietly transparent and the narrated show still plays.
 */
export type ShowcaseScene =
  | "boot" | "core" | "orbit" | "warp" | "finale" | "bowl" | "drive" | "desk"
  | "studioShell" | "studioEyes" | "studioGear" | "studioName" | "qr"
  | "faces" | "helmet" | "lab" | "labpop" | "sparkle" | "hearts" | "confetti" | "trick" | "hud" | "gears" | "name"
  | "out";

export const TRANSPARENT_SCENES: ReadonlySet<ShowcaseScene> = new Set<ShowcaseScene>([
  "faces", "helmet", "lab", "labpop", "sparkle", "hearts", "confetti", "trick", "hud", "gears", "name", "out",
]);

/** Opaque scenes drawn on a light Apple-studio background instead of the night stage. */
export const LIGHT_SCENES: ReadonlySet<ShowcaseScene> = new Set<ShowcaseScene>(["studioShell", "studioEyes", "studioGear", "studioName", "qr"]);
const STUDIO_BG = 0xf5f5f7;
export const SHOP_URL = "https://developmentindustries.org/build";

type ThreeMod = typeof import("three");
type RigKey = "boot" | "core" | "orbit" | "warp" | "finale" | "bowl" | "drive" | "desk" | "studio" | "qr" | "faces" | "helmet" | "lab" | "sparkle" | "hearts" | "confetti" | "trick" | "hud" | "gears" | "name";
const RIG_FOR: Record<Exclude<ShowcaseScene, "out">, RigKey> = {
  boot: "boot", core: "core", orbit: "orbit", warp: "warp", finale: "finale", bowl: "bowl", drive: "drive", desk: "desk",
  studioShell: "studio", studioEyes: "studio", studioGear: "studio", studioName: "studio", qr: "qr",
  faces: "faces", helmet: "helmet", lab: "lab", labpop: "lab", sparkle: "sparkle", hearts: "hearts", confetti: "confetti", trick: "trick",
  hud: "hud", gears: "gears", name: "name",
};

interface Rig {
  group: THREE.Group;
  /** t = seconds since this rig became active; ts = seconds since the current SCENE started. */
  update: (t: number, dt: number, scene: ShowcaseScene, ts: number) => void;
  dispose: () => void;
}

const ICE = 0xc9dcf0, STEEL = 0x4a7fb5, NAVY = 0x1e2a38, AMBER = 0xe0a64b, GOLD = 0xf5b83d;
const ROSE = 0xff8fb0, VIOLET = 0xb14aff, MINT = 0x5ce0b8, SLIME = 0x39ff14, WATER = 0x0b3358;
const FADE_S = 0.7;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x: number) => { const c = clamp01(x); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
const easeOutBack = (x: number) => { const c = clamp01(x); const k = 1.70158; return 1 + (k + 1) * Math.pow(c - 1, 3) + k * Math.pow(c - 1, 2); };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Scale every material's opacity in a group by `a` (remembers each base opacity). */
function setAlpha(root: THREE.Object3D, a: number) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (mat.userData.baseOpacity === undefined) mat.userData.baseOpacity = mat.opacity;
      mat.opacity = (mat.userData.baseOpacity as number) * a;
      mat.transparent = true;
    }
  });
}
/** Change a material's base opacity at runtime (respected by setAlpha). */
function setBase(mat: THREE.Material, v: number) { mat.userData.baseOpacity = v; mat.opacity = v; }

function disposeGroup(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
  });
}

function points(T: ThreeMod, count: number, color: number, size: number, opacity = 0.9, map?: THREE.Texture, additive = !map) {
  const pos = new Float32Array(count * 3);
  const geo = new T.BufferGeometry();
  const attr = new T.BufferAttribute(pos, 3);
  geo.setAttribute("position", attr);
  const mat = new T.PointsMaterial({
    color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false,
    blending: additive ? T.AdditiveBlending : T.NormalBlending, ...(map ? { map, alphaTest: additive ? 0.02 : 0.15 } : {}),
  });
  return { pts: new T.Points(geo, mat), pos, attr, mat };
}
const flat = (T: ThreeMod, color: number, opacity = 1, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) =>
  new T.MeshBasicMaterial({ color, transparent: true, opacity, ...extra });

/** Evenly spread directions on a sphere (fibonacci). */
function fib(i: number, n: number): [number, number, number] {
  const y = 1 - (i / Math.max(1, n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * 2.399963;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
}

function radialTexture(T: ThreeMod, rgb: string): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, `rgba(${rgb},0.9)`); grad.addColorStop(0.45, `rgba(${rgb},0.25)`); grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
}
function heartTexture(T: ThreeMod): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ff8fb0";
  g.beginPath();
  g.moveTo(32, 56); g.bezierCurveTo(4, 36, 4, 12, 20, 12); g.bezierCurveTo(28, 12, 32, 20, 32, 22);
  g.bezierCurveTo(32, 20, 36, 12, 44, 12); g.bezierCurveTo(60, 12, 60, 36, 32, 56); g.fill();
  const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
}

// ── boot: nebula gathers into a glowing core ─────────────────────────────────
function buildBoot(T: ThreeMod): Rig {
  const group = new T.Group();
  const N = 2200;
  const { pts, pos, attr } = points(T, N, ICE, 0.032, 0.85);
  const start = new Float32Array(N * 3), target = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const d = fib(i, N), rs = rnd(1.6, 3.6), rt = 1.05 + rnd(-0.03, 0.03);
    start.set([d[0] * rs + rnd(-0.4, 0.4), d[1] * rs + rnd(-0.4, 0.4), d[2] * rs + rnd(-0.4, 0.4)], i * 3);
    target.set([d[0] * rt, d[1] * rt, d[2] * rt], i * 3);
    pos.set([start[i * 3]!, start[i * 3 + 1]!, start[i * 3 + 2]!], i * 3);
  }
  group.add(pts);
  const core = new T.Mesh(new T.IcosahedronGeometry(0.62, 1), flat(T, STEEL, 0.9, { wireframe: true }));
  const glow = new T.Mesh(new T.IcosahedronGeometry(0.5, 2), flat(T, ICE, 0.28, { blending: T.AdditiveBlending, depthWrite: false }));
  const ring1 = new T.Mesh(new T.TorusGeometry(1.38, 0.012, 8, 110), flat(T, STEEL, 0.85));
  const ring2 = new T.Mesh(new T.TorusGeometry(1.62, 0.009, 8, 110), flat(T, STEEL, 0.85));
  ring1.rotation.x = 1.2; ring2.rotation.x = 0.4; ring2.rotation.y = 0.9;
  for (const m of [core, glow, ring1, ring2]) m.scale.setScalar(0.001);
  group.add(core, glow, ring1, ring2);
  return {
    group,
    update(t, dt) {
      const k = easeInOut(t / 4.6), breathe = 1 + 0.02 * Math.sin(t * 1.6);
      for (let i = 0; i < N; i++) {
        const sw = (1 - k) * 0.35 * Math.sin(t * 0.9 + i * 0.013), b = i * 3;
        pos[b] = (start[b]! + (target[b]! - start[b]!) * k) * breathe + sw * target[b + 2]!;
        pos[b + 1] = (start[b + 1]! + (target[b + 1]! - start[b + 1]!) * k) * breathe;
        pos[b + 2] = (start[b + 2]! + (target[b + 2]! - start[b + 2]!) * k) * breathe - sw * target[b]!;
      }
      attr.needsUpdate = true;
      const s = easeOut((t - 3.4) / 1.4);
      core.scale.setScalar(Math.max(0.001, s)); glow.scale.setScalar(Math.max(0.001, s * (1 + 0.05 * Math.sin(t * 3))));
      const r = easeOut((t - 4.6) / 1.2);
      ring1.scale.setScalar(Math.max(0.001, r)); ring2.scale.setScalar(Math.max(0.001, r));
      ring1.rotation.z += dt * 0.5; ring2.rotation.z -= dt * 0.35; ring2.rotation.x += dt * 0.12;
      core.rotation.y += dt * 0.4; core.rotation.x += dt * 0.15;
      group.rotation.y += dt * 0.12;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── core: wireframe neural core with pulsing nodes + racing signals ──────────
function buildCore(T: ThreeMod): Rig {
  const group = new T.Group();
  const geo = new T.IcosahedronGeometry(1.15, 2);
  const shell = new T.Mesh(geo, flat(T, STEEL, 0.55, { wireframe: true }));
  group.add(shell);
  const raw = geo.getAttribute("position") as THREE.BufferAttribute;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < raw.count; i++) { const x = raw.getX(i), y = raw.getY(i), z = raw.getZ(i); seen.set(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`, [x, y, z]); }
  const verts = [...seen.values()];
  const nodes = points(T, verts.length, ICE, 0.075, 0.95);
  verts.forEach((v, i) => nodes.pos.set(v, i * 3));
  nodes.attr.needsUpdate = true;
  group.add(nodes.pts);
  const S = 70;
  const sig = points(T, S, GOLD, 0.055, 1);
  const pairs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < S; i++) pairs.push([Math.floor(Math.random() * verts.length), Math.floor(Math.random() * verts.length), Math.random(), rnd(0.25, 0.6)]);
  group.add(sig.pts);
  const stars = points(T, 700, ICE, 0.02, 0.5);
  for (let i = 0; i < 700; i++) { const d = fib(i, 700), r = rnd(6, 9); stars.pos.set([d[0] * r, d[1] * r, d[2] * r], i * 3); }
  stars.attr.needsUpdate = true;
  group.add(stars.pts);
  return {
    group,
    update(t, dt) {
      nodes.mat.size = 0.065 + 0.02 * Math.sin(t * 2.4);
      for (let i = 0; i < S; i++) {
        const [a, b, ph, sp] = pairs[i]!, f = (t * sp + ph) % 1, va = verts[a]!, vb = verts[b]!;
        sig.pos[i * 3] = va[0] + (vb[0] - va[0]) * f; sig.pos[i * 3 + 1] = va[1] + (vb[1] - va[1]) * f; sig.pos[i * 3 + 2] = va[2] + (vb[2] - va[2]) * f;
      }
      sig.attr.needsUpdate = true;
      shell.rotation.y += dt * 0.28; shell.rotation.x = 0.35 * Math.sin(t * 0.4);
      nodes.pts.rotation.copy(shell.rotation); sig.pts.rotation.copy(shell.rotation);
      stars.pts.rotation.y -= dt * 0.03;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── faces: transparent, a ring of emotion orbs circles the rim ───────────────
function buildFaces(T: ThreeMod): Rig {
  const group = new T.Group();
  const colors = [GOLD, ICE, ROSE, VIOLET, AMBER, MINT, STEEL, ROSE, GOLD, ICE, VIOLET, MINT, AMBER, ICE];
  const orbs = colors.map((c) => { const m = new T.Mesh(new T.SphereGeometry(0.075, 10, 10), flat(T, c, 0.95)); group.add(m); return m; });
  const halo = points(T, colors.length, ICE, 0.32, 0.35);
  group.add(halo.pts);
  const circ = new T.LineLoop(
    new T.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new T.Vector3(Math.cos(i / 128 * Math.PI * 2) * 2.12, Math.sin(i / 128 * Math.PI * 2) * 2.12, 0))),
    new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.35 }),
  );
  group.add(circ);
  return {
    group,
    update(t, dt) {
      orbs.forEach((o, i) => {
        const a = t * 0.38 + (i / orbs.length) * Math.PI * 2;
        o.position.set(Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0.15 * Math.sin(t * 2 + i));
        o.scale.setScalar(1 + 0.25 * Math.sin(t * 3 + i * 1.7));
        halo.pos.set([o.position.x, o.position.y, o.position.z], i * 3);
      });
      halo.attr.needsUpdate = true;
      circ.rotation.z -= dt * 0.1;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── orbit: a small planet, three satellites on tilted orbits ─────────────────
function buildOrbit(T: ThreeMod): Rig {
  const group = new T.Group();
  const planet = new T.Mesh(new T.IcosahedronGeometry(0.72, 1), flat(T, NAVY, 1));
  const wire = new T.Mesh(new T.IcosahedronGeometry(0.728, 1), flat(T, STEEL, 0.9, { wireframe: true }));
  const atmo = new T.Mesh(new T.SphereGeometry(0.86, 18, 18), flat(T, ICE, 0.1, { blending: T.AdditiveBlending, depthWrite: false }));
  group.add(planet, wire, atmo);
  const orbits: Array<{ rx: number; ry: number; tilt: THREE.Euler }> = [];
  const sats: Array<{ mesh: THREE.Mesh; i: number; speed: number; phase: number }> = [];
  const specs: Array<[number, number, number, number, number, number]> = [[1.35, 1.05, 0.9, 0.2, AMBER, 0.9], [1.7, 1.3, -0.6, 0.7, ICE, 0.6], [2.0, 1.55, 0.3, -0.9, GOLD, 0.42]];
  specs.forEach(([rx, ry, ex, ez, col, speed], i) => {
    const line = new T.LineLoop(new T.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, k) => new T.Vector3(Math.cos(k / 128 * Math.PI * 2) * rx, 0, Math.sin(k / 128 * Math.PI * 2) * ry))), new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.45 }));
    const tilt = new T.Euler(ex, 0, ez);
    line.rotation.copy(tilt); group.add(line); orbits.push({ rx, ry, tilt });
    const mesh = new T.Mesh(new T.OctahedronGeometry(0.09), flat(T, col, 1));
    group.add(mesh); sats.push({ mesh, i, speed, phase: Math.random() * 6.28 });
  });
  const tmp = new T.Vector3();
  return {
    group,
    update(t, dt) {
      planet.rotation.y += dt * 0.25; wire.rotation.y += dt * 0.25;
      atmo.scale.setScalar(1 + 0.03 * Math.sin(t * 1.3));
      for (const s of sats) {
        const o = orbits[s.i]!, a = t * s.speed + s.phase;
        tmp.set(Math.cos(a) * o.rx, 0, Math.sin(a) * o.ry).applyEuler(o.tilt);
        s.mesh.position.copy(tmp); s.mesh.rotation.x += dt * 2; s.mesh.rotation.y += dt * 1.5;
      }
      group.rotation.y = 0.15 * Math.sin(t * 0.3); group.rotation.x = 0.25;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── fireworks: bursts blooming around the rim (the trick, and after a finale) ─
function makeFireworks(T: ThreeMod, every = 0.75) {
  const group = new T.Group();
  const K = 6, P = 80;
  const bursts = Array.from({ length: K }, () => { const p = points(T, P, GOLD, 0.06, 0); group.add(p.pts); return { p, v: new Float32Array(P * 3), born: -10 }; });
  let next = 0, cursor = 0;
  return {
    group,
    update(t: number, dt: number, active = true) {
      if (active && t >= next) {
        next = t + every * rnd(0.7, 1.3);
        const b = bursts[cursor++ % K]!;
        const a = rnd(0, Math.PI * 2), r = rnd(0.9, 1.9), cx = Math.cos(a) * r, cy = Math.sin(a) * r;
        b.born = t; b.p.mat.color.setHSL(rnd(0, 1), 0.9, 0.62);
        for (let i = 0; i < P; i++) { const d = fib(i, P), sp = rnd(1.2, 2.6); b.v.set([d[0] * sp, d[1] * sp, d[2] * sp * 0.3], i * 3); b.p.pos.set([cx, cy, 0.3], i * 3); }
        b.p.attr.needsUpdate = true;
      }
      for (const b of bursts) {
        const age = t - b.born;
        if (age < 0 || age > 1.4) { setBase(b.p.mat, 0); continue; }
        setBase(b.p.mat, age < 0.1 ? 1 : Math.max(0, 1 - (age - 0.1) / 1.3));
        b.p.mat.size = 0.05 + 0.05 * Math.max(0, 1 - age);
        for (let i = 0; i < P; i++) { const k = i * 3; b.p.pos[k] += b.v[k]! * dt; b.p.pos[k + 1] += (b.v[k + 1]! - 1.8 * age) * dt; b.p.pos[k + 2] += b.v[k + 2]! * dt; b.v[k] *= 0.985; b.v[k + 1] *= 0.985; }
        b.p.attr.needsUpdate = true;
      }
    },
    dispose: () => disposeGroup(group),
  };
}

// ── name: a guest's name assembles from gold above the eyes ──────────────────
function buildName(T: ThreeMod, label: string): Rig {
  const group = new T.Group();
  const targets = label ? sampleLabel(label.toUpperCase()) : [];
  const N = Math.min(1400, targets.length);
  const SC = 0.62, Y = 1.42;
  const pts = points(T, Math.max(1, N), GOLD, 0.04, 0);
  const from = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const a = rnd(0, Math.PI * 2), r = rnd(2.0, 2.6); from.set([Math.cos(a) * r, Math.sin(a) * r, rnd(-0.5, 0.5)], i * 3); pts.pos.set([from[i * 3]!, from[i * 3 + 1]!, from[i * 3 + 2]!], i * 3); }
  pts.attr.needsUpdate = true;
  if (N) group.add(pts.pts);
  const glow = points(T, 1, GOLD, 2.4, N ? 0.3 : 0, radialTexture(T, "245,184,61"), true); glow.pos.set([0, Y, -0.3]); glow.attr.needsUpdate = true; group.add(glow.pts);
  const TW = 24;
  const twinkle = points(T, TW, ICE, 0.07, N ? 0.8 : 0);
  for (let i = 0; i < TW; i++) twinkle.pos.set([rnd(-1.5, 1.5), Y + rnd(-0.45, 0.45), 0.1], i * 3); twinkle.attr.needsUpdate = true; group.add(twinkle.pts);
  const IN = 1.3;
  return {
    group,
    update(t, dt) {
      if (!N) return;
      const k = easeOut(t / IN), wob = t > IN ? 0.01 : 0;
      setBase(pts.mat, Math.min(1, k * 1.3));
      for (let i = 0; i < N; i++) { const tg = targets[i]!, b = i * 3, tx = tg[0] * SC, ty = Y + tg[1] * SC; pts.pos[b] = from[b]! + (tx - from[b]!) * k + wob * Math.sin(t * 5 + i); pts.pos[b + 1] = from[b + 1]! + (ty - from[b + 1]!) * k + wob * Math.cos(t * 4 + i * 0.7); pts.pos[b + 2] = from[b + 2]! * (1 - k); }
      pts.attr.needsUpdate = true;
      pts.mat.size = 0.04 + 0.008 * Math.sin(t * 6);
      setBase(twinkle.mat, 0.35 + 0.45 * Math.abs(Math.sin(t * 3)));
      for (let i = 0; i < TW; i++) { const b = i * 3 + 1; twinkle.pos[b] = twinkle.pos[b]! + dt * 0.15; if (twinkle.pos[b]! > Y + 0.5) twinkle.pos[b] = Y - 0.5; }
      twinkle.attr.needsUpdate = true;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── desk: the Mark 1 at home — lamp, mug, and what he does for you floating up ─
function iconTexture(T: ThreeMod, kind: "bulb" | "note" | "ask"): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 96;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#f5b83d"; g.fillStyle = "#f5b83d"; g.lineWidth = 6; g.lineCap = "round"; g.lineJoin = "round";
  if (kind === "bulb") {
    g.beginPath(); g.arc(48, 40, 24, 0, Math.PI * 2); g.stroke();
    g.fillRect(36, 66, 24, 8); g.fillRect(40, 78, 16, 6);
    g.beginPath(); g.moveTo(40, 52); g.lineTo(48, 40); g.lineTo(56, 52); g.stroke();
  } else {
    g.font = "900 78px 'Arial Black', Impact, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(kind === "note" ? "♪" : "?", 48, 52);
  }
  const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
}
function buildDesk(T: ThreeMod): Rig {
  const group = new T.Group();
  const glowTex = radialTexture(T, "245,184,61");
  const DESK = -1.05;
  const slab = new T.Mesh(new T.PlaneGeometry(7, 1.6), flat(T, 0x0e1626, 1)); slab.position.set(0, DESK - 0.8, -0.2);
  const edge = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-4, DESK, 0), new T.Vector3(4, DESK, 0)]), new T.LineBasicMaterial({ color: ICE, transparent: true, opacity: 0.8 }));
  group.add(slab, edge);
  // lamp: post, arm, shade, and a warm pool of light over him
  const post = new T.Mesh(new T.CylinderGeometry(0.035, 0.045, 1.9, 10), flat(T, STEEL, 1)); post.position.set(1.55, DESK + 0.95, 0);
  const arm = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1.0, 10), flat(T, STEEL, 1)); arm.position.set(1.1, DESK + 1.85, 0); arm.rotation.z = Math.PI / 2 - 0.35;
  const shade = new T.Mesh(new T.ConeGeometry(0.34, 0.4, 20, 1, true), flat(T, NAVY, 1, { side: T.DoubleSide })); shade.position.set(0.62, DESK + 1.95, 0); shade.rotation.z = 0.55;
  const bulb = new T.Mesh(new T.SphereGeometry(0.06, 8, 8), flat(T, GOLD, 1)); bulb.position.set(0.62, DESK + 1.85, 0);
  const beam = new T.Mesh(new T.PlaneGeometry(2.4, 2.4), new T.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending })); beam.position.set(0.1, DESK + 0.9, -0.5);
  group.add(post, arm, shade, bulb, beam);
  // a mug, steaming
  const mug = new T.Group();
  const cup = new T.Mesh(new T.CylinderGeometry(0.16, 0.14, 0.32, 16), flat(T, ROSE, 1)); cup.position.y = 0.16;
  const handle = new T.Mesh(new T.TorusGeometry(0.09, 0.03, 8, 16), flat(T, ROSE, 1)); handle.position.set(0.18, 0.16, 0);
  const steam = points(T, 12, ICE, 0.05, 0.6);
  for (let i = 0; i < 12; i++) steam.pos.set([rnd(-0.06, 0.06), 0.35 + rnd(0, 0.5), 0.1], i * 3); steam.attr.needsUpdate = true;
  mug.add(cup, handle, steam.pts); mug.position.set(-1.35, DESK, 0.2); group.add(mug);
  // the Mark 1, at home
  const { bot, eyeL, eyeR, loop, loopGlow } = buildMark1(T, radialTexture(T, "201,220,240"));
  const SC = 1.15; bot.scale.setScalar(SC); bot.position.set(0.05, DESK + 0.34 * SC, 0.1); group.add(bot);
  // what he does, floating up from his antenna in turn: light, music, a question
  const kinds: Array<"bulb" | "note" | "ask"> = ["bulb", "note", "ask"];
  const icons = kinds.map((k) => { const s = new T.Sprite(new T.SpriteMaterial({ map: iconTexture(T, k), transparent: true, opacity: 0, depthWrite: false })); s.scale.setScalar(0.5); group.add(s); return s; });
  const CYCLE = 7.5, STAGGER = 2.2, LIFE = 3.2;
  return {
    group,
    update(t, dt) {
      bot.position.y = DESK + 0.34 * SC + 0.03 * Math.sin(t * 1.6);
      bot.rotation.z = 0.04 * Math.sin(t * 1.3);
      const blink = (t % 3.3) < 0.15 ? 0.12 : 1; eyeL.scale.y = blink; eyeR.scale.y = blink;
      loop.rotation.y = 0.5 * Math.sin(t * 2.2);
      (bulb.material as THREE.MeshBasicMaterial).opacity = 0.85 + 0.15 * Math.sin(t * 9);
      for (let i = 0; i < 12; i++) { let y = steam.pos[i * 3 + 1]! + 0.25 * dt; steam.pos[i * 3] = steam.pos[i * 3]! + 0.08 * Math.sin(t * 2 + i) * dt; if (y > 0.9) { y = 0.35; steam.pos[i * 3] = rnd(-0.06, 0.06); } steam.pos[i * 3 + 1] = y; }
      steam.attr.needsUpdate = true;
      let glow = 0.35;
      icons.forEach((s, i) => {
        const age = (((t - 0.8 - i * STAGGER) % CYCLE) + CYCLE) % CYCLE;
        const on = t > 0.8 + i * STAGGER && age < LIFE;
        const k = age / LIFE;
        setBase(s.material, on ? (k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1) : 0);
        s.position.set(bot.position.x + 0.15 + 0.35 * Math.sin(k * 3 + i) + (i - 1) * 0.5 * k, bot.position.y + 1.15 * SC + 1.3 * k, 0.6);
        s.scale.setScalar(0.42 + 0.18 * Math.sin(k * Math.PI));
        if (on && k < 0.15) glow = 0.9;
      });
      (loopGlow.pts.material as THREE.PointsMaterial).opacity = glow;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── warp / finale: starfield rush; finale also assembles the name ────────────
function sampleLabel(label: string): Array<[number, number]> {
  const c = document.createElement("canvas"); c.width = 360; c.height = 130;
  const g = c.getContext("2d"); if (!g) return [];
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  let px = 104;
  do { g.font = `900 ${px}px "Arial Black", Impact, system-ui, sans-serif`; px -= 6; } while (g.measureText(label).width > 330 && px > 30);
  g.fillText(label, 180, 66);
  const img = g.getImageData(0, 0, c.width, c.height).data;
  const out: Array<[number, number]> = [];
  for (let y = 0; y < c.height; y += 3) for (let x = 0; x < c.width; x += 3) if (img[(y * c.width + x) * 4]! > 128) out.push([(x - 180) / 95, -(y - 66) / 95]);
  return out;
}
function buildWarp(T: ThreeMod, label: string | null): Rig {
  const group = new T.Group();
  const W = 1400;
  const warp = points(T, W, ICE, 0.028, 0.9);
  for (let i = 0; i < W; i++) warp.pos.set([rnd(-3.2, 3.2), rnd(-3.2, 3.2), rnd(-14, 2)], i * 3);
  warp.attr.needsUpdate = true;
  group.add(warp.pts);
  const targets = label ? sampleLabel(label) : [];
  const N = Math.min(1800, targets.length);
  const name = points(T, Math.max(1, N), GOLD, 0.045, 0);
  const from = new Float32Array(N * 3), dir = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const d = fib((i * 7919) % N, N), r = rnd(2.5, 4);
    from.set([d[0] * r, d[1] * r, d[2] * r - 1], i * 3); dir.set([rnd(-1, 1), rnd(-1, 1), rnd(-0.5, 1.5)], i * 3);
    name.pos.set([from[i * 3]!, from[i * 3 + 1]!, from[i * 3 + 2]!], i * 3);
  }
  name.attr.needsUpdate = true;
  if (N) group.add(name.pts);
  // a little rocket crosses the stars every few seconds (cute, robotic)
  const rocket = new T.Group();
  const rbody = new T.Mesh(new T.ConeGeometry(0.09, 0.42, 12), flat(T, ICE, 1)); rbody.rotation.z = -Math.PI / 2;
  const rwin = new T.Mesh(new T.SphereGeometry(0.035, 8, 8), flat(T, STEEL, 1)); rwin.position.set(0.02, 0, 0.08);
  const finGeo = new T.ConeGeometry(0.06, 0.14, 3);
  const fin1 = new T.Mesh(finGeo, flat(T, AMBER, 1)); fin1.position.set(-0.16, 0.08, 0); fin1.rotation.z = 0.4;
  const fin2 = new T.Mesh(finGeo, flat(T, AMBER, 1)); fin2.position.set(-0.16, -0.08, 0); fin2.rotation.z = Math.PI - 0.4;
  const flame = points(T, 30, AMBER, 0.06, 0.95);
  rocket.add(rbody, rwin, fin1, fin2, flame.pts);
  rocket.position.set(-9, 0, 0);
  group.add(rocket);
  // planets drift past in the corners (one ringed), never during the name
  const planets = [VIOLET, MINT].map((col, i) => {
    const g = new T.Group();
    g.add(new T.Mesh(new T.IcosahedronGeometry(0.7, 1), flat(T, col, 1)), new T.Mesh(new T.IcosahedronGeometry(0.72, 1), flat(T, ICE, 0.35, { wireframe: true })));
    if (i === 0) { const ring = new T.Mesh(new T.TorusGeometry(1.15, 0.06, 6, 40), flat(T, GOLD, 0.9)); ring.rotation.x = 1.2; g.add(ring); }
    g.position.set(0, 0, -30); group.add(g);
    return { g, x: i ? -2.4 : 2.3, y: i ? 1.6 : -1.5, ph: i * 5.5 + 2 };
  });
  const fw = makeFireworks(T, 0.55);
  group.add(fw.group);
  const IN = 4.5, HOLD = 7.4, BURST = 11.6, GONE = 13.6;
  return {
    group,
    update(t, dt) {
      const speed = 2 + 12 * easeInOut(t / 3.2);
      planets.forEach((p) => {
        const c = (t + p.ph) % 11;
        const fly = c < 5 && (!label || t < IN - 1);
        p.g.visible = fly;
        if (fly) { const k = Math.pow(c / 5, 1.6); p.g.position.set(p.x * (0.55 + 0.45 * k), p.y * (0.55 + 0.45 * k), -7 + 8.5 * k); p.g.rotation.y += dt * 0.8; p.g.rotation.z += dt * 0.2; }
      });
      fw.update(t, dt, !!label && t > BURST - 0.2);
      const cyc = t % 6.5;
      if (cyc < 3.2) {
        const k = cyc / 3.2;
        rocket.position.set(-3.6 + 7.2 * k, -1.7 + 3.2 * k + 0.12 * Math.sin(t * 6), 0.8);
        rocket.rotation.z = 0.42;
        for (let i = 0; i < 30; i++) { const b = i * 3; flame.pos[b] = -0.22 - i * 0.03 + rnd(-0.02, 0.02); flame.pos[b + 1] = rnd(-0.05, 0.05) * (1 + i * 0.08); flame.pos[b + 2] = 0; }
        flame.attr.needsUpdate = true;
      } else { rocket.position.set(-9, 0, 0); }
      warp.mat.opacity = 0.9 * (label ? 1 - easeInOut((t - 7.5) / 2) : 1);
      for (let i = 0; i < W; i++) { let z = warp.pos[i * 3 + 2]! + speed * dt; if (z > 3) z -= 16; warp.pos[i * 3 + 2] = z; }
      warp.attr.needsUpdate = true;
      if (!N) return;
      const nm = name.mat;
      if (t < IN) nm.opacity = 0;
      else if (t < HOLD) {
        const k = easeOut((t - IN) / (HOLD - IN)); nm.opacity = Math.min(1, k * 1.4);
        for (let i = 0; i < N; i++) { const tg = targets[i]!, b = i * 3; name.pos[b] = from[b]! + (tg[0] - from[b]!) * k; name.pos[b + 1] = from[b + 1]! + (tg[1] - from[b + 1]!) * k; name.pos[b + 2] = from[b + 2]! * (1 - k); }
        name.attr.needsUpdate = true;
      } else if (t < BURST) {
        nm.opacity = 1; nm.size = 0.045 + 0.012 * Math.sin(t * 6);
        for (let i = 0; i < N; i++) { const tg = targets[i]!, b = i * 3; name.pos[b] = tg[0] + 0.012 * Math.sin(t * 5 + i); name.pos[b + 1] = tg[1] + 0.012 * Math.cos(t * 4 + i * 0.7); name.pos[b + 2] = 0; }
        name.attr.needsUpdate = true;
      } else {
        const k = (t - BURST) / (GONE - BURST); nm.opacity = Math.max(0, 1 - k); const v = 3.5 * dt;
        for (let i = 0; i < N; i++) { const b = i * 3; name.pos[b] += dir[b]! * v; name.pos[b + 1] += dir[b + 1]! * v; name.pos[b + 2] += dir[b + 2]! * v; }
        name.attr.needsUpdate = true;
      }
    },
    dispose: () => { fw.dispose(); disposeGroup(group); },
  };
}

// ── the Mark 1 — Nobi's body as drawn on the workshop page ───────────────────
// One continuous white curve, smoked-glass face, antenna loop, charcoal base
// with the gold stripe, five speaker dots, one wheel. Toon ink outlines come
// from an inverted back-face hull behind each shell piece. Faces +z.
interface Mark1 {
  bot: THREE.Group; wheel: THREE.Group; eyeL: THREE.Mesh; eyeR: THREE.Mesh; loop: THREE.Mesh; loopGlow: ReturnType<typeof points>;
  /** recolorable parts (the studio show cycles them) */
  shell: THREE.Mesh; face: THREE.Mesh; stripe: THREE.Mesh; base: THREE.Mesh; eyeGlow: ReturnType<typeof points>; foot: THREE.Mesh;
}
function buildMark1(T: ThreeMod, glowTex: THREE.Texture): Mark1 {
  const INK = 0x101d2e, PAPER = 0xf7f5f0, GLASS = 0x1e2a38, BASE = 0x1c2634, STRIPE = 0xe0a64b;
  const hull = (geo: THREE.BufferGeometry, s: number): THREE.Mesh => { const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: INK, side: T.BackSide })); m.scale.setScalar(s); return m; };
  const bot = new T.Group();
  const shellGeo = new T.CapsuleGeometry(0.3, 0.62, 6, 24);
  const shell = new T.Mesh(shellGeo, flat(T, PAPER, 1)); shell.position.y = 0.42;
  const shellInk = hull(shellGeo, 1.07); shellInk.position.y = 0.42;
  const face = new T.Mesh(new T.CircleGeometry(0.2, 32), flat(T, GLASS, 1)); face.position.set(0, 0.55, 0.305);
  const faceRim = new T.Mesh(new T.RingGeometry(0.2, 0.215, 32), flat(T, INK, 1)); faceRim.position.set(0, 0.55, 0.306);
  const eyeGeo = new T.CapsuleGeometry(0.035, 0.07, 4, 8);
  const eyeL = new T.Mesh(eyeGeo, flat(T, ICE, 1)); eyeL.position.set(-0.07, 0.56, 0.315);
  const eyeR = new T.Mesh(eyeGeo, flat(T, ICE, 1)); eyeR.position.set(0.07, 0.56, 0.315);
  const eyeGlow = points(T, 2, ICE, 0.42, 0.55, glowTex, true); eyeGlow.pos.set([-0.07, 0.56, 0.36, 0.07, 0.56, 0.36]); eyeGlow.attr.needsUpdate = true;
  const loop = new T.Mesh(new T.TorusGeometry(0.045, 0.012, 8, 20), flat(T, INK, 1)); loop.position.y = 1.08;
  const loopGlow = points(T, 1, GOLD, 0.3, 0.7, glowTex, true); loopGlow.pos.set([0, 1.08, 0.02]); loopGlow.attr.needsUpdate = true;
  const earGeo = new T.SphereGeometry(0.075, 12, 10);
  const earL = new T.Mesh(earGeo, flat(T, GLASS, 1)); earL.position.set(-0.3, 0.55, 0); earL.scale.set(0.5, 1, 0.8);
  const earR = new T.Mesh(earGeo, flat(T, GLASS, 1)); earR.position.set(0.3, 0.55, 0); earR.scale.set(0.5, 1, 0.8);
  const dots = new T.Group();
  for (let i = 0; i < 5; i++) { const d = new T.Mesh(new T.SphereGeometry(0.012, 6, 6), flat(T, INK, 1)); const a = (i - 2) * 0.32; d.position.set(Math.sin(a) * 0.2, 0.22 - Math.abs(i - 2) * 0.012, Math.cos(a) * 0.3); dots.add(d); }
  const base = new T.Mesh(new T.CylinderGeometry(0.29, 0.36, 0.13, 28), flat(T, BASE, 1)); base.position.y = -0.045;
  const baseInk = hull(new T.CylinderGeometry(0.29, 0.36, 0.13, 28), 1.06); baseInk.position.y = -0.045;
  const stripe = new T.Mesh(new T.TorusGeometry(0.3, 0.016, 8, 40), flat(T, STRIPE, 1)); stripe.position.y = 0.03; stripe.rotation.x = Math.PI / 2;
  // V1 has no wheels: it sits on a soft rubber foot (the `wheel` group name is
  // kept so the bowl/drive rigs still animate it — as a subtle wobble, not a spin).
  const wheel = new T.Group();
  const foot = new T.Mesh(new T.CylinderGeometry(0.3, 0.33, 0.07, 28), flat(T, INK, 1));
  wheel.add(foot); wheel.position.y = -0.14;
  loop.visible = false; loopGlow.pts.visible = false;   // V1 has no antenna (kept for the rigs that animate it)
  bot.add(shellInk, shell, face, faceRim, eyeL, eyeR, eyeGlow.pts, loop, loopGlow.pts, earL, earR, dots, baseInk, base, stripe, wheel);
  return { bot, wheel, eyeL, eyeR, loop, loopGlow, shell, face, stripe, base, eyeGlow, foot };
}

// ── drive: the Mark 1 rolls in from the left, skids, turns to camera, settles ─
// (the workshop page's signature move: speed lines, skid mark, dust puffs)
function buildDrive(T: ThreeMod): Rig {
  const group = new T.Group();
  const glowTex = radialTexture(T, "201,220,240");
  const GROUND = -1.05;
  const ground = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-4, GROUND, 0), new T.Vector3(4, GROUND, 0)]), new T.LineBasicMaterial({ color: ICE, transparent: true, opacity: 0.85 }));
  const tickPts: THREE.Vector3[] = [];
  for (let i = -8; i <= 8; i++) tickPts.push(new T.Vector3(i * 0.45, GROUND - 0.06, 0), new T.Vector3(i * 0.45, GROUND - (i % 4 === 0 ? 0.18 : 0.11), 0));
  const ticks = new T.LineSegments(new T.BufferGeometry().setFromPoints(tickPts), new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.7 }));
  group.add(ground, ticks);
  const m1 = buildMark1(T, glowTex);
  const { bot, wheel, eyeL, eyeR, loop, loopGlow } = m1;
  const SCALE = 1.45;
  bot.scale.setScalar(SCALE);
  const REST_Y = GROUND + 0.34 * SCALE;
  bot.position.set(-5, REST_Y, 0);
  bot.rotation.y = Math.PI / 2;                                  // side view while driving
  group.add(bot);
  const lineMat = new T.LineBasicMaterial({ color: ICE, transparent: true, opacity: 0 });
  const speedLines: THREE.Line[] = [];
  for (let i = 0; i < 3; i++) {
    const y = REST_Y + 0.35 + i * 0.28, len = 0.7 - i * 0.12;
    const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-len, y, 0.2), new T.Vector3(0, y, 0.2)]), lineMat);
    speedLines.push(l); group.add(l);
  }
  const skid = new T.Mesh(new T.PlaneGeometry(1.5, 0.06), flat(T, ICE, 0));
  skid.position.set(-0.75, GROUND + 0.03, -0.1);
  group.add(skid);
  const dust: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) { const d = new T.Mesh(new T.SphereGeometry(0.11, 8, 8), flat(T, ICE, 0)); d.position.set(0.5, GROUND + 0.1, 0.3); dust.push(d); group.add(d); }
  const glow = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), new T.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.18, depthWrite: false, blending: T.AdditiveBlending }));
  glow.position.set(0, REST_Y + 0.5, -1);
  group.add(glow);
  const DRIVE = 1.35, TURN0 = 1.45, TURN1 = 1.8, SETTLE0 = 1.85, SETTLE1 = 2.35;
  return {
    group,
    update(t, dt) {
      // drive in with a small overshoot, wheel spinning, speed lines trailing
      const k = clamp01(t / DRIVE);
      const x = -5 + 5 * easeOutBack(k);
      bot.position.x = x;
      wheel.rotation.z = t < DRIVE ? 0.04 * Math.sin(t * 30) : 0;      // glides in (no wheels on a V1)
      const sl = t < 0.15 ? t / 0.15 : t < DRIVE * 0.8 ? 1 : Math.max(0, 1 - (t - DRIVE * 0.8) / (DRIVE * 0.2));
      lineMat.opacity = 0.9 * sl;
      speedLines.forEach((l, i) => { l.position.x = x - 0.55 - i * 0.2; });
      // skid + dust as it stops
      const sk = clamp01((t - DRIVE + 0.1) / 0.5);
      skid.scale.x = 0.2 + 0.8 * easeOut(sk); skid.position.x = x - 0.75 * skid.scale.x;
      (skid.material as THREE.MeshBasicMaterial).opacity = t > DRIVE - 0.1 ? 0.55 * easeOut(sk) : 0;
      dust.forEach((d, i) => {
        const p = clamp01((t - DRIVE + 0.05 - i * 0.08) / 0.8);
        const on = t > DRIVE - 0.05 + i * 0.08 && p < 1;
        (d.material as THREE.MeshBasicMaterial).opacity = on ? 0.5 * (1 - p) : 0;
        d.position.set(x - 0.55 + 0.7 * p + i * 0.1, GROUND + 0.1 + 0.6 * p, 0.3); d.scale.setScalar(0.6 + 1.3 * p);
      });
      // turn to camera, then settle with a little bounce
      const turn = easeInOut((t - TURN0) / (TURN1 - TURN0));
      bot.rotation.y = Math.PI / 2 * (1 - turn);
      let y = REST_Y;
      if (t >= SETTLE0 && t < SETTLE1) { const s = (t - SETTLE0) / (SETTLE1 - SETTLE0); y += s < 0.35 ? -0.18 * Math.sin((s / 0.35) * Math.PI) : 0.05 * Math.sin(((s - 0.35) / 0.65) * Math.PI); }
      else if (t >= SETTLE1) { y += 0.03 * Math.sin((t - SETTLE1) * 1.6); bot.rotation.z = 0.05 * Math.sin((t - SETTLE1) * 1.3); }
      bot.position.y = y;
      // life: blink, antenna wiggle + pulse
      const blink = t > SETTLE1 && ((t - SETTLE1) % 3.1) < 0.16 ? 0.12 : 1;
      eyeL.scale.y = blink; eyeR.scale.y = blink;
      loop.rotation.y = 0.5 * Math.sin(t * 2.2);
      (loopGlow.pts.material as THREE.PointsMaterial).opacity = 0.35 + 0.35 * Math.sin(t * 5);
    },
    dispose: () => disposeGroup(group),
  };
}

// ── studio: the Apple-white product studio for the "how do I get one" show ───
// One rig, four scenes (RIG_FOR maps them all here): studioShell cycles shell
// colors, studioEyes cycles the eye color (the accent follows: seam, gear
// details), studioGear pops the real accessories on, studioName engraves the
// name on the base. Light background — the ink outlines carry the drawing.
const SHELL_CYCLE = [0xffffff, 0x2b3440, 0x6d2b25, 0xb99a6b, 0x9db8a4, 0xa9c6e8, 0xefc3c8, 0x182338];
const EYE_CYCLE = [0xc9dcf0, 0xf5b83d, 0x5ce0b8, 0xff8fb0, 0xc08bff, 0xff7a3d];
function nameTexture(T: ThreeMod, text: string, dark: boolean, px = 54): THREE.Texture {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 512, 96);
  g.fillStyle = dark ? "#f7f5f0" : "#101d2e"; g.textAlign = "center"; g.textBaseline = "middle";
  let size = px;
  do { g.font = `700 ${size}px ui-monospace, Menlo, Consolas, monospace`; size -= 2; } while (g.measureText(text).width > 496 && size > 14);   // fit the plate
  g.fillText(text, 256, 50);
  const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
}
function buildStudio(T: ThreeMod, getName: () => string): Rig {
  const group = new T.Group();
  const glowTex = radialTexture(T, "201,220,240");
  const m1 = buildMark1(T, glowTex);
  const { bot, eyeL, eyeR, shell, stripe, eyeGlow, foot } = m1;
  const SC = 1.5; bot.scale.setScalar(SC); bot.position.set(0, -0.62, 0);
  group.add(bot);
  const floor = new T.Mesh(new T.PlaneGeometry(2.4, 0.5), new T.MeshBasicMaterial({ map: radialTexture(T, "29,29,31"), transparent: true, opacity: 0.22, depthWrite: false }));
  floor.position.set(0, -0.86, -0.2); floor.scale.set(1, 0.3, 1);
  group.add(floor);
  // gear: cradle (car cup-holder carrier), charger pack, charging stand
  const INK = 0x101d2e, GEAR = 0x1c2634;
  const cradle = new T.Group();
  const cup = new T.Mesh(new T.CylinderGeometry(0.44, 0.52, 0.5, 32, 1, true), flat(T, GEAR, 1, { side: T.DoubleSide })); cup.position.y = 0.05;
  const cupBottom = new T.Mesh(new T.CylinderGeometry(0.52, 0.5, 0.06, 32), flat(T, GEAR, 1)); cupBottom.position.y = -0.2;
  const taper = new T.Mesh(new T.CylinderGeometry(0.22, 0.18, 0.34, 24), flat(T, 0x121a26, 1)); taper.position.y = -0.4;
  const cupLip = new T.Mesh(new T.TorusGeometry(0.44, 0.02, 8, 48), flat(T, INK, 1)); cupLip.position.y = 0.3; cupLip.rotation.x = Math.PI / 2;
  const cupBand = new T.Mesh(new T.TorusGeometry(0.49, 0.014, 8, 48), flat(T, 0xc9dcf0, 1)); cupBand.position.y = -0.02; cupBand.rotation.x = Math.PI / 2;
  cradle.add(cup, cupBottom, taper, cupLip, cupBand); cradle.position.set(0, -0.62, 0); cradle.scale.setScalar(0.001);
  const pack = new T.Group();
  const packBody = new T.Mesh(new T.BoxGeometry(0.22, 0.5, 0.16), flat(T, GEAR, 1));
  const packInk = new T.Mesh(new T.BoxGeometry(0.22, 0.5, 0.16), new T.MeshBasicMaterial({ color: INK, side: T.BackSide })); packInk.scale.setScalar(1.06);
  const packWin = new T.Mesh(new T.PlaneGeometry(0.1, 0.24), flat(T, 0xc9dcf0, 1)); packWin.position.set(0, 0.02, 0.081);
  const packLvl = new T.Mesh(new T.PlaneGeometry(0.07, 0.1), flat(T, 0x1c2634, 1)); packLvl.position.set(0, -0.03, 0.082);
  pack.add(packInk, packBody, packWin, packLvl); pack.position.set(0.5, 0.05, -0.05); pack.scale.setScalar(0.001);
  const stand = new T.Group();
  const standDisc = new T.Mesh(new T.CylinderGeometry(0.62, 0.66, 0.06, 40), flat(T, 0x2b3440, 1));
  const standRing = new T.Mesh(new T.TorusGeometry(0.5, 0.02, 8, 48), flat(T, 0xc9dcf0, 1)); standRing.position.y = 0.035; standRing.rotation.x = Math.PI / 2;
  stand.add(standDisc, standRing); stand.position.set(0, -0.88, 0); stand.scale.setScalar(0.001);
  group.add(cradle, pack, stand);
  const accentMeshes = [stripe, cupBand, packWin, standRing];
  // name plate on the base
  let nameMat = new T.MeshBasicMaterial({ map: nameTexture(T, "", true), transparent: true });
  const plate = new T.Mesh(new T.PlaneGeometry(0.62, 0.116), nameMat); plate.position.set(0, -0.045 * SC - 0.62, 0.36 * SC);
  group.add(plate);
  let typed = -1;
  let shellIdx = -1, eyeIdx = -1;
  const setShell = (hex: number) => { (shell.material as THREE.MeshBasicMaterial).color.set(hex); };
  const setEyes = (hex: number) => { for (const m of [eyeL, eyeR]) (m.material as THREE.MeshBasicMaterial).color.set(hex); eyeGlow.mat.color.set(hex); for (const a of accentMeshes) (a.material as THREE.MeshBasicMaterial).color.set(hex); };
  const popIn = (g: THREE.Group, t: number, at: number) => { g.scale.setScalar(Math.max(0.001, easeOutBack((t - at) / 0.6))); };
  return {
    group,
    update(t, dt, scene, ts) {
      bot.position.y = -0.62 + 0.025 * Math.sin(t * 1.4);
      bot.rotation.y = 0.18 * Math.sin(t * 0.5);
      const blink = (t % 3.4) < 0.15 ? 0.12 : 1; eyeL.scale.y = blink; eyeR.scale.y = blink;
      if (scene === "studioShell") {
        const i = Math.min(SHELL_CYCLE.length - 1, Math.floor(ts / 0.75));
        if (i !== shellIdx) { shellIdx = i; setShell(SHELL_CYCLE[i]!); shell.scale.setScalar(1.06); }
        shell.scale.setScalar(1 + (shell.scale.x - 1) * Math.max(0, 1 - dt * 8));
        bot.rotation.y = 0.55 * Math.sin(ts * 1.3);                    // shows both sides, never the back
      } else if (scene === "studioEyes") {
        const i = Math.min(EYE_CYCLE.length - 1, Math.floor(ts / 0.7));
        if (i !== eyeIdx) { eyeIdx = i; setEyes(EYE_CYCLE[i]!); }
        eyeGlow.mat.size = 0.42 + 0.12 * Math.abs(Math.sin(t * 5));
        bot.rotation.y = 0.1 * Math.sin(t * 0.8);
      } else if (scene === "studioGear") {
        popIn(cradle, ts, 0.3); popIn(pack, ts, 2.0); popIn(stand, ts, 3.8);
        foot.visible = ts < 0.3;                                      // it sits IN the cradle
        pack.position.set(0.5 + 0.02 * Math.sin(t * 2), 0.05, -0.05);
      } else if (scene === "studioName") {
        cradle.scale.setScalar(Math.max(0.001, cradle.scale.x * (1 - dt * 4)));
        pack.scale.setScalar(Math.max(0.001, pack.scale.x * (1 - dt * 4)));
        stand.scale.setScalar(Math.max(0.001, stand.scale.x * (1 - dt * 4)));
        foot.visible = true;
        const full = (getName() || "YOURS").toUpperCase().slice(0, 12);
        const n = Math.min(full.length, Math.floor(ts / 0.22));
        if (n !== typed) { typed = n; nameMat.map?.dispose(); nameMat.map = nameTexture(T, full.slice(0, n) + (n < full.length ? "_" : ""), true); nameMat.needsUpdate = true; }
        bot.rotation.y = 0;
        bot.position.y = -0.62 + 0.02 * Math.sin(t * 1.4);
      }
    },
    dispose: () => { nameMat.map?.dispose(); disposeGroup(group); },
  };
}

// ── qr: the shop's QR assembles from scattered cubes (scannable when settled) ─
function buildQr(T: ThreeMod, url: string): Rig {
  const group = new T.Group();
  const q = qrcode(0, "M"); q.addData(url); q.make();
  const n = q.getModuleCount();
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cells.push([r, c]);
  const SIZE = 2.9, cell = SIZE / n;
  const geo = new T.BoxGeometry(cell * 0.92, cell * 0.92, cell * 0.6);
  const mesh = new T.InstancedMesh(geo, new T.MeshBasicMaterial({ color: 0x1d1d1f }), cells.length);
  const from = new Float32Array(cells.length * 3), delay = new Float32Array(cells.length);
  const M = new T.Matrix4(), P = new T.Vector3(), Q = new T.Quaternion(), S = new T.Vector3(1, 1, 1);
  cells.forEach(([r, c], i) => {
    const x = (c - n / 2 + 0.5) * cell, y = -(r - n / 2 + 0.5) * cell;
    const a = rnd(0, Math.PI * 2), rad = rnd(2.4, 4.2);
    from.set([Math.cos(a) * rad, Math.sin(a) * rad, rnd(-1.5, 1.5)], i * 3);
    delay[i] = Math.hypot(x, y) / (SIZE * 0.72) * 0.9 + rnd(0, 0.25);
    M.compose(P.set(from[i * 3]!, from[i * 3 + 1]!, from[i * 3 + 2]!), Q, S); mesh.setMatrixAt(i, M);
  });
  mesh.position.y = 0.12;
  group.add(mesh);
  const quiet = new T.Mesh(new T.PlaneGeometry(SIZE + cell * 4, SIZE + cell * 4), flat(T, 0xffffff, 1)); quiet.position.set(0, 0.12, -0.02);
  group.add(quiet);
  const capMat = new T.MeshBasicMaterial({ map: nameTexture(T, url.replace(/^https?:\/\//, ""), false, 40), transparent: true });
  const cap = new T.Mesh(new T.PlaneGeometry(2.6, 0.48), capMat); cap.position.set(0, -1.72, 0.05);
  group.add(cap);
  return {
    group,
    update(t) {
      const settled = t > 2.2;
      cells.forEach(([r, c], i) => {
        const x = (c - n / 2 + 0.5) * cell, y = -(r - n / 2 + 0.5) * cell;
        const k = easeOut((t - delay[i]!) / 1.1);
        const fx = from[i * 3]!, fy = from[i * 3 + 1]!, fz = from[i * 3 + 2]!;
        P.set(fx + (x - fx) * k, fy + (y - fy) * k, fz * (1 - k));
        Q.setFromAxisAngle(new T.Vector3(0.3, 1, 0.2).normalize(), (1 - k) * 4);
        M.compose(P, Q, S); mesh.setMatrixAt(i, M);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.scale.setScalar(settled ? 1 + 0.01 * Math.sin(t * 2) : 1);
      (capMat as THREE.MeshBasicMaterial).opacity = easeOut((t - 1.8) / 0.8);
    },
    dispose: () => { capMat.map?.dispose(); disposeGroup(group); },
  };
}

// ── bowl: Nobi's whole mini body hanging out in a fishbowl ──────────────────
function buildBowl(T: ThreeMod): Rig {
  const group = new T.Group();
  // water + surface
  const water = new T.Mesh(new T.PlaneGeometry(7, 4), flat(T, 0x0e3f6b, 0.85));
  water.position.set(0, -1.35, -1.2);
  const surface = new T.Mesh(new T.PlaneGeometry(7, 0.05), flat(T, ICE, 0.6));
  surface.position.set(0, 0.68, -1.1);
  const glowTex = radialTexture(T, "120,190,240");
  const shimmer = new T.Mesh(new T.PlaneGeometry(4.5, 4.5), new T.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.45, depthWrite: false, blending: T.AdditiveBlending }));
  shimmer.position.set(0, -0.6, -1.15);
  group.add(water, surface, shimmer);
  // bubbles
  const B = 70;
  const bub = points(T, B, ICE, 0.05, 0.75);
  const bubV = new Float32Array(B);
  for (let i = 0; i < B; i++) { bub.pos.set([rnd(-1.8, 1.8), rnd(-2.2, 0.6), rnd(-0.5, 0.5)], i * 3); bubV[i] = rnd(0.25, 0.7); }
  bub.attr.needsUpdate = true;
  group.add(bub.pts);
  const { bot, wheel, eyeL, eyeR, loop, loopGlow } = buildMark1(T, glowTex);
  bot.position.set(0, -0.45, 0);
  bot.scale.setScalar(1.3);
  group.add(bot);
  // a little fish friend
  const fish = new T.Group();
  const fbody = new T.Mesh(new T.ConeGeometry(0.09, 0.28, 12), flat(T, GOLD, 1)); fbody.rotation.z = -Math.PI / 2;
  const tail = new T.Mesh(new T.ConeGeometry(0.07, 0.12, 3), flat(T, AMBER, 1)); tail.rotation.z = Math.PI / 2; tail.position.x = -0.18;
  const feye = new T.Mesh(new T.SphereGeometry(0.02, 6, 6), flat(T, NAVY, 1)); feye.position.set(0.06, 0.03, 0.07);
  fish.add(fbody, tail, feye);
  group.add(fish);
  // a little school trailing the big fish, seaweed swaying, bubbles off his ears
  const school = Array.from({ length: 5 }, (_, i) => {
    const f = new T.Group(); const col = i % 2 ? MINT : ICE;
    const b = new T.Mesh(new T.ConeGeometry(0.045, 0.14, 10), flat(T, col, 1)); b.rotation.z = -Math.PI / 2;
    const tl = new T.Mesh(new T.ConeGeometry(0.035, 0.06, 3), flat(T, col, 1)); tl.rotation.z = Math.PI / 2; tl.position.x = -0.09;
    f.add(b, tl); group.add(f);
    return { f, tl, off: i * 0.55 + 0.6, ph: rnd(0, 6.28) };
  });
  const weeds = [-1.9, -1.45, 1.55, 1.95].map((x, i) => {
    const n = 9, h = 0.12 + i * 0.02;
    const l = new T.Line(new T.BufferGeometry().setFromPoints(Array.from({ length: n }, (_, k) => new T.Vector3(x, -2.3 + k * h, -0.6))), new T.LineBasicMaterial({ color: MINT, transparent: true, opacity: 0.8 }));
    group.add(l); return { l, x, n, ph: rnd(0, 6.28) };
  });
  const AB = 10;
  const ab = points(T, AB, ICE, 0.04, 0.8);
  for (let i = 0; i < AB; i++) ab.pos.set([(i % 2 ? 0.42 : -0.42), 0.3 + i * 0.04, 0.2], i * 3); ab.attr.needsUpdate = true; group.add(ab.pts);
  return {
    group,
    update(t, dt) {
      school.forEach((s, i) => {
        const a = t * 0.35 - s.off * 0.18, d = Math.cos(a) >= 0 ? 1 : -1;
        s.f.position.set(2.4 * Math.sin(a), -1.35 + 0.15 * Math.sin(t * 2.2 - s.off) + 0.25 * Math.sin(s.ph + i), -0.35 - i * 0.05);
        s.f.scale.x = d; s.tl.rotation.y = 0.5 * Math.sin(t * 9 + s.ph);
      });
      weeds.forEach((w) => { const pos = w.l.geometry.getAttribute("position") as THREE.BufferAttribute; for (let k = 0; k < w.n; k++) { const f = k / w.n; pos.setX(k, w.x + 0.36 * f * f * Math.sin(t * 1.4 + w.ph + k * 0.4)); } pos.needsUpdate = true; });
      for (let i = 0; i < AB; i++) { const b = i * 3; let y = ab.pos[b + 1]! + 0.3 * dt; ab.pos[b] = (i % 2 ? 0.42 : -0.42) + 0.05 * Math.sin(t * 3 + i); if (y > 0.64) y = 0.22; ab.pos[b + 1] = y; }
      ab.attr.needsUpdate = true;
      for (let i = 0; i < B; i++) { let y = bub.pos[i * 3 + 1]! + bubV[i]! * dt; bub.pos[i * 3] = bub.pos[i * 3]! + 0.15 * Math.sin(t * 2 + i) * dt; if (y > 0.6) { y = -2.3; bub.pos[i * 3] = rnd(-1.8, 1.8); } bub.pos[i * 3 + 1] = y; }
      bub.attr.needsUpdate = true;
      surface.position.y = 0.68 + 0.02 * Math.sin(t * 1.8);
      bot.position.y = -0.45 + 0.07 * Math.sin(t * 1.5);
      bot.rotation.y = 0.32 * Math.sin(t * 0.6);
      bot.rotation.z = 0.06 * Math.sin(t * 1.5 + 0.8);               // happy little rock
      wheel.rotation.z = 0.05 * Math.sin(t * 2.4);                     // a little wobble in the water
      const blink = (t % 3.4) < 0.16 ? 0.12 : 1;
      eyeL.scale.y = blink; eyeR.scale.y = blink;
      loop.rotation.y = 0.5 * Math.sin(t * 2.2);
      (loopGlow.pts.material as THREE.PointsMaterial).opacity = 0.35 + 0.35 * Math.sin(t * 5);
      const fx = 2.4 * Math.sin(t * 0.35), dirn = Math.cos(t * 0.35) >= 0 ? 1 : -1;
      fish.position.set(fx, -1.35 + 0.15 * Math.sin(t * 2.2), -0.3);
      fish.scale.x = dirn; tail.rotation.y = 0.5 * Math.sin(t * 9);
    },
    dispose: () => disposeGroup(group),
  };
}

// ── helmet: glass dome over the face ─────────────────────────────────────────
function buildHelmet(T: ThreeMod): Rig {
  const group = new T.Group();
  // A dome INSIDE the round bezel (the screen's edge is ~2.0 world units at z=0).
  const rim = new T.Mesh(new T.TorusGeometry(1.6, 0.09, 10, 90), flat(T, ICE, 1));
  rim.position.z = 0.2;
  const rim2 = new T.Mesh(new T.TorusGeometry(1.72, 0.035, 8, 90), flat(T, STEEL, 0.9));
  rim2.position.z = 0.1;
  const glass = new T.Mesh(new T.SphereGeometry(1.62, 32, 24), flat(T, ICE, 0.1, { depthWrite: false }));
  const hi1 = new T.Mesh(new T.TorusGeometry(1.38, 0.04, 8, 48, 0.9), flat(T, 0xffffff, 0.55)); hi1.position.z = 0.5; hi1.rotation.z = 1.9;
  const hi2 = new T.Mesh(new T.TorusGeometry(1.2, 0.022, 8, 48, 0.45), flat(T, 0xffffff, 0.35)); hi2.position.z = 0.6; hi2.rotation.z = 2.6;
  const stem = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.42, 8), flat(T, STEEL, 1)); stem.position.set(0.82, 1.5, 0.25); stem.rotation.z = -0.5;
  const bulb = new T.Mesh(new T.SphereGeometry(0.085, 10, 10), flat(T, AMBER, 1)); bulb.position.set(0.94, 1.7, 0.25);
  const stars = points(T, 220, ICE, 0.02, 0.7);
  for (let i = 0; i < 220; i++) { const d = fib(i, 220), r = rnd(1.75, 1.95); stars.pos.set([d[0] * r, d[1] * r, Math.abs(d[2]) * r * 0.6 + 0.15], i * 3); }
  stars.attr.needsUpdate = true;
  group.add(glass, rim, rim2, hi1, hi2, stem, bulb, stars.pts);
  return {
    group,
    update(t, dt) {
      const s = easeOutBack(t / 0.8);
      group.scale.setScalar(Math.max(0.001, s));
      hi1.rotation.z += dt * 0.25; hi2.rotation.z -= dt * 0.18;
      bulb.material.opacity = 0.5 + 0.5 * Math.max(0, Math.sin(t * 3));
      stars.pts.rotation.z += dt * 0.05;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── lab: a bubbling green test tube beside the face; labpop boils it over ────
function buildLab(T: ThreeMod): Rig {
  const group = new T.Group();
  const tube = new T.Group();
  const glass = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 1.2, 20, 1, true), flat(T, ICE, 0.16, { depthWrite: false, side: T.DoubleSide }));
  const bottom = new T.Mesh(new T.SphereGeometry(0.2, 20, 12), flat(T, ICE, 0.16, { depthWrite: false })); bottom.position.y = -0.6;
  const lip = new T.Mesh(new T.TorusGeometry(0.21, 0.025, 8, 24), flat(T, ICE, 0.7)); lip.position.y = 0.6; lip.rotation.x = Math.PI / 2;
  const liquid = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.62, 20), flat(T, SLIME, 0.85)); liquid.position.y = -0.3;
  const lbot = new T.Mesh(new T.SphereGeometry(0.17, 20, 12), flat(T, SLIME, 0.85)); lbot.position.y = -0.6;
  const glowTex = radialTexture(T, "57,255,20");
  const glow = new T.Mesh(new T.PlaneGeometry(1.6, 1.6), new T.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.55, depthWrite: false, blending: T.AdditiveBlending }));
  glow.position.set(0, -0.3, -0.3);
  const NB = 45;
  const bub = points(T, NB, 0xbfffb0, 0.045, 0.9);
  const bv = new Float32Array(NB);
  for (let i = 0; i < NB; i++) { bub.pos.set([rnd(-0.12, 0.12), rnd(-0.75, 0.0), rnd(-0.1, 0.1)], i * 3); bv[i] = rnd(0.3, 0.8); }
  bub.attr.needsUpdate = true;
  tube.add(glow, glass, bottom, lip, liquid, lbot, bub.pts);
  tube.rotation.z = -0.35;
  group.add(tube);
  // a burner under the tube — that's why it bubbles
  const burner = new T.Group();
  const bbase = new T.Mesh(new T.CylinderGeometry(0.16, 0.2, 0.08, 16), flat(T, STEEL, 1)); bbase.position.y = -1.3;
  const bneck = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.26, 10), flat(T, STEEL, 1)); bneck.position.y = -1.14;
  const fOuter = new T.Mesh(new T.ConeGeometry(0.11, 0.34, 12), flat(T, AMBER, 0.85, { blending: T.AdditiveBlending, depthWrite: false })); fOuter.position.y = -0.86;
  const fInner = new T.Mesh(new T.ConeGeometry(0.055, 0.2, 10), flat(T, ICE, 0.9, { blending: T.AdditiveBlending, depthWrite: false })); fInner.position.y = -0.93;
  burner.add(bbase, bneck, fOuter, fInner);
  group.add(burner);
  const NP = 220;
  const pop = points(T, NP, SLIME, 0.05, 0);
  const pv = new Float32Array(NP * 3);
  for (let i = 0; i < NP; i++) { const a = rnd(0, 6.28), sp = rnd(1.5, 4.5); pv.set([Math.cos(a) * sp * 0.6, rnd(2.5, 5.5), Math.sin(a) * sp * 0.4], i * 3); }
  group.add(pop.pts);
  let popStart = -1;
  return {
    group,
    update(t, dt, scene, ts) {
      const enter = easeOutBack(t / 0.9);
      tube.position.x = 3.2 + (1.3 - 3.2) * enter;
      tube.position.y = -0.35 + 0.05 * Math.sin(t * 2.2);
      liquid.scale.y = 1 + 0.05 * Math.sin(t * 6);
      burner.position.x = tube.position.x + 0.2;
      fOuter.scale.set(1 + 0.15 * Math.sin(t * 23), 1 + 0.2 * Math.sin(t * 17), 1);
      fInner.scale.y = 1 + 0.25 * Math.sin(t * 29);
      for (let i = 0; i < NB; i++) { let y = bub.pos[i * 3 + 1]! + bv[i]! * dt; if (y > 0.05) y = -0.72; bub.pos[i * 3 + 1] = y; }
      bub.attr.needsUpdate = true;
      const popping = scene === "labpop";
      if (popping && popStart < 0) {
        popStart = ts;
        const top = new T.Vector3(0, 0.62, 0).applyEuler(tube.rotation).add(tube.position);
        for (let i = 0; i < NP; i++) pop.pos.set([top.x + rnd(-0.1, 0.1), top.y, top.z], i * 3);
      }
      if (popStart >= 0) {
        const pt = ts - popStart;
        if (popping && pt < 1.8) {
          pop.mat.opacity = Math.max(0, 1 - pt / 1.8);
          for (let i = 0; i < NP; i++) { const b = i * 3; pop.pos[b] += pv[b]! * dt; pop.pos[b + 1] += (pv[b + 1]! - 6 * pt) * dt; pop.pos[b + 2] += pv[b + 2]! * dt; }
          pop.attr.needsUpdate = true;
          tube.position.x += 0.06 * Math.sin(pt * 50) * (1 - pt / 1.8);
          setBase(glow.material as THREE.Material, 0.55 + 0.6 * (1 - pt / 1.8));
        } else { pop.mat.opacity = 0; if (!popping) popStart = -1; }
      }
    },
    dispose: () => disposeGroup(group),
  };
}

// ── sparkle: a burst behind the eyes that repeats every ~2.2s ────────────────
function buildSparkle(T: ThreeMod): Rig {
  const group = new T.Group();
  const N = 320;
  const gold = points(T, N / 2, GOLD, 0.05, 1), ice = points(T, N / 2, ICE, 0.04, 1);
  const dirs = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const d = fib(i, N); dirs.set([d[0] * rnd(0.6, 1), d[1] * rnd(0.6, 1), d[2] * 0.3], i * 3); }
  group.add(gold.pts, ice.pts);
  const place = (pts: { pos: Float32Array; attr: THREE.BufferAttribute }, off: number, k: number) => {
    const n = pts.pos.length / 3;
    for (let i = 0; i < n; i++) { const b = (i + off) * 3, r = 0.3 + 2.1 * easeOut(k); pts.pos[i * 3] = dirs[b]! * r; pts.pos[i * 3 + 1] = dirs[b + 1]! * r; pts.pos[i * 3 + 2] = dirs[b + 2]! * r; }
    pts.attr.needsUpdate = true;
  };
  return {
    group,
    update(t) {
      const k = (t % 2.2) / 1.6;
      const a = k < 1 ? 1 - easeInOut(k) : 0;
      place(gold, 0, k); place(ice, N / 2, Math.min(1, k * 1.1));
      gold.mat.opacity = a; ice.mat.opacity = a * 0.8;
      group.rotation.z = t * 0.2;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── hearts: heart sprites drift up around the face ───────────────────────────
function buildHearts(T: ThreeMod): Rig {
  const group = new T.Group();
  const N = 28;
  const h = points(T, N, 0xffffff, 0.34, 0.95, heartTexture(T));
  const v = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) { h.pos.set([rnd(-2.2, 2.2), rnd(-2.6, 2.4), rnd(-0.3, 0.3)], i * 3); v[i] = rnd(0.35, 0.8); ph[i] = rnd(0, 6.28); }
  h.attr.needsUpdate = true;
  group.add(h.pts);
  return {
    group,
    update(t, dt) {
      for (let i = 0; i < N; i++) {
        let y = h.pos[i * 3 + 1]! + v[i]! * dt; const x = h.pos[i * 3]!;
        const r = Math.hypot(x, y);
        if (y > 2.6 || r < 1.15) { y = -2.6; h.pos[i * 3] = (Math.random() < 0.5 ? -1 : 1) * rnd(1.3, 2.2); }
        h.pos[i * 3 + 1] = y; h.pos[i * 3] = h.pos[i * 3]! + 0.25 * Math.sin(t * 1.5 + ph[i]!) * dt;
      }
      h.attr.needsUpdate = true;
      h.mat.size = 0.34 + 0.04 * Math.sin(t * 3);
    },
    dispose: () => disposeGroup(group),
  };
}

// ── confetti: three colours falling and swaying ──────────────────────────────
function buildConfetti(T: ThreeMod): Rig {
  const group = new T.Group();
  const sets = [GOLD, ROSE, MINT, ICE].map((c) => points(T, 70, c, 0.07, 0.95));
  const meta = sets.map(() => ({ v: new Float32Array(70), ph: new Float32Array(70) }));
  sets.forEach((s, si) => { for (let i = 0; i < 70; i++) { s.pos.set([rnd(-2.4, 2.4), rnd(-2.6, 3.0), rnd(-0.4, 0.4)], i * 3); meta[si]!.v[i] = rnd(0.6, 1.3); meta[si]!.ph[i] = rnd(0, 6.28); } s.attr.needsUpdate = true; group.add(s.pts); });
  return {
    group,
    update(t, dt) {
      sets.forEach((s, si) => {
        for (let i = 0; i < 70; i++) { let y = s.pos[i * 3 + 1]! - meta[si]!.v[i]! * dt; if (y < -2.6) { y = 2.8; s.pos[i * 3] = rnd(-2.4, 2.4); } s.pos[i * 3 + 1] = y; s.pos[i * 3] = s.pos[i * 3]! + 0.6 * Math.sin(t * 3 + meta[si]!.ph[i]!) * dt; }
        s.attr.needsUpdate = true; s.mat.size = 0.07 + 0.02 * Math.sin(t * 8 + si);
      });
    },
    dispose: () => disposeGroup(group),
  };
}

// ── trick: rainbow ring spinning around the eyes + sparkles ──────────────────
function buildTrick(T: ThreeMod): Rig {
  const group = new T.Group();
  const rings = [0, 1, 2].map((k) => { const p = points(T, 60, 0xffffff, 0.09, 1); for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; p.pos.set([Math.cos(a) * (1.85 + k * 0.14), Math.sin(a) * (1.85 + k * 0.14), 0], i * 3); } p.attr.needsUpdate = true; group.add(p.pts); return p; });
  const spark = buildSparkle(T);
  group.add(spark.group);
  const fw = makeFireworks(T, 0.6);
  group.add(fw.group);
  return {
    group,
    update(t, dt, scene, ts) {
      rings.forEach((r, k) => { r.pts.rotation.z += dt * (2.2 + k * 0.9) * (k % 2 ? -1 : 1); r.mat.color.setHSL((t * 0.35 + k * 0.33) % 1, 0.9, 0.62); });
      spark.update(t, dt, scene, ts);
      fw.update(t, dt, true);
    },
    dispose: () => { spark.dispose(); fw.dispose(); disposeGroup(group); },
  };
}

// ── hud: a robotic boot HUD — rotating arc rings, ticks, an orbiting scan dot ─
function arcLine(T: ThreeMod, r: number, a0: number, a1: number, color: number, opacity: number): THREE.Line {
  const n = 40;
  const pts = Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * (i / n); return new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0); });
  return new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color, transparent: true, opacity }));
}
function buildHud(T: ThreeMod): Rig {
  const group = new T.Group();
  const rings: Array<{ g: THREE.Group; speed: number }> = [];
  const specs: Array<[number, number, number, number]> = [[1.42, 3, 0.9, 0.35], [1.66, 4, 0.65, -0.22], [1.9, 6, 0.4, 0.14]];
  specs.forEach(([r, arcs, span, speed], i) => {
    const g = new T.Group();
    for (let k = 0; k < arcs; k++) { const a0 = (k / arcs) * Math.PI * 2; g.add(arcLine(T, r, a0, a0 + span, i === 1 ? STEEL : ICE, 0.85)); }
    group.add(g); rings.push({ g, speed });
  });
  const tickPts: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, r0 = i % 4 === 0 ? 1.98 : 2.02; tickPts.push(new T.Vector3(Math.cos(a) * r0, Math.sin(a) * r0, 0), new T.Vector3(Math.cos(a) * 2.08, Math.sin(a) * 2.08, 0)); }
  const ticks = new T.LineSegments(new T.BufferGeometry().setFromPoints(tickPts), new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.7 }));
  group.add(ticks);
  const dot = new T.Mesh(new T.SphereGeometry(0.06, 8, 8), flat(T, GOLD, 1));
  const dotGlow = points(T, 1, GOLD, 0.5, 0.7, radialTexture(T, "245,184,61"), true);
  group.add(dot, dotGlow.pts);
  const spark = buildSparkle(T);
  group.add(spark.group);
  return {
    group,
    update(t, dt, scene, ts) {
      rings.forEach((r) => { r.g.rotation.z += dt * r.speed; });
      ticks.rotation.z -= dt * 0.05;
      const a = t * 1.6;
      dot.position.set(Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0.05);
      dotGlow.pos.set([dot.position.x, dot.position.y, 0.06]); dotGlow.attr.needsUpdate = true;
      group.scale.setScalar(Math.max(0.001, easeOutBack(t / 0.9)));
      spark.update(t, dt, scene, ts);
    },
    dispose: () => { spark.dispose(); disposeGroup(group); },
  };
}

// ── gears: "thinking" — meshing gear rings turning around the eyes ───────────
function gear(T: ThreeMod, r: number, teeth: number, color: number): THREE.Group {
  const g = new T.Group();
  g.add(new T.Mesh(new T.TorusGeometry(r, 0.035, 8, 64), flat(T, color, 0.95)));
  const toothGeo = new T.BoxGeometry(0.11, 0.09, 0.06);
  for (let i = 0; i < teeth; i++) { const a = (i / teeth) * Math.PI * 2; const m = new T.Mesh(toothGeo, flat(T, color, 0.95)); m.position.set(Math.cos(a) * (r + 0.07), Math.sin(a) * (r + 0.07), 0); m.rotation.z = a; g.add(m); }
  const spokes: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; spokes.push(new T.Vector3(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25, 0), new T.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0)); }
  g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(spokes), new T.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })));
  g.add(new T.Mesh(new T.TorusGeometry(r * 0.25, 0.03, 8, 32), flat(T, color, 0.9)));
  return g;
}
function buildGears(T: ThreeMod): Rig {
  const group = new T.Group();
  const big = gear(T, 1.62, 22, STEEL); big.position.z = -0.2;
  const small1 = gear(T, 0.34, 8, ICE); small1.position.set(-1.55, 1.35, 0.2);
  const small2 = gear(T, 0.42, 9, GOLD); small2.position.set(1.6, -1.3, 0.2);
  const small3 = gear(T, 0.26, 7, ICE); small3.position.set(1.45, 1.5, 0.2);
  group.add(big, small1, small2, small3);
  return {
    group,
    update(t, dt) {
      big.rotation.z += dt * 0.45; small1.rotation.z -= dt * 2.1; small2.rotation.z -= dt * 1.7; small3.rotation.z += dt * 2.6;
      group.scale.setScalar(Math.max(0.001, easeOutBack(t / 0.7)));
    },
    dispose: () => disposeGroup(group),
  };
}

export default function ShowcaseOverlay({ scene, label, nameTag, onSkip }: {
  scene: ShowcaseScene;
  /** The name that assembles from particles in the finale. */
  label: string;
  /** A guest's name for the `name` scene (rebuilt live when it changes — it's often learned mid-conversation). */
  nameTag?: string;
  /** Tap anywhere to skip the show. */
  onSkip?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ShowcaseScene>(scene);
  sceneRef.current = scene;
  const labelRef = useRef(label);
  const nameTagRef = useRef(nameTag ?? "");
  nameTagRef.current = nameTag ?? "";
  const transparent = TRANSPARENT_SCENES.has(scene);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let raf = 0;
    let cleanup: (() => void) | null = null;

    void (async () => {
      let T: ThreeMod;
      try { T = await import("three"); } catch { return; }
      if (cancelled) return;
      let renderer: THREE.WebGLRenderer;
      try { renderer = new T.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" }); } catch { return; }
      renderer.setPixelRatio(1);
      const size = () => Math.min(window.innerWidth, window.innerHeight);
      const fit = () => { const s = size(); renderer.setSize(s, s, false); renderer.domElement.style.width = `${s}px`; renderer.domElement.style.height = `${s}px`; };
      fit();
      host.appendChild(renderer.domElement);
      const camera = new T.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 4.3);
      const world = new T.Scene();
      const rigs: Record<RigKey, Rig> = {
        boot: buildBoot(T), core: buildCore(T), orbit: buildOrbit(T), warp: buildWarp(T, null), finale: buildWarp(T, labelRef.current),
        bowl: buildBowl(T), faces: buildFaces(T), helmet: buildHelmet(T), lab: buildLab(T), sparkle: buildSparkle(T),
        hearts: buildHearts(T), confetti: buildConfetti(T), trick: buildTrick(T), hud: buildHud(T), gears: buildGears(T), drive: buildDrive(T),
        desk: buildDesk(T), name: buildName(T, nameTagRef.current),
        studio: buildStudio(T, () => nameTagRef.current), qr: buildQr(T, SHOP_URL),
      };
      const keys = Object.keys(rigs) as RigKey[];
      const alpha: Record<string, number> = {};
      const rigStart: Record<string, number> = {};
      for (const k of keys) { world.add(rigs[k].group); rigs[k].group.visible = false; alpha[k] = 0; }
      let activeScene: ShowcaseScene | null = null;
      let sceneStart = performance.now();
      const clock = new T.Clock();
      const t0 = performance.now();
      window.addEventListener("resize", fit);
      // The guest's name usually arrives after mount — rebuild that one rig when it changes.
      let builtName = nameTagRef.current;
      const syncName = () => {
        const nm = nameTagRef.current;
        if (nm === builtName) return;
        builtName = nm;
        world.remove(rigs.name.group); rigs.name.dispose();
        rigs.name = buildName(T, nm);
        world.add(rigs.name.group); rigs.name.group.visible = false; alpha.name = 0;
      };

      const loop = (now: number) => {
        if (cancelled) return;
        const dt = Math.min(0.05, clock.getDelta());
        syncName();
        const s = sceneRef.current;
        if (s !== activeScene) { activeScene = s; sceneStart = now; }
        const want = s === "out" ? null : RIG_FOR[s];
        renderer.setClearColor(LIGHT_SCENES.has(s) ? STUDIO_BG : 0x03060f, TRANSPARENT_SCENES.has(s) ? 0 : 1);
        for (const k of keys) {
          const target = k === want ? 1 : 0;
          const a = alpha[k]!;
          if (target === 1 && a === 0) rigStart[k] = now;          // (re)activated → its clock restarts
          const next = a + Math.sign(target - a) * Math.min(Math.abs(target - a), dt / FADE_S);
          alpha[k] = next;
          const g = rigs[k].group;
          g.visible = next > 0.001;
          if (g.visible) { setAlpha(g, next); rigs[k].update((now - (rigStart[k] ?? now)) / 1000, dt, s, (now - sceneStart) / 1000); }
        }
        const tt = (now - t0) / 1000;
        camera.position.x = Math.sin(tt * 0.22) * 0.18; camera.position.y = Math.cos(tt * 0.17) * 0.12; camera.lookAt(0, 0, 0);
        renderer.render(world, camera);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        window.removeEventListener("resize", fit);
        cancelAnimationFrame(raf);
        for (const k of keys) rigs[k].dispose();
        renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
    })();

    return () => { cancelled = true; cleanup?.(); };
  }, []);

  return (
    <div ref={hostRef} onClick={onSkip} role="presentation"
      className="fixed inset-0 z-[110] flex items-center justify-center transition-colors duration-700"
      style={{ background: transparent ? "transparent" : LIGHT_SCENES.has(scene) ? "#f5f5f7" : "#03060f", cursor: "none" }} />
  );
}
