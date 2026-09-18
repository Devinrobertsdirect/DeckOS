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
  /**
   * Who has answered this round, and how they did.
   *
   * `early` is a flag rather than a reading of `ms === 0`, because a false start
   * has no honest time to report and 0 is a perfectly good number that a clamp
   * or a clock wobble could produce by accident. A mistake the game names out
   * loud ("too early" versus "wrong colour") must not rest on a falsy number.
   */
  answered: Record<string, { ms: number; right: boolean; early: boolean }>;
  scores: Record<string, number>;
  best: Record<string, number>;
  winner: string | null;
}

/** Nobody is quicker than this, so anything faster is a clock, not a thumb. */
const MIN_MS = 1;
/** The round is called after this long, so no time on screen may exceed it. */
const ROUND_MS = 3000;

/**
 * The roster is whoever is holding a phone RIGHT NOW, which is not the same as
 * whoever has a score. Someone who joined at round four has no score yet and
 * someone who put their phone down still has one, so reading the roster off
 * `scores` either hangs the round waiting on a ghost or quietly forgets a
 * newcomer. `ctx.players` is the only honest answer, and both act() and tick()
 * are handed it.
 */
function allAnswered(state: QuickColorsState, players: Player[]): boolean {
  // An empty table answers nothing; treating it as "everyone is done" would
  // flip a round on the very first tick after the last phone walked off.
  if (players.length === 0) return false;
  return players.every((p) => state.answered[p.id] !== undefined);
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
      // "Again" used to hand back `scores: {}`, which looks like a clean slate
      // and is in fact a lobotomy: the round-over check read its keys, so an
      // empty table meant "everyone has answered" and every round after a
      // rematch ended on the first tap. Rebuild the sheet from the live roster
      // instead — zeroed for a rematch, carried over for a restart — so the
      // scoreboard and the roster can never drift apart.
      const scores: Record<string, number> = {};
      for (const p of ctx.players) scores[p.id] = action === "again" ? 0 : (state.scores[p.id] ?? 0);
      if (scores[player.id] === undefined) scores[player.id] = action === "again" ? 0 : (state.scores[player.id] ?? 0);
      return {
        ...state,
        phase: "ready",
        round: 1,
        // 8 to 22 ticks of stillness, so the flash never lands on a beat.
        armIn: 8 + Math.floor(ctx.random() * 14),
        // A stale target or flash time outliving the reset is how a fresh round
        // reports a four-second reaction from the previous game.
        target: "",
        options: [],
        flashedAt: 0,
        answered: {},
        winner: null,
        scores,
        best: action === "again" ? {} : state.best,
      };
    }

    // A tap. Anything pressed before the flash is a false start.
    if (action === "pick") {
      if (state.phase === "ready") {
        if (state.answered[player.id] !== undefined) return state;  // already out this round
        // Jumped the gun: that is your answer for this round, and it is wrong.
        const answered = { ...state.answered, [player.id]: { ms: 0, right: false, early: true } };
        // If the whole table jumped, there is nothing left to wait for. Calling
        // it here rather than letting the flash land on a room that can no
        // longer answer saves everyone a silent five seconds staring at a phone
        // with no buttons on it.
        const done = allAnswered({ ...state, answered }, ctx.players);
        return { ...state, answered, phase: done ? "result" : state.phase };
      }
      if (state.phase !== "flash") return state;
      if (state.answered[player.id] !== undefined) return state;    // one guess each
      const right = (value ?? "") === state.target;
      // Clamped at both ends: a tap can arrive a hair before our own flash
      // timestamp on a loaded tick, and a phone that reconnects late must not
      // be credited with a nine-second reaction. Neither is a real reading.
      const ms = Math.min(ROUND_MS, Math.max(MIN_MS, ctx.now - state.flashedAt));
      const answered = { ...state.answered, [player.id]: { ms, right, early: false } };

      const scores = { ...state.scores };
      const best = { ...state.best };
      let winner = state.winner;
      if (right && winner === null) {
        // First correct thumb takes the point. Later correct answers still get
        // their time on screen, because beating your own best is the solo game.
        winner = player.id;
        scores[player.id] = (scores[player.id] ?? 0) + 1;
      }
      if (right && (best[player.id] === undefined || ms < best[player.id]!)) best[player.id] = ms;

      const next = { ...state, answered, scores, best, winner };
      return { ...next, phase: allAnswered(next, ctx.players) ? "result" : state.phase };
    }

    if (action === "next" && state.phase === "result") {
      if (state.round >= ROUNDS) return { ...state, phase: "over" };
      return {
        ...state,
        phase: "ready",
        round: state.round + 1,
        armIn: 8 + Math.floor(ctx.random() * 14),
        target: "",
        options: [],
        flashedAt: 0,
        answered: {},
        winner: null,
      };
    }
    return state;
  },

  tick: (state, ctx): QuickColorsState => {
    // The round can become finished without anybody pressing anything: the last
    // player who still owed an answer walks off, or a phone joins mid-round and
    // then leaves again. act() only runs on a tap, so if the check lived there
    // alone the round would sit there until the timeout — or, in the ready
    // phase, sit there for the flash and the full three seconds after it.
    if ((state.phase === "flash" || state.phase === "ready") && allAnswered(state, ctx.players)) {
      return { ...state, phase: "result" };
    }
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
    // Nobody answered in three seconds: call the round and move on. This is the
    // backstop for a table that has simply stopped playing, so it must not
    // depend on anyone being present. It can only fire once, because the very
    // act of firing leaves the flash phase behind. `flashedAt` is checked too:
    // a zeroed timestamp would read as thirty years elapsed and end the round
    // on the first tick of the flash.
    if (state.phase === "flash" && state.flashedAt > 0 && ctx.now - state.flashedAt > ROUND_MS) {
      return { ...state, phase: "result" };
    }
    return state;
  },

  render: (state, players) => {
    const name = (id: string | null) => players.find((p) => p.id === id)?.name ?? "";
    const table = players
      .map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0, active: p.id === state.winner }))
      .sort((a, b) => b.score - a.score);

    // A winner with no recorded answer should be impossible, but "undefined
    // milliseconds" spoken aloud from his face is the sort of thing a room
    // remembers, so the line only mentions a time when there is one.
    const winnerMs = state.winner !== null ? state.answered[state.winner]?.ms : undefined;

    const face = {
      title: state.phase === "lobby" ? "Quick Colors" : `Quick Colors · ${state.round}/${ROUNDS}`,
      body:
        state.phase === "lobby" ? "I flash a colour. Tap it first."
          : state.phase === "ready" ? "Wait for it…"
            : state.phase === "flash" ? "NOW"
              : state.phase === "result"
                ? (state.winner !== null
                  ? (winnerMs !== undefined ? `${name(state.winner)} — ${winnerMs} milliseconds.` : `${name(state.winner)} had it.`)
                  : "Nobody got that one.")
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
          title: mine ? (mine.right ? `${mine.ms}ms` : mine.early ? "Too early" : "Wrong one")
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
            : mine?.early ? "You went before the flash."
              : mine ? `Wrong colour, and ${mine.ms}ms wasted.` : "You did not answer.",
          choices: [{ action: "next", label: state.round >= ROUNDS ? "See the scores" : "Next colour" }],
        };
      } else {
        phones[p.id] = {
          title: "Final",
          // `undefined`, not falsy: a best time is a number, and a number that
          // reads as "no best time" the moment it hits zero is a bug waiting
          // for a faster thumb or a clamp.
          body: table.map((t) => `${t.name} ${t.score}`).join("   ")
            + (state.best[p.id] !== undefined ? `\n\nYour fastest: ${state.best[p.id]}ms` : ""),
          choices: [{ action: "again", label: "Again" }],
        };
      }
    }
    return { face, phones };
  },
};
