import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Read the Room — everyone answers a question. One of you answered a different one.
 *
 * Nobi asks the room a question out loud, but the question on your phone is the
 * one that counts — and exactly one player has been given a slightly different
 * one. Everybody types an answer. Nobi reads them all out in his own voice, in
 * a shuffled order, and the room works out whose answer belongs to a different
 * question.
 *
 * The impostor does not know they are the impostor at first, which is the good
 * part: they answer honestly, hear their own answer read back, and only then
 * realise everyone is looking at them. They win by not being caught; everyone
 * else wins by catching them.
 *
 * This only works with a phone each — the answers must be written at the same
 * time and in private — so it asks for three, and it is the game to hand a
 * group of strangers at a stand.
 */

type Phase = "lobby" | "writing" | "reading" | "voting" | "reveal";

interface Answer {
  playerId: string;
  text: string;
}

export interface RoomState {
  phase: Phase;
  round: number;
  /** What the room hears, and what most phones are shown. */
  askedAloud: string;
  commonPrompt: string;
  oddPrompt: string;
  /** Whose phone got the different question. */
  oddPlayerId: string;
  answers: Answer[];
  /** Shuffled for reading out; indexes into answers. */
  order: string[];
  /** How far through reading them we are. */
  readIndex: number;
  votes: Record<string, string>;   // voter → suspected
  scores: Record<string, number>;
  lastResult?: { caught: boolean; oddName: string; oddPrompt: string; commonPrompt: string };
}

/** A fallback pair so the game still plays with no network. */
const OFFLINE: Array<{ asked: string; common: string; odd: string }> = [
  { asked: "Name something you would take to a desert island.", common: "Name something you would take to a desert island.", odd: "Name something you would take to a wedding." },
  { asked: "What is the worst thing to find in a fridge?", common: "What is the worst thing to find in a fridge?", odd: "What is the worst thing to find in a suitcase?" },
  { asked: "Describe your ideal Sunday in three words.", common: "Describe your ideal Sunday in three words.", odd: "Describe your ideal Monday in three words." },
  { asked: "Something you would never lend to a friend.", common: "Something you would never lend to a friend.", odd: "Something you would never lend to a stranger." },
];

const nameOf = (players: Player[], id: string) => players.find((p) => p.id === id)?.name ?? "someone";

export const readTheRoom: GameDefinition<RoomState> = {
  id: "read-the-room",
  title: "Read the Room",
  blurb: "Everyone answers a question. One of you answered a different one. Find them.",
  icon: "🎭",
  color: "#ff8fb0",
  minPlayers: 3,
  maxPlayers: 8,

  create: () => ({
    phase: "lobby", round: 0, askedAloud: "", commonPrompt: "", oddPrompt: "", oddPlayerId: "",
    answers: [], order: [], readIndex: 0, votes: {}, scores: {},
  }),

  join: (state, player) => (state.scores[player.id] === undefined
    ? { ...state, scores: { ...state.scores, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<RoomState> => {
    if (action === "start" || action === "again") {
      const players = Object.keys(state.scores);
      if (players.length < 3) return state;
      const pair = await freshPair(ctx);
      const odd = players[Math.floor(ctx.random() * players.length)]!;
      return {
        ...state,
        phase: "writing",
        round: state.round + 1,
        askedAloud: pair.asked,
        commonPrompt: pair.common,
        oddPrompt: pair.odd,
        oddPlayerId: odd,
        answers: [],
        order: [],
        readIndex: 0,
        votes: {},
        lastResult: undefined,
      };
    }

    if (action === "answer" && state.phase === "writing") {
      const text = (value ?? "").trim().slice(0, 60);
      if (!text) return state;
      if (state.answers.some((a) => a.playerId === player.id)) return state;
      const answers = [...state.answers, { playerId: player.id, text }];
      const everyone = Object.keys(state.scores);
      if (answers.length < everyone.length) return { ...state, answers };
      // All in: shuffle for reading, so the order gives nothing away.
      const order = answers.map((a) => a.playerId);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      return { ...state, answers, order, phase: "reading", readIndex: 0 };
    }

    // Anyone can advance the reading; it is a shared moment, not a turn.
    if (action === "read-next" && state.phase === "reading") {
      const next = state.readIndex + 1;
      return next >= state.order.length
        ? { ...state, readIndex: next, phase: "voting" }
        : { ...state, readIndex: next };
    }

    if (action === "vote" && state.phase === "voting") {
      // A choice button sends its LABEL, which here is the suspect's NAME — so
      // the vote has to be turned back into a player id. Comparing the raw value
      // to an id silently matched nobody, and every round ended a draw.
      const raw = (value ?? "").trim();
      const byId = Object.keys(state.scores).find((id) => id === raw);
      const byName = ctx.players.find((p) => p.name === raw)?.id;
      const suspect = byId ?? byName ?? "";
      if (!suspect || suspect === player.id) return state;
      const votes = { ...state.votes, [player.id]: suspect };
      const everyone = Object.keys(state.scores);
      if (Object.keys(votes).length < everyone.length) return { ...state, votes };

      // Tally. The odd one out is caught if they take the most votes outright.
      const tally: Record<string, number> = {};
      for (const s of Object.values(votes)) tally[s] = (tally[s] ?? 0) + 1;
      const top = Math.max(...Object.values(tally));
      const leaders = Object.entries(tally).filter(([, n]) => n === top).map(([id]) => id);
      const caught = leaders.length === 1 && leaders[0] === state.oddPlayerId;

      const scores = { ...state.scores };
      if (caught) {
        // Everyone who pointed at them scores; the impostor gets nothing.
        for (const [voter, suspected] of Object.entries(votes)) {
          if (suspected === state.oddPlayerId) scores[voter] = (scores[voter] ?? 0) + 1;
        }
      } else {
        // Got away with it — worth more than a single correct vote.
        scores[state.oddPlayerId] = (scores[state.oddPlayerId] ?? 0) + 2;
      }
      return {
        ...state,
        phase: "reveal",
        votes,
        scores,
        lastResult: { caught, oddName: "", oddPrompt: state.oddPrompt, commonPrompt: state.commonPrompt },
      };
    }
    return state;
  },

  render: (state, players) => {
    const waiting = players.filter((p) => !state.answers.some((a) => a.playerId === p.id));
    const reading = state.order[state.readIndex];
    const readingAnswer = state.answers.find((a) => a.playerId === reading);

    const face = {
      title: state.phase === "lobby" ? "Read the Room" : `Read the Room · round ${state.round}`,
      body:
        state.phase === "lobby"
          ? players.length < 3
            ? `Three phones needed. ${players.length} so far.`
            : "Everyone has a phone. Press Start."
          : state.phase === "writing"
            ? `${state.askedAloud}   ·   waiting on ${waiting.length}`
            : state.phase === "reading"
              ? `“${readingAnswer?.text ?? ""}”`
              : state.phase === "voting"
                ? "Who answered a different question?"
                : state.lastResult?.caught
                  ? `Caught. ${nameOf(players, state.oddPlayerId)} was asked: ${state.oddPrompt}`
                  : `Got away with it. ${nameOf(players, state.oddPlayerId)} was asked: ${state.oddPrompt}`,
      mood: state.phase === "reveal" ? (state.lastResult?.caught ? "excited" : "mischievous") : state.phase === "reading" ? "curious" : "happy",
      color: state.phase === "reveal" ? (state.lastResult?.caught ? "#5ce0b8" : "#ff8fb0") : "#c9dcf0",
      scene: null,
      // He asks the question aloud, and reads each answer aloud. That is the game.
      speak:
        state.phase === "writing" && state.answers.length === 0 ? state.askedAloud
          : state.phase === "reading" && readingAnswer ? readingAnswer.text
            : undefined,
      scores: players.map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0 })),
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const isOdd = p.id === state.oddPlayerId;
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Read the Room",
          body: players.length < 3
            ? `Waiting for phones. ${players.length} of 3.`
            : "Everyone gets a question. One of you gets a different one.",
          choices: players.length >= 3 ? [{ action: "start", label: "Start" }] : [],
        };
      } else if (state.phase === "writing") {
        const done = state.answers.some((a) => a.playerId === p.id);
        phones[p.id] = {
          title: done ? "Answer in" : "Your question",
          // The impostor is simply shown a different question. They are not told.
          body: done ? `Waiting for ${waiting.length} more.` : (isOdd ? state.oddPrompt : state.commonPrompt),
          input: done ? undefined : { action: "answer", placeholder: "a few words", maxLength: 60 },
          yourTurn: !done,
        };
      } else if (state.phase === "reading") {
        phones[p.id] = {
          title: `Answer ${state.readIndex + 1} of ${state.order.length}`,
          body: `“${readingAnswer?.text ?? ""}”`,
          choices: [{ action: "read-next", label: state.readIndex + 1 >= state.order.length ? "That's all — vote" : "Next answer" }],
        };
      } else if (state.phase === "voting") {
        const voted = state.votes[p.id];
        phones[p.id] = {
          title: voted ? "Voted" : "Who was it?",
          body: voted ? "Waiting for the others." : "Pick the one who answered a different question.",
          choices: voted ? [] : players.filter((o) => o.id !== p.id).map((o) => ({
            action: "vote",
            label: o.name,
            // The vote is a player ID; the name is only what you read.
            value: o.id,
            detail: state.answers.find((a) => a.playerId === o.id)?.text,
          })),
        };
      } else {
        phones[p.id] = {
          title: state.lastResult?.caught ? "Caught them" : "They got away",
          body: isOdd
            ? `You were the odd one. Yours was: ${state.oddPrompt}`
            : `${nameOf(players, state.oddPlayerId)} was asked: ${state.oddPrompt}`,
          secret: isOdd ? "That was you all along." : undefined,
          choices: [{ action: "again", label: "Another round" }],
        };
      }
    }
    return { face, phones };
  },
};

/** Two questions that look like the same question. */
async function freshPair(ctx: GameContext): Promise<{ asked: string; common: string; odd: string }> {
  try {
    const raw = await ctx.narrate(
      [
        "Invent a round for a party guessing game.",
        "Write TWO questions that sound like the same kind of question, so that answers to them are hard to tell apart,",
        "but different enough that a careful listener could notice. Keep both under twelve words.",
        "Reply on exactly two lines, nothing else:",
        "A: <the question most players get>",
        "B: <the question one player gets instead>",
      ].join("\n"),
      60,
    );
    const a = raw.match(/^A:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const b = raw.match(/^B:\s*(.+)$/im)?.[1]?.trim() ?? "";
    if (a && b && a.toLowerCase() !== b.toLowerCase()) return { asked: a, common: a, odd: b };
  } catch { /* fall through */ }
  return OFFLINE[Math.floor(Math.random() * OFFLINE.length)]!;
}
