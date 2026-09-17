#!/usr/bin/env node
/* build-netlify.mjs — bundle the cloud as ONE self-contained Netlify Function into the site folder. */
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
const out = process.argv[2] || "../../devberri-site-work/netlify/functions/cloud.mjs";
mkdirSync(out.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
await build({
  // ESM v2 function; `require` for the CJS deps inside comes from a module-scoped createRequire.
  entryPoints: ["src/netlify.ts"], bundle: true, platform: "node", target: "node20", format: "esm", outfile: out, sourcemap: false, minify: false,
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});
console.log("✓ built cloud function →", out);
