#!/usr/bin/env node
/*
 * pack.mjs — build Neura into a distributable desktop app (cross-platform).
 *
 * Steps: build the API server + the frontend, stage them into this folder as
 * api-dist / frontend-dist, then run electron-builder for the chosen target.
 *
 *   node scripts/pack.mjs            # installer for the current OS
 *   node scripts/pack.mjs --win     # Windows  .exe (nsis + portable)
 *   node scripts/pack.mjs --mac     # macOS    .dmg (universal, sign/notarize via env)
 *   node scripts/pack.mjs --linux   # Linux    .AppImage + .deb
 *   node scripts/pack.mjs --dir     # unpacked app (fast, no installer — for testing)
 *   node scripts/pack.mjs --stage-only   # just build+copy artifacts (for `npm start`)
 *
 * Signing/notarization is env-driven (electron-builder reads them):
 *   Windows:  CSC_LINK, CSC_KEY_PASSWORD
 *   macOS:    CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = resolve(HERE, "..");
const REPO = resolve(ELECTRON, "..", "..");
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

function run(cmd, cwd) {
  console.log(`\n[36m▸ ${cmd}[0m  (${cwd})`);
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}
function stage(from, to) {
  if (!existsSync(from)) throw new Error(`Build output missing: ${from}`);
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`  staged → ${to}`);
}

// ── 1. Build the API server bundle (core/server/dist/index.mjs) ──────────────
run("node ./build.mjs", join(REPO, "core", "server"));

// ── 2. Build the frontend (Vite) ─────────────────────────────────────────────
run("pnpm --filter @workspace/deck-os build", REPO);

// ── 3. Stage both into the electron package ──────────────────────────────────
console.log("\n[36m▸ staging build artifacts[0m");
stage(join(REPO, "core", "server", "dist"), join(ELECTRON, "api-dist"));
const pub = join(REPO, "interfaces", "desktop", "dist", "public");
const distRoot = join(REPO, "interfaces", "desktop", "dist");
stage(existsSync(join(pub, "index.html")) ? pub : distRoot, join(ELECTRON, "frontend-dist"));

if (has("--stage-only")) { console.log("\n[32m✓ staged (skipped electron-builder)[0m"); process.exit(0); }

// ── 4. Package with electron-builder ─────────────────────────────────────────
let target = "";
if (has("--win")) target = "--win";
else if (has("--mac")) target = "--mac";
else if (has("--linux")) target = "--linux";
if (has("--dir")) target += " --dir";

run(`npx --no-install electron-builder ${target}`.trim(), ELECTRON);
console.log("\n[32m✓ done — see interfaces/electron/dist-out/[0m");
