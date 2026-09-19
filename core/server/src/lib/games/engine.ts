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
import { focus } from "./focus.js";
import { bodies } from "./bodies.js";

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
  [focus.id]: focus as unknown as GameDefinition<never>,
  [bodies.id]: bodies as unknown as GameDefinition<never>,
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
 * PRESENCE — how the robot notices that a phone has left the table.
 *
 * Phones never announce their departure. They lock, they go flat, they walk out
 * of the door mid-round, and the browser sends nothing at all. What they DO do,
 * every 1200ms while the game is open, is GET /games/state. So that poll is the
 * heartbeat, and silence is the only evidence of absence there will ever be.
 *
 * Nine games each invented their own defence against this — a "skip" button
 * anyone can press, a tick that times a turn out, a holder-sanity check that
 * moves the bomb off a dead id. All of them were papering over the same missing
 * engine feature, and none of them could fix the roster itself: the leaver was
 * still on the score strip, still a legal target for a pass, still counted
 * towards minPlayers.
 */
const PLAYER_POLL_MS = 1200;
/**
 * How long a phone may be silent before the table gives up on it.
 *
 * 45 seconds is about 37 consecutive missed polls. The numbers either side of
 * it are both wrong for a reason:
 *
 *  · Much shorter and ordinary life ejects people. A phone that locks, a walk
 *    through a bad corner of the flat, a lift, an iOS tab that gets throttled
 *    the moment it is backgrounded — all of those produce ten or twenty seconds
 *    of silence from somebody sitting right there at the table.
 *  · Much longer and the table waits on a ghost. A minute and a half of Read
 *    the Room stuck on an empty chair is the round abandoned; people do not
 *    wait that long, they stop playing.
 *
 * 45 seconds sits past every blip and inside one round. It is also made much
 * safer by REINSTATEMENT below: a phone wrongly swept comes back to its own id,
 * its own seat and its own score simply by polling again, so the cost of being
 * a little too eager is a player missing a turn, not a player losing their game.
 */
const ABSENT_MS = 45_000;
/** Cheap, and far coarser than the timeout it enforces — this is a sweep, not a clock. */
const SWEEP_MS = 5_000;
/**
 * How long a departed player's chair is kept warm.
 *
 * Long enough that "I was in the kitchen" and "my phone died and I plugged it
 * in" both end with the same person rejoining the same game, and short enough
 * that it is not a memory leak. Ten minutes is comfortably longer than any
 * round and shorter than any evening.
 */
const REINSTATE_MS = 10 * 60_000;

/** playerId -> the last time we heard from that phone. */
const lastSeen = new Map<string, number>();
/** playerId -> the player we removed, and when, so they can be seated again. */
const departed = new Map<string, { player: Player; at: number }>();
let sweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Note that a phone is alive. Called from the poll, from a press and from a
 * join — every route a phone can possibly touch — because an arcade player
 * holding a d-pad deliberately stops polling for the phone view while they hold
 * it, and would otherwise be swept mid-game for the crime of playing.
 */
export function touchPlayer(playerId: string): void {
  // Only ids actually at the table, or the map grows an entry for every stale
  // playerId a pocketed phone from last week's game polls us with.
  if (!playerId || !session?.players.some((p) => p.id === playerId)) return;
  lastSeen.set(playerId, Date.now());
}

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
      // Everyone gets a clean clock across a restart. lastSeen lives in memory
      // only, so without this every player in the restored session looks like
      // they have been silent since 1970 and the first sweep empties the table
      // — the brain coming back would clear the room it was meant to rejoin.
      const now = Date.now();
      for (const p of session.players) lastSeen.set(p.id, now);
      forgetFrame();
      startTicker();
      startSweeper();
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
    stopSweeper();
    forgetFrame();
    lastSeen.clear();
    departed.clear();
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

/**
 * The last frame we actually sent, serialised.
 *
 * A ticking game publishes whether or not anything moved, so Meteor sitting on
 * its game-over card was broadcasting a full frame fourteen times a second, for
 * as long as nobody pressed anything — to a kiosk face and to every listening
 * client, on a Pi, forever. Hot Potato was nearly as bad: the fuse ticks four
 * times a second but it is DRAWN as a twelve-character bar, so eleven ticks in
 * twelve rendered a frame byte-identical to the one before it.
 *
 * The comparison is a JSON.stringify of the rendered frame rather than a deep
 * walk of it. That is a deliberate trade: stringify allocates, but it is one
 * tight pass in native code over a few KB — tens of microseconds at 14Hz, which
 * is nothing next to the socket writes, the JSON the broadcast does anyway, and
 * the config write behind save(). A hand-rolled deep compare would avoid the
 * allocation and cost more to get right, and it would still have to walk the
 * same tree.
 *
 * It covers the PHONES as well as the face, even though only the face is
 * broadcast, because `version` is what phones poll on: a frame whose face is
 * unchanged but whose phones are not must still move the version, or the phone
 * holding the bomb never finds out it has it.
 */
let lastFrameJson: string | null = null;

/** Forget the last frame, so the next publish always goes out. */
function forgetFrame(): void {
  lastFrameJson = null;
}

/** Push the current frame to the face and bump the version phones poll on. */
function publish(opts: { fromTick?: boolean } = {}): void {
  const d = def();
  if (!session || !d) return;
  const frame = guard("render", () => d.render(session!.state as never, session!.players), null);
  if (!frame) return;
  // Every frame carries the game's identity, so the face can wear it: the icon
  // sits on the board strip and the colour tints the moment. A game that does
  // not choose a colour for a particular beat inherits its own, which means no
  // two games ever look the same across the room.
  const face = { ...frame.face, color: frame.face.color ?? d.color, icon: d.icon, accent: d.color };
  // A game may put anything at all in face.canvas. If it cannot be serialised
  // we simply cannot dedup this frame, which is a missed saving and never a
  // reason to drop it.
  let json: string | null = null;
  try {
    json = JSON.stringify({ face, phones: frame.phones });
  } catch { json = null; }
  if (json !== null && json === lastFrameJson) return;
  lastFrameJson = json;
  session.version += 1;
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

/**
 * Presses on an arcade game ride the tick instead of publishing themselves.
 *
 * Four phones holding a d-pad send a press every 90ms each — roughly forty
 * presses a second — and each one was broadcasting its own frame. Meteor is
 * already redrawing the room fourteen times a second on its own clock, so those
 * forty frames bought nothing but traffic.
 *
 * Only for games that tick FAST. The ceiling is the worst delay a press may
 * suffer, and at 120ms that is below what a hand notices; Hot Potato at 250ms
 * and the quiz games at 500ms are outside it, and they keep publishing the
 * instant you press, because a pass or an answer that takes a visible moment to
 * register feels like a phone that did not hear you.
 */
const COALESCE_MAX_TICK_MS = 120;
function pressRidesTheTick(d: GameDefinition<never>): boolean {
  return !!ticker && !!d.tick && !!d.tickMs && d.tickMs <= COALESCE_MAX_TICK_MS;
}

/**
 * Sweep the table for phones that have stopped talking to us.
 *
 * It runs on its own clock rather than inside startTicker, because most games
 * here are turn-based and have no tick at all — and a turn-based game is
 * exactly the kind that grinds to a halt when the person whose turn it is has
 * gone. Presence cannot be a favour that only arcade games get.
 *
 * It is deliberately quiet while the game is SUSPENDED. The back arrow means
 * "put this away and pick it up later", which may be an hour later; nobody is
 * polling in the meantime, so a sweep would empty the table and call it
 * absence. Everyone gets a fresh clock when the game comes back.
 */
function startSweeper(): void {
  stopSweeper();
  sweeper = setInterval(() => {
    if (!session || suspended) return;
    const now = Date.now();
    const gone = session.players.filter((p) => now - (lastSeen.get(p.id) ?? 0) > ABSENT_MS);
    for (const p of gone) void removePlayer(p.id, "absent");
    // Old chairs are cleared here rather than on a clock of their own; this
    // interval is already running and the map is a handful of entries.
    for (const [id, rec] of departed) if (now - rec.at > REINSTATE_MS) departed.delete(id);
  }, SWEEP_MS);
  // The sweep must never be the reason a Pi stays awake.
  sweeper.unref?.();
}

function stopSweeper(): void {
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
}

/**
 * A phone has left, on purpose or by silence.
 *
 * It goes through the SAME queue as a press, and that is not tidiness. act()
 * may await the brain for half a second; a sweep firing in that window would
 * take a player off the roster while the game was midway through deciding what
 * their press meant, and then applyAction would write its result — computed
 * against a table that still had them in it — straight over the top. Removal is
 * an action on the table like any other, so it queues like one.
 */
export function leaveGame(playerId: string): Promise<{ ok: boolean; error?: string }> {
  return removePlayer(playerId, "left");
}

function removePlayer(playerId: string, why: "left" | "absent"): Promise<{ ok: boolean; error?: string }> {
  const mine = actQueue.then(() => applyRemoval(playerId, why));
  actQueue = mine.catch(() => undefined);
  return mine;
}

function applyRemoval(playerId: string, why: "left" | "absent"): { ok: boolean; error?: string } {
  const d = def();
  if (!session || !d) return { ok: false, error: "no game running" };
  const idx = session.players.findIndex((p) => p.id === playerId);
  if (idx < 0) return { ok: false, error: "not at this table" };
  const player = session.players[idx]!;

  /**
   * Roster first, hook second.
   *
   * Everything a game reads about who is at the table comes from this array —
   * ctx.players, the `players` argument to render(), the score strip, the list
   * of people you may pass the bomb to. Pruning it before calling leave() means
   * the hook sees the world it is tidying up FOR, and it means the large
   * majority of games that define no hook at all still get most of what they
   * need for free: the leaver simply stops being rendered.
   */
  session.players.splice(idx, 1);
  lastSeen.delete(playerId);
  departed.set(playerId, { player, at: Date.now() });

  if (d.leave) {
    // Same contract as act(): a throwing hook ends the game rather than
    // wedging it. Losing a round beats a table that cannot be pressed.
    const next = guard("leave", () => d.leave!(session!.state as never, player, context()) as unknown, null);
    if (next === null) return { ok: false, error: "that game just ended" };
    session.state = next;
  }

  /**
   * What a game that defines NO leave() is promised, and what it is not.
   *
   * Promised: the roster is correct, so anything derived from ctx.players or
   * from render()'s `players` argument is correct — the score strip, the list
   * of people you may name, minPlayers checks, "waiting for one more phone".
   *
   * Not promised: that state which holds an id in a POSITION is repaired. A
   * bomb on a departed holder, a turn order with a ghost in it, a round whose
   * fraud has gone home. The engine cannot guess what handing those on should
   * mean, and guessing wrong is worse than doing nothing. It cannot CRASH a
   * game either way, because every game already resolves ids through the
   * roster and falls back rather than indexing into it — but it can leave the
   * table waiting, and that is precisely what leave() is for.
   */
  logger.info({ playerId, why, left: session.players.length, gameId: session.gameId }, "games: a phone left the table");

  // An empty table stops the clock. Meteor at fourteen ticks a second with
  // nobody watching is pure heat, and the state is kept exactly as it was, so
  // the first phone back finds the round where the room left it.
  if (session.players.length === 0) stopTicker();

  publish();
  return { ok: true };
}

export function currentSession(): { gameId: string; version: number; players: Array<{ id: string; name: string }> } | null {
  return session ? { gameId: session.gameId, version: session.version, players: session.players.map((p) => ({ id: p.id, name: p.name })) } : null;
}

export async function startGame(gameId: string): Promise<{ ok: boolean; error?: string; playCode?: string }> {
  const d = GAMES[gameId];
  if (!d) return { ok: false, error: "unknown game" };
  stopTicker();
  stopSweeper();
  // A new code every game, so last week's players cannot wander back in — and
  // for the same reason, last game's chairs are not kept warm for this one.
  playCode = mintPlayCode();
  suspended = false;
  lastSeen.clear();
  departed.clear();
  forgetFrame();
  session = { gameId, startedAt: Date.now(), players: [], state: d.create({ players: [] }) as unknown, version: 0 };
  startTicker();
  startSweeper();
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
  // The face has been cleared, so the next frame must go out even if it is
  // identical to the one showing when the game was put away.
  forgetFrame();
  broadcast({ type: "game.frame", source: "games", payload: { gameId: null, version: session.version, face: null }, timestamp: new Date().toISOString() });
  void save(true);
}

/** Put a suspended game back on the face. */
export function resumeGame(): boolean {
  if (!session) return false;
  suspended = false;
  // Nobody was expected to be polling while it was away, so nobody has been
  // absent. Everyone starts again from now and the sweep begins from there.
  const now = Date.now();
  for (const p of session.players) lastSeen.set(p.id, now);
  forgetFrame();
  startTicker();
  startSweeper();
  publish();
  return true;
}

/** True when a game is loaded but deliberately off the face. */
export function isSuspended(): boolean {
  return !!session && suspended;
}

export async function endGame(): Promise<void> {
  stopTicker();
  stopSweeper();
  forgetFrame();
  lastSeen.clear();
  departed.clear();
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
    if (known) { touchPlayer(known.id); return { playerId: known.id }; }
  }
  if (session.players.length >= d.maxPlayers) return { error: "table is full" };

  /**
   * Coming back to your own chair.
   *
   * A phone keeps its player id in localStorage, so the one that was swept for
   * silence asks to join with the id it had. Giving it a NEW id would make a
   * returning player a stranger to their own scores — and it is what turns a
   * presence timeout that fires slightly too eagerly from a lost game into a
   * missed turn. This is the safety net that lets ABSENT_MS be brisk.
   *
   * The seat comes back too. Seats are only ever handed out above the highest
   * one in use, so the chair this player left was never given to anyone else.
   */
  const back = existingId ? departed.get(existingId) : undefined;
  const player: Player = back
    ? back.player
    : {
      id: randomUUID().slice(0, 8),
      name: (name || `Player ${session.players.length + 1}`).slice(0, 16),
      joinedAt: Date.now(),
      seat: session.players.reduce((max, p) => Math.max(max, p.seat + 1), 0),
    };
  if (back) departed.delete(player.id);
  session.players.push(player);
  // Marked alive before join() runs, so a join is itself a full heartbeat and
  // nobody can be swept in the window between sitting down and their phone's
  // first poll a second later.
  touchPlayer(player.id);
  /**
   * join() is called again for a returning player, and every game's join() is
   * already written to be idempotent — they all check whether they know this id
   * before dealing anything. That is what makes reinstatement free: the game
   * decides whether coming back means "here are your lives again" or "you still
   * have exactly what you had", and it has already made that decision.
   */
  const joined = guard("join", () => d.join(session!.state as never, player) as unknown, null);
  if (joined === null) return { error: "that game just ended" };
  session.state = joined;
  // The clock stops when the room empties; the first phone back starts it.
  if (!suspended && !ticker) startTicker();
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
  // A press is proof of life. It has to be, because a held d-pad deliberately
  // stops fetching the phone view while the finger is down.
  touchPlayer(playerId);
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
  // On a fast arcade game the tick is a moment away and will carry this press
  // out with everything else that happened in the same frame.
  if (!pressRidesTheTick(d)) publish();
  return { ok: true };
}

/**
 * What this phone should show right now.
 *
 * Also the heartbeat. The poll is the only signal a phone gives off without
 * being asked, so presence is read from exactly the call the phone was already
 * making — no extra route, no extra request, nothing for a game to remember to
 * do. It is a side effect in a function that otherwise only reads, which is
 * worth naming rather than hiding.
 */
export function viewFor(playerId: string) {
  touchPlayer(playerId);
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
