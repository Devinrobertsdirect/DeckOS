/**
 * games/types.ts — the shape every Nobi game takes.
 *
 * A game here is not a screen; it is a rule set with two audiences. The ROOM
 * watches the faceplate — a 480px circle with two expressive eyes — and each
 * player holds a phone that can show them something nobody else sees. That
 * split is the whole reason these games are worth making: a private second
 * screen per player is a mechanic most consoles cannot offer, and a round
 * screen with a face on it is a terrible rectangle but a wonderful character.
 *
 * So every game implements the same three things:
 *   join()   — someone picked up a phone
 *   act()    — a player did something
 *   render() — what the room sees, and what each phone sees
 *
 * Games are pure over their own state: the same state and action always give
 * the same result. The server owns the state, so a phone can lock, a player can
 * walk away, and the game is exactly where they left it when they come back.
 */

/** A player is a phone. The id is stable for as long as that phone keeps its tab. */
export interface Player {
  id: string;
  name: string;
  joinedAt: number;
  /** Turn order, assigned on join. */
  seat: number;
}

/** What the room sees on the faceplate. The face renderer knows how to draw these. */
export interface FaceView {
  /** The headline on the circle. Keep it short: it is read from across a table. */
  title?: string;
  /** A line of body text under it. */
  body?: string;
  /** Big centred text — a score, a countdown, a die result. */
  big?: string;
  /** His expression while this is on screen. */
  mood?: string;
  /** Eye colour for the moment. */
  color?: string;
  /** A background scene from the showcase set, when one suits. */
  scene?: string | null;
  /** Say this out loud (Rocky). Only when it earns the credits. */
  speak?: string;
  /** Names + scores down the side, when the game keeps score. */
  scores?: Array<{ name: string; score: number; active?: boolean }>;
  /** Free-form payload for a game that draws its own thing (Orbit, Eye Contact). */
  canvas?: Record<string, unknown>;
}

/** What ONE player sees on their phone. Private by construction. */
export interface PhoneView {
  title?: string;
  body?: string;
  /**
   * Buttons. `action` is handed back to act() verbatim.
   *
   * `value` is what act() receives. It defaults to the LABEL, which is a trap
   * worth naming: Same Page read its seat button as `Number(value)` while the
   * label said "Player 1", so `Number("Player 1")` was NaN and nobody could
   * ever take a seat — the game was unplayable from a phone while passing every
   * test that called the API with `value: "1"`. If act() compares against
   * anything other than the words on the button, set `value` explicitly.
   */
  choices?: Array<{ action: string; label: string; value?: string; detail?: string; disabled?: boolean }>;
  /** A free-text box, when the game wants words rather than a choice. */
  input?: { action: string; placeholder: string; maxLength?: number };
  /** Something only this player knows: a role, a hand, a secret roll. */
  secret?: string;
  /** A d-pad / tilt surface for the reaction and arcade games. */
  pad?: "dpad" | "tilt" | "tap";
  /** True when it is this player's turn — the phone makes that obvious. */
  yourTurn?: boolean;
}

export interface GameRender {
  face: FaceView;
  phones: Record<string, PhoneView>;
}

/** Everything a game may do besides changing its own state. */
export interface GameContext {
  /** Ask the brain for prose. Costs credits, so games use it sparingly. */
  narrate: (prompt: string, maxWords?: number) => Promise<string>;
  /** Deterministic within a turn, so a replay of the same state matches. */
  random: () => number;
  now: number;
  /**
   * Everyone at the table. A phone button sends its LABEL back as the value,
   * not an id, so any game that lets you pick a PERSON needs the roster here to
   * turn "Devin" back into a player id.
   */
  players: Player[];
}

export interface GameDefinition<S = unknown> {
  id: string;
  title: string;
  /** One line, shown on the game picker. */
  blurb: string;
  /**
   * The game's "app icon" and its colour. The picker is a grid of tiles, and a
   * grid of identical text buttons is unfindable — you hunt for a shape and a
   * colour long before you read a word. Every game owns one of each, and the
   * same colour carries through onto his face while that game is running, so
   * the room can tell at a glance which game is on.
   */
  icon: string;
  color: string;
  minPlayers: number;
  maxPlayers: number;
  /** Fresh state for a new session. */
  create: (opts: { players: Player[] }) => S;
  join: (state: S, player: Player) => S;
  /** A player acted. Return the new state; throw nothing — return state unchanged if the action is stale. */
  act: (state: S, player: Player, action: string, value: string | undefined, ctx: GameContext) => S | Promise<S>;
  /** Called on a timer when the game wants one (countdowns, moving targets). */
  tick?: (state: S, ctx: GameContext) => S;
  /** How often tick() should run, in ms. Omit for turn-based games. */
  tickMs?: number;
  render: (state: S, players: Player[]) => GameRender;
}

/** A live session of one game. */
export interface GameSession {
  gameId: string;
  startedAt: number;
  players: Player[];
  state: unknown;
  /** Bumped on every change so phones can poll cheaply. */
  version: number;
}
