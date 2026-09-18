import { randomUUID } from "node:crypto";
import os from "node:os";
import { broadcast } from "../ws-server.js";
import { getConfig, setConfig } from "../app-config.js";
import { logger } from "../logger.js";
import { runInference } from "../inference.js";
import type { GameDefinition, GameSession, Player, GameContext } from "./types.js";
import { devsDungeon } from "./devs-dungeon.js";
import { samePage } from "./same-page.js";
import { readTheRoom } from "./read-the-room.js";
import { bizbot } from "./bizbot.js";
import { meteor } from "./meteor.js";
import { quickColors } from "./quick-colors.js";
import { wouldYouRather } from "./would-you-rather.js";
import { hotPotato } from "./hot-potato.js";
import { madLibrarian } from "./mad-librarian.js";
import { quizbee } from "./quizbee.js";
import { triviaNight } from "./trivia-night.js";
import { wavelength } from "./wavelength.js";

/**
 * games/engine.ts — one live game at a time, owned by the robot.
 *
 * The robot holds the state, not the phones. That is what makes the back arrow
 * safe: you leave a game, the game keeps playing in its own time, and when you
 * come back it is exactly where it was. It is also what makes several phones a
 * single table rather than several games.
 *
 * Sessions are saved to config after every change, so a brain restart mid-round
 * does not lose the story. They are small (a few KB) and there is only ever one.
 */

const GAMES: Record<string, GameDefinition<never>> = {
  [devsDungeon.id]: devsDungeon as unknown as GameDefinition<never>,
  [samePage.id]: samePage as unknown as GameDefinition<never>,
  [readTheRoom.id]: readTheRoom as unknown as GameDefinition<never>,
  [bizbot.id]: bizbot as unknown as GameDefinition<never>,
  [meteor.id]: meteor as unknown as GameDefinition<never>,
  [quickColors.id]: quickColors as unknown as GameDefinition<never>,
  [wouldYouRather.id]: wouldYouRather as unknown as GameDefinition<never>,
  [hotPotato.id]: hotPotato as unknown as GameDefinition<never>,
  [madLibrarian.id]: madLibrarian as unknown as GameDefinition<never>,
  [quizbee.id]: quizbee as unknown as GameDefinition<never>,
  [triviaNight.id]: triviaNight as unknown as GameDefinition<never>,
  [wavelength.id]: wavelength as unknown as GameDefinition<never>,
};

const SAVE_KEY = "NOBI_GAME_SESSION";
/**
 * Bumped whenever a game's saved state changes shape. A save from an older
 * build is discarded rather than fed to code that no longer understands it.
 *
 * This is not hypothetical: a Same Page save written before seats existed was
 * restored into a build that reads `state.seats`, the ticker threw on every
 * interval, and systemd restart-looped the brain. A game is entertainment; it
 * must never be able to stop the robot from being a robot.
 */
const SAVE_VERSION = 2;

let session: GameSession | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

/**
 * The PLAY code — a throwaway password for this game and nothing else.
 *
 * Handing strangers the robot's pairing code so they can play was the wrong
 * trade: that code also drives the demo and opens the setup band, which writes
 * API keys. A QR shown to a room at a convention should not be able to reach
 * any of that.
 *
 * So a game mints its own code when it starts, that code opens ONLY the game
 * routes, and it dies with the game. Four characters because it gets read off a
 * screen across a table and typed with a thumb — and it is worth nothing once
 * the game is over, so four is plenty.
 */
let playCode: string | null = null;
/** A game that is loaded but put away — off the face, and not ticking. */
let suspended = false;

/** No I/O/0/1 — they are the characters people get wrong reading a screen. */
function mintPlayCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** The code for the game currently running, or null when nothing is on. */
export function currentPlayCode(): string | null {
  return playCode;
}

/** True when this code may touch the game routes — and only those. */
export function isPlayCode(given: string): boolean {
  return !!playCode && given.trim().toUpperCase().replace(/\s+/g, "") === playCode;
}


/** The address a phone on the same Wi-Fi can actually reach him on. */
function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  }
  return null;
}

/** Put the join QR and the play code on his face. */
function inviteToJoin(code: string): void {
  const port = process.env["PORT"] ?? 8080;
  const ip = lanIp();
  const host = ip ? `${ip}:${port}` : `${os.hostname()}.local:${port}`;
  broadcast({
    type: "face.command",
    source: "games",
    payload: {
      showLink: {
        title: "Join the game",
        url: `http://${host}/api/remote?code=${encodeURIComponent(code)}`,
        code,
        hint: `Scan, or go to ${host}/play and enter ${code}`,
      },
    },
    timestamp: new Date().toISOString(),
  });
}


export function listGames() {
  return Object.values(GAMES).map((g) => ({
    id: g.id, title: g.title, blurb: g.blurb, icon: g.icon, color: g.color,
    minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
  }));
}

/** Restore whatever was in play when the brain last stopped. */
export async function restoreSession(): Promise<void> {
  try {
    const raw = await getConfig(SAVE_KEY).catch(() => null);
    if (!raw) return;
    const saved = JSON.parse(raw) as GameSession & { schema?: number };
    if (saved?.schema !== SAVE_VERSION) {
      logger.info({ found: saved?.schema, want: SAVE_VERSION }, "games: dropping a save from an older build");
      await setConfig(SAVE_KEY, "");
      return;
    }
    if (saved.gameId && GAMES[saved.gameId]) {
      session = saved;
      startTicker();
    }
  } catch { /* a corrupt save is not worth a crash; start fresh */ }
}

let lastSaveAt = 0;
/**
 * Persist the session, at most once every couple of seconds.
 *
 * Turn-based games publish a frame when somebody presses a button, so saving on
 * every publish was free. An arcade game ticks fourteen times a second, and
 * writing the whole session to the config store fourteen times a second would
 * put the robot's storage under constant load for the sake of a game nobody
 * needs resumed to the exact frame. Losing a second of a meteor round is not a
 * loss; a turn-based game still saves promptly because `force` skips the gate.
 */
async function save(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSaveAt < 2000) return;
  lastSaveAt = now;
  try {
    await setConfig(SAVE_KEY, session ? JSON.stringify({ ...session, schema: SAVE_VERSION }) : "");
  } catch { /* best effort */ }
}

/**
 * Anything a game does is wrapped in this. If a game throws — bad saved state,
 * a bug in a render, an option that no longer exists — the game is dropped and
 * the robot carries on. Losing a round is a nuisance; losing the robot at a
 * stand is the end of the demo.
 */
function guard<T>(what: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    logger.error({ err, what, gameId: session?.gameId }, "games: a game threw — ending it so the robot keeps running");
    stopTicker();
    session = null;
    void setConfig(SAVE_KEY, "").catch(() => {});
    try {
      broadcast({ type: "game.frame", source: "games", payload: { gameId: null, version: 0, face: null }, timestamp: new Date().toISOString() });
    } catch { /* the face will simply keep its last frame */ }
    return fallback;
  }
}

function def(): GameDefinition<never> | null {
  return session ? (GAMES[session.gameId] ?? null) : null;
}

function context(): GameContext {
  return {
    now: Date.now(),
    random: Math.random,
    players: session ? session.players : [],
    /**
     * The same brain, asked for a SHAPE rather than a speech.
     *
     * No narrator framing at all. narrate() wraps everything in "you are
     * narrating aloud, reply with the narration only", which is right for a
     * line of story and actively harmful for structured output: asked for five
     * questions as Q:/A:/C: through narrate(), the model returned a warm
     * welcome to quiz night followed by the questions in prose. Nothing parsed.
     */
    ask: async (prompt: string, maxWords = 200) => {
      const framed = [
        prompt,
        "",
        "Answer in EXACTLY the form above. No preamble, no commentary, no markdown, " +
          `no explanation, nothing else. At most ${maxWords} words.`,
      ].join("\n");
      const out = await runInference({ prompt: framed, mode: "fast", task: "chat" });
      return String(out?.response ?? "").trim();
    },
    narrate: async (prompt: string, maxWords = 60) => {
      // A narrator, not an assistant: the rules go in the prompt because
      // runInference takes a single prompt, and a game that gets "Sure! Here's
      // a story:" read aloud in Rocky's voice has lost the room.
      const framed = [
        "You are narrating a game aloud for a room of people.",
        prompt,
        "",
        "Reply with the narration ONLY: no preamble, no commentary, no questions, " +
          `no offers of help, no markdown, at most ${maxWords} words.`,
      ].join("\n");
      const out = await runInference({ prompt: framed, mode: "fast", task: "chat" });
      return String(out?.response ?? "").trim();
    },
  };
}

/** Push the current frame to the face and bump the version phones poll on. */
function publish(opts: { fromTick?: boolean } = {}): void {
  const d = def();
  if (!session || !d) return;
  session.version += 1;
  const frame = guard("render", () => d.render(session!.state as never, session!.players), null);
  if (!frame) return;
  // Every frame carries the game's identity, so the face can wear it: the icon
  // sits on the board strip and the colour tints the moment. A game that does
  // not choose a colour for a particular beat inherits its own, which means no
  // two games ever look the same across the room.
  const face = { ...frame.face, color: frame.face.color ?? d.color, icon: d.icon, accent: d.color };
  broadcast({
    type: "game.frame",
    source: "games",
    payload: { gameId: session.gameId, version: session.version, face },
    timestamp: new Date().toISOString(),
  });
  // A press is worth saving immediately; a tick can wait for the throttle.
  void save(!opts.fromTick);
}

function startTicker(): void {
  stopTicker();
  const d = def();
  if (!d?.tick || !d.tickMs) return;
  ticker = setInterval(() => {
    if (!session || !d.tick) return;
    const next = guard("tick", () => d.tick!(session!.state as never, context()) as unknown, null);
    if (next === null) return;          // the guard has already ended the game
    session.state = next;
    publish({ fromTick: true });
  }, d.tickMs);
}

function stopTicker(): void {
  if (ticker) { clearInterval(ticker); ticker = null; }
}

export function currentSession(): { gameId: string; version: number; players: Array<{ id: string; name: string }> } | null {
  return session ? { gameId: session.gameId, version: session.version, players: session.players.map((p) => ({ id: p.id, name: p.name })) } : null;
}

export async function startGame(gameId: string): Promise<{ ok: boolean; error?: string; playCode?: string }> {
  const d = GAMES[gameId];
  if (!d) return { ok: false, error: "unknown game" };
  stopTicker();
  // A new code every game, so last week's players cannot wander back in.
  playCode = mintPlayCode();
  suspended = false;
  session = { gameId, startedAt: Date.now(), players: [], state: d.create({ players: [] }) as unknown, version: 0 };
  startTicker();
  publish();
  // The invitation belongs to STARTING a game, not to the HTTP route that
  // happened to ask for it — a game started by voice needs the join code on his
  // face just as much as one started from the remote, and more so, because the
  // person who asked out loud has no screen in their hand yet.
  inviteToJoin(playCode);
  return { ok: true, playCode };
}

/** Leave the game running but take it off the face (the back arrow). */
export function suspendGame(): void {
  if (!session) return;
  // Stop the clock as well as the picture. Without this a ticking game — Meteor
  // ticks fourteen times a second — simply publishes another frame a moment
  // later and puts itself straight back on his face, so "put it away" did not
  // work at all for the one kind of game that most needed it. Stopping the
  // ticker also means the round is exactly where you left it when you return,
  // which is what the back arrow has always promised.
  suspended = true;
  stopTicker();
  broadcast({ type: "game.frame", source: "games", payload: { gameId: null, version: session.version, face: null }, timestamp: new Date().toISOString() });
  void save(true);
}

/** Put a suspended game back on the face. */
export function resumeGame(): boolean {
  if (!session) return false;
  suspended = false;
  startTicker();
  publish();
  return true;
}

/** True when a game is loaded but deliberately off the face. */
export function isSuspended(): boolean {
  return !!session && suspended;
}

export async function endGame(): Promise<void> {
  stopTicker();
  session = null;
  // The play code dies with the game: it was only ever a key to this table.
  playCode = null;
  suspended = false;
  broadcast({ type: "game.frame", source: "games", payload: { gameId: null, version: 0, face: null }, timestamp: new Date().toISOString() });
  await save();
}

export function joinGame(name: string, existingId?: string): { playerId: string } | { error: string } {
  const d = def();
  if (!session || !d) return { error: "no game running" };
  if (existingId) {
    const known = session.players.find((p) => p.id === existingId);
    if (known) return { playerId: known.id };
  }
  if (session.players.length >= d.maxPlayers) return { error: "table is full" };
  const player: Player = {
    id: randomUUID().slice(0, 8),
    name: (name || `Player ${session.players.length + 1}`).slice(0, 16),
    joinedAt: Date.now(),
    seat: session.players.length,
  };
  session.players.push(player);
  const joined = guard("join", () => d.join(session!.state as never, player) as unknown, null);
  if (joined === null) return { error: "that game just ended" };
  session.state = joined;
  publish();
  return { playerId: player.id };
}

/**
 * One press at a time, per table.
 *
 * `act()` may await — a brain call for a clue, a question, a story — and this
 * function read the state, awaited, then wrote it back. Two presses landing
 * either side of that await therefore BOTH built on the state from before
 * either of them, and the second write silently threw the first away. With six
 * phones at a table that is not a rare race: it is two people tapping at once,
 * which is what a party game is.
 *
 * The symptom was never a crash. It was a vote that did not count, a word that
 * vanished, a seat that would not take — the sort of thing that gets blamed on
 * the Wi-Fi. Three separate audits of three separate games arrived at this same
 * line, which is the clearest possible sign it belongs here and not in them.
 *
 * So presses queue. Each waits for the one before it, reads the state that
 * press actually produced, and writes on top of it.
 */
let actQueue: Promise<unknown> = Promise.resolve();

export async function actInGame(playerId: string, action: string, value?: string): Promise<{ ok: boolean; error?: string }> {
  const mine = actQueue.then(() => applyAction(playerId, action, value));
  // The queue must survive a failed press, or one error would wedge the table.
  actQueue = mine.catch(() => undefined);
  return mine;
}

async function applyAction(playerId: string, action: string, value?: string): Promise<{ ok: boolean; error?: string }> {
  // Re-read everything INSIDE the queue: the game may have ended, or the state
  // moved on, while this press waited its turn.
  const d = def();
  if (!session || !d) return { ok: false, error: "no game running" };
  const player = session.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, error: "not at this table" };
  const before = session;
  try {
    const next = (await d.act(session.state as never, player, action, value, context())) as unknown;
    // The table can be ended or restarted mid-await by a voice command or the
    // remote. Writing our result onto a session we no longer hold would
    // resurrect a round that is already over.
    if (session !== before) return { ok: false, error: "that game has moved on" };
    session.state = next;
  } catch {
    return { ok: false, error: "that did not work" };
  }
  publish();
  return { ok: true };
}

/** What this phone should show right now. */
export function viewFor(playerId: string) {
  const d = def();
  if (!session || !d) return null;
  const frame = guard("render", () => d.render(session!.state as never, session!.players), null);
  if (!frame) return null;
  return {
    gameId: session.gameId,
    title: d.title,
    icon: d.icon,
    color: d.color,
    version: session.version,
    phone: frame.phones[playerId] ?? { title: d.title, body: "Join to play." },
    players: session.players.map((p) => ({ id: p.id, name: p.name })),
  };
}
