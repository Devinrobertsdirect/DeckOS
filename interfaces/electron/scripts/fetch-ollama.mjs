#!/usr/bin/env node
/*
 * fetch-ollama.mjs — download the Ollama runtime for THIS platform into
 * interfaces/electron/vendor/ollama/, so electron-builder can ship it as a
 * sidecar (resources/ollama). Run before packaging:  node scripts/fetch-ollama.mjs
 *
 * The binary is large (100s of MB) and platform-specific, so it is NOT committed
 * — this script fetches it on the build machine / CI. If you skip it, the app
 * still builds and falls back to a system-installed Ollama (or cloud/rule-engine).
 *
 *   NEURA_OLLAMA_VERSION=v0.x.x  → pin a release (default: latest)
 */
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import https from "node:https";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "vendor", "ollama");
const VERSION = process.env.NEURA_OLLAMA_VERSION || "latest";

const ASSET = {
  win32: "ollama-windows-amd64.zip",
  linux: process.arch === "arm64" ? "ollama-linux-arm64.tgz" : "ollama-linux-amd64.tgz",
  darwin: "ollama-darwin.tgz",
}[process.platform];

if (!ASSET) {
  console.error(`[fetch-ollama] unsupported platform: ${process.platform}`);
  process.exit(1);
}

const base =
  VERSION === "latest"
    ? "https://github.com/ollama/ollama/releases/latest/download"
    : `https://github.com/ollama/ollama/releases/download/${VERSION}`;
const url = `${base}/${ASSET}`;

function download(u, dest, redirects = 0) {
  return new Promise((res, rej) => {
    if (redirects > 6) return rej(new Error("too many redirects"));
    https
      .get(u, { headers: { "User-Agent": "neura-build" } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          return res(download(r.headers.location, dest, redirects + 1));
        }
        if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode} for ${u}`));
        const f = createWriteStream(dest);
        r.pipe(f);
        f.on("finish", () => f.close(() => res()));
        f.on("error", rej);
      })
      .on("error", rej);
  });
}

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const archive = join(OUT, ASSET);
  console.log(`[fetch-ollama] downloading ${url}`);
  await download(url, archive);
  console.log(`[fetch-ollama] extracting ${ASSET}`);
  // bsdtar (Windows 10+, macOS, Linux) extracts both .zip and .tgz.
  execSync(`tar -xf "${archive}" -C "${OUT}"`, { stdio: "inherit" });
  rmSync(archive, { force: true });
  // Ensure the unix binary is executable.
  if (process.platform !== "win32") {
    const bin = join(OUT, "ollama");
    if (existsSync(bin)) execSync(`chmod +x "${bin}"`);
  }
  console.log(`[fetch-ollama] done → ${OUT}`);
})().catch((e) => {
  console.error(`[fetch-ollama] failed: ${e.message}`);
  process.exit(1);
});
