#!/usr/bin/env node
// cdp-eval.mjs — poke the kiosk Chromium over CDP (:9222). Zero deps; Node 22's
// global fetch + WebSocket. Finds the page target on localhost:8080.
//   node cdp-eval.mjs 'document.title'   → Runtime.evaluate, prints JSON result
//   node cdp-eval.mjs --key Enter        → Input.dispatchKeyEvent keyDown+keyUp
//                                          (simulate keyboard wake remotely)
// Exits nonzero on any error or after 10s.

const TIMEOUT_MS = 10_000;
const die = (msg) => {
  console.error(`cdp-eval: ${msg}`);
  process.exit(1);
};
const timer = setTimeout(() => die("timeout (10s)"), TIMEOUT_MS);

const [, , arg1, arg2] = process.argv;
if (!arg1) die('usage: cdp-eval.mjs "<js expression>"  |  cdp-eval.mjs --key <DOM key>');

// Find the kiosk page target
let targets;
try {
  targets = await (await fetch("http://127.0.0.1:9222/json")).json();
} catch (err) {
  die(`cannot reach DevTools on :9222 — is the kiosk up? (${err.message})`);
}
const page = targets.find((t) => t.type === "page" && (t.url || "").includes("localhost:8080"));
if (!page) die("no page target for localhost:8080");

// Minimal CDP client: id-matched request/response over the debugger websocket
const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (!msg.id || !pending.has(msg.id)) return; // events — not ours
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(msg.error.message));
  else resolve(msg.result);
};
ws.onerror = () => die("websocket error");

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onclose = () => reject(new Error("websocket closed before open"));
}).catch((err) => die(err.message));

try {
  if (arg1 === "--key") {
    if (!arg2) die("--key needs a DOM key name (e.g. Enter)");
    // text makes printable keys (and Enter) register as a real keypress
    const text = arg2 === "Enter" ? "\r" : arg2.length === 1 ? arg2 : "";
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: arg2, text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: arg2 });
    console.log(JSON.stringify({ ok: true, key: arg2 }));
  } else {
    const result = await send("Runtime.evaluate", {
      expression: arg1,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log(JSON.stringify(result));
    if (result.exceptionDetails) process.exit(1);
  }
} catch (err) {
  die(err.message);
}

clearTimeout(timer);
ws.close();
process.exit(0);
