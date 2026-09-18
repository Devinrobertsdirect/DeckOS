import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Wavelength — how close is your head to everyone else's?
 *
 * One player (the PSYCHIC) is shown a spectrum — "cold to hot", "useless to
 * essential" — and a hidden target somewhere along it. They say ONE clue out
 * loud. Everyone else then turns a dial trying to land where they think the
 * target is, and scores by how close they get.
 *
 * The whole game is calibration. The clue "coffee" on cold-to-hot means 80% to
 * one person and 95% to another, and the argument about which is right is the
 * entire point. Nobody is being tested on knowledge; you are being tested on
 * how well you know the person giving the clue.
 *
 * It belongs on a round screen more than on a table, because the dial IS a dial
 * — the face draws the spectrum as an arc with a needle on it, and the target
 * band only appears when everyone has locked in.
 */

type Phase = "lobby" | "clue" | "guessing" | "reveal";

/** Scoring bands, as a fraction of the whole spectrum. */
const BULLSEYE = 0.04;   // 4 either side — dead on
const CLOSE = 0.10;
const NEAR = 0.18;

export interface WaveState {
  phase: Phase;
  round: number;
  /** Whose turn it is to give the clue. */
  psychicId: string;
  /** Turn order so the psychic role goes round fairly. */
  order: string[];
  /** The spectrum, and where the target sits on it (0..1). */
  left: string;
  right: string;
  target: number;
  clue: string;
  /** playerId -> their dial position (0..1). */
  guesses: Record<string, number>;
  scores: Record<string, number>;
  used: string[];
}

/** Written spectra. Good ones are opinions, not facts. */
const OFFLINE: Array<[string, string]> = [
  ["Cold", "Hot"],
  ["Useless", "Essential"],
  ["Underrated", "Overrated"],
  ["Forgettable", "Unforgettable"],
  ["A chore", "A treat"],
  ["Badly behaved", "Well behaved"],
  ["Cheap", "Expensive"],
  ["Quiet", "Loud"],
  ["Embarrassing", "Impressive"],
  ["A want", "A need"],
  ["Ugly", "Beautiful"],
  ["Safe", "Dangerous"],
  ["Childish", "Grown up"],
  ["Fashion crime", "Peak style"],
  ["Round", "Pointy"],
  ["A job", "A calling"],
];

export const wavelength: GameDefinition<WaveState> = {
  id: "wavelength",
  title: "Wavelength",
  blurb: "One of you sees a hidden spot on a scale and gives a one word clue. The rest turn the dial.",
  icon: "🎯",
  color: "#5ce0b8",
  minPlayers: 2,
  maxPlayers: 8,

  create: () => ({
    phase: "lobby", round: 0, psychicId: "", order: [], left: "", right: "",
    target: 0.5, clue: "", guesses: {}, scores: {}, used: [],
  }),

  join: (state, player) => (state.scores[player.id] === undefined
    ? { ...state, scores: { ...state.scores, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<WaveState> => {
    if (action === "start" || action === "again") {
      if (state.phase !== "lobby" && state.phase !== "reveal") return state;
      const roster = ctx.players.map((p) => p.id);
      if (roster.length < 2) return state;
      // The psychic role moves along the table rather than being random, so
      // everybody gets a go and nobody gets three in a row.
      const order = roster;
      const previous = state.order.indexOf(state.psychicId);
      const nextIdx = state.order.length && previous >= 0 ? (previous + 1) % order.length : 0;
      const spectrum = await freshSpectrum(state.used, ctx);
      const scores = { ...state.scores };
      for (const id of roster) if (scores[id] === undefined) scores[id] = 0;
      return {
        ...state,
        phase: "clue",
        round: state.round + 1,
        order,
        psychicId: order[Math.min(nextIdx, order.length - 1)]!,
        left: spectrum[0],
        right: spectrum[1],
        // Never the exact middle or the very ends: those make for a dull clue.
        target: 0.1 + ctx.random() * 0.8,
        clue: "",
        guesses: {},
        scores,
        used: [...state.used, `${spectrum[0]}/${spectrum[1]}`].slice(-12),
      };
    }

    if (action === "clue" && state.phase === "clue") {
      if (player.id !== state.psychicId) return state;
      const clue = (value ?? "").trim().slice(0, 40);
      if (!clue) return state;
      return { ...state, clue, phase: "guessing" };
    }

    // The psychic has walked off: anyone can hand the role on rather than
    // sitting in front of a spectrum nobody is allowed to describe.
    if (action === "pass-psychic" && state.phase === "clue") {
      if (player.id === state.psychicId) return state;
      const idx = state.order.indexOf(state.psychicId);
      const next = state.order[(idx + 1) % state.order.length];
      return { ...state, psychicId: next ?? player.id };
    }

    if (action === "guess" && state.phase === "guessing") {
      if (player.id === state.psychicId) return state;          // they know the answer
      const at = Number(value);
      if (!Number.isFinite(at) || at < 0 || at > 1) return state;
      const guesses = { ...state.guesses, [player.id]: at };
      // Everyone except the psychic has to be in.
      const others = ctx.players.filter((p) => p.id !== state.psychicId);
      const allIn = others.length > 0 && others.every((p) => guesses[p.id] !== undefined);
      if (!allIn) return { ...state, guesses };
      return { ...state, guesses, phase: "reveal", scores: settle(state, guesses, ctx.players) };
    }

    // Close it early when somebody has clearly wandered off.
    if (action === "close" && state.phase === "guessing") {
      return { ...state, phase: "reveal", scores: settle(state, state.guesses, ctx.players) };
    }
    return state;
  },

  render: (state, players) => {
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
    const others = players.filter((p) => p.id !== state.psychicId);
    const waiting = others.filter((p) => state.guesses[p.id] === undefined);
    const table = players
      .map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0, active: p.id === state.psychicId }))
      .sort((a, b) => b.score - a.score);

    const face = {
      title: state.phase === "lobby" ? "Wavelength" : `${state.left}  ←→  ${state.right}`,
      body:
        state.phase === "lobby"
          ? players.length < 2 ? "Two phones needed." : "One of you sees the target. The rest guess."
          : state.phase === "clue"
            ? `${nameOf(state.psychicId)} can see the target. Waiting for a clue.`
            : state.phase === "guessing"
              ? `“${state.clue}”   ·   waiting on ${waiting.length}`
              : `It was here. ${bestLine(state, players)}`,
      big: state.phase === "guessing" || state.phase === "reveal" ? state.clue : undefined,
      mood: state.phase === "reveal" ? "excited" : state.phase === "guessing" ? "curious" : "thinking",
      color: "#5ce0b8",
      scene: null,
      // The face draws the real thing: an arc, a needle per player, and the
      // target band revealed only at the end.
      canvas: {
        kind: "wavelength",
        phase: state.phase,
        left: state.left,
        right: state.right,
        target: state.phase === "reveal" ? state.target : null,
        bands: { bullseye: BULLSEYE, close: CLOSE, near: NEAR },
        needles: players
          .filter((p) => state.guesses[p.id] !== undefined)
          .map((p) => ({ name: p.name, at: state.guesses[p.id]!, show: state.phase === "reveal" })),
      },
      speak:
        state.phase === "guessing" && Object.keys(state.guesses).length === 0
          ? `${state.clue}. Turn your dials.`
          : state.phase === "reveal" ? bestLine(state, players) : undefined,
      scores: table,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const isPsychic = p.id === state.psychicId;
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Wavelength",
          body: players.length < 2 ? `Waiting for phones. ${players.length} of 2.`
            : "One of you sees a hidden spot on a scale and gives a ONE word clue. Everyone else guesses where it was.",
          choices: players.length >= 2 ? [{ action: "start", label: "Start" }] : [],
        };
      } else if (state.phase === "clue") {
        phones[p.id] = isPsychic
          ? {
            title: `${state.left} ←→ ${state.right}`,
            // The number is the secret. Showing a percentage rather than a
            // picture is deliberate: it is precise, and the whole skill is
            // turning a precise number into an imprecise word.
            body: `Your target: ${Math.round(state.target * 100)}% toward ${state.right}.`,
            secret: "Say one word out loud. Do not say a number.",
            input: { action: "clue", placeholder: "your one word clue", maxLength: 40 },
            yourTurn: true,
          }
          : {
            title: "Wait",
            body: `${nameOf(state.psychicId)} is thinking of a clue.`,
            choices: [{ action: "pass-psychic", label: "Pass it to the next player" }],
          };
      } else if (state.phase === "guessing") {
        const mine = state.guesses[p.id];
        phones[p.id] = isPsychic
          ? { title: "Say nothing", body: `You said “${state.clue}”. Now let them argue.`, secret: `It was ${Math.round(state.target * 100)}%.`,
            choices: waiting.length ? [{ action: "close", label: "Close it early" }] : [] }
          : mine !== undefined
            ? { title: "Locked in", body: `${Math.round(mine * 100)}%. Waiting on ${waiting.length}.` }
            : {
              title: `“${state.clue}”`,
              body: `${state.left} on the left, ${state.right} on the right. Where was it?`,
              // Eleven stops is enough resolution to argue about and few enough
              // to be a row of buttons on a phone.
              choices: Array.from({ length: 11 }, (_, i) => ({
                action: "guess",
                label: `${i * 10}%`,
                value: String(i / 10),
              })),
              yourTurn: true,
            };
      } else {
        const mine = state.guesses[p.id];
        phones[p.id] = {
          title: mine === undefined ? "You sat that one out" : scoreWord(Math.abs(mine - state.target)),
          body: `It was ${Math.round(state.target * 100)}% toward ${state.right}. The clue was “${state.clue}”.`,
          choices: [{ action: "again", label: "Next round" }],
        };
      }
    }
    return { face, phones };
  },
};

/** Points by distance, and the psychic shares whatever the table earns. */
function settle(state: WaveState, guesses: Record<string, number>, players: Player[]): Record<string, number> {
  const scores = { ...state.scores };
  let table = 0;
  for (const p of players) {
    if (p.id === state.psychicId) continue;
    const at = guesses[p.id];
    if (at === undefined) continue;
    const d = Math.abs(at - state.target);
    const points = d <= BULLSEYE ? 4 : d <= CLOSE ? 3 : d <= NEAR ? 2 : 0;
    scores[p.id] = (scores[p.id] ?? 0) + points;
    table += points;
  }
  // The psychic scores on how well the ROOM did, which is what makes them work
  // at the clue rather than showing off with something only they would get.
  if (state.psychicId) scores[state.psychicId] = (scores[state.psychicId] ?? 0) + Math.round(table / Math.max(1, players.length - 1));
  return scores;
}

function scoreWord(d: number): string {
  return d <= BULLSEYE ? "Dead on — 4" : d <= CLOSE ? "Close — 3" : d <= NEAR ? "Near — 2" : "Miles off";
}

function bestLine(state: WaveState, players: Player[]): string {
  const ranked = players
    .filter((p) => p.id !== state.psychicId && state.guesses[p.id] !== undefined)
    .map((p) => ({ name: p.name, d: Math.abs(state.guesses[p.id]! - state.target) }))
    .sort((a, b) => a.d - b.d);
  if (!ranked.length) return "Nobody guessed.";
  const best = ranked[0]!;
  return best.d <= BULLSEYE ? `${best.name} was dead on.` : `${best.name} was closest.`;
}

/** A spectrum, written or invented. Opinions make better ones than facts. */
async function freshSpectrum(used: string[], ctx: GameContext): Promise<[string, string]> {
  try {
    const raw = await ctx.narrate(
      [
        "Invent a spectrum for the party game Wavelength: two opposite ends of a scale that people would ARGUE about.",
        "Opinions, not facts. Good: 'Underrated / Overrated', 'A chore / A treat'. Bad: 'Small / Large'.",
        `Do not reuse: ${used.join(", ") || "none yet"}.`,
        "Reply with exactly two words or short phrases separated by a slash, nothing else.",
      ].join("\n"),
      20,
    );
    const parts = raw.split("/").map((s) => s.trim().replace(/^["']|["'.]+$/g, ""));
    if (parts.length === 2 && parts[0] && parts[1] && parts[0].length < 24 && parts[1].length < 24) {
      return [parts[0], parts[1]];
    }
  } catch { /* fall through */ }
  const spare = OFFLINE.filter((o) => !used.includes(`${o[0]}/${o[1]}`));
  const pool = spare.length ? spare : OFFLINE;
  return pool[Math.floor(ctx.random() * pool.length)]!;
}
