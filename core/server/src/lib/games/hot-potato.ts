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
  /** Total the fuse started at, so the face can show how far it has burned. */
  fuseTotal: number;
  /** Words already used this round; saying one again does not count. */
  said: string[];
  /** Lives. Three strikes and you are out of the game. */
  lives: Record<string, number>;
  lastBoom: string | null;
  round: number;
}

const TICK_MS = 250;
/** 18 to 45 seconds, and nobody is told which. */
const FUSE_MIN = Math.round(18_000 / TICK_MS);
const FUSE_MAX = Math.round(45_000 / TICK_MS);
const START_LIVES = 3;

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
    said: [], lives: {}, lastBoom: null, round: 0,
  }),

  join: (state, player) => (state.lives[player.id] === undefined
    ? { ...state, lives: { ...state.lives, [player.id]: START_LIVES } }
    : state),

  act: (state, player, action, value, ctx): HotPotatoState => {
    if (action === "start" || action === "again") {
      const alive = Object.keys(state.lives);
      if (alive.length < 2) return state;
      const lives = action === "again"
        ? Object.fromEntries(alive.map((id) => [id, START_LIVES]))
        : state.lives;
      return {
        ...state,
        phase: "live",
        round: state.round + 1,
        category: CATEGORIES[Math.floor(ctx.random() * CATEGORIES.length)]!,
        holderId: alive[Math.floor(ctx.random() * alive.length)]!,
        fuse: FUSE_MIN + Math.floor(ctx.random() * (FUSE_MAX - FUSE_MIN)),
        fuseTotal: FUSE_MAX,
        said: [],
        lives,
        lastBoom: null,
      };
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
      return { ...state, said: [...state.said, word] };
    }

    if (action === "next" && (state.phase === "boom")) {
      const alive = Object.entries(state.lives).filter(([, n]) => n > 0).map(([id]) => id);
      if (alive.length < 2) return { ...state, phase: "over" };
      return {
        ...state,
        phase: "live",
        round: state.round + 1,
        category: CATEGORIES[Math.floor(ctx.random() * CATEGORIES.length)]!,
        holderId: alive[Math.floor(ctx.random() * alive.length)]!,
        fuse: FUSE_MIN + Math.floor(ctx.random() * (FUSE_MAX - FUSE_MIN)),
        said: [],
        lastBoom: null,
      };
    }
    return state;
  },

  tick: (state): HotPotatoState => {
    if (state.phase !== "live") return state;
    const fuse = state.fuse - 1;
    if (fuse > 0) return { ...state, fuse };
    // Boom. Whoever is holding it loses a life.
    const lives = { ...state.lives, [state.holderId]: Math.max(0, (state.lives[state.holderId] ?? 1) - 1) };
    return { ...state, fuse: 0, phase: "boom", lives, lastBoom: state.holderId };
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
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Hot Potato",
          body: "Name something from the category, then choose who gets the bomb next. Three lives each.",
          choices: players.length >= 2 ? [{ action: "start", label: "Start" }] : [],
        };
      } else if (state.phase === "live" && p.id === holder) {
        // Holder: type the word, then pick a victim. Both on one screen.
        phones[p.id] = {
          title: `Name ${state.category}`,
          body: state.said.length ? `Said already: ${state.said.join(", ")}` : "Say one out loud, type it, then pass.",
          input: { action: "said", placeholder: "your answer", maxLength: 40 },
          choices: alive.filter((o) => o.id !== p.id).map((o) => ({
            action: "pass", label: `Pass to ${o.name}`, value: o.id,
          })),
          yourTurn: true,
        };
      } else if (state.phase === "live") {
        phones[p.id] = {
          title: out ? "You're out" : "Not you",
          body: `${nameOf(holder)} is holding it.`,
          secret: out ? undefined : "Look innocent.",
        };
      } else if (state.phase === "boom") {
        phones[p.id] = {
          title: state.lastBoom === p.id ? "It went off on you" : `${nameOf(state.lastBoom ?? "")} got it`,
          body: `${state.lives[p.id] ?? 0} lives left.`,
          choices: [{ action: "next", label: "Next round" }],
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
