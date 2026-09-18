import { Router } from "express";
import { z } from "zod";
import { broadcast } from "../lib/ws-server.js";
import { getOrCreatePairingCode } from "../lib/pairing.js";

/**
 * remote.ts — the demo remote: a page you bookmark on your phone.
 *
 * At a stand, voice will sometimes lose to the room, and standing there
 * repeating yourself is the worst moment a demo can have. This serves one
 * self-contained page at /remote with big buttons that drive the face: run a
 * show, put the QR up, stop him. It is deliberately NOT part of the mobile app —
 * no install, no build step, no account. Open the URL, bookmark it, hand it to
 * whoever is helping you.
 *
 * Auth is the robot's existing pairing code, which is only visible to someone
 * who can already see the robot's screen (or is on its network and asked it).
 * That is the same bar as the phone-link QR, and the commands are all things a
 * person standing in front of it could do by speaking anyway.
 *
 * Commands go out as the SAME events a spoken request produces, so there is no
 * second code path to keep in step with the voice one.
 */
const router = Router();

/**
 * What a button can ask for. Two kinds, deliberately:
 *
 *  - `phrase` goes through the ears path, so a show or a skill runs exactly as
 *    if it had been spoken. Right for anything with real behaviour behind it.
 *  - `face` is a DIRECT instruction to the screen — mood, eye colour, gaze,
 *    trick, scene. These are instant and cannot fail: no transcription, no
 *    model, no round trip. Most of what makes a demo feel alive is here, and
 *    several of them have no spoken trigger at all ("look left" is not a skill).
 */
type Command =
  | { label: string; phrase: string }
  | { label: string; face: Record<string, unknown> }
  | { label: string; stop: true };

const COMMANDS: Record<string, Command> = {
  // shows + real skills, through the spoken path
  demo:     { label: "Demo",       phrase: "show me a quick demo" },
  pitch:    { label: "Introduce",  phrase: "introduce yourself" },
  order:    { label: "How to buy", phrase: "how can i get one of you" },
  qr:       { label: "QR code",    phrase: "show me the qr code" },
  shop:     { label: "Shop",       phrase: "show me the shop" },
  botno:    { label: "Bot #",      phrase: "what is your bot number" },
  sync:     { label: "Sync",       phrase: "sync my account" },
  meet:     { label: "Say hi",     phrase: "say hello to everyone" },
  // tricks — the four set pieces, chosen directly
  trick:    { label: "Trick",      face: { trick: "rainbow" } },
  spin:     { label: "Spin",       face: { trick: "spin" } },
  hearts:   { label: "Hearts",     face: { trick: "hearts" } },
  warp:     { label: "Warp",       face: { trick: "warp" } },
  joke:     { label: "Joke",       face: { joke: true } },
  // moods
  happy:    { label: "Happy",      face: { mood: "happy" } },
  excited:  { label: "Excited",    face: { mood: "excited" } },
  wink:     { label: "Wink",       face: { mood: "wink" } },
  love:     { label: "Love",       face: { mood: "love" } },
  think:    { label: "Thinking",   face: { mood: "thinking" } },
  cool:     { label: "Cool",       face: { mood: "cool" } },
  shocked:  { label: "Shocked",    face: { mood: "shocked" } },
  sleep:    { label: "Sleep",      face: { mood: "sleepy" } },
  // where he looks
  lookL:    { label: "Look left",  face: { gaze: [-0.9, 0] } },
  lookR:    { label: "Look right", face: { gaze: [0.9, 0] } },
  lookU:    { label: "Look up",    face: { gaze: [0, -0.8] } },
  lookAt:   { label: "Look at you", face: { gaze: [0, 0] } },
  // eye colour
  cIce:     { label: "Ice",        face: { color: "#c9dcf0" } },
  cGold:    { label: "Gold",       face: { color: "#f5b83d" } },
  cMint:    { label: "Mint",       face: { color: "#5ce0b8" } },
  cRose:    { label: "Rose",       face: { color: "#ff8fb0" } },
  cViolet:  { label: "Violet",     face: { color: "#c08bff" } },
  cEmber:   { label: "Ember",      face: { color: "#ff7a3d" } },
  // background scenes
  sSpark:   { label: "Sparkle",    face: { scene: "sparkle" } },
  sConf:    { label: "Confetti",   face: { scene: "confetti" } },
  sCore:    { label: "Core",       face: { scene: "core" } },
  sOff:     { label: "Clear",      face: { scene: null, mood: "idle", color: null } },
  stop:     { label: "Stop",       stop: true },
};

const Body = z.object({ code: z.string().min(1).max(40), command: z.string().min(1).max(40) });

router.post("/remote/command", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "send { code, command }" }); return; }
  const expected = await getOrCreatePairingCode();
  const given = parsed.data.code.trim().toUpperCase().replace(/\s+/g, "");
  if (given !== expected.toUpperCase().replace(/\s+/g, "")) { res.status(403).json({ error: "bad code" }); return; }

  const cmd = COMMANDS[parsed.data.command];
  if (!cmd) { res.status(400).json({ error: "unknown command" }); return; }

  if ("stop" in cmd) {
    broadcast({ type: "voice.interrupt", source: "remote", payload: { text: "" }, timestamp: new Date().toISOString() });
  } else if ("face" in cmd) {
    broadcast({ type: "face.command", source: "remote", payload: cmd.face, timestamp: new Date().toISOString() });
  } else {
    // Exactly what the ears send when they hear the same request out loud.
    broadcast({ type: "voice.heard", source: "remote", payload: { text: cmd.phrase }, timestamp: new Date().toISOString() });
  }
  res.json({ ok: true, ran: parsed.data.command });
});

/** Laid out as three bands: what he DOES, how he LOOKS, where he LOOKS. */
const GROUPS: Array<{ title: string; keys: string[]; wide?: string[] }> = [
  { title: "Do", keys: ["demo", "pitch", "order", "qr", "trick", "spin", "hearts", "warp", "joke", "meet", "shop", "botno"], wide: ["demo"] },
  { title: "Feel", keys: ["happy", "excited", "wink", "love", "cool", "shocked", "think", "sleep"] },
  { title: "Look", keys: ["lookL", "lookAt", "lookR", "lookU", "cIce", "cGold", "cMint", "cRose", "cViolet", "cEmber", "sSpark", "sConf", "sCore", "sOff", "sync"] },
];
const SWATCH: Record<string, string> = { cIce: "#c9dcf0", cGold: "#f5b83d", cMint: "#5ce0b8", cRose: "#ff8fb0", cViolet: "#c08bff", cEmber: "#ff7a3d" };

router.get("/remote", async (_req, res) => {
  const code = await getOrCreatePairingCode();
  res.type("html").send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Nobi remote</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%231e2a38'/%3E%3Crect x='13' y='15' width='7' height='18' rx='3.5' fill='%23c9dcf0'/%3E%3Crect x='28' y='15' width='7' height='18' rx='3.5' fill='%23c9dcf0'/%3E%3C/svg%3E">
<style>
  :root{--ink:#e8eefb;--bg:#080c16;--card:#121a2b;--line:#22304a;--eye:#c9dcf0;--stop:#f5b83d}
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{background:var(--bg);color:var(--ink);font:500 16px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;
       min-height:100dvh;padding:18px 16px calc(18px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px}
  h1{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7d8ba6;display:flex;align-items:center;gap:9px}
  h1 svg{flex:none}
  .band h2{font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:#5d6b86;margin:0 2px 8px}
  .band+.band{margin-top:14px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  button{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--ink);
         border-radius:14px;padding:16px 6px;font:600 14px system-ui,sans-serif;display:flex;
         align-items:center;justify-content:center;gap:7px;cursor:pointer;
         transition:transform .12s,background .12s;min-height:56px;text-align:center}
  button.wide{grid-column:span 2}
  button .sw{width:13px;height:13px;border-radius:50%;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
  button:active{transform:scale(.95);background:#1b2740}
  button[disabled]{opacity:.45}
  .stop{width:100%;margin-top:14px;background:var(--stop);color:#20160a;border-color:transparent;
        padding:22px;font-size:17px;font-weight:700}
  .msg{min-height:22px;text-align:center;font-size:14px;color:#7d8ba6}
  .gate{margin-top:auto;border-top:1px solid var(--line);padding-top:14px}
  .gate label{display:block;font-size:12px;color:#7d8ba6;margin-bottom:6px}
  .gate input{width:100%;background:var(--card);border:1px solid var(--line);color:var(--ink);
              border-radius:12px;padding:13px;font:600 18px ui-monospace,Menlo,monospace;letter-spacing:.18em;text-align:center}
</style></head><body>
<h1><svg width="20" height="20" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#1e2a38"/><g fill="#c9dcf0"><rect x="13" y="15" width="7" height="18" rx="3.5"/><rect x="28" y="15" width="7" height="18" rx="3.5"/></g></svg>Nobi remote</h1>
${GROUPS.map((g) => `<div class="band"><h2>${g.title}</h2><div class="grid">
${g.keys.map((k) => {
  const c = COMMANDS[k];
  if (!c) return "";
  const wide = g.wide?.includes(k) ? " wide" : "";
  const sw = SWATCH[k] ? `<span class="sw" style="background:${SWATCH[k]}"></span>` : "";
  return `  <button class="b${wide}" data-cmd="${k}">${sw}${c.label}</button>`;
}).join("\n")}
</div></div>`).join("\n")}
<button class="stop" data-cmd="stop">\u25A0 STOP</button>
<div class="msg" id="msg">Tap a button. He does it on his own screen.</div>
<div class="gate">
  <label for="code">Pairing code${/* prefilled when opened from the robot's own QR */ ""}</label>
  <input id="code" inputmode="latin" autocapitalize="characters" spellcheck="false" placeholder="XXX-0000">
</div>
<script>
  var KEY = "nobi_remote_code";
  var params = new URLSearchParams(location.search);
  var input = document.getElementById("code");
  var msg = document.getElementById("msg");
  input.value = params.get("code") || localStorage.getItem(KEY) || "";
  input.addEventListener("change", function () { try { localStorage.setItem(KEY, input.value.trim()); } catch (e) {} });
  document.querySelectorAll("button[data-cmd]").forEach(function (b) {
    b.addEventListener("click", async function () {
      var code = input.value.trim();
      if (!code) { msg.textContent = "Enter the pairing code below."; input.focus(); return; }
      try { localStorage.setItem(KEY, code); } catch (e) {}
      b.disabled = true; msg.textContent = "…";
      try {
        var r = await fetch("/api/remote/command", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: code, command: b.dataset.cmd }),
        });
        var j = await r.json();
        msg.textContent = r.ok ? "Sent: " + j.ran : (j.error === "bad code" ? "That code is not right." : (j.error || "Failed"));
        if (r.ok && navigator.vibrate) navigator.vibrate(18);
      } catch (e) { msg.textContent = "Cannot reach him. Same Wi-Fi?"; }
      b.disabled = false;
    });
  });
</script>
</body></html>`);
  // the code is never embedded in the page: it is typed once and kept on the phone
  void code;
});

export default router;
