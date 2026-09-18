import { Router } from "express";
import { z } from "zod";
import { networkInterfaces } from "node:os";
import { broadcast } from "../lib/ws-server.js";
import {
  status, scanNetworks, joinNetwork, startHotspot, stopHotspot, revertToPrevious,
  hotspotName, hotspotPassword,
} from "../lib/net-setup.js";

/**
 * setup-wifi.ts — the page a customer sees on their phone, and the API behind it.
 *
 * This is the whole out-of-box experience for a robot with no keyboard. He puts
 * a hotspot in the air, his face says what to join and what to type, and this
 * page is what they land on. It has to work on a five year old iPhone with no
 * internet connection behind it, so: one file, no build step, no fonts, no
 * frameworks, nothing fetched from outside.
 *
 *   GET  /setup                  → the page (also served at /api/setup/wifi/page)
 *   GET  /api/setup/wifi         → status + what to tell the customer
 *   POST /api/setup/wifi/scan    → rescan, returns networks
 *   POST /api/setup/wifi/join    → { ssid, password }
 *   POST /api/setup/wifi/hotspot → { on, revertAfterMs } — start/stop by hand
 *
 * The hotspot routes are how this gets tested without stranding a robot:
 * `revertAfterMs` arms a timer before anything is torn down, so he comes back
 * on his own even if the test goes badly. That is not politeness, it is the only
 * safe way to develop a feature whose failure mode is losing the machine.
 */
const router = Router();

/** The address his hotspot answers on — read live rather than assumed. */
function localAddress(): string {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (!name.startsWith("wlan") || !addrs) continue;
    for (const a of addrs) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return "10.42.0.1"; // NetworkManager's default for a shared connection
}

function port(): string {
  return process.env["PORT"] ?? "8080";
}

router.get("/setup/wifi", async (_req, res) => {
  const s = await status();
  res.json({ ...s, url: `http://${localAddress()}:${port()}/setup` });
});

router.post("/setup/wifi/scan", async (_req, res) => {
  res.json({ networks: await scanNetworks(true) });
});

const Join = z.object({ ssid: z.string().min(1).max(64), password: z.string().max(128).default("") });
router.post("/setup/wifi/join", async (req, res) => {
  const parsed = Join.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: "pick a network" }); return; }
  const { ssid, password } = parsed.data;
  // Say it out loud as it happens — the customer is looking at the robot, not
  // at their phone, and a silent forty seconds feels like a failure.
  broadcast({ type: "net.joining", source: "setup-wifi", payload: { ssid }, timestamp: new Date().toISOString() });
  const result = await joinNetwork(ssid, password);
  broadcast({
    type: "net.joined",
    source: "setup-wifi",
    payload: { ssid, ok: result.ok, error: result.error },
    timestamp: new Date().toISOString(),
  });
  res.json(result);
});

const Hotspot = z.object({
  on: z.boolean(),
  /** Come back to the old network after this long. Capped at ten minutes. */
  revertAfterMs: z.number().int().min(30_000).max(600_000).optional(),
});
router.post("/setup/wifi/hotspot", async (req, res) => {
  const parsed = Hotspot.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.message }); return; }
  if (parsed.data.on) {
    // Somebody pressed a button to get here, so this is never the automatic
    // fallback: he must stay in setup until they finish or the revert fires.
    const ok = await startHotspot({ revertAfterMs: parsed.data.revertAfterMs, reason: "requested" });
    res.json({ ok, ...(await status()), url: `http://${localAddress()}:${port()}/setup` });
    return;
  }
  // "off" means go back to being on Wi-Fi, not merely stop broadcasting.
  const back = await revertToPrevious();
  if (!back) await stopHotspot();
  res.json({ ok: true, ...(await status()) });
});

/* ── the page ──────────────────────────────────────────────────────────── */

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Set up your Nobi</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; padding:24px 16px 48px; background:#070b12; color:#e8f0fa;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:460px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:.2px; }
  .sub { color:#8fa6c0; font-size:14px; margin:0 0 24px; }
  .card { background:#0e1522; border:1px solid #1d2a3d; border-radius:14px; overflow:hidden; }
  .net { display:flex; align-items:center; gap:12px; width:100%; padding:14px 16px;
         background:none; border:0; border-bottom:1px solid #16212f; color:inherit;
         font:inherit; text-align:left; cursor:pointer; }
  .net:last-child { border-bottom:0; }
  .net:active { background:#16212f; }
  .net b { font-weight:500; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bars { width:22px; text-align:right; color:#5ce0b8; font-size:12px; letter-spacing:1px; }
  .lock { color:#5d7a99; font-size:12px; }
  input { width:100%; padding:14px 16px; margin:12px 0 0; font:inherit; color:#e8f0fa;
          background:#0e1522; border:1px solid #27384f; border-radius:12px; }
  button.go { width:100%; padding:15px; margin-top:12px; font:600 16px/1 inherit;
              color:#04121a; background:#5ce0b8; border:0; border-radius:12px; }
  button.go[disabled] { opacity:.5; }
  .ghost { display:block; width:100%; margin-top:14px; padding:12px; background:none;
           border:0; color:#8fa6c0; font:inherit; text-decoration:underline; }
  .msg { margin-top:16px; padding:12px 14px; border-radius:12px; font-size:14px; }
  .bad { background:#2a1620; color:#ff9ab4; }
  .good { background:#0f2a22; color:#5ce0b8; }
  .spin { display:inline-block; width:14px; height:14px; margin-right:8px; vertical-align:-2px;
          border:2px solid #5ce0b8; border-top-color:transparent; border-radius:50%;
          animation:s .8s linear infinite; }
  @keyframes s { to { transform:rotate(360deg); } }
</style></head>
<body><div class="wrap">
  <h1>Let's get Nobi online</h1>
  <p class="sub" id="sub">Pick your Wi-Fi.</p>
  <div id="view"></div>
</div>
<script>
// No build step and no dependencies on purpose: this page is served by a robot
// that is, at this exact moment, the only network the phone can see.
var view = document.getElementById('view'), sub = document.getElementById('sub');
var nets = [], chosen = null, busy = false;

function bars(signal) {
  var n = signal > 70 ? 4 : signal > 50 ? 3 : signal > 30 ? 2 : 1;
  return '||||'.slice(0, n);
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
  return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); }

function list() {
  chosen = null;
  sub.textContent = 'Pick your Wi-Fi.';
  if (!nets.length) { view.innerHTML = '<div class="msg bad">No networks in range yet.</div>' + rescan(); return; }
  view.innerHTML = '<div class="card">' + nets.map(function (n, i) {
    return '<button class="net" data-i="' + i + '"><b>' + esc(n.ssid) + '</b>' +
           (n.secure ? '<span class="lock">&#128274;</span>' : '') +
           '<span class="bars">' + bars(n.signal) + '</span></button>';
  }).join('') +
    // A hidden network broadcasts no name, so it can never appear in a scan and
    // was simply unreachable from this page. nmcli can still join one by name.
    '<button class="net" data-other="1"><b>Other network…</b>' +
    '<span class="bars">&#8594;</span></button>' +
    '</div>' + rescan();
  [].forEach.call(view.querySelectorAll('.net'), function (b) {
    b.onclick = function () {
      if (b.dataset.other) return pickOther();
      pick(nets[+b.dataset.i]);
    };
  });
}
function rescan() { return '<button class="ghost" onclick="scan()">Look again</button>'; }

/** Type a network name by hand — for a hidden network, or one too weak to see. */
function pickOther() {
  sub.textContent = 'Type the exact network name.';
  view.innerHTML =
    '<input id="ssid" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Network name">' +
    '<input id="pw" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" placeholder="Wi-Fi password (leave blank if open)">' +
    '<button class="go" id="go">Connect Nobi</button>' +
    '<button class="ghost" onclick="list()">Back to the list</button>';
  var ssid = document.getElementById('ssid');
  setTimeout(function () { ssid.focus(); }, 60);
  document.getElementById('go').onclick = function () {
    var name = ssid.value.trim();
    if (!name) { ssid.focus(); return; }
    chosen = { ssid: name, secure: true };
    join();
  };
}

function pick(n) {
  chosen = n;
  sub.textContent = n.ssid;
  view.innerHTML =
    (n.secure ? '<input id="pw" type="password" autocomplete="current-password" ' +
                'autocapitalize="off" autocorrect="off" placeholder="Wi-Fi password">' : '') +
    '<button class="go" id="go">Connect Nobi</button>' +
    '<button class="ghost" onclick="list()">Back to the list</button>';
  var pw = document.getElementById('pw');
  if (pw) setTimeout(function () { pw.focus(); }, 60);
  document.getElementById('go').onclick = join;
  if (pw) pw.onkeydown = function (e) { if (e.key === 'Enter') join(); };
}

function join() {
  if (busy) return;
  busy = true;
  var pw = document.getElementById('pw');
  var body = { ssid: chosen.ssid, password: pw ? pw.value : '' };
  view.innerHTML = '<div class="msg good"><span class="spin"></span>Connecting to ' +
                   esc(chosen.ssid) + '. This takes about half a minute.</div>';
  // He drops the hotspot to try the new network, so this phone loses him
  // mid-request. A failed fetch is expected and means nothing either way —
  // the answer is on his face, and we poll for it once he is reachable again.
  fetch('/api/setup/wifi/join', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then(function (r) { return r.json(); })
    .then(function (j) { busy = false; j.ok ? done(chosen.ssid) : fail(j.error); })
    .catch(function () { setTimeout(poll, 8000); });
}

function poll() {
  fetch('/api/setup/wifi').then(function (r) { return r.json(); }).then(function (s) {
    busy = false;
    if (s.online) return done(s.ssid);
    if (s.setupMode) return fail(s.lastError || 'That did not work. Try again.');
    setTimeout(poll, 4000);
  }).catch(function () { setTimeout(poll, 4000); });
}

function done(ssid) {
  sub.textContent = '';
  view.innerHTML = '<div class="msg good">Nobi is on ' + esc(ssid) + '.</div>' +
    '<p class="sub" style="margin-top:16px">You can put your phone back on your own Wi-Fi now. ' +
    'Ask him "are you online?" and he will tell you.</p>';
}
function fail(msg) {
  busy = false;
  sub.textContent = '';
  view.innerHTML = '<div class="msg bad">' + esc(msg || 'That did not work.') + '</div>' +
    '<button class="ghost" onclick="scan()">Try again</button>';
}

function scan() {
  view.innerHTML = '<div class="msg good"><span class="spin"></span>Looking for networks.</div>';
  fetch('/api/setup/wifi/scan', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (j) { nets = j.networks || []; list(); })
    .catch(function () { fail('Could not look for networks.'); });
}
scan();
</script></body></html>`;

router.get(["/setup", "/setup/wifi/page"], (_req, res) => {
  res.type("html").set("Cache-Control", "no-store").send(PAGE);
});

export default router;
