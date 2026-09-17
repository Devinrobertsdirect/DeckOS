import { useEffect, useRef } from "react";
import type * as THREE from "three";

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
 *   bowl    the round screen becomes a fishbowl: Nobi's whole mini body hangs
 *           out inside, waving, with bubbles and a small fish friend
 * Transparent scenes (the real eyes show through — props around them):
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
  | "boot" | "core" | "orbit" | "warp" | "finale" | "bowl"
  | "faces" | "helmet" | "lab" | "labpop" | "sparkle" | "hearts" | "confetti" | "trick"
  | "out";

export const TRANSPARENT_SCENES: ReadonlySet<ShowcaseScene> = new Set<ShowcaseScene>([
  "faces", "helmet", "lab", "labpop", "sparkle", "hearts", "confetti", "trick", "out",
]);

type ThreeMod = typeof import("three");
type RigKey = "boot" | "core" | "orbit" | "warp" | "finale" | "bowl" | "faces" | "helmet" | "lab" | "sparkle" | "hearts" | "confetti" | "trick";
const RIG_FOR: Record<Exclude<ShowcaseScene, "out">, RigKey> = {
  boot: "boot", core: "core", orbit: "orbit", warp: "warp", finale: "finale", bowl: "bowl",
  faces: "faces", helmet: "helmet", lab: "lab", labpop: "lab", sparkle: "sparkle", hearts: "hearts", confetti: "confetti", trick: "trick",
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
  const IN = 4.5, HOLD = 7.4, BURST = 11.6, GONE = 13.6;
  return {
    group,
    update(t, dt) {
      const speed = 2 + 12 * easeInOut(t / 3.2);
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
    dispose: () => disposeGroup(group),
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
  // mini Nobi — flat toy colours, eyes sitting proud of the head so they glow
  const bot = new T.Group();
  const head = new T.Mesh(new T.SphereGeometry(0.34, 20, 16), flat(T, 0x243a55, 1));
  head.position.y = 0.52;
  const headRim = new T.Mesh(new T.TorusGeometry(0.31, 0.022, 8, 40), flat(T, STEEL, 1));
  headRim.position.y = 0.22; headRim.rotation.x = Math.PI / 2;
  const eyeGeo = new T.CapsuleGeometry(0.06, 0.12, 4, 8);
  const eyeL = new T.Mesh(eyeGeo, flat(T, ICE, 1)); eyeL.position.set(-0.12, 0.56, 0.37);
  const eyeR = new T.Mesh(eyeGeo, flat(T, ICE, 1)); eyeR.position.set(0.12, 0.56, 0.37);
  const eyeGlow = points(T, 2, ICE, 0.5, 0.6, glowTex, true); eyeGlow.pos.set([-0.12, 0.56, 0.42, 0.12, 0.56, 0.42]); eyeGlow.attr.needsUpdate = true;
  const body = new T.Mesh(new T.BoxGeometry(0.52, 0.5, 0.36), flat(T, 0x2c4566, 1));
  body.position.y = -0.1;
  const bodyEdge = new T.LineSegments(new T.EdgesGeometry(body.geometry), new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.8 }));
  bodyEdge.position.copy(body.position);
  const chest = new T.Mesh(new T.SphereGeometry(0.055, 10, 10), flat(T, AMBER, 1)); chest.position.set(0, -0.02, 0.19);
  const armGeo = new T.CylinderGeometry(0.045, 0.045, 0.38, 10); armGeo.translate(0, -0.19, 0);
  const armL = new T.Mesh(armGeo, flat(T, STEEL, 1)); armL.position.set(-0.32, 0.1, 0);
  const armR = new T.Mesh(armGeo, flat(T, STEEL, 1)); armR.position.set(0.32, 0.1, 0);
  const handGeo = new T.SphereGeometry(0.065, 10, 10);
  const handL = new T.Mesh(handGeo, flat(T, ICE, 1)); handL.position.set(0, -0.4, 0); armL.add(handL);
  const handR = new T.Mesh(handGeo, flat(T, ICE, 1)); handR.position.set(0, -0.4, 0); armR.add(handR);
  const wheelGeo = new T.TorusGeometry(0.11, 0.045, 8, 20);
  const wheelL = new T.Mesh(wheelGeo, flat(T, 0x0f1a26, 1)); wheelL.position.set(-0.18, -0.42, 0); wheelL.rotation.y = Math.PI / 2;
  const wheelR = new T.Mesh(wheelGeo, flat(T, 0x0f1a26, 1)); wheelR.position.set(0.18, -0.42, 0); wheelR.rotation.y = Math.PI / 2;
  const axle = new T.Mesh(new T.BoxGeometry(0.42, 0.06, 0.1), flat(T, STEEL, 1)); axle.position.y = -0.42;
  const stem = new T.Mesh(new T.CylinderGeometry(0.018, 0.018, 0.22, 8), flat(T, STEEL, 1)); stem.position.set(0.14, 0.95, 0); stem.rotation.z = -0.25;
  const bulb = new T.Mesh(new T.SphereGeometry(0.05, 10, 10), flat(T, AMBER, 1)); bulb.position.set(0.17, 1.07, 0);
  bot.add(head, headRim, eyeL, eyeR, eyeGlow.pts, body, bodyEdge, chest, armL, armR, wheelL, wheelR, axle, stem, bulb);
  bot.position.set(0, -0.35, 0);
  bot.scale.setScalar(1.35);
  group.add(bot);
  // a little fish friend
  const fish = new T.Group();
  const fbody = new T.Mesh(new T.ConeGeometry(0.09, 0.28, 12), flat(T, GOLD, 1)); fbody.rotation.z = -Math.PI / 2;
  const tail = new T.Mesh(new T.ConeGeometry(0.07, 0.12, 3), flat(T, AMBER, 1)); tail.rotation.z = Math.PI / 2; tail.position.x = -0.18;
  const feye = new T.Mesh(new T.SphereGeometry(0.02, 6, 6), flat(T, NAVY, 1)); feye.position.set(0.06, 0.03, 0.07);
  fish.add(fbody, tail, feye);
  group.add(fish);
  return {
    group,
    update(t, dt) {
      for (let i = 0; i < B; i++) { let y = bub.pos[i * 3 + 1]! + bubV[i]! * dt; bub.pos[i * 3] = bub.pos[i * 3]! + 0.15 * Math.sin(t * 2 + i) * dt; if (y > 0.6) { y = -2.3; bub.pos[i * 3] = rnd(-1.8, 1.8); } bub.pos[i * 3 + 1] = y; }
      bub.attr.needsUpdate = true;
      surface.position.y = 0.68 + 0.02 * Math.sin(t * 1.8);
      bot.position.y = -0.35 + 0.07 * Math.sin(t * 1.5);
      bot.rotation.y = 0.28 * Math.sin(t * 0.6);
      armR.rotation.z = -0.4 + 0.45 * Math.sin(t * 4.2);            // waving
      armL.rotation.z = 0.25 + 0.06 * Math.sin(t * 1.5 + 1);
      const blink = (t % 3.4) < 0.16 ? 0.12 : 1;
      eyeL.scale.y = blink; eyeR.scale.y = blink;
      bulb.material.opacity = 0.6 + 0.4 * Math.sin(t * 5);
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
  return {
    group,
    update(t, dt, scene, ts) {
      rings.forEach((r, k) => { r.pts.rotation.z += dt * (2.2 + k * 0.9) * (k % 2 ? -1 : 1); r.mat.color.setHSL((t * 0.35 + k * 0.33) % 1, 0.9, 0.62); });
      spark.update(t, dt, scene, ts);
    },
    dispose: () => { spark.dispose(); disposeGroup(group); },
  };
}

export default function ShowcaseOverlay({ scene, label, onSkip }: {
  scene: ShowcaseScene;
  /** The name that assembles from particles in the finale. */
  label: string;
  /** Tap anywhere to skip the show. */
  onSkip?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ShowcaseScene>(scene);
  sceneRef.current = scene;
  const labelRef = useRef(label);
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
        hearts: buildHearts(T), confetti: buildConfetti(T), trick: buildTrick(T),
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

      const loop = (now: number) => {
        if (cancelled) return;
        const dt = Math.min(0.05, clock.getDelta());
        const s = sceneRef.current;
        if (s !== activeScene) { activeScene = s; sceneStart = now; }
        const want = s === "out" ? null : RIG_FOR[s];
        renderer.setClearColor(0x03060f, TRANSPARENT_SCENES.has(s) ? 0 : 1);
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
      style={{ background: transparent ? "transparent" : "#03060f", cursor: "none" }} />
  );
}
