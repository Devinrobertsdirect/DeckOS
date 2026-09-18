import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Hot Potato — a live fuse, a category, and you choose who gets it next.
 *
 * Passing to a PERSON rather than "the next player" is the whole game. A
 * countdown going round a circle is a countdown; a countdown you can hand to
 * the friend who is already panicking is a social weapon, and the table starts
 * playing each other instead of the clock.
 *
 * The fuse length is hidden and random, so nobody can hold it for a safe three
 * seconds and pass on a beat. His face carries the tension — the eyes get worse
 * as it burns — which is the part a phone app cannot do.
 */

type Phase = "lobby" | "live" | "boom" | "over";

/** Categories that anyone can answer instantly, which is what keeps it moving. */
const CATEGORIES = [
  "a breakfast cereal", "a country in Europe", "something in a toolbox",
  "a board game", "something you find in a fridge", "a car brand",
  "an ice cream flavour", "something at the beach", "a superhero",
  "something in this room", "a pizza topping", "a job your parents understand",
  "a sport with a ball", "something that runs on batteries", "a fictional robot",
  "a thing you always lose", "a colour that is not a colour", "an excuse for being late",
];

export interface HotPotatoState {
  phase: Phase;
  category: string;
  /** Who is holding it. */
  holderId: string;
  /** Ticks remaining. HIDDEN from everyone — the point is not knowing. */
  fuse: number;
  /**
   * What THIS round's fuse started at, so the burning line can be drawn as a
   * fraction. It must be re-set every round alongside `fuse`: when it was
   * pinned to the longest possible fuse the bar started part-burned, and the
   * amount it was already missing told the room how short the fuse was — which
   * gave away the one thing the game keeps secret.
   */
  fuseTotal: number;
  /** Words already used this round; saying one again does not count. */
  said: string[];
  /** Lives. Three strikes and you are out of the game. */
  lives: Record<string, number>;
  lastBoom: string | null;
  round: number;
  /**
   * Ticks left on the pause after a bang before the next round starts on its
   * own. Somebody has to press "next" otherwise, and the person most likely to
   * be holding a dead or pocketed phone is the one who just got blown up.
   */
  pause: number;
  /**
   * Phones that arrived after the bomb was already lit. They sit out the rest
   * of this game rather than being handed three fresh lives mid-fight, and they
   * are dealt in on the next "again". Tracked separately from lives so their
   * phone can say "you are in next game" instead of the lie "you're out".
   */
  waiting: string[];
}

const TICK_MS = 250;
/** 18 to 45 seconds, and nobody is told which. */
const FUSE_MIN = Math.round(18_000 / TICK_MS);
const FUSE_MAX = Math.round(45_000 / TICK_MS);
const START_LIVES = 3;
/** Long enough to laugh at whoever got it, short enough that nobody has to tap. */
const BOOM_PAUSE = Math.round(8_000 / TICK_MS);
/**
 * A round's word list is shown on the holder's phone and kept for duplicate
 * checking, and a stubborn table can type into it all night. Keeping the last
 * forty is plenty for "you already said that" and stops one long round growing
 * a saved session without limit.
 */
const SAID_MAX = 40;

/** Everyone still in the fight. Written once so no reader of lives forgets the zero. */
function aliveIds(lives: Record<string, number>): string[] {
  return Object.entries(lives).filter(([, n]) => (n ?? 0) > 0).map(([id]) => id);
}

/**
 * Light a fresh fuse. Both halves move together on purpose — see fuseTotal.
 */
function beginRound(
  state: HotPotatoState,
  lives: Record<string, number>,
  waiting: string[],
  random: () => number,
): HotPotatoState {
  const alive = aliveIds(lives);
  const fuse = FUSE_MIN + Math.floor(random() * (FUSE_MAX - FUSE_MIN));
  return {
    ...state,
    phase: "live",
    round: state.round + 1,
    category: CATEGORIES[Math.floor(random() * CATEGORIES.length)]!,
    holderId: alive[Math.floor(random() * alive.length)]!,
    fuse,
    fuseTotal: fuse,
    said: [],
    lives,
    waiting,
    lastBoom: null,
    pause: 0,
  };
}

export const hotPotato: GameDefinition<HotPotatoState> = {
  id: "hot-potato",
  title: "Hot Potato",
  blurb: "Name one, then hand the bomb to whoever you like least. Fuse length is a secret.",
  icon: "💣",
  color: "#ff5e2b",
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: TICK_MS,

  create: () => ({
    phase: "lobby", category: "", holderId: "", fuse: 0, fuseTotal: 0,
    said: [], lives: {}, lastBoom: null, round: 0, pause: 0, waiting: [],
  }),

  /**
   * A phone that turns up in the lobby gets three lives; one that turns up
   * while a bomb is in the air gets none and a seat on the bench. Handing a
   * latecomer three lives mid-game hands them the game — everyone else has
   * been spending theirs — and it also makes them a legal target for a pass.
   */
  join: (state, player) => {
    if (state.lives[player.id] !== undefined) return state;
    if (state.phase === "lobby") {
      return { ...state, lives: { ...state.lives, [player.id]: START_LIVES } };
    }
    return {
      ...state,
      lives: { ...state.lives, [player.id]: 0 },
      waiting: [...(state.waiting ?? []), player.id],
    };
  },

  act: (state, player, action, value, ctx): HotPotatoState => {
    if (action === "start" || action === "again") {
      // "start" lights the first bomb of a game; "again" wipes the slate after
      // one. Neither may interrupt a live fuse, or any phone left on an old
      // screen could restart the round out from under the table.
      if (action === "start" && state.phase !== "lobby") return state;
      if (action === "again" && state.phase !== "over" && state.phase !== "boom") return state;
      const everyone = Object.keys(state.lives);
      const lives = action === "again"
        ? Object.fromEntries(everyone.map((id) => [id, START_LIVES]))
        : state.lives;
      // Count the players who will actually be holding lives, not every id the
      // game has ever seen: a bench full of latecomers is not a playable table.
      if (aliveIds(lives).length < 2) return state;
      return beginRound(state, lives, [], ctx.random);
    }

    /**
     * One action does both halves of a turn: the word and the choice of victim.
     * Splitting them into two taps would put a pause exactly where the game
     * wants none — you say a cereal and shove it at someone in one motion.
     */
    if (action === "pass" && state.phase === "live" && player.id === state.holderId) {
      const target = (value ?? "").trim();
      if (!target || target === player.id) return state;
      if ((state.lives[target] ?? 0) <= 0) return state;         // not to someone who is out
      return { ...state, holderId: target };
    }

    if (action === "said" && state.phase === "live" && player.id === state.holderId) {
      const word = (value ?? "").trim().slice(0, 40);
      if (!word) return state;
      const already = state.said.some((s) => s.toLowerCase() === word.toLowerCase());
      if (already) return state;                                  // say a new one
      return { ...state, said: [...state.said, word].slice(-SAID_MAX) };
    }

    if (action === "next" && state.phase === "boom") {
      if (aliveIds(state.lives).length < 2) return { ...state, phase: "over", pause: 0 };
      return beginRound(state, state.lives, state.waiting ?? [], ctx.random);
    }
    return state;
  },

  tick: (state, ctx): HotPotatoState => {
    // The bang is on a clock too, so a round never waits on a tap from the one
    // person whose phone just went into a pocket. The button is still there for
    // anyone who does not want to wait.
    if (state.phase === "boom") {
      const pause = (state.pause ?? 0) - 1;
      if (pause > 0) return { ...state, pause };
      if (aliveIds(state.lives).length < 2) return { ...state, pause: 0, phase: "over" };
      return beginRound(state, state.lives, state.waiting ?? [], ctx.random);
    }
    if (state.phase !== "live") return state;

    /**
     * The bomb must never be parked on somebody who is not in the fight — a
     * holder on zero lives (or an id the table no longer knows) would burn
     * down, "lose" a life they do not have, and hand the game a holder who can
     * never pass, which is the one way this game can sit still forever.
     */
    if ((state.lives[state.holderId] ?? 0) <= 0) {
      const alive = aliveIds(state.lives);
      if (alive.length < 2) return { ...state, fuse: 0, phase: "over", pause: 0 };
      return { ...state, holderId: alive[Math.floor(ctx.random() * alive.length)]! };
    }

    const fuse = state.fuse - 1;
    if (fuse > 0) return { ...state, fuse };
    // Boom. Whoever is holding it loses a life — including a holder who simply
    // sat there and never passed, which is the whole point of a live fuse.
    const lives = { ...state.lives, [state.holderId]: Math.max(0, (state.lives[state.holderId] ?? 1) - 1) };
    return { ...state, fuse: 0, phase: "boom", lives, lastBoom: state.holderId, pause: BOOM_PAUSE };
  },

  render: (state, players) => {
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
    const burned = state.fuseTotal ? 1 - state.fuse / state.fuseTotal : 0;
    // The fuse is shown as a burning line, never as a number. Knowing you have
    // four seconds is a different, worse game than suspecting you might.
    const LEN = 12;
    const left = Math.max(0, Math.round((1 - burned) * LEN));
    const fuseArt = `${"─".repeat(left)}💥`;

    const alive = players.filter((p) => (state.lives[p.id] ?? 0) > 0);
    const holder = state.holderId;
    const bench = new Set(state.waiting ?? []);
    /** True once the next tap can only reveal a winner, never light another fuse. */
    const finished = alive.length < 2;
    const lastSaid = state.said.slice(-8);

    const face = {
      title: state.phase === "lobby" ? "Hot Potato" : `Name ${state.category}`,
      body:
        state.phase === "lobby" ? "Name one, then hand it to someone. Do not be holding it at the end."
          : state.phase === "live" ? `${nameOf(holder)} has it`
            : state.phase === "boom" ? `${nameOf(state.lastBoom ?? "")} was holding it.`
              : `${alive[0]?.name ?? "Nobody"} survives.`,
      big: state.phase === "live" ? fuseArt : undefined,
      // He gets visibly more worried the longer it burns — that is the clock.
      mood: state.phase === "boom" ? "shocked"
        : state.phase === "over" ? "starstruck"
          : burned > 0.8 ? "scared" : burned > 0.5 ? "surprised" : "curious",
      color: state.phase === "boom" ? "#ff4d4d" : burned > 0.8 ? "#ff5e2b" : burned > 0.5 ? "#ff9f1c" : "#c9dcf0",
      scene: state.phase === "boom" ? "confetti" : null,
      speak:
        state.phase === "live" && state.said.length === 0 ? `Name ${state.category}. Then pass it.`
          : state.phase === "boom" ? `Boom. ${nameOf(state.lastBoom ?? "")}.`
            : state.phase === "over" ? `${alive[0]?.name ?? "Nobody"} wins.` : undefined,
      scores: players.map((p) => ({
        name: p.name,
        score: state.lives[p.id] ?? 0,
        active: p.id === holder && state.phase === "live",
      })),
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const out = (state.lives[p.id] ?? 0) <= 0;
      const waiting = bench.has(p.id);
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Hot Potato",
          body: players.length >= 2
            ? "Name something from the category, then choose who gets the bomb next. Three lives each."
            : "Waiting for one more phone — two to eight play.",
          choices: players.length >= 2 ? [{ action: "start", label: "Start" }] : [],
        };
      } else if (state.phase === "live" && p.id === holder) {
        // Holder: type the word, then pick a victim. Both on one screen.
        phones[p.id] = {
          title: `Name ${state.category}`,
          body: lastSaid.length
            ? `Said already: ${state.said.length > lastSaid.length ? "… " : ""}${lastSaid.join(", ")}`
            : "Say one out loud, type it, then pass.",
          input: { action: "said", placeholder: "your answer", maxLength: 40 },
          choices: alive.filter((o) => o.id !== p.id).map((o) => ({
            action: "pass", label: `Pass to ${o.name}`, value: o.id,
          })),
          yourTurn: true,
        };
      } else if (state.phase === "live") {
        phones[p.id] = {
          title: waiting ? "Next game" : out ? "You're out" : "Not you",
          body: waiting
            ? `${nameOf(holder)} is holding it. You are dealt in when this one ends.`
            : `${nameOf(holder)} is holding it.`,
          secret: out || waiting ? undefined : "Look innocent.",
        };
      } else if (state.phase === "boom") {
        phones[p.id] = {
          title: state.lastBoom === p.id ? "It went off on you" : `${nameOf(state.lastBoom ?? "")} got it`,
          body: waiting
            ? "You are dealt in on the next game."
            : `${state.lives[p.id] ?? 0} lives left.`,
          // The label has to be honest: after the last life is gone this button
          // shows the winner, it does not light another fuse.
          choices: [{ action: "next", label: finished ? "See who won" : "Next round" }],
        };
      } else {
        phones[p.id] = {
          title: alive[0]?.id === p.id ? "You survived" : `${alive[0]?.name ?? "Nobody"} survived`,
          body: "Three lives each, one bomb, no mercy.",
          choices: [{ action: "again", label: "Again" }],
        };
      }
    }
    return { face, phones };
  },
};

/** Kept for a later variant that asks the brain for fresh categories. */
export async function freshCategory(ctx: GameContext): Promise<string> {
  try {
    const raw = await ctx.narrate(
      "Name ONE category for a fast party game, in the form 'a pizza topping' or 'something in a toolbox'. Reply with the category only, under six words.",
      12,
    );
    const c = raw.trim().replace(/^["']|["'.]$/g, "");
    if (c && c.length < 40) return c;
  } catch { /* fall through */ }
  return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)]!;
}
