import { Router } from "express";
import { z } from "zod";
import { broadcast } from "../lib/ws-server.js";
import { getOrCreatePairingCode } from "../lib/pairing.js";
import { getConfig, setConfig } from "../lib/app-config.js";
import { cancelRotation } from "../lib/code-rotation.js";
import { currentSession, endGame } from "../lib/games/engine.js";
import { running, setShow, type RunningKind } from "../lib/running.js";
import { isSpeaking } from "./voice.js";

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
  // Full throw. A "look left" that moves the eyes a hair is not a look — these
  // are demo buttons, read from across a stand, and they should be unmistakable.
  lookL:    { label: "Look left",  face: { gaze: [-1, 0] } },
  lookR:    { label: "Look right", face: { gaze: [1, 0] } },
  lookU:    { label: "Look up",    face: { gaze: [0, -1] } },
  lookD:    { label: "Look down",  face: { gaze: [0, 1] } },
  lookAt:   { label: "Look at you", face: { gaze: [0, 0] } },
  // eye colour
  // A full wheel, so "change his eyes" is a real demo moment rather than six
  // near neighbours. Every one is a distinct hue, not a shade of the last.
  cIce:     { label: "Ice",        face: { color: "#c9dcf0" } },
  cGold:    { label: "Gold",       face: { color: "#f5b83d" } },
  cMint:    { label: "Mint",       face: { color: "#5ce0b8" } },
  cRose:    { label: "Rose",       face: { color: "#ff8fb0" } },
  cViolet:  { label: "Violet",     face: { color: "#c08bff" } },
  cEmber:   { label: "Ember",      face: { color: "#ff7a3d" } },
  cRed:     { label: "Red",        face: { color: "#ff4d4d" } },
  cOrange:  { label: "Orange",     face: { color: "#ff9f1c" } },
  cLime:    { label: "Lime",       face: { color: "#9ee04a" } },
  cGreen:   { label: "Green",      face: { color: "#3ddc84" } },
  cCyan:    { label: "Cyan",       face: { color: "#3ad7ff" } },
  cBlue:    { label: "Blue",       face: { color: "#4d8cff" } },
  cIndigo:  { label: "Indigo",     face: { color: "#7a6cff" } },
  cMagenta: { label: "Magenta",    face: { color: "#ff5ce0" } },
  cWhite:   { label: "White",      face: { color: "#ffffff" } },
  // background scenes
  // Every one of these is a scene the face genuinely draws. They were all
  // already built for the shows; only three were reachable from the remote.
  sSpark:   { label: "Sparkle",    face: { scene: "sparkle" } },
  sConf:    { label: "Confetti",   face: { scene: "confetti" } },
  sCore:    { label: "Core",       face: { scene: "core" } },
  sOrbit:   { label: "Orbit",      face: { scene: "orbit" } },
  sWarp:    { label: "Starfield",  face: { scene: "warp" } },
  sHud:     { label: "HUD",        face: { scene: "hud" } },
  sGears:   { label: "Gears",      face: { scene: "gears" } },
  sLab:     { label: "Lab",        face: { scene: "lab" } },
  sHelmet:  { label: "Helmet",     face: { scene: "helmet" } },
  sBowl:    { label: "Fishbowl",   face: { scene: "bowl" } },
  sDrive:   { label: "Drive",      face: { scene: "drive" } },
  sFinale:  { label: "Finale",     face: { scene: "finale" } },
  sOff:     { label: "Clear",      face: { scene: null, mood: "idle", color: null } },
  stop:     { label: "Stop",       stop: true },
};

const Body = z.object({
  code: z.string().min(1).max(40),
  command: z.string().min(1).max(40),
  /** Which running thing to stop, when more than one is going. */
  target: z.enum(["show", "game", "speech", "all"]).optional(),
});

router.post("/remote/command", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "send { code, command }" }); return; }
  const expected = await getOrCreatePairingCode();
  const given = parsed.data.code.trim().toUpperCase().replace(/\s+/g, "");
  if (given !== expected.toUpperCase().replace(/\s+/g, "")) { res.status(403).json({ error: "bad code" }); return; }

  const cmd = COMMANDS[parsed.data.command];
  if (!cmd) { res.status(400).json({ error: "unknown command" }); return; }

  // ANY button calls off a pending code change. Reaching for the remote is the
  // clearest possible way of saying "not that" — and the person who wants to
  // stop it is usually the person already holding the thing.
  const stoppedRotation = cancelRotation();

  if ("stop" in cmd) {
    /**
     * STOP asks, when there is anything to ask about.
     *
     * A demo playing while a game sits on the table is an ordinary state at a
     * stand, and "stop" has no single obvious meaning there — so with two or
     * more things running the remote is told to put up a chooser naming them.
     * With one, it just stops. With none, it is still a fine panic button and
     * cuts whatever he was saying.
     *
     * A game that a person stops is ENDED, not put away. Saving a round is for
     * when the app dies under them, not for when they deliberately said stop.
     */
    const live = running({ speaking: isSpeaking() });
    const target = parsed.data.target
      ?? (live.length === 1 ? live[0]!.kind : live.length === 0 ? "all" : undefined);

    if (!target) {
      res.json({ ok: true, ran: "stop", needsChoice: true, running: live });
      return;
    }

    // EVERY stop cuts the speech and takes down whatever card is on his face.
    // Whichever thing you picked, "stop" means the screen goes quiet too — a
    // STOP that leaves a QR code sitting there has not stopped what the person
    // was actually looking at. The interrupt handler in the face clears the
    // overlay, the caption and the scene together.
    broadcast({ type: "voice.interrupt", source: "remote", payload: { text: "" }, timestamp: new Date().toISOString() });

    if (target === "show" || target === "all") {
      // The show lives in the face; the interrupt above is what actually stops
      // it. Clear our record so it does not linger in the chooser.
      setShow(null);
      broadcast({ type: "face.command", source: "remote", payload: { scene: null, mood: "idle", color: null }, timestamp: new Date().toISOString() });
    }
    if ((target === "game" || target === "all") && currentSession()) {
      await endGame();
    }
    res.json({ ok: true, ran: "stop", stopped: target, ...(stoppedRotation ? { stoppedCodeChange: true } : {}) });
    return;
  } else if ("face" in cmd) {
    broadcast({ type: "face.command", source: "remote", payload: cmd.face, timestamp: new Date().toISOString() });
  } else {
    // Exactly what the ears send when they hear the same request out loud.
    broadcast({ type: "voice.heard", source: "remote", payload: { text: cmd.phrase }, timestamp: new Date().toISOString() });
  }
  res.json({ ok: true, ran: parsed.data.command, ...(stoppedRotation ? { stoppedCodeChange: true } : {}) });
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

/** What is running right now, so the remote can name it on a STOP chooser. */
router.get("/remote/running", async (req, res) => {
  if (!(await checkCode(req))) { res.status(403).json({ error: "bad code" }); return; }
  res.json({ running: running({ speaking: isSpeaking() }) });
});

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
  { title: "Look", keys: ["lookL", "lookAt", "lookR", "lookU", "lookD", "sOff"] },
  { title: "Colour", keys: ["cIce", "cGold", "cMint", "cRose", "cViolet", "cEmber", "cRed", "cOrange", "cLime", "cGreen", "cCyan", "cBlue", "cIndigo", "cMagenta", "cWhite"] },
  { title: "Scenes", keys: ["sSpark", "sConf", "sCore", "sOrbit", "sWarp", "sHud", "sGears", "sLab", "sHelmet", "sBowl", "sDrive", "sFinale", "sync"] },
];
/**
 * The Apps tab, as a list of sections rather than one shelf.
 *
 * Games is the section with things in it today, but the robot is growing
 * things that are apps and not games — a focus companion is being written now —
 * and those should not have to be filed under "Games" or wait for a redesign.
 * Adding a category is adding a line here.
 *
 * A `live` section owns only its shell: the robot is asked what is in it after
 * the page loads (that is the games shelf). A static section lists tiles, and
 * each tile is just a command key, so anything already reachable from the
 * Control tab can be given an app tile without a second code path. A static
 * section with nothing in it is not drawn at all.
 */
type AppTile = { cmd: string; icon: string; name: string; sub: string; color: string };
const APP_SECTIONS: Array<{ title: string; id: string; live?: boolean; tiles?: AppTile[] }> = [
  { title: "Games", id: "gameList", live: true },
  // Waiting on the focus companion, which will land as:
  // { title: "Tools", id: "toolList", tiles: [
  //   { cmd: "focus", icon: "⏱", name: "Focus", sub: "Pomodoro with him", color: "#5ce0b8" },
  // ] },
];

/** Swatches are read straight off the commands, so a new colour cannot be added without one. */
const SWATCH: Record<string, string> = Object.fromEntries(
  Object.entries(COMMANDS).flatMap(([k, c]) => {
    if (!k.startsWith("c") || !("face" in c)) return [];
    const color = (c.face as { color?: unknown }).color;
    return typeof color === "string" ? [[k, color] as const] : [];
  }),
);

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
  /* The bottom padding clears the fixed STOP bar. STOP is pinned so it is
     reachable from every tab, which means every tab has to leave room for it
     or its last row of buttons sits underneath and cannot be tapped. */
  body{background:var(--bg);color:var(--ink);font:500 16px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;
       min-height:100dvh;padding:18px 16px calc(104px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px}
  h1{font-size:15px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#7d8ba6;display:flex;align-items:center;gap:9px}
  h1 svg{flex:none}
  /* Tabs. The remote outgrew one scroll: 55 command buttons and a games shelf
     is a lot of thumb. Three tabs — what he DOES, what you can OPEN, and the
     plumbing — and the one you were on is remembered, because this page is a
     bookmark people reload constantly and landing back at the top of Control
     when you were mid-game is its own small annoyance.
     Flex rather than a three-column grid on purpose: a guest has only one tab,
     and a hidden grid child leaves an empty track where its tab used to be.
     The box-shadow is not a shadow: it paints the page background out to the
     gutters around the pinned bar, so buttons scrolling underneath do not show
     in the gap beside it. */
  .tabs{display:flex;gap:6px;background:var(--card);border:1px solid var(--line);
        border-radius:16px;padding:5px;position:sticky;top:0;z-index:20;
        box-shadow:0 -10px 0 16px var(--bg)}
  .tab{flex:1;min-height:46px;padding:11px 4px;border-color:transparent;background:transparent;
       color:#7d8ba6;font:700 12px system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}
  .tab[aria-current="true"]{background:#1b2740;color:var(--ink);border-color:var(--line)}
  .tab:active{transform:scale(.97)}
  /* Same trap as the sheet below: a button is display:flex here, and that beats
     the UA stylesheet's display:none for [hidden]. */
  .tab[hidden],.panel[hidden],.stopbar[hidden]{display:none}
  .panel{display:flex;flex-direction:column}
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
  /* [hidden] MUST come with an explicit display:none. The attribute works by
     setting display:none in the UA stylesheet, and an author rule that sets
     display:flex beats it — which left this sheet permanently on screen with
     a "Never mind" button that could not dismiss it. */
  .sheet[hidden]{display:none}
  .sheet{position:fixed;inset:0;z-index:50;background:rgba(4,8,15,.72);display:flex;
         align-items:flex-end;justify-content:center;padding:16px}
  .sheetcard{width:100%;max-width:520px;background:var(--card);border:1px solid var(--line);
             border-radius:20px;padding:18px 16px calc(18px + env(safe-area-inset-bottom))}
  .sheetcard h3{font:700 17px system-ui,sans-serif;margin:0 0 12px;text-align:center}
  .sheetcard #stopChoices{display:grid;gap:9px;margin-bottom:12px}
  .sheetcard .b{width:100%;min-height:58px}
  .pad{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin-top:12px}
  .padb{min-height:96px;font-size:34px;border-radius:20px;background:var(--card)}
  .padb:active{background:#25344a;transform:scale(.97)}
  .padhint{font:600 11px system-ui,sans-serif;color:#7d8ba6;text-align:center;white-space:nowrap}
  #gChoices button{min-height:62px;font-size:15px;flex-direction:column;gap:3px}
  #gChoices button small{font-size:11px;color:#7d8ba6;font-weight:500}
  /* Setup owns its tab now, so it no longer needs the rule that used to divide
     it from the bands above it. */
  .setup{margin-top:2px}
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
  /* STOP is the panic button at a live stand, so it is pinned to the bottom of
     the screen rather than living on a tab. Whatever you are looking at, it is
     under your thumb. The fade behind it keeps the buttons that scroll past
     from reading as part of it, and the safe-area padding keeps it clear of
     the home indicator. */
  .stopbar{position:fixed;left:0;right:0;bottom:0;z-index:40;
           padding:14px 16px calc(12px + env(safe-area-inset-bottom));
           background:linear-gradient(180deg,rgba(8,12,22,0) 0,var(--bg) 38%)}
  .stop{width:100%;margin:0;background:var(--stop);color:#20160a;border-color:transparent;
        padding:22px;font-size:17px;font-weight:700}
  .msg{min-height:22px;text-align:center;font-size:14px;color:#7d8ba6}
  .gate{margin-top:auto;border-top:1px solid var(--line);padding-top:14px}
  .gate label{display:block;font-size:12px;color:#7d8ba6;margin-bottom:6px}
  .gate input{width:100%;background:var(--card);border:1px solid var(--line);color:var(--ink);
              border-radius:12px;padding:13px;font:600 18px ui-monospace,Menlo,monospace;letter-spacing:.18em;text-align:center}
</style></head><body>
<h1><svg width="20" height="20" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22" fill="#1e2a38"/><g fill="#c9dcf0"><rect x="13" y="15" width="7" height="18" rx="3.5"/><rect x="28" y="15" width="7" height="18" rx="3.5"/></g></svg>Nobi remote</h1>

<nav class="tabs" id="tabs">
  <button class="tab" data-tab="control" aria-current="true">Control</button>
  <button class="tab" data-tab="apps" aria-current="false">Apps</button>
  <button class="tab" data-tab="setup" aria-current="false">Setup</button>
</nav>

<div class="panel" id="tab-control">
${GROUPS.map((g) => `<div class="band"><h2>${g.title}</h2><div class="grid">
${g.keys.map((k) => {
  const c = COMMANDS[k];
  if (!c) return "";
  const wide = g.wide?.includes(k) ? " wide" : "";
  const sw = SWATCH[k] ? `<span class="sw" style="background:${SWATCH[k]}"></span>` : "";
  return `  <button class="b${wide}" data-cmd="${k}">${sw}${c.label}</button>`;
}).join("\n")}
</div></div>`).join("\n")}
</div>

<div class="panel" id="tab-apps" hidden>
  <div class="msg" id="modeNote" hidden>You're in with a game code \u2014 games only.</div>
${APP_SECTIONS.map((s) => {
  const tiles = s.tiles ?? [];
  if (!s.live && !tiles.length) return "";
  const body = s.live
    ? `    <button class="b wide" disabled>Loading…</button>`
    : tiles.map((t) => `    <button class="tile" data-cmd="${t.cmd}" style="--gc:${t.color}">` +
        `<span class="ticon">${t.icon}</span><span class="tname">${t.name}</span>` +
        `<span class="tsub">${t.sub}</span></button>`).join("\n");
  return `  <div class="band"><h2>${s.title}</h2>
  <div class="gamegrid" id="${s.id}">
${body}
  </div></div>`;
}).join("\n")}
</div>

<!-- Shown only when more than one thing is running, so STOP has to ask. -->
<div class="sheet" id="stopSheet" hidden>
  <div class="sheetcard">
    <h3>Stop what?</h3>
    <div id="stopChoices"></div>
    <button class="b wide" id="stopCancel">Never mind</button>
  </div>
</div>

<div class="panel" id="tab-setup" hidden>
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

<!-- Pinned, not tabbed. See .stopbar above for why. -->
<div class="stopbar" id="stopBar">
  <button class="stop" data-cmd="stop">■ STOP</button>
</div>
<script>
  var KEY = "nobi_remote_code";
  var params = new URLSearchParams(location.search);
  var input = document.getElementById("code");
  var msg = document.getElementById("msg");
  input.value = params.get("code") || localStorage.getItem(KEY) || "";
  input.addEventListener("change", function () { try { localStorage.setItem(KEY, input.value.trim()); } catch (e) {} });
  // ── Tabs ─────────────────────────────────────────────────────────────────
  // The tab you were on is remembered, because this page is a bookmark and gets
  // reloaded constantly — being thrown back to the top of Control every time is
  // exactly the friction the tabs were meant to remove. Only a deliberate tap
  // is written down; a mode change that forces a tab (a guest landing on Apps)
  // must not quietly overwrite what the owner of the phone had chosen.
  var TAB_KEY = "nobi_remote_tab";
  function setTab(name, persist) {
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (!btn || btn.hidden) { name = "apps"; }
    document.querySelectorAll(".tab").forEach(function (b) {
      b.setAttribute("aria-current", b.dataset.tab === name ? "true" : "false");
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.hidden = p.id !== "tab-" + name;
    });
    if (persist) { try { localStorage.setItem(TAB_KEY, name); } catch (e) {} }
  }
  function wantedTab() {
    try { return localStorage.getItem(TAB_KEY) || "control"; } catch (e) { return "control"; }
  }
  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { setTab(b.dataset.tab, true); window.scrollTo(0, 0); });
  });
  setTab(wantedTab(), false);
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
    // A game takes the whole screen: the tabs, every panel and the STOP bar step
    // out of the way. STOP is not lost — the game bar has its own End, and Back
    // puts you straight back on the tab you were on, still pinned.
    document.querySelectorAll(".tabs, .panel, .stopbar").forEach(function (n) { n.style.display = on ? "none" : ""; });
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

  /**
   * Owner or guest?
   *
   * A game mints its own PLAY code, which opens the game routes and nothing
   * else. Rather than build a second page for guests — two implementations of
   * a live game is two places for it to disagree with itself — the one page
   * asks the robot what this code is worth. /remote/state answers only to the
   * owner, so a 403 IS the answer: hide everything except the games.
   *
   * Nothing here is a security boundary; the server refuses those calls
   * regardless. This is just not showing someone a wall of buttons that would
   * all fail for them.
   */
  async function applyMode() {
    var owner = false;
    try {
      var r = await fetch("/api/remote/state?code=" + encodeURIComponent(code()));
      owner = r.ok;
    } catch (e) { /* offline: assume guest and show the least */ }
    // A guest gets one tab. Hiding the Control and Setup tabs rather than their
    // contents means there is nothing to wander into, and the tab bar collapses
    // to the single thing they came for.
    ["control", "setup"].forEach(function (t) {
      var tab = document.querySelector('.tab[data-tab="' + t + '"]');
      if (tab) tab.hidden = !owner;
    });
    // STOP belongs to whoever can actually drive him; a PLAY code would only be
    // refused by the server, so a guest is not shown a button that cannot work.
    document.getElementById("stopBar").hidden = !owner;
    var gate = document.querySelector(".gate");
    if (gate) gate.hidden = !owner && !!code();
    document.getElementById("modeNote").hidden = owner;
    setTab(owner ? wantedTab() : "apps", false);
  }

  input.addEventListener("change", function () { applyMode(); loadState(); loadGames(); });
  if (input.value.trim()) { applyMode(); loadGames(); }
  input.addEventListener("change", loadState);
  if (input.value.trim()) loadState();

  // STOP: if the robot says more than one thing is running, ask which.
  var sheet = document.getElementById("stopSheet");
  document.getElementById("stopCancel").addEventListener("click", function () { sheet.hidden = true; });
  function askWhich(list) {
    var box = document.getElementById("stopChoices");
    box.innerHTML = list.map(function (r) {
      return '<button class="b" data-stop="' + r.kind + '">Stop ' + r.label + '</button>';
    }).join("") + '<button class="b" data-stop="all">Stop everything</button>';
    box.querySelectorAll("[data-stop]").forEach(function (b) {
      b.addEventListener("click", function () { sheet.hidden = true; sendStop(b.dataset.stop); });
    });
    sheet.hidden = false;
  }
  async function sendStop(target) {
    try {
      var r = await fetch("/api/remote/command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code(), command: "stop", target: target })
      });
      var j = await r.json();
      if (j.needsChoice && j.running && j.running.length) { askWhich(j.running); return; }
      msg.textContent = j.stopped === "all" ? "Stopped." : "Stopped: " + (j.stopped || "");
      if (navigator.vibrate) navigator.vibrate(18);
      loadGames();
    } catch (e) { msg.textContent = "Cannot reach him. Same Wi-Fi?"; }
  }

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
        // STOP may come back asking which of several things to stop.
        if (j.needsChoice && j.running && j.running.length) { askWhich(j.running); b.disabled = false; return; }
        msg.textContent = r.ok ? (j.stopped ? "Stopped: " + j.stopped : "Sent: " + j.ran)
                               : (j.error === "bad code" ? "That code is not right." : (j.error || "Failed"));
        if (r.ok && navigator.vibrate) navigator.vibrate(18);
        if (r.ok && j.stopped) loadGames();
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
