import { useEffect, useRef } from "react";

/**
 * SurvivorOverlay — the Survivor billboard, built for the robot's 480×480
 * round faceplate. VISUAL-ONLY and FAST: two tiki torches ROARING on each side
 * of giant fire-filled text ("JEFF, SEND ME TO FIJI!") that fills the circle
 * like a billboard — in and gone in ~3 seconds; the parent then shuffles the
 * eyes through fire colors. One-shot lifecycle (mounts → runs → onDone →
 * parent unmounts), same pattern as ConnectParticles.
 *
 * Rendering is a single raw-WebGL fragment shader (no three.js — the client is
 * canvas-2D everywhere and the Pi's cold-boot bundle is a documented
 * constraint). Internal resolution is capped at 384px and CSS-upscaled — well
 * inside the Pi 4's V3D budget. Falls back to a canvas-2D version if WebGL is
 * unavailable, so the moment never dead-airs.
 *
 * Variants:
 *  - "torches": torches roar up + banner slams in together → flare out. (~3.3s)
 *  - "snuff":  center torch burns → snuffer kills it → dark beat → it ROARS
 *    back → "CAN'T SNUFF A ROBOT!" → out. (~3.8s)
 */
const DURATION: Record<"torches" | "snuff", number> = { torches: 3.3, snuff: 3.8 };

const VERT = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_variant; // 0 = torches, 1 = snuff
uniform sampler2D u_text;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// Flame intensity in flame-local space (origin at flame base, +y up), sz = scale.
float flame(vec2 p, float sz, float t, float seed){
  if (sz <= 0.003) return 0.0;
  if (abs(p.x) > 0.7 * sz || p.y < -0.06 * sz || p.y > 1.45 * sz) return 0.0;
  p /= sz;
  float n  = fbm(vec2(p.x * 3.0 + seed * 17.0, p.y * 2.2 - t * 3.4 + seed * 31.0));
  float n2 = fbm(vec2(p.x * 7.0 - seed * 7.0,  p.y * 4.6 - t * 5.2));
  p.x += (n - 0.5) * 0.42 * p.y + (n2 - 0.5) * 0.15 * p.y;
  float w = 0.20 * (1.0 - p.y * 0.62) * (0.70 + 0.55 * n);
  float body = 1.0 - smoothstep(0.0, max(w, 0.001), abs(p.x));
  float vert = smoothstep(-0.02, 0.06, p.y) * (1.0 - smoothstep(0.55, 1.3, p.y + (n - 0.5) * 0.5));
  return clamp(body * vert * (0.82 + 0.35 * n2), 0.0, 1.0);
}

vec3 fireColor(float i){
  vec3 c = vec3(0.0);
  c = mix(c, vec3(0.55, 0.06, 0.02), smoothstep(0.02, 0.25, i));
  c = mix(c, vec3(1.0, 0.42, 0.05), smoothstep(0.20, 0.55, i));
  c = mix(c, vec3(1.0, 0.80, 0.25), smoothstep(0.50, 0.80, i));
  c = mix(c, vec3(1.0, 0.97, 0.85), smoothstep(0.80, 0.97, i));
  return c;
}

float sdBox(vec2 p, vec2 b){
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float embers(vec2 q, float t, float seed){
  float acc = 0.0;
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    vec2 g = q * vec2(16.0, 9.0) + vec2(seed * 9.0, -t * (1.6 + fi * 1.0));
    vec2 id = floor(g);
    vec2 f = fract(g);
    float h = hash(id + fi * 13.7);
    vec2 c = vec2(0.25 + 0.5 * hash(id + 2.7), 0.5);
    c.x += 0.14 * sin(t * 2.4 + h * 6.28);
    float d = length((f - c) * vec2(1.0, 1.7));
    float tw = 0.5 + 0.5 * sin(t * (4.0 + h * 5.0) + h * 40.0);
    acc += (1.0 - smoothstep(0.0, 0.05 * (0.4 + h), d)) * step(0.78, h) * tw;
  }
  return acc;
}

// One ROARING torch: pole + head silhouette, tall flame, glow, embers.
vec3 torch(vec2 p, float x, float sz, float scale, float t, float seed){
  vec3 col = vec3(0.0);
  vec2 base = vec2(x, -0.06);
  float pole = sdBox(p - vec2(x, -0.24), vec2(0.011, 0.16));
  float head = sdBox(p - vec2(x, -0.09), vec2(0.026, 0.034));
  float wood = min(pole, head);
  if (wood < 0.0) col = vec3(0.06, 0.038, 0.022) * (1.0 + 10.0 * abs(wood));
  float fl = flame(p - base, sz, t, seed) * min(scale * 1.25, 1.35);
  fl = min(fl, 1.0);
  col += fireColor(fl) * step(0.001, scale);
  vec2 gc = base + vec2(0.0, 0.4 * sz * scale);
  float g = scale / (1.0 + 34.0 * dot(p - gc, p - gc));
  col += vec3(1.0, 0.45, 0.12) * g * 0.4;
  if (scale > 0.2 && p.y > base.y && abs(p.x - x) < 0.18) {
    float em = embers((p - base) * vec2(1.0, 0.8), t, seed);
    em *= (1.0 - smoothstep(0.15, 0.6, p.y - base.y)) * scale;
    col += vec3(1.0, 0.55, 0.15) * em * 0.9;
  }
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 asp = vec2(u_res.x / u_res.y, 1.0);
  vec2 p = (uv - 0.5) * asp;
  float t = u_t;

  float durTot = mix(3.3, 3.8, u_variant);
  float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(durTot - 0.32, durTot - 0.03, t));

  // night backdrop, warm at the horizon
  vec3 col = mix(vec3(0.028, 0.038, 0.085), vec3(0.010, 0.012, 0.035), smoothstep(-0.3, 0.5, p.y));

  float tp = 0.0; // banner presence

  if (u_variant < 0.5) {
    // ── BILLBOARD: torches roar up both sides, banner slams in the middle ───
    float roar = 1.0 + 0.09 * sin(t * 3.1) + 0.05 * sin(t * 7.3);
    float flare = 1.0 + 0.5 * smoothstep(2.65, 2.95, t);
    float s1 = smoothstep(0.10, 0.38, t) * (1.0 + 0.35 * exp(-max(t - 0.38, 0.0) * 4.0)) * roar * flare;
    float s2 = smoothstep(0.18, 0.46, t) * (1.0 + 0.35 * exp(-max(t - 0.46, 0.0) * 4.0)) * roar * flare;
    col += torch(p, -0.37, 0.30, s1, t, 0.31);
    col += torch(p,  0.37, 0.30, s2, t + 1.7, 0.83);
    col += vec3(1.0, 0.6, 0.2) * 0.45 * exp(-abs(t - 0.32) * 7.0); // ignition flash
    tp = smoothstep(0.45, 0.62, t) * (1.0 - smoothstep(2.85, 3.12, t));
  } else {
    // ── SNUFF & RELIGHT, fast cut ───────────────────────────────────────────
    float roar = 1.0 + 0.09 * sin(t * 3.1);
    float ignite = smoothstep(0.12, 0.42, t) * (1.0 + 0.3 * exp(-max(t - 0.42, 0.0) * 4.0));
    float dieOff = 1.0 - smoothstep(1.15, 1.5, t);
    float rl = smoothstep(1.95, 2.15, t);
    float spring = 1.0 + 0.6 * exp(-max(t - 2.05, 0.0) * 3.5) * sin(max(t - 2.05, 0.0) * 12.0);
    float scale = (ignite * dieOff + rl * 1.25 * spring) * roar;
    col += torch(p, 0.0, 0.36, scale, t, 0.57);
    // snuffer cone drops in and out fast
    float coneY = mix(0.6, 0.02, smoothstep(0.95, 1.3, t)) + mix(0.0, 0.7, smoothstep(1.55, 2.0, t));
    float ch = clamp((p.y - coneY) / 0.16, 0.0, 1.0);
    float cone = step(abs(p.x), mix(0.065, 0.018, ch)) * step(coneY, p.y) * step(p.y, coneY + 0.16);
    float snuffer = cone * smoothstep(0.9, 1.0, t) * (1.0 - smoothstep(2.0, 2.2, t));
    col = mix(col, vec3(0.012, 0.012, 0.018), snuffer);
    // ember pulse in the dark beat, then the relight flash
    float beat = smoothstep(1.5, 1.6, t) * (1.0 - smoothstep(1.9, 2.0, t));
    col += vec3(1.0, 0.35, 0.08) * beat * (0.4 + 0.3 * sin(t * 12.0)) / (1.0 + 600.0 * dot(p - vec2(0.0, -0.05), p - vec2(0.0, -0.05)));
    col += vec3(1.0, 0.75, 0.4) * 0.6 * exp(-abs(t - 2.1) * 6.0) * step(1.95, t);
    col *= 1.0 - 0.5 * smoothstep(1.35, 1.55, t) * (1.0 - smoothstep(1.95, 2.15, t));
    tp = smoothstep(2.15, 2.32, t) * (1.0 - smoothstep(3.35, 3.6, t));
  }

  // ── THE BANNER: giant fire text FILLING the circle between the torches ────
  if (tp > 0.001) {
    col *= 1.0 - 0.30 * tp; // pop the words; the torches keep roaring beside them
    float e = max(t - mix(0.45, 2.15, u_variant), 0.0);
    float s = 1.0 + 2.6 * exp(-e * 10.0); // fast slam from huge
    vec2 q = p / s;
    q.x += q.y * 0.06 * sin(t * 1.4);           // subtle billboard wobble
    q.x *= 1.0 + q.y * 0.10;                     // slight perspective tilt
    vec2 tuv = q / vec2(0.56, 0.60) + 0.5;       // text plane fills the circle
    tuv += (vec2(fbm(tuv * 7.0 + t * 1.6), fbm(tuv * 7.0 - t * 1.4)) - 0.5) * 0.012;
    float m = 0.0;
    float glo = 0.0;
    if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
      vec2 tc = vec2(tuv.x, 1.0 - tuv.y);
      m = texture2D(u_text, tc).r;
      glo = texture2D(u_text, clamp(tc + vec2( 0.010, 0.0), 0.0, 1.0)).r
          + texture2D(u_text, clamp(tc + vec2(-0.010, 0.0), 0.0, 1.0)).r
          + texture2D(u_text, clamp(tc + vec2(0.0,  0.012), 0.0, 1.0)).r
          + texture2D(u_text, clamp(tc + vec2(0.0, -0.012), 0.0, 1.0)).r;
    }
    vec3 fill = fireColor(0.48 + 0.5 * fbm(q * vec2(3.0, 5.0) + vec2(0.0, -t * 2.4)));
    col += fill * m * tp * 1.35;
    col += vec3(1.0, 0.45, 0.10) * glo * 0.11 * tp;   // bloom
    col += vec3(1.0, 0.5, 0.15) * embers(p * 1.3, t, 0.45) * 0.35 * tp;
    col += vec3(1.0, 0.8, 0.5) * 0.5 * exp(-e * 9.0) * tp; // slam flash
  }

  // round-bezel vignette
  col *= 1.0 - smoothstep(0.42, 0.62, length(p)) * 0.8;
  gl_FragColor = vec4(col * fade, 1.0);
}
`;

/**
 * Billboard text: wrap into short stacked lines and maximize the font so the
 * block FILLS a square texture (the shader maps it across the round screen).
 */
function makeBannerCanvas(banner: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 1024;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = banner.trim().toUpperCase().split(/\s+/);
  const font = (px: number) => `900 ${px}px "Arial Black", Impact, system-ui, sans-serif`;
  let best: { size: number; lines: string[] } = { size: 80, lines: [banner.toUpperCase()] };
  for (let size = 300; size >= 80; size -= 10) {
    ctx.font = font(size);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const probe = cur ? cur + " " + w : w;
      if (ctx.measureText(probe).width > 920 && cur) { lines.push(cur); cur = w; }
      else cur = probe;
    }
    if (cur) lines.push(cur);
    const fits = lines.length <= 4 && lines.every((l) => ctx.measureText(l).width <= 920)
      && lines.length * size * 1.1 <= 940;
    if (fits) { best = { size, lines }; break; }
  }
  ctx.font = font(best.size);
  const lh = best.size * 1.1;
  const y0 = 512 - ((best.lines.length - 1) * lh) / 2;
  best.lines.forEach((l, i) => ctx.fillText(l, 512, y0 + i * lh));
  return c;
}

/** Canvas-2D emergency fallback: gradient flames + the billboard, same beats. */
function drawFallback(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, variant: "torches" | "snuff", banner: string) {
  const dur = DURATION[variant];
  const fade = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - (dur - 0.32)) / 0.29));
  ctx.fillStyle = "#05070f";
  ctx.fillRect(0, 0, w, h);
  const xs = variant === "torches" ? [0.13, 0.87] : [0.5];
  xs.forEach((fx, i) => {
    let s = Math.min(1, Math.max(0, (t - 0.1 - i * 0.08) / 0.3));
    if (variant === "snuff") {
      if (t > 1.15) s *= Math.max(0, 1 - (t - 1.15) / 0.35);
      if (t > 1.95) s = Math.min(1.25, (t - 1.95) / 0.2) * 1.2;
    }
    const flick = 0.82 + 0.18 * Math.sin(t * 13 + i * 2.7) * Math.sin(t * 8.3 + i);
    const cx = fx * w, cy = h * 0.55, r = h * 0.2 * s * flick;
    ctx.fillStyle = "#120b06";
    ctx.fillRect(cx - w * 0.008, cy, w * 0.016, h * 0.3);
    if (r > 1) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(255,245,200,${0.95 * fade})`);
      g.addColorStop(0.35, `rgba(255,160,40,${0.8 * fade})`);
      g.addColorStop(0.75, `rgba(200,50,10,${0.35 * fade})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy - r * 0.35, r * 0.5, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const textIn = variant === "torches" ? 0.45 : 2.15;
  if (t > textIn) {
    const e = t - textIn;
    const tp = Math.min(1, e / 0.17) * (1 - Math.max(0, (t - (dur - 0.45)) / 0.3));
    const s = 1 + 2.6 * Math.exp(-e * 10);
    ctx.save();
    ctx.globalAlpha = Math.max(0, tp);
    ctx.translate(w / 2, h / 2);
    ctx.scale(1 / s, 1 / s);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const words = banner.toUpperCase().split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    ctx.font = `900 ${Math.round(h * 0.16)}px "Arial Black", Impact, sans-serif`;
    for (const wd of words) {
      const probe = cur ? cur + " " + wd : wd;
      if (ctx.measureText(probe).width > w * 0.62 && cur) { lines.push(cur); cur = wd; }
      else cur = probe;
    }
    if (cur) lines.push(cur);
    const lh = h * 0.18;
    const y0 = -((lines.length - 1) * lh) / 2;
    const grad = ctx.createLinearGradient(0, -h * 0.3, 0, h * 0.3);
    grad.addColorStop(0, "#ffe89a");
    grad.addColorStop(0.5, "#ff8a00");
    grad.addColorStop(1, "#e03410");
    ctx.fillStyle = grad;
    ctx.shadowColor = "rgba(255,130,20,0.9)";
    ctx.shadowBlur = 24;
    lines.forEach((l, i) => ctx.fillText(l, 0, y0 + i * lh));
    ctx.restore();
  }
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - fade)})`;
  ctx.fillRect(0, 0, w, h);
}

export default function SurvivorOverlay({ variant, banner, onDone }: {
  variant: "torches" | "snuff";
  banner: string;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // PetShell re-renders constantly — keep the callback in a ref so the effect
  // never re-runs mid-show (same pattern as YouTubeOverlay).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const bannerRef = useRef(banner);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Cap internal resolution for the Pi's V3D GPU; CSS upscales the rest.
    const scale = Math.min(1, 384 / Math.max(canvas.clientWidth, canvas.clientHeight, 1));
    const w = (canvas.width = Math.max(2, Math.round(canvas.clientWidth * scale)));
    const h = (canvas.height = Math.max(2, Math.round(canvas.clientHeight * scale)));

    let raf = 0;
    let done = false;
    const start = performance.now();
    const finish = () => {
      if (done) return;
      done = true;
      onDoneRef.current();
    };

    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });
    let cleanupGl: (() => void) | null = null;

    if (gl) {
      const mk = (type: number, src: string) => {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      };
      const vs = mk(gl.VERTEX_SHADER, VERT);
      const fs = mk(gl.FRAGMENT_SHADER, FRAG);
      const prog = vs && fs ? gl.createProgram() : null;
      if (prog && vs && fs) {
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
      }
      if (prog && gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, "a");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.viewport(0, 0, w, h);
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeBannerCanvas(bannerRef.current));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform2f(gl.getUniformLocation(prog, "u_res"), w, h);
        gl.uniform1f(gl.getUniformLocation(prog, "u_variant"), variant === "snuff" ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(prog, "u_text"), 0);
        const uT = gl.getUniformLocation(prog, "u_t");
        const loop = (now: number) => {
          const t = (now - start) / 1000;
          if (t >= DURATION[variant]) { finish(); return; }
          gl.uniform1f(uT, t);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        cleanupGl = () => {
          gl.getExtension("WEBGL_lose_context")?.loseContext();
        };
      }
    }

    if (!cleanupGl) {
      // WebGL unavailable or failed to compile — 2D fallback, never dead-air.
      const ctx = canvas.getContext("2d");
      if (!ctx) { finish(); return; }
      const loop = (now: number) => {
        const t = (now - start) / 1000;
        if (t >= DURATION[variant]) { finish(); return; }
        drawFallback(ctx, w, h, t, variant, bannerRef.current);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      cleanupGl?.();
    };
  }, [variant]);

  return (
    <div className="fixed inset-0 z-[110] bg-black">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
