import { getConfig, setConfig } from "../app-config.js";
import { logger } from "../logger.js";

/**
 * persist.ts — the things a game should still know next week.
 *
 * A game SESSION is deliberately throwaway: it lives in memory, it is saved so
 * a brain restart does not lose a round, and it dies when the table breaks up.
 * That is right for a round of Hot Potato and wrong for everything a person
 * built or earned — a quiz somebody wrote, a dungeon they have been exploring
 * for a month, a leaderboard with their name on it.
 *
 * So this is the other half: a small durable store, namespaced per game, that
 * outlives sessions, restarts and reboots. It is deliberately tiny and dumb —
 * a JSON blob in the same config store everything else uses — because a robot
 * with no database should not grow one to remember twelve quiz questions.
 *
 * Writes are cached and flushed on a short timer, so a game that saves after
 * every answer does not hammer the Pi's storage.
 */

const KEY = "NOBI_GAME_STORE";
/** Bumped if the shape ever changes in a way old data cannot survive. */
const VERSION = 1;
/** Hard ceiling. A robot's config file is not a database. */
const MAX_BYTES = 256 * 1024;

interface Store {
  version: number;
  /** One bag per game id. A game may put whatever it likes in its own. */
  games: Record<string, unknown>;
}

let cache: Store | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = await getConfig(KEY).catch(() => null);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      if (parsed?.version === VERSION && parsed.games) { cache = parsed; return cache; }
      logger.info({ found: parsed?.version, want: VERSION }, "game store: dropping data from an older shape");
    }
  } catch { /* a corrupt blob is not worth losing the robot over */ }
  cache = { version: VERSION, games: {} };
  return cache;
}

/** Everything this game has kept, or `fallback` the first time it asks. */
export async function readGameData<T>(gameId: string, fallback: T): Promise<T> {
  const store = await load();
  const found = store.games[gameId];
  return (found === undefined ? fallback : found) as T;
}

/**
 * Keep something for this game. Returns immediately; the write lands within a
 * second or so, because a quiz being saved should never make a button feel slow.
 */
export async function writeGameData<T>(gameId: string, value: T): Promise<void> {
  const store = await load();
  store.games[gameId] = value;
  dirty = true;
  if (!flushTimer) flushTimer = setTimeout(() => { void flush(); }, 800);
}

/** Force the pending write out now — used when something must not be lost. */
export async function flush(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!dirty || !cache) return;
  dirty = false;
  try {
    const json = JSON.stringify(cache);
    if (json.length > MAX_BYTES) {
      // Refusing is better than silently truncating somebody's quiz, and far
      // better than filling the config file until nothing else can be saved.
      logger.warn({ bytes: json.length, max: MAX_BYTES }, "game store: too large, refusing to save");
      return;
    }
    await setConfig(KEY, json);
  } catch (err) {
    logger.error({ err }, "game store: could not save");
  }
}

/**
 * A lifetime scoreboard, shared by any game that wants one.
 *
 * Kept by NAME rather than by player id on purpose: a phone gets a fresh id
 * every time its browser tab is replaced, and a leaderboard that forgets you
 * because you reloaded is not a leaderboard. The name is what people recognise
 * anyway — it is what they typed when they sat down.
 */
export interface Standing { name: string; points: number; games: number; bestAt: string }

export async function addScores(gameId: string, results: Array<{ name: string; points: number }>): Promise<void> {
  if (!results.length) return;
  const board = await readGameData<Record<string, Standing>>(`${gameId}:board`, {});
  for (const r of results) {
    const key = r.name.trim().toLowerCase().slice(0, 24);
    if (!key) continue;
    const prev = board[key] ?? { name: r.name.trim().slice(0, 24), points: 0, games: 0, bestAt: "" };
    board[key] = {
      name: r.name.trim().slice(0, 24),
      points: prev.points + Math.max(0, Math.round(r.points)),
      games: prev.games + 1,
      bestAt: new Date().toISOString(),
    };
  }
  // Keep the top 50. A stand gets through a lot of names in a day and nobody
  // is scrolling to 137th place.
  const trimmed = Object.entries(board)
    .sort(([, a], [, b]) => b.points - a.points)
    .slice(0, 50);
  await writeGameData(`${gameId}:board`, Object.fromEntries(trimmed));
}

export async function topScores(gameId: string, limit = 5): Promise<Standing[]> {
  const board = await readGameData<Record<string, Standing>>(`${gameId}:board`, {});
  return Object.values(board).sort((a, b) => b.points - a.points).slice(0, limit);
}
