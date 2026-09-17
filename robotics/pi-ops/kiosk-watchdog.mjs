#!/usr/bin/env node
// kiosk-watchdog.mjs — heal a blank Nobi face over CDP (:9222). Zero deps.
//
// The supervisor relaunches Chromium only when it DIES; a Chromium that is alive
// but showing a blank page (lost the cold-boot race with the brain, or a transient
// load failure) never recovers on its own — that's the "white screen on reboot."
// This checks the live page and, if it's blank/about:blank WHILE the brain is
// healthy, navigates it back to the app. Prints "ok" | "healed" | "wait" | "skip".
//
//   node kiosk-watchdog.mjs         → check, and heal if blank
//   node kiosk-watchdog.mjs check   → report only, never navigate
const APP = process.env.NEURA_KIOSK_URL || "http://localhost:8080/?screen=round";
const HEALTH = "http://localhost:8080/api/healthz";
const CHECK_ONLY = process.argv[2] === "check";
const done = (s) => { console.log(s); process.exit(0); };

// The brain must be serving before we reload — otherwise we'd just reload into
// another blank. If it's down, hold (the supervisor's boot gate handles startup).
let healthy = false;
try {
  const r = await fetch(HEALTH, { signal: AbortSignal.timeout(2500) });
  healthy = r.ok;
} catch { healthy = false; }

let page;
try {
  const targets = await (await fetch("http://127.0.0.1:9222/json", { signal: AbortSignal.timeout(2500) })).json();
  page = targets.find((t) => t.type === "page");
} catch { done("skip"); }        // DevTools not up yet — nothing to do
if (!page) done("skip");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const send = (method, params) => new Promise((res, rej) => {
  const i = id++; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
};
const killTimer = setTimeout(() => { try { ws.close(); } catch {} process.exit(0); }, 8000);
await new Promise((r) => { ws.onopen = r; ws.onerror = () => done("skip"); });

let state;
try {
  const r = await send("Runtime.evaluate", {
    expression: "({u:location.href,n:(document.getElementById('root')||{}).childElementCount||0,b:document.body?document.body.innerText.length:0})",
    returnByValue: true,
  });
  state = r.result?.value ?? { u: "", n: 0, b: 0 };
} catch { done("skip"); }

const blank = state.u === "about:blank" || !/localhost:8080/.test(state.u) || (state.n === 0 && state.b === 0);

if (!blank) { clearTimeout(killTimer); ws.close(); done("ok"); }
if (!healthy) { clearTimeout(killTimer); ws.close(); done("wait"); }   // blank but brain down — hold
if (CHECK_ONLY) { clearTimeout(killTimer); ws.close(); done("blank"); }

try { await send("Page.navigate", { url: APP }); done("healed"); }
catch { done("skip"); }
