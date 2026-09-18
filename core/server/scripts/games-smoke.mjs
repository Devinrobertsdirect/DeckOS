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
 *   node scripts/games-smoke.mjs http://nobi.local:8080 ABC-1234
 *
 * Pass a REAL pairing code on the command line, never in this file. Ask the
 * robot for its own ("what is my pairing code") or read it off its screen.
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

  await play("mad-librarian", async () => {
    const a = await join("Ann");
    await tap(a, "Start");
    await wait(400);
    // Keep handing in words until every gap is full and he starts reading.
    for (let i = 0; i < 12 && (await phone(a)).input; i++) { await type(a, `word${i}`); await wait(150); }
    const p = await phone(a);
    if (!/^\d+ of \d+$/.test(p.title ?? "")) throw new Error(`never started reading (title: ${p.title})`);
    if (!p.body || p.body.length < 5) throw new Error("no line to read");
  });

  await play("read-the-room", async () => {
    const ids = [await join("Ann"), await join("Bob"), await join("Cal")];
    await tap(ids[0], "Start");
    await wait(600);
    // Go round the circle twice: only the player whose turn it is may speak,
    // so this also proves the turn gate holds.
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < ids.length; i++) {
        const up = ids.find(async () => true);
        void up;
        for (const id of ids) {
          const ph = await phone(id);
          if (ph.yourTurn && ph.input) { await type(id, `w${round}${i}`); break; }
        }
        await wait(150);
      }
    }
    // After the second circle the table must be offered the accusation.
    const p = await phone(ids[0]);
    const opts = (p.choices ?? []).map((c) => c.label);
    if (!opts.includes("I know who it is")) throw new Error(`no accusation offered (saw: ${opts.join(", ")})`);
    await tap(ids[0], "I know who it is");
    await wait(200);
    const names = (await labels(ids[0]));
    if (names.length < 2) throw new Error("nobody to accuse");
    await tap(ids[0], names[0]);
    await wait(300);
    const end = await phone(ids[0]);
    if (!/Caught|Got away/.test(end.title ?? "")) throw new Error(`round did not resolve (title: ${end.title})`);
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

  await play("quick-colors", async () => {
    const a = await join("Ann");
    await tap(a, "Start");
    // Wait for the flash, which is deliberately at a random moment.
    for (let i = 0; i < 80 && (await phone(a)).title !== "GO"; i++) await wait(200);
    const swatches = (await phone(a)).choices ?? [];
    if (swatches.length < 2) throw new Error("no colours to tap");
    await tap(a, swatches[0].label);
    await wait(500);
    // Right or wrong, the round has to resolve and offer the next one.
    if (!(await labels(a)).some((l) => /Next colour|See the scores/.test(l))) throw new Error("round never resolved");
  });

  await play("would-you-rather", async () => {
    const a = await join("Ann");
    await tap(a, "Start");
    await wait(600);
    const opts = (await phone(a)).choices ?? [];
    if (opts.length < 2) throw new Error("no options offered");
    await tap(a, opts[0].label);
    await wait(400);
    if (!(await labels(a)).includes("Next one")) throw new Error("never reached the reveal");
  });

  await play("hot-potato", async () => {
    const a = await join("Ann"), b = await join("Bob");
    await tap(a, "Start");
    await wait(700);
    const holder = (await phone(a)).yourTurn ? a : b;
    const victim = holder === a ? "Bob" : "Ann";
    await type(holder, "Cheerios");
    await tap(holder, `Pass to ${victim}`);
    await wait(500);
    const other = holder === a ? b : a;
    if (!(await phone(other)).yourTurn) throw new Error("the bomb did not change hands");
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
