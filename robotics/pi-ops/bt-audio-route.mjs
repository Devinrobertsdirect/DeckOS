#!/usr/bin/env node
// bt-audio-route.mjs <MAC> — after a Bluetooth audio device connects, put it in
// the HFP "headset-head-unit" profile (so the MIC exists — the ears sidecar reads
// bluez_input.<MAC>) and make it the default sink AND source, so Nobi's voice
// plays to it and it hears through it. WirePlumber only (no pactl on this Pi).
// Profile/node ids are session-specific, so everything is resolved live from
// pw-dump. Idempotent: if it's already HFP + default, this is a no-op.
import { execSync } from "node:child_process";

const us = (process.argv[2] || "").replace(/:/g, "_");
if (!us) { console.error("usage: bt-audio-route.mjs <MAC>"); process.exit(1); }

const dump = () => JSON.parse(execSync("pw-dump", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const sh = (c) => { try { execSync(c, { stdio: "ignore" }); return true; } catch { return false; } };

let d = dump();

// ── 1. HFP profile on the card (only switch if it isn't already HFP) ──────────
let cardId = null, hfpIdx = null, activeIdx = null;
for (const o of d) {
  if ((o.info?.props?.["device.name"] || "") === `bluez_card.${us}`) {
    cardId = o.id;
    const en = o.info?.params?.EnumProfile || [];
    const hfp = en.find((x) => x.name === "headset-head-unit") || en.find((x) => /headset-head-unit/.test(x.name || ""));
    if (hfp) hfpIdx = hfp.index;
    activeIdx = (o.info?.params?.Profile || [])[0]?.index ?? null;
  }
}
if (cardId != null && hfpIdx != null && activeIdx !== hfpIdx) {
  sh(`wpctl set-profile ${cardId} ${hfpIdx}`);
  try { execSync("sleep 2"); } catch { /* ignore */ }
  d = dump();   // switching profiles recreates the audio nodes — re-read them
}

// ── 2. default sink + source = this device ───────────────────────────────────
let sinkId = null, srcId = null;
for (const o of d) {
  const p = o.info?.props || {};
  const n = p["node.name"] || "";
  const cls = p["media.class"] || "";
  if (n.startsWith(`bluez_output.${us}`) && /Sink/.test(cls)) sinkId = o.id;
  if (/bluez_input/.test(n) && n.includes(us) && /Source/.test(cls)) srcId = o.id;
}
if (sinkId != null) sh(`wpctl set-default ${sinkId}`);
if (srcId != null) sh(`wpctl set-default ${srcId}`);

console.log(JSON.stringify({ cardId, hfpIdx, sinkId, srcId }));
