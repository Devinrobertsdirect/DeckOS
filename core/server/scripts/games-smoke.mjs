#!/usr/bin/env node
/**
 * games-smoke.mjs — play every game the way a PHONE plays it.
 *
 * This exists because of a specific, expensive mistake. A phone button sends
 * its `value` if the game set one and otherwise its LABEL, and two games were
 * reading that value as something else entirely:
 *
 *   · Same Page read the seat button as Number(value) while the label said
 *     "Player 1". Number("Player 1") is NaN, so nobody could ever take a seat,
 *     the Start button never appeared, and the game was completely unplayable.
 *   · Read the Room compared the vote to a player id while the label was a
 *     NAME, so no vote ever matched and every round ended in a draw.
 *
 * Both games passed every test I ran, because I drove them with the ids and
 * numbers the code wanted — `{action:"seat", value:"1"}` — which is precisely
 * what a phone never sends. A test that knows the right answer proves nothing.
 *
 * So this harness is only allowed to press buttons the way the page does: it
 * reads the choices from the API and sends back `value ?? label`, exactly like
 * the remote's click handler. If a game is unplayable by thumb, this fails.
 *
 *   node scripts/games-smoke.mjs [baseUrl] [pairingCode]
 *   node scripts/games-smoke.mjs http://nobi.local:8080 XJB-2777
 */

const BASE = (process.argv[2] ?? process.env.NOBI_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const CODE = process.argv[3] ?? process.env.NOBI_CODE ?? "";

let failures = 0;
const log = (s) => process.stdout.write(`${s}\n`);
const fail = (game, why) => { failures++; log(`  FAIL  ${game}: ${why}`); };

async function api(path, body) {
  const url = `${BASE}/api${path}`;
  const res = body
    ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: CODE, ...body }) })
    : await fetch(url);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

const phone = async (playerId) =>
  (await api(`/games/state?code=${encodeURIComponent(CODE)}&playerId=${playerId}`)).phone ?? {};

/** Press a button by its visible label, sending what the remote page would send. */
async function tap(playerId, label) {
  const p = await phone(playerId);
  const c = (p.choices ?? []).find((x) => x.label === label);
  if (!c) throw new Error(`no button "${label}" (saw: ${(p.choices ?? []).map((x) => x.label).join(", ") || "none"})`);
  if (c.disabled) throw new Error(`button "${label}" is disabled`);
  // The one line that matters: value if the game set one, otherwise the label.
  await api("/games/act", { playerId, action: c.action, value: c.value ?? c.label });
}

async function type(playerId, text) {
  const p = await phone(playerId);
  if (!p.input) throw new Error("expected a text box, found none");
  await api("/games/act", { playerId, action: p.input.action, value: text });
}

const join = async (name) => (await api("/games/join", { name })).playerId;
const labels = async (playerId) => ((await phone(playerId)).choices ?? []).map((c) => c.label);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function play(gameId, fn) {
  try {
    await api("/games/start", { gameId });
    await fn();
    log(`  ok    ${gameId}`);
  } catch (err) {
    fail(gameId, err.message);
  } finally {
    await api("/games/end", {}).catch(() => {});
  }
}

async function main() {
  if (!CODE) { log("Need a pairing code: node scripts/games-smoke.mjs <baseUrl> <code>"); process.exit(2); }
  log(`Playing every game by thumb against ${BASE}`);

  await play("same-page", async () => {
    const a = await join("Ann"), b = await join("Bob");
    await tap(a, "Player 1");
    await tap(b, "Player 2");
    // Taking a seat is what reveals Start. If seats silently fail, so does this.
    if (!(await labels(a)).includes("Start")) throw new Error("no Start after both seats were taken");
    await tap(a, "Mode: Team");
    if (!(await labels(a)).includes("Mode: Team ✓")) throw new Error("Team mode would not turn on");
    await tap(a, "Start");
    await wait(6000);
    if (!(await phone(a)).input) throw new Error("no way to type a guess once play started");
  });

  await play("read-the-room", async () => {
    const ids = [await join("Ann"), await join("Bob"), await join("Cal")];
    await tap(ids[0], "Start");
    for (const [i, id] of ids.entries()) await type(id, `answer-${i}`);
    for (let i = 0; i < 5 && (await phone(ids[0])).title?.startsWith("Answer"); i++) {
      await tap(ids[0], (await labels(ids[0]))[0]);
    }
    if ((await phone(ids[0])).title !== "Who was it?") throw new Error("never reached the vote");
    for (const id of ids) await tap(id, (await labels(id))[0]);
    const end = await phone(ids[0]);
    // A vote that matches nobody leaves every round a draw — the original bug.
    if (!/Caught them|They got away/.test(end.title ?? "")) throw new Error(`votes did not resolve (title: ${end.title})`);
  });

  await play("bizbot", async () => {
    const a = await join("Ann");
    await tap(a, "Consult me");
    await type(a, "nobody is buying the thing");
    await tap(a, "Skip to the insight");
    await tap(a, "Give us the insight");
    const p = await phone(a);
    if (!p.body || p.body.length < 20) throw new Error("no insight came back");
    await tap(a, "Actually useful");
  });

  await play("meteor", async () => {
    const a = await join("Ann");
    await tap(a, "Start");
    await wait(1500);
    const p = await phone(a);
    if (p.pad !== "dpad") throw new Error("no d-pad to turn the shield with");
    await api("/games/act", { playerId: a, action: "right" });
  });

  await play("devs-dungeon", async () => {
    const a = await join("Ann");
    await tap(a, (await labels(a))[0]);
    await wait(8000);
    const p = await phone(a);
    if (!(p.choices?.length || p.input)) throw new Error("nothing to do on the first turn");
  });

  log(failures ? `\n${failures} game(s) unplayable by thumb` : "\nevery game is playable by thumb");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { log(`harness error: ${err.message}`); process.exit(1); });
