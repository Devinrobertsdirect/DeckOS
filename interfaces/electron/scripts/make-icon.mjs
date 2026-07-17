#!/usr/bin/env node
/*
 * make-icon.mjs — generate the Neura app icon from the brand, in pure Node.
 *
 * Draws the face exactly per the design language — smoked-navy disc (#1E2A38
 * family), two ice-blue (#C9DCF0) stadium eyes with a soft glow, subtle rim —
 * and writes real PNGs with a built-in encoder (no native deps). Rendering is
 * SDF-based so edges are properly anti-aliased at any size.
 *
 * Outputs:
 *   interfaces/electron/build/icon.png     1024×1024  (electron-builder → .ico/.icns)
 *   interfaces/desktop/public/logo.png      512×512   (web app icon)
 *   interfaces/desktop/public/favicon.svg   vector    (crisp browser favicon)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = resolve(HERE, "..");
const DESKTOP_PUB = resolve(ELECTRON, "..", "desktop", "public");

// ── minimal PNG encoder (RGBA8) ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── the face, rendered via signed-distance fields ────────────────────────────
const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const lerp = (a, b, t) => a + (b - a) * t;
/** SDF of a vertical stadium (rounded capsule) centred at (cx,cy). */
function stadiumSd(px, py, cx, cy, halfW, halfH) {
  const seg = halfH - halfW; // vertical core segment half-length
  const qy = clamp(py - cy, -seg, seg);
  const dx = px - cx, dy = py - cy - qy;
  return Math.hypot(dx, dy) - halfW;
}
function renderFace(size) {
  const c = size / 2;
  const R = size * 0.46;             // disc radius
  const eyeDx = R * 0.30;            // eye offset from centre
  const eyeHW = R * 0.105;           // eye half-width
  const eyeHH = R * 0.24;            // eye half-height
  const eyeY = c - R * 0.045;        // eyes sit a touch high
  const rim = Math.max(2, size * 0.008);
  const glowLen = R * 0.16;

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const dc = Math.hypot(px - c, py - c);
      const discSd = dc - R;
      let r = 0, g = 0, b = 0, a = 0;

      // disc: vertical navy gradient (#24344A → #151E2A), soft inner vignette
      const cov = clamp(0.5 - discSd, 0, 1);
      if (cov > 0) {
        const ty = clamp((py - (c - R)) / (2 * R), 0, 1);
        r = lerp(0x24, 0x15, ty); g = lerp(0x34, 0x1e, ty); b = lerp(0x4a, 0x2a, ty);
        const vin = 1 - 0.18 * clamp((dc / R - 0.55) / 0.45, 0, 1); // edge darkening
        r *= vin; g *= vin; b *= vin;
        a = cov;
      }
      // rim light: thin ice stroke just inside the edge
      const rimSd = Math.abs(discSd + rim) - rim;
      const rimCov = clamp(0.5 - rimSd, 0, 1) * 0.22 * (a > 0 ? 1 : 0);
      if (rimCov > 0) { r = lerp(r, 0xc9, rimCov); g = lerp(g, 0xdc, rimCov); b = lerp(b, 0xf0, rimCov); }

      // eyes: two ice stadiums + glow, clipped to the disc
      if (a > 0) {
        const sd = Math.min(
          stadiumSd(px, py, c - eyeDx, eyeY, eyeHW, eyeHH),
          stadiumSd(px, py, c + eyeDx, eyeY, eyeHW, eyeHH),
        );
        const glow = sd > 0 ? Math.exp(-sd / glowLen) * 0.28 : 0;
        if (glow > 0.003) { r = lerp(r, 0xc9, glow); g = lerp(g, 0xdc, glow); b = lerp(b, 0xf0, glow); }
        const eye = clamp(0.5 - sd, 0, 1);
        if (eye > 0) { r = lerp(r, 0xc9, eye); g = lerp(g, 0xdc, eye); b = lerp(b, 0xf0, eye); }
      }

      const i = (y * size + x) * 4;
      buf[i] = Math.round(r); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(b);
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

// ── emit ─────────────────────────────────────────────────────────────────────
function writePng(path, size) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(renderFace(size), size, size));
  console.log(`  ✓ ${path} (${size}×${size})`);
}
writePng(join(ELECTRON, "build", "icon.png"), 1024);
writePng(join(DESKTOP_PUB, "logo.png"), 512);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#24344A"/><stop offset="1" stop-color="#151E2A"/>
  </linearGradient></defs>
  <circle cx="50" cy="50" r="46" fill="url(#d)" stroke="#C9DCF0" stroke-opacity=".25" stroke-width="1.6"/>
  <rect x="30.7" y="34.4" width="9.6" height="22" rx="4.8" fill="#C9DCF0"/>
  <rect x="59.7" y="34.4" width="9.6" height="22" rx="4.8" fill="#C9DCF0"/>
</svg>\n`;
writeFileSync(join(DESKTOP_PUB, "favicon.svg"), svg);
console.log(`  ✓ ${join(DESKTOP_PUB, "favicon.svg")} (vector)`);
console.log("Neura icons generated.");
