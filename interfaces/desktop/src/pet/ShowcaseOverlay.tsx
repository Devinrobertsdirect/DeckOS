import { useEffect, useRef } from "react";
import type * as THREE from "three";

/**
 * ShowcaseOverlay — the flashy "quick demo" visual layer for the robot's
 * 480×480 round face. Five Three.js scenes, crossfaded, driven by the `scene`
 * prop from PetShell's showcase runner (which also narrates + moves the eyes):
 *
 *   boot   — a nebula of particles gathers into a glowing core with orbit rings
 *   core   — a wireframe neural core: pulsing nodes + signals racing the edges
 *   faces  — TRANSPARENT: a ring of emotion-orbs circles the rim while the real
 *            face engine underneath tours its expressions
 *   orbit  — a low-poly planet with three satellites on tilted orbits
 *   finale — a starfield warp, then the bot's name assembles from particles and
 *            bursts apart
 *   out    — everything fades; the parent unmounts on the next beat
 *
 * three.js is `import()`ed on mount so it lives in its own chunk — the robot's
 * cold-boot bundle (a documented constraint) never pays for it. Pixel ratio is
 * pinned to 1 and every scene stays under ~6k vertices, well inside the Pi 4's
 * V3D budget. If WebGL or the chunk fails, the overlay stays quietly transparent
 * and the narrated demo still plays on the face — it never dead-airs.
 */
export type ShowcaseScene = "boot" | "core" | "faces" | "orbit" | "finale" | "out";

type ThreeMod = typeof import("three");

interface Rig {
  group: THREE.Group;
  /** Called every frame while visible; t = seconds since this scene became active. */
  update: (t: number, dt: number) => void;
  dispose: () => void;
}

const ICE = 0xc9dcf0, STEEL = 0x4a7fb5, NAVY = 0x1e2a38, AMBER = 0xe0a64b, GOLD = 0xf5b83d;
const ROSE = 0xff8fb0, VIOLET = 0xb14aff, MINT = 0x5ce0b8;
const FADE_S = 0.7;

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeInOut = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2; };
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

function disposeGroup(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.dispose();
  });
}

function points(T: ThreeMod, count: number, color: number, size: number, opacity = 0.9): { pts: THREE.Points; pos: Float32Array; attr: THREE.BufferAttribute } {
  const pos = new Float32Array(count * 3);
  const geo = new T.BufferGeometry();
  const attr = new T.BufferAttribute(pos, 3);
  geo.setAttribute("position", attr);
  const mat = new T.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });
  return { pts: new T.Points(geo, mat), pos, attr };
}

/** Evenly spread directions on a sphere (fibonacci). */
function fib(i: number, n: number): [number, number, number] {
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * 2.399963;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
}

// ── boot: nebula gathers into a glowing core ─────────────────────────────────
function buildBoot(T: ThreeMod): Rig {
  const group = new T.Group();
  const N = 2200;
  const { pts, pos, attr } = points(T, N, ICE, 0.032, 0.85);
  const start = new Float32Array(N * 3), target = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const d = fib(i, N), rs = rnd(1.6, 3.6), rt = 1.05 + rnd(-0.03, 0.03);
    const j = [rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(-0.4, 0.4)];
    start.set([d[0] * rs + j[0], d[1] * rs + j[1], d[2] * rs + j[2]], i * 3);
    target.set([d[0] * rt, d[1] * rt, d[2] * rt], i * 3);
    pos.set([start[i * 3]!, start[i * 3 + 1]!, start[i * 3 + 2]!], i * 3);
  }
  group.add(pts);
  const core = new T.Mesh(new T.IcosahedronGeometry(0.62, 1), new T.MeshBasicMaterial({ color: STEEL, wireframe: true, transparent: true, opacity: 0.9 }));
  const glow = new T.Mesh(new T.IcosahedronGeometry(0.5, 2), new T.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.28, blending: T.AdditiveBlending, depthWrite: false }));
  const ringMat = () => new T.MeshBasicMaterial({ color: STEEL, transparent: true, opacity: 0.85 });
  const ring1 = new T.Mesh(new T.TorusGeometry(1.38, 0.012, 8, 110), ringMat());
  const ring2 = new T.Mesh(new T.TorusGeometry(1.62, 0.009, 8, 110), ringMat());
  ring1.rotation.x = 1.2; ring2.rotation.x = 0.4; ring2.rotation.y = 0.9;
  core.scale.setScalar(0.001); glow.scale.setScalar(0.001); ring1.scale.setScalar(0.001); ring2.scale.setScalar(0.001);
  group.add(core, glow, ring1, ring2);
  return {
    group,
    update(t, dt) {
      const k = easeInOut(t / 4.6);
      const breathe = 1 + 0.02 * Math.sin(t * 1.6);
      for (let i = 0; i < N; i++) {
        const sw = (1 - k) * 0.35 * Math.sin(t * 0.9 + i * 0.013);
        const b = i * 3;
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
  const shell = new T.Mesh(geo, new T.MeshBasicMaterial({ color: STEEL, wireframe: true, transparent: true, opacity: 0.55 }));
  group.add(shell);
  // unique vertices → nodes
  const raw = geo.getAttribute("position") as THREE.BufferAttribute;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < raw.count; i++) {
    const x = raw.getX(i), y = raw.getY(i), z = raw.getZ(i);
    seen.set(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`, [x, y, z]);
  }
  const verts = [...seen.values()];
  const nodes = points(T, verts.length, ICE, 0.075, 0.95);
  verts.forEach((v, i) => nodes.pos.set(v, i * 3));
  nodes.attr.needsUpdate = true;
  group.add(nodes.pts);
  // signals travel between random vertex pairs
  const S = 70;
  const sig = points(T, S, GOLD, 0.055, 1);
  const pairs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < S; i++) pairs.push([Math.floor(Math.random() * verts.length), Math.floor(Math.random() * verts.length), Math.random(), rnd(0.25, 0.6)]);
  group.add(sig.pts);
  // distant stars
  const stars = points(T, 700, ICE, 0.02, 0.5);
  for (let i = 0; i < 700; i++) { const d = fib(i, 700), r = rnd(6, 9); stars.pos.set([d[0] * r, d[1] * r, d[2] * r], i * 3); }
  stars.attr.needsUpdate = true;
  group.add(stars.pts);
  return {
    group,
    update(t, dt) {
      (nodes.pts.material as THREE.PointsMaterial).size = 0.065 + 0.02 * Math.sin(t * 2.4);
      for (let i = 0; i < S; i++) {
        const [a, b, ph, sp] = pairs[i]!;
        const f = (t * sp + ph) % 1;
        const va = verts[a]!, vb = verts[b]!;
        sig.pos[i * 3] = va[0] + (vb[0] - va[0]) * f;
        sig.pos[i * 3 + 1] = va[1] + (vb[1] - va[1]) * f;
        sig.pos[i * 3 + 2] = va[2] + (vb[2] - va[2]) * f;
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
  const orbs: THREE.Mesh[] = colors.map((c) => {
    const m = new T.Mesh(new T.SphereGeometry(0.075, 10, 10), new T.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
    group.add(m);
    return m;
  });
  const haloPts = points(T, colors.length, ICE, 0.32, 0.35);
  group.add(haloPts.pts);
  const circ = new T.LineLoop(
    new T.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new T.Vector3(Math.cos(i / 128 * Math.PI * 2) * 2.12, Math.sin(i / 128 * Math.PI * 2) * 2.12, 0))),
    new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.35 }),
  );
  group.add(circ);
  return {
    group,
    update(t, dt) {
      const R = 2.0;
      orbs.forEach((o, i) => {
        const a = t * 0.38 + (i / orbs.length) * Math.PI * 2;
        o.position.set(Math.cos(a) * R, Math.sin(a) * R, 0.15 * Math.sin(t * 2 + i));
        o.scale.setScalar(1 + 0.25 * Math.sin(t * 3 + i * 1.7));
        haloPts.pos.set([o.position.x, o.position.y, o.position.z], i * 3);
      });
      haloPts.attr.needsUpdate = true;
      circ.rotation.z -= dt * 0.1;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── orbit: a small planet, three satellites on tilted orbits ─────────────────
function buildOrbit(T: ThreeMod): Rig {
  const group = new T.Group();
  const planet = new T.Mesh(new T.IcosahedronGeometry(0.72, 1), new T.MeshBasicMaterial({ color: NAVY, transparent: true, opacity: 1 }));
  const wire = new T.Mesh(new T.IcosahedronGeometry(0.728, 1), new T.MeshBasicMaterial({ color: STEEL, wireframe: true, transparent: true, opacity: 0.9 }));
  const atmo = new T.Mesh(new T.SphereGeometry(0.86, 18, 18), new T.MeshBasicMaterial({ color: ICE, transparent: true, opacity: 0.1, blending: T.AdditiveBlending, depthWrite: false }));
  group.add(planet, wire, atmo);
  const orbits: Array<{ line: THREE.LineLoop; rx: number; ry: number; tilt: THREE.Euler }> = [];
  const sats: Array<{ mesh: THREE.Mesh; i: number; speed: number; phase: number }> = [];
  const specs: Array<[number, number, number, number, number, number]> = [[1.35, 1.05, 0.9, 0.2, AMBER, 0.9], [1.7, 1.3, -0.6, 0.7, ICE, 0.6], [2.0, 1.55, 0.3, -0.9, GOLD, 0.42]];
  specs.forEach(([rx, ry, ex, ez, col, speed], i) => {
    const ptsArr = Array.from({ length: 128 }, (_, k) => new T.Vector3(Math.cos(k / 128 * Math.PI * 2) * rx, 0, Math.sin(k / 128 * Math.PI * 2) * ry));
    const line = new T.LineLoop(new T.BufferGeometry().setFromPoints(ptsArr), new T.LineBasicMaterial({ color: STEEL, transparent: true, opacity: 0.45 }));
    const tilt = new T.Euler(ex, 0, ez);
    line.rotation.copy(tilt);
    group.add(line);
    orbits.push({ line, rx, ry, tilt });
    const mesh = new T.Mesh(new T.OctahedronGeometry(0.09), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 1 }));
    group.add(mesh);
    sats.push({ mesh, i, speed, phase: Math.random() * 6.28 });
  });
  const tmp = new T.Vector3();
  return {
    group,
    update(t, dt) {
      planet.rotation.y += dt * 0.25; wire.rotation.y += dt * 0.25;
      atmo.scale.setScalar(1 + 0.03 * Math.sin(t * 1.3));
      for (const s of sats) {
        const o = orbits[s.i]!;
        const a = t * s.speed + s.phase;
        tmp.set(Math.cos(a) * o.rx, 0, Math.sin(a) * o.ry).applyEuler(o.tilt);
        s.mesh.position.copy(tmp);
        s.mesh.rotation.x += dt * 2; s.mesh.rotation.y += dt * 1.5;
      }
      group.rotation.y = 0.15 * Math.sin(t * 0.3);
      group.rotation.x = 0.25;
    },
    dispose: () => disposeGroup(group),
  };
}

// ── finale: warp, then the name assembles from particles and bursts ──────────
function sampleLabel(label: string): Array<[number, number]> {
  const c = document.createElement("canvas");
  c.width = 360; c.height = 130;
  const g = c.getContext("2d");
  if (!g) return [];
  g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  let px = 104;
  do { g.font = `900 ${px}px "Arial Black", Impact, system-ui, sans-serif`; px -= 6; } while (g.measureText(label).width > 330 && px > 30);
  g.fillText(label, 180, 66);
  const img = g.getImageData(0, 0, c.width, c.height).data;
  const out: Array<[number, number]> = [];
  for (let y = 0; y < c.height; y += 3) for (let x = 0; x < c.width; x += 3) {
    if (img[(y * c.width + x) * 4]! > 128) out.push([(x - 180) / 95, -(y - 66) / 95]);
  }
  return out;
}

function buildFinale(T: ThreeMod, label: string): Rig {
  const group = new T.Group();
  const W = 1400;
  const warp = points(T, W, ICE, 0.028, 0.9);
  for (let i = 0; i < W; i++) warp.pos.set([rnd(-3.2, 3.2), rnd(-3.2, 3.2), rnd(-14, 2)], i * 3);
  warp.attr.needsUpdate = true;
  group.add(warp.pts);
  const targets = sampleLabel(label);
  const N = Math.min(1800, targets.length);
  const name = points(T, N, GOLD, 0.045, 0);
  const from = new Float32Array(N * 3), dir = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const d = fib((i * 7919) % N, N), r = rnd(2.5, 4);
    from.set([d[0] * r, d[1] * r, d[2] * r - 1], i * 3);
    dir.set([rnd(-1, 1), rnd(-1, 1), rnd(-0.5, 1.5)], i * 3);
    name.pos.set([from[i * 3]!, from[i * 3 + 1]!, from[i * 3 + 2]!], i * 3);
  }
  name.attr.needsUpdate = true;
  group.add(name.pts);
  const IN = 4.5, HOLD = 7.4, BURST = 11.6, GONE = 13.6;
  return {
    group,
    update(t, dt) {
      const speed = 2 + 12 * easeInOut(t / 3.2);
      const wm = warp.pts.material as THREE.PointsMaterial;
      wm.opacity = 0.9 * (1 - easeInOut((t - 7.5) / 2));
      for (let i = 0; i < W; i++) {
        let z = warp.pos[i * 3 + 2]! + speed * dt;
        if (z > 3) z -= 16;
        warp.pos[i * 3 + 2] = z;
      }
      warp.attr.needsUpdate = true;
      const nm = name.pts.material as THREE.PointsMaterial;
      if (t < IN) { nm.opacity = 0; }
      else if (t < HOLD) {
        const k = easeOut((t - IN) / (HOLD - IN));
        nm.opacity = Math.min(1, k * 1.4);
        for (let i = 0; i < N; i++) {
          const tg = targets[i]!, b = i * 3;
          name.pos[b] = from[b]! + (tg[0] - from[b]!) * k;
          name.pos[b + 1] = from[b + 1]! + (tg[1] - from[b + 1]!) * k;
          name.pos[b + 2] = from[b + 2]! * (1 - k);
        }
        name.attr.needsUpdate = true;
      } else if (t < BURST) {
        nm.opacity = 1; nm.size = 0.045 + 0.012 * Math.sin(t * 6);
        for (let i = 0; i < N; i++) { const tg = targets[i]!, b = i * 3; name.pos[b] = tg[0] + 0.012 * Math.sin(t * 5 + i); name.pos[b + 1] = tg[1] + 0.012 * Math.cos(t * 4 + i * 0.7); name.pos[b + 2] = 0; }
        name.attr.needsUpdate = true;
      } else {
        const k = (t - BURST) / (GONE - BURST);
        nm.opacity = Math.max(0, 1 - k);
        const v = 3.5 * dt;
        for (let i = 0; i < N; i++) { const b = i * 3; name.pos[b] += dir[b]! * v; name.pos[b + 1] += dir[b + 1]! * v; name.pos[b + 2] += dir[b + 2]! * v; }
        name.attr.needsUpdate = true;
      }
    },
    dispose: () => disposeGroup(group),
  };
}

export default function ShowcaseOverlay({ scene, label, onSkip }: {
  scene: ShowcaseScene;
  /** The name that assembles from particles in the finale. */
  label: string;
  /** Tap anywhere to skip the demo. */
  onSkip?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ShowcaseScene>(scene);
  sceneRef.current = scene;
  const labelRef = useRef(label);
  const transparent = scene === "faces" || scene === "out";

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
      try {
        renderer = new T.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
      } catch { return; }
      renderer.setPixelRatio(1);
      const size = () => Math.min(window.innerWidth, window.innerHeight);
      const fit = () => { const s = size(); renderer.setSize(s, s, false); renderer.domElement.style.width = `${s}px`; renderer.domElement.style.height = `${s}px`; };
      fit();
      host.appendChild(renderer.domElement);
      const camera = new T.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(0, 0, 4.3);
      const world = new T.Scene();
      const rigs: Record<Exclude<ShowcaseScene, "out">, Rig> = {
        boot: buildBoot(T), core: buildCore(T), faces: buildFaces(T), orbit: buildOrbit(T), finale: buildFinale(T, labelRef.current),
      };
      const alpha: Record<string, number> = {};
      for (const k of Object.keys(rigs) as Array<keyof typeof rigs>) { world.add(rigs[k].group); rigs[k].group.visible = false; alpha[k] = 0; }
      const started: Record<string, number> = {};
      let active: ShowcaseScene | null = null;
      const clock = new T.Clock();
      let t0 = performance.now();
      window.addEventListener("resize", fit);

      const loop = (now: number) => {
        if (cancelled) return;
        const dt = Math.min(0.05, clock.getDelta());
        const s = sceneRef.current;
        if (s !== active) { active = s; if (s !== "out" && started[s] === undefined) started[s] = now; }
        renderer.setClearColor(0x03060f, (s === "faces" || s === "out") ? 0 : 1);
        for (const k of Object.keys(rigs) as Array<keyof typeof rigs>) {
          const want = k === s ? 1 : 0;
          const a = alpha[k]!;
          const next = a + Math.sign(want - a) * Math.min(Math.abs(want - a), dt / FADE_S);
          alpha[k] = next;
          const g = rigs[k].group;
          g.visible = next > 0.001;
          if (g.visible) {
            setAlpha(g, next);
            rigs[k].update((now - (started[k] ?? now)) / 1000, dt);
          }
        }
        const tt = (now - t0) / 1000;
        camera.position.x = Math.sin(tt * 0.22) * 0.18;
        camera.position.y = Math.cos(tt * 0.17) * 0.12;
        camera.lookAt(0, 0, 0);
        renderer.render(world, camera);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        window.removeEventListener("resize", fit);
        cancelAnimationFrame(raf);
        for (const k of Object.keys(rigs) as Array<keyof typeof rigs>) rigs[k].dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
    })();

    return () => { cancelled = true; cleanup?.(); };
  }, []);

  return (
    <div
      ref={hostRef}
      onClick={onSkip}
      role="presentation"
      className="fixed inset-0 z-[110] flex items-center justify-center transition-colors duration-700"
      style={{ background: transparent ? "transparent" : "#03060f", cursor: "none" }}
    />
  );
}
