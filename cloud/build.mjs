#!/usr/bin/env node
/*
 * build.mjs — bundle Nobi Cloud into a single self-contained dist/index.mjs
 * (like core/server). Runs with plain `node dist/index.mjs` on Replit or locally,
 * no install of the source tree required at runtime.
 */
import { build } from "esbuild";
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/index.mjs",
  sourcemap: true,
  // Keep native/optional deps external; everything else is inlined.
  banner: {
    js: "import{createRequire}from'module';const require=createRequire(import.meta.url);",
  },
});

console.log("✓ built cloud → dist/index.mjs");
