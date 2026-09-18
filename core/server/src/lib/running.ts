import { currentSession, listGames } from "./games/engine.js";

/**
 * running.ts — what is actually going on right now, so STOP can be honest.
 *
 * STOP used to be one broadcast that cut whatever speech was in flight. That is
 * fine when a robot is only ever doing one thing, and wrong the moment he is
 * doing two: a demo playing while a game sits on the table is a perfectly normal
 * state at a stand, and "stop" then has no single obvious meaning.
 *
 * So the robot keeps a list of the things a person would recognise as running,
 * and the remote asks. One thing running, it stops. Two, it asks which.
 *
 * Shows are the awkward member: they are played BY THE FACE, so the server has
 * no way to know one is on unless the face says so. It reports in at the start
 * and end of every show, and the report carries a timestamp so a face that
 * crashes mid-demo cannot leave a ghost in this list forever.
 */

export type RunningKind = "show" | "game" | "speech";

export interface RunningThing {
  kind: RunningKind;
  /** What to call it on a button: "Demo", "Dev's Dungeon". */
  label: string;
}

/** A show the face is playing, with the time it said so. */
let show: { name: string; at: number } | null = null;
/**
 * A show nobody ended. The longest scripted show runs a couple of minutes, so
 * anything still "playing" after five is a face that reloaded mid-demo and
 * never got to tell us it stopped.
 */
const SHOW_STALE_MS = 5 * 60_000;

const SHOW_LABELS: Record<string, string> = { demo: "Demo", pitch: "Introduction", order: "How to buy", meet: "Meeting someone" };

/** The face reports a show starting (`name`) or finishing (`null`). */
export function setShow(name: string | null): void {
  show = name ? { name, at: Date.now() } : null;
}

function liveShow(): string | null {
  if (!show) return null;
  if (Date.now() - show.at > SHOW_STALE_MS) { show = null; return null; }
  return show.name;
}

/**
 * Everything a person could sensibly ask him to stop, most interruptible first.
 * `speaking` comes from the caller because it lives in the voice route's state.
 */
export function running(opts: { speaking: boolean }): RunningThing[] {
  const out: RunningThing[] = [];

  const s = liveShow();
  if (s) out.push({ kind: "show", label: SHOW_LABELS[s] ?? "Show" });

  const session = currentSession();
  if (session) out.push({ kind: "game", label: gameLabel(session.gameId) });

  // Only worth offering on its own. If a show or a game is on, the talking is
  // part of it, and a button that says "Talking" next to "Demo" is a puzzle.
  if (opts.speaking && out.length === 0) out.push({ kind: "speech", label: "Talking" });

  return out;
}

/**
 * Titles come from the engine, looked up when they are needed.
 *
 * The engine used to push them here at import time, which made the two modules
 * import each other: loading this one loaded the engine, whose top-level
 * registration then ran before the table in this file existed. The robot
 * crashed on boot with "Cannot set properties of undefined", and the deploy
 * health gate rolled it straight back. Reading on demand keeps the dependency
 * pointing one way, and still leaves the engine the only place a game is named.
 */
function gameLabel(gameId: string): string {
  return listGames().find((g) => g.id === gameId)?.title ?? "Game";
}
