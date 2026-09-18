import { Router } from "express";
import { z } from "zod";
import { broadcast } from "../lib/ws-server.js";
import { getOrCreatePairingCode } from "../lib/pairing.js";
import { getConfig, setConfig } from "../lib/app-config.js";

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

/**
 * Everything the remote needs to show its Setup band, and the one place it can
 * change things. Pairing-code gated like the commands: same network, same bar.
 *
 * Keys are WRITE-ONLY here. The remote can tell you a key is present and how
 * long it is, never what it is — a code that lets you drive the robot should
 * not also hand out its credentials.
 */
const KEY_SLOTS = ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY"] as const;

async function checkCode(req: Parameters<typeof router.post>[1] extends never ? never : any): Promise<boolean> {
  const given = String((req.body?.code ?? req.query?.code ?? "")).trim().toUpperCase().replace(/\s+/g, "");
  const expected = (await getOrCreatePairingCode()).toUpperCase().replace(/\s+/g, "");
  return !!given && given === expected;
}

router.get("/remote/state", async (req, res) => {
  if (!(await checkCode(req))) { res.status(403).json({ error: "bad code" }); return; }
  const [voiceId, ...keys] = await Promise.all([
    getConfig("ELEVENLABS_VOICE_ID").catch(() => null),
    ...KEY_SLOTS.map((k) => getConfig(k).catch(() => null)),
  ]);
  const cloudUrl = (await getConfig("NOBI_CLOUD_URL").catch(() => null)) ?? "";
  const token = (await getConfig("NOBI_CLOUD_TOKEN").catch(() => null)) ?? "";
  const botNumber = (await getConfig("NOBI_BOT_NUMBER").catch(() => null)) ?? null;
  res.json({
    voiceId: voiceId ?? null,
    keys: Object.fromEntries(KEY_SLOTS.map((k, i) => [k, { set: !!keys[i], length: (keys[i] ?? "").length }])),
    cloud: { url: cloudUrl, linked: !!token, botNumber },
  });
});

router.post("/remote/setup", async (req, res) => {
  if (!(await checkCode(req))) { res.status(403).json({ error: "bad code" }); return; }
  const b = (req.body ?? {}) as { voiceId?: string; key?: string; value?: string; sync?: boolean };
  const done: string[] = [];
  if (typeof b.voiceId === "string" && /^[A-Za-z0-9]{10,40}$/.test(b.voiceId)) {
    await setConfig("ELEVENLABS_VOICE_ID", b.voiceId);
    // The face caches the voice; tell it now so the next line uses the new one.
    broadcast({ type: "voice.changed", source: "remote", payload: { voiceId: b.voiceId }, timestamp: new Date().toISOString() });
    done.push("voice");
  }
  if (typeof b.key === "string" && (KEY_SLOTS as readonly string[]).includes(b.key) && typeof b.value === "string" && b.value.trim()) {
    await setConfig(b.key, b.value.trim());
    done.push(b.key);
  }
  if (b.sync) {
    const { syncFromCloud } = await import("../lib/cloud-sync.js");
    const r = await syncFromCloud();
    res.json({ ok: r.ok, done: [...done, "sync"], sync: r });
    return;
  }
  res.json({ ok: true, done });
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
  res.set("Cache-Control", "no-store");
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
  /* Game tiles. Each game owns an icon and a colour, and the tile wears both —
     the colour bleeds up from the bottom so a grid of them reads as a shelf of
     apps rather than a list of words. */
  .gamegrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
  .tile{position:relative;flex-direction:column;align-items:flex-start;gap:2px;
        padding:14px 14px 13px;min-height:104px;overflow:hidden;text-align:left;
        background:linear-gradient(180deg,var(--card) 55%,color-mix(in srgb,var(--gc) 22%,var(--card)) 100%);
        border-color:color-mix(in srgb,var(--gc) 35%,var(--line))}
  .tile:active{transform:scale(.97)}
  .ticon{font-size:26px;line-height:1.1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))}
  .tname{font:700 15px system-ui,sans-serif;color:var(--ink)}
  .tsub{font:500 11px system-ui,sans-serif;color:#8fa0b8}
  .tile.live{border-color:var(--gc);box-shadow:0 0 0 1px var(--gc),0 6px 18px -8px var(--gc)}
  .tile.live .tsub{color:var(--gc)}
  button{appearance:none;border:1px solid var(--line);background:var(--card);color:var(--ink);
         border-radius:14px;padding:16px 6px;font:600 14px system-ui,sans-serif;display:flex;
         align-items:center;justify-content:center;gap:7px;cursor:pointer;
         transition:transform .12s,background .12s;min-height:56px;text-align:center}
  button.wide{grid-column:span 2}
  button .sw{width:13px;height:13px;border-radius:50%;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
  button:active{transform:scale(.95);background:#1b2740}
  button[disabled]{opacity:.45}
  .gamebar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .gamebar span{flex:1;font-size:15px;font-weight:600;letter-spacing:.04em}
  .gamebar .back,.gamebar .endg{appearance:none;border:1px solid var(--line);background:var(--card);
        color:var(--ink);border-radius:12px;padding:10px 14px;font:600 15px system-ui;cursor:pointer}
  .gamebar .endg{font-size:13px;color:#8fa0bd}
  .gcard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px}
  .gtitle{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--eye);margin-bottom:8px}
  .gbody{font-size:16px;line-height:1.5;color:var(--ink)}
  .gsecret{margin-top:12px;padding-top:12px;border-top:1px dashed var(--line);font-size:14px;color:var(--stop)}
  .gsecret::before{content:"Only you know: ";color:#5d6b86}
  .gplayers{margin-top:14px;font-size:12px;color:#5d6b86;text-align:center}
  .pad{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin-top:12px}
  .padb{min-height:96px;font-size:34px;border-radius:20px;background:var(--card)}
  .padb:active{background:#25344a;transform:scale(.97)}
  .padhint{font:600 11px system-ui,sans-serif;color:#7d8ba6;text-align:center;white-space:nowrap}
  #gChoices button{min-height:62px;font-size:15px;flex-direction:column;gap:3px}
  #gChoices button small{font-size:11px;color:#7d8ba6;font-weight:500}
  .setup{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
  .setup label{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5d6b86;margin:14px 2px 6px}
  .setup .hint{letter-spacing:0;text-transform:none;color:#4a5878}
  .setup .row{font-size:13px;color:#8fa0bd;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:12px}
  .setup .row2{display:grid;grid-template-columns:1fr auto;gap:8px}
  .setup select,.setup input{width:100%;background:var(--card);border:1px solid var(--line);color:var(--ink);
        border-radius:12px;padding:13px;font:500 15px system-ui,sans-serif}
  .setup input{margin-top:8px;font-family:ui-monospace,Menlo,monospace;letter-spacing:.05em}
  .setup button.b{min-height:0;padding:0 18px;font-size:14px}
  .setup button.full{width:100%;margin-top:10px;padding:16px}
  .fine{font-size:11px;color:#4a5878;margin-top:8px;line-height:1.5}
  .stop{width:100%;margin-top:14px;background:var(--stop);color:#20160a;border-color:transparent;
        padding:22px;font-size:17px;font-weight:700}
  .msg{min-height:22px;text-align:center;font-size:14px;color:#7d8ba6}
  .gate{margin-top:auto;border-top:1px solid var(--line);padding-top:14px}
  .gate label{display:block;font-size:12px;color:#7d8ba6;margin-bottom:6px}
  .gate input{width:100%;background:var(--card);border:1px solid var(--line);color:var(--ink);
              border-radius:12px;padding:13px;font:600 18px ui-monospace,Menlo,monospace;letter-spacing:.18em;text-align:center}
</style></head><body>
<h1><svg width="20" height="20" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#1e2a38"/><g fill="#c9dcf0"><rect x="13" y="15" width="7" height="18" rx="3.5"/><rect x="28" y="15" width="7" height="18" rx="3.5"/></g></svg>Nobi remote</h1>
</div>

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

<div class="band" id="gamesBand">
  <h2>Games</h2>
  <div class="gamegrid" id="gameList"><button class="b wide" disabled>Loading\u2026</button></div>

<div class="band setup">
  <h2>Setup</h2>
  <div class="row" id="cloudRow">Checking\u2026</div>
  <button class="b full" id="syncBtn">\u27F3  Sync from my account</button>

  <label for="voiceSel">His voice</label>
  <div class="row2">
    <select id="voiceSel"><option>Loading voices\u2026</option></select>
    <button class="b" id="voiceSave">Use</button>
  </div>

  <label for="keySel">API keys <span class="hint" id="keyHint"></span></label>
  <div class="row2">
    <select id="keySel">
      <option value="OPENROUTER_API_KEY">OpenRouter (his brain)</option>
      <option value="ELEVENLABS_API_KEY">ElevenLabs (his voice)</option>
      <option value="ANTHROPIC_API_KEY">Anthropic</option>
    </select>
    <button class="b" id="keySave">Save</button>
  </div>
  <input id="keyVal" type="password" autocomplete="off" spellcheck="false" placeholder="paste the key, then Save">
  <p class="fine">Keys are written straight to this robot and never shown back.</p>
</div>
<div id="gameView" hidden>
  <div class="gamebar">
    <button class="back" id="gameBack">\u2190</button>
    <span id="gameTitle">Game</span>
    <button class="endg" id="gameEnd">End</button>
  </div>
  <div class="gcard">
    <div class="gtitle" id="gTitle"></div>
    <div class="gbody" id="gBody"></div>
    <div class="gsecret" id="gSecret" hidden></div>
  </div>
  <div id="gChoices" class="grid"></div>
  <!-- The arcade pad. Hidden until a game asks for it, and it REPEATS while
       held: a phone has no analogue stick, so holding a direction has to be how
       you turn smoothly, or aiming a shield is impossible. -->
  <div id="gPad" class="pad" hidden>
    <button class="padb" data-pad="left">&#8592;</button>
    <div class="padhint" id="gPadHint">hold to turn</div>
    <button class="padb" data-pad="right">&#8594;</button>
  </div>
  <div class="row2" id="gInputRow" hidden>
    <input id="gInput" placeholder="\u2026">
    <button class="b" id="gSend">Go</button>
  </div>
  <div class="gplayers" id="gPlayers"></div>
</div>

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
  // ── Setup: what the robot currently has, and the three things you can change
  function setupBody(extra) {
    var o = { code: input.value.trim() };
    for (var k in extra) o[k] = extra[k];
    return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) };
  }
  async function loadState() {
    var code = input.value.trim();
    if (!code) return;
    try {
      var r = await fetch("/api/remote/state?code=" + encodeURIComponent(code));
      if (!r.ok) { document.getElementById("cloudRow").textContent = "Enter the pairing code to set things up."; return; }
      var st = await r.json();
      var c = st.cloud || {};
      document.getElementById("cloudRow").innerHTML = (c.botNumber ? "Nobi #" + c.botNumber + " \u00b7 " : "") +
        (c.linked ? "linked to your account" : c.url ? "not linked yet" : "no cloud set");
      var hint = [];
      for (var k in st.keys) if (st.keys[k].set) hint.push(k.split("_")[0].toLowerCase());
      document.getElementById("keyHint").textContent = hint.length ? "(" + hint.join(", ") + " set)" : "(none set)";
      loadVoices(st.voiceId);
    } catch (e) { /* offline */ }
  }
  async function loadVoices(current) {
    var sel = document.getElementById("voiceSel");
    try {
      var r = await fetch("/api/vision/elevenlabs/voices");
      var j = await r.json();
      var list = (j.voices || []);
      if (!list.length) { sel.innerHTML = "<option>No voices (check the ElevenLabs key)</option>"; return; }
      sel.innerHTML = list.map(function (v) {
        return '<option value="' + v.id + '"' + (v.id === current ? " selected" : "") + ">" + v.name + "</option>";
      }).join("");
    } catch (e) { sel.innerHTML = "<option>Could not load voices</option>"; }
  }
  document.getElementById("syncBtn").addEventListener("click", async function () {
    this.disabled = true; msg.textContent = "Syncing\u2026";
    try {
      var r = await fetch("/api/remote/setup", setupBody({ sync: true }));
      var j = await r.json();
      msg.textContent = j.ok
        ? "Synced" + (j.sync && j.sync.ownerName ? " \u2014 hello, " + j.sync.ownerName : "") + ". " + ((j.sync && j.sync.keys ? j.sync.keys.length : 0)) + " key(s) in."
        : "Sync: " + ((j.sync && j.sync.error) || j.error || "failed");
      loadState();
    } catch (e) { msg.textContent = "Could not reach him."; }
    this.disabled = false;
  });
  document.getElementById("voiceSave").addEventListener("click", async function () {
    var id = document.getElementById("voiceSel").value;
    this.disabled = true; msg.textContent = "Setting voice\u2026";
    try {
      var r = await fetch("/api/remote/setup", setupBody({ voiceId: id }));
      msg.textContent = r.ok ? "Voice set. Next thing he says uses it." : "Could not set the voice.";
    } catch (e) { msg.textContent = "Could not reach him."; }
    this.disabled = false;
  });
  document.getElementById("keySave").addEventListener("click", async function () {
    var name = document.getElementById("keySel").value, val = document.getElementById("keyVal");
    if (!val.value.trim()) { msg.textContent = "Paste a key first."; return; }
    this.disabled = true; msg.textContent = "Saving\u2026";
    try {
      var r = await fetch("/api/remote/setup", setupBody({ key: name, value: val.value.trim() }));
      msg.textContent = r.ok ? name.split("_")[0] + " key saved." : "Could not save that key.";
      val.value = "";
      loadState();
    } catch (e) { msg.textContent = "Could not reach him."; }
    this.disabled = false;
  });
  // ── Games ────────────────────────────────────────────────────────────────
  // The robot owns the game; this is a view onto it. Back leaves the table
  // exactly as it is (the robot keeps playing its own state), End clears it.
  var PLAYER_KEY = "nobi_player_id";
  var gamePoll = null, playerId = null, lastVersion = -1;
  function code() { return input.value.trim(); }
  function show(el, on) { document.getElementById(el).hidden = !on; }
  function inGame(on) {
    document.querySelectorAll(".band, .stop").forEach(function (n) { n.style.display = on ? "none" : ""; });
    show("gameView", on);
  }
  async function loadGames() {
    try {
      var r = await fetch("/api/games?code=" + encodeURIComponent(code()));
      if (!r.ok) return;
      var j = await r.json();
      var list = document.getElementById("gameList");
      // App tiles, not a list of identical buttons. You find a game by its
      // shape and its colour long before you finish reading its name, and a
      // game already in progress has to be the most obvious thing on screen.
      list.innerHTML = j.games.map(function (g) {
        var live = j.session && j.session.gameId === g.id;
        return '<button class="tile' + (live ? " live" : "") + '" data-game="' + g.id +
               '" style="--gc:' + (g.color || "#7fb3ff") + '">' +
               '<span class="ticon">' + (g.icon || "\u2b50") + "</span>" +
               '<span class="tname">' + g.title + "</span>" +
               '<span class="tsub">' + (live ? "In progress \u00b7 tap to rejoin"
                 : (g.minPlayers === g.maxPlayers ? g.minPlayers + " players"
                    : g.minPlayers + "\u2013" + g.maxPlayers + " players")) + "</span>" +
               "</button>";
      }).join("");
      list.querySelectorAll("[data-game]").forEach(function (b) {
        b.addEventListener("click", function () { openGame(b.dataset.game, j.session && j.session.gameId === b.dataset.game); });
      });
    } catch (e) { /* offline */ }
  }
  async function openGame(id, resuming) {
    msg.textContent = "";
    if (!resuming) {
      await fetch("/api/games/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code(), gameId: id }) });
      try { localStorage.removeItem(PLAYER_KEY); } catch (e) {}
    } else {
      await fetch("/api/games/resume", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code() }) });
    }
    var name = localStorage.getItem("nobi_player_name") || "";
    if (!name) {
      name = (prompt("Your name for the table?") || "Player").slice(0, 16);
      try { localStorage.setItem("nobi_player_name", name); } catch (e) {}
    }
    var jr = await fetch("/api/games/join", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code(), name: name, playerId: localStorage.getItem(PLAYER_KEY) || undefined }) });
    var jj = await jr.json();
    if (jj.playerId) { playerId = jj.playerId; try { localStorage.setItem(PLAYER_KEY, playerId); } catch (e) {} }
    else { msg.textContent = jj.error || "Could not join."; return; }
    inGame(true);
    lastVersion = -1;
    pollGame();
    gamePoll = setInterval(pollGame, 1200);
  }
  function leaveGame(end) {
    if (gamePoll) { clearInterval(gamePoll); gamePoll = null; }
    fetch("/api/games/" + (end ? "end" : "suspend"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code() }) })
      .catch(function () {});
    inGame(false);
    msg.textContent = end ? "Game ended." : "Saved. Pick it up any time.";
    loadGames();
  }

  // ?game=<id> opens straight into that game. This is how the phone app's
  // games shelf hands off: tap a tile there, land in the game here, rather than
  // arriving at the top of the remote and having to find it again.
  (function () {
    var want = new URLSearchParams(location.search).get("game");
    if (!want) return;
    fetch("/api/games?code=" + encodeURIComponent(code())).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var known = (j.games || []).some(function (g) { return g.id === want; });
        if (known) openGame(want, !!(j.session && j.session.gameId === want));
      }).catch(function () { /* stay on the remote */ });
  })();
  // Hold-to-repeat, at roughly the rate the game ticks. Each repeat is one
  // turn step, so a long press sweeps the shield and a tap nudges it.
  (function () {
    var held = null;
    function begin(dir) {
      if (held) return;
      act(dir, undefined, true);
      held = setInterval(function () { act(dir, undefined, true); }, 90);
    }
    function end() { if (held) { clearInterval(held); held = null; } }
    document.querySelectorAll("[data-pad]").forEach(function (b) {
      var dir = b.dataset.pad;
      b.addEventListener("pointerdown", function (e) { e.preventDefault(); begin(dir); });
      ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
        b.addEventListener(ev, end);
      });
    });
    // A finger that leaves the screen entirely must not leave the shield spinning.
    window.addEventListener("blur", end);
  })();

  document.getElementById("gameBack").addEventListener("click", function () { leaveGame(false); });
  document.getElementById("gameEnd").addEventListener("click", function () { leaveGame(true); });
  async function act(action, value, quiet) {
    await fetch("/api/games/act", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code(), playerId: playerId, action: action, value: value }) }).catch(function () {});
    // A held d-pad fires ten times a second; re-fetching the phone view after
    // each one would triple the traffic to redraw a card that has not changed.
    // The face is driven by the server's own frames, so it stays correct.
    if (quiet) return;
    pollGame();
  }
  async function pollGame() {
    if (!playerId) return;
    try {
      var r = await fetch("/api/games/state?code=" + encodeURIComponent(code()) + "&playerId=" + playerId + "&since=" + lastVersion);
      if (r.status === 204) return;
      if (!r.ok) return;
      var v = await r.json();
      lastVersion = v.version;
      document.getElementById("gameTitle").textContent = v.title;
      var p = v.phone || {};
      document.getElementById("gTitle").textContent = p.title || "";
      document.getElementById("gBody").textContent = p.body || "";
      var sec = document.getElementById("gSecret");
      sec.hidden = !p.secret; sec.textContent = p.secret || "";
      var ch = document.getElementById("gChoices");
      ch.innerHTML = (p.choices || []).map(function (c, i) {
        return '<button class="b' + ((p.choices.length % 2 && i === p.choices.length - 1) ? " wide" : "") + '" data-a="' + c.action +
               '" data-v="' + String(c.value != null ? c.value : (c.label || "")).replace(/"/g, "&quot;") + '"' + (c.disabled ? " disabled" : "") + ">" +
               c.label + (c.detail ? "<small>" + c.detail + "</small>" : "") + "</button>";
      }).join("");
      ch.querySelectorAll("[data-a]").forEach(function (b) {
        b.addEventListener("click", function () { act(b.dataset.a, b.dataset.v); });
      });
      show("gPad", p.pad === "dpad");
      show("gInputRow", !!p.input);
      if (p.input) {
        document.getElementById("gInput").placeholder = p.input.placeholder || "";
        document.getElementById("gSend").onclick = function () {
          var el = document.getElementById("gInput");
          if (el.value.trim()) { act(p.input.action, el.value.trim()); el.value = ""; }
        };
      }
      document.getElementById("gPlayers").textContent = (v.players || []).map(function (x) { return x.name; }).join(" \u00b7 ");
    } catch (e) { /* keep polling */ }
  }

  input.addEventListener("change", function () { loadState(); loadGames(); });
  if (input.value.trim()) loadGames();
  input.addEventListener("change", loadState);
  if (input.value.trim()) loadState();

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
