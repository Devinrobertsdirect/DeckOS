import type { GameDefinition, PhoneView, Player } from "./types.js";

/**
 * Quick Colors — his eyes flash a colour, first thumb to match it wins.
 *
 * The whole game is his face and your reflexes, which is exactly what this
 * machine is good at: a phone press reaches the face in about 26 milliseconds,
 * so "who was first" is a real answer rather than a guess. It is also the
 * cheapest possible demo of the eye colour wheel — the thing everyone reaches
 * for the moment they pick up the remote anyway.
 *
 * Deliberately playable by one person (chase your own best time) and better with
 * two, because at a stand the person who stops is usually alone.
 */

type Phase = "lobby" | "ready" | "flash" | "result" | "over";

const ROUNDS = 7;
/** Colours are drawn from these — far enough apart to tell at a glance, in a hurry. */
const PALETTE: Array<{ name: string; hex: string }> = [
  { name: "Red", hex: "#ff4d4d" },
  { name: "Orange", hex: "#ff9f1c" },
  { name: "Gold", hex: "#f5b83d" },
  { name: "Lime", hex: "#9ee04a" },
  { name: "Green", hex: "#3ddc84" },
  { name: "Mint", hex: "#5ce0b8" },
  { name: "Cyan", hex: "#3ad7ff" },
  { name: "Blue", hex: "#4d8cff" },
  { name: "Violet", hex: "#c08bff" },
  { name: "Magenta", hex: "#ff5ce0" },
  { name: "Rose", hex: "#ff8fb0" },
  { name: "Ice", hex: "#c9dcf0" },
];
/** How many swatches a phone shows. More is harder; six fits a thumb. */
const CHOICES = 6;

export interface QuickColorsState {
  phase: Phase;
  round: number;
  /** Ticks until the flash. Random, so nobody can drum the rhythm. */
  armIn: number;
  /** The colour to find, and the swatches it hides among. */
  target: string;
  options: Array<{ name: string; hex: string }>;
  /** When the colour appeared, for honest millisecond times. */
  flashedAt: number;
  /** Who has answered this round, and how they did. */
  answered: Record<string, { ms: number; right: boolean }>;
  scores: Record<string, number>;
  best: Record<string, number>;
  winner: string | null;
}

export const quickColors: GameDefinition<QuickColorsState> = {
  id: "quick-colors",
  title: "Quick Colors",
  blurb: "His eyes flash a colour. First thumb to match it takes the point.",
  icon: "🎨",
  color: "#3ad7ff",
  minPlayers: 1,
  maxPlayers: 6,
  tickMs: 100,

  create: () => ({
    phase: "lobby", round: 0, armIn: 0, target: "", options: [],
    flashedAt: 0, answered: {}, scores: {}, best: {}, winner: null,
  }),

  join: (state, player) => (state.scores[player.id] === undefined
    ? { ...state, scores: { ...state.scores, [player.id]: 0 } }
    : state),

  act: (state, player, action, value, ctx): QuickColorsState => {
    if (action === "start" || action === "again") {
      return {
        ...state,
        phase: "ready",
        round: 1,
        // 8 to 22 ticks of stillness, so the flash never lands on a beat.
        armIn: 8 + Math.floor(ctx.random() * 14),
        answered: {},
        winner: null,
        scores: action === "again" ? {} : state.scores,
        best: action === "again" ? {} : state.best,
      };
    }

    // A tap. Anything pressed before the flash is a false start.
    if (action === "pick") {
      if (state.phase === "ready") {
        // Jumped the gun: that is your answer for this round, and it is wrong.
        return { ...state, answered: { ...state.answered, [player.id]: { ms: 0, right: false } } };
      }
      if (state.phase !== "flash") return state;
      if (state.answered[player.id]) return state;            // one guess each
      const right = (value ?? "") === state.target;
      const ms = Math.max(1, ctx.now - state.flashedAt);
      const answered = { ...state.answered, [player.id]: { ms, right } };

      const scores = { ...state.scores };
      const best = { ...state.best };
      let winner = state.winner;
      if (right && !winner) {
        // First correct thumb takes the point. Later correct answers still get
        // their time on screen, because beating your own best is the solo game.
        winner = player.id;
        scores[player.id] = (scores[player.id] ?? 0) + 1;
      }
      if (right && (best[player.id] === undefined || ms < best[player.id]!)) best[player.id] = ms;

      const everyone = Object.keys(state.scores);
      const done = everyone.every((id) => answered[id]);
      return { ...state, answered, scores, best, winner, phase: done ? "result" : state.phase };
    }

    if (action === "next" && state.phase === "result") {
      if (state.round >= ROUNDS) return { ...state, phase: "over" };
      return {
        ...state,
        phase: "ready",
        round: state.round + 1,
        armIn: 8 + Math.floor(ctx.random() * 14),
        answered: {},
        winner: null,
      };
    }
    return state;
  },

  tick: (state, ctx): QuickColorsState => {
    if (state.phase === "ready") {
      const armIn = state.armIn - 1;
      if (armIn > 0) return { ...state, armIn };
      // Flash: pick a target and the swatches it hides among.
      const pool = [...PALETTE];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
      const options = pool.slice(0, CHOICES);
      const target = options[Math.floor(ctx.random() * options.length)]!.hex;
      return { ...state, phase: "flash", armIn: 0, target, options, flashedAt: ctx.now };
    }
    // Nobody answered in three seconds: call the round and move on.
    if (state.phase === "flash" && ctx.now - state.flashedAt > 3000) {
      return { ...state, phase: "result" };
    }
    return state;
  },

  render: (state, players) => {
    const name = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";
    const table = players
      .map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0, active: p.id === state.winner }))
      .sort((a, b) => b.score - a.score);

    const winnerMs = state.winner ? state.answered[state.winner]?.ms : undefined;

    const face = {
      title: state.phase === "lobby" ? "Quick Colors" : `Quick Colors · ${state.round}/${ROUNDS}`,
      body:
        state.phase === "lobby" ? "I flash a colour. Tap it first."
          : state.phase === "ready" ? "Wait for it…"
            : state.phase === "flash" ? "NOW"
              : state.phase === "result"
                ? (state.winner ? `${name(state.winner)} — ${winnerMs} milliseconds.` : "Nobody got that one.")
                : "That's the set.",
      big: state.phase === "flash" ? undefined : state.phase === "over" ? String(Math.max(0, ...Object.values(state.scores))) : undefined,
      // HIS EYES ARE THE GAME BOARD. On the flash they become the colour, full
      // brightness, nothing else on screen to read.
      color: state.phase === "flash" ? state.target : state.phase === "ready" ? "#2a3b52" : "#c9dcf0",
      mood: state.phase === "flash" ? "shocked" : state.phase === "result" ? (state.winner ? "excited" : "confused") : state.phase === "over" ? "starstruck" : "thinking",
      scene: null,
      speak:
        state.phase === "over"
          ? `Done. ${table[0] ? `${table[0].name} wins it.` : ""}`
          : state.phase === "lobby" ? "Watch my eyes. When they change, tap that colour first." : undefined,
      scores: table,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const mine = state.answered[p.id];
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Quick Colors",
          body: "Watch his eyes. When they flash, tap that colour before anyone else.",
          choices: [{ action: "start", label: "Start" }],
        };
      } else if (state.phase === "ready" || state.phase === "flash") {
        // The swatches are on the phone the whole time, so the only thing that
        // changes at the flash is his face — you watch HIM, not your screen.
        phones[p.id] = {
          // A false start and a wrong colour are different mistakes, and telling
          // someone they were "too early" when they were simply wrong is the
          // kind of small lie that makes a game feel broken.
          title: mine ? (mine.right ? `${mine.ms}ms` : mine.ms === 0 ? "Too early" : "Wrong one")
            : state.phase === "flash" ? "GO" : "Ready…",
          body: mine ? "Waiting for the others." : "Tap the colour his eyes turn.",
          choices: mine ? [] : state.options.map((o) => ({
            action: "pick", label: o.name, value: o.hex,
          })),
          yourTurn: !mine,
        };
      } else if (state.phase === "result") {
        phones[p.id] = {
          title: state.winner === p.id ? "You had it" : state.winner ? `${name(state.winner)} had it` : "Nobody had it",
          body: mine?.right ? `${mine.ms}ms${state.best[p.id] === mine.ms ? " — your best yet" : ""}`
            : mine?.ms === 0 ? "You went before the flash."
              : mine ? `Wrong colour, and ${mine.ms}ms wasted.` : "You did not answer.",
          choices: [{ action: "next", label: state.round >= ROUNDS ? "See the scores" : "Next colour" }],
        };
      } else {
        phones[p.id] = {
          title: "Final",
          body: table.map((t) => `${t.name} ${t.score}`).join("   ") + (state.best[p.id] ? `\n\nYour fastest: ${state.best[p.id]}ms` : ""),
          choices: [{ action: "again", label: "Again" }],
        };
      }
    }
    return { face, phones };
  },
};
