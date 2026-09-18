import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Read the Room — everyone knows the thing. One of you is faking it.
 *
 * Every phone is given the same CHARACTER or THING, except one, which just says
 * FRAUD. Then he goes round the circle asking each player in turn for a single
 * word related to it. The fraud has to work out what everyone is talking about
 * from the words already said, and then say something that sounds like they
 * knew all along.
 *
 * The first round is the cruel one: an early speaker gives the fraud almost
 * nothing, and the fraud speaking first is nearly dead. That is the game.
 *
 * From the second round on, anyone can say they think they have it. Guessing is
 * a real bet — name the fraud and you win outright, name the wrong person and
 * the fraud wins. Nobody has to guess, so a table that is unsure can keep
 * circling and gather another word each, which is the pressure that makes the
 * fraud sweat.
 */

type Phase = "lobby" | "speaking" | "accusing" | "reveal";

export interface RoomState {
  phase: Phase;
  round: number;
  /** What everyone except the fraud was given. */
  subject: string;
  fraudId: string;
  /** Turn order, fixed for the game so "the circle" means something. */
  order: string[];
  /** Whose turn it is to say a word, as an index into `order`. */
  turn: number;
  /** Every word said, in order, so the table can see the trail. */
  words: Array<{ playerId: string; word: string }>;
  /** Who asked to accuse, and what they are being asked. */
  accuserId: string;
  scores: Record<string, number>;
  result: null | {
    /** Did somebody accuse, and were they right? */
    accuserId: string;
    accusedId: string;
    correct: boolean;
    subject: string;
  };
  used: string[];
}

/** A round can be called from round 2 onwards — one full circle of evidence first. */
const ACCUSE_FROM_ROUND = 2;

/** Offline subjects: concrete, widely known, and rich in related words. */
const OFFLINE = [
  "a hospital", "Batman", "a wedding", "the beach", "a supermarket",
  "Harry Potter", "a gym", "an aeroplane", "a farm", "a birthday party",
  "a courtroom", "space", "a barber shop", "Christmas", "a zoo",
  "a haunted house", "a football match", "a coffee shop", "a library", "a casino",
];

export const readTheRoom: GameDefinition<RoomState> = {
  id: "read-the-room",
  title: "Read the Room",
  blurb: "Everyone gets the same thing. One of you gets FRAUD. Say a word each and find them.",
  icon: "🎭",
  color: "#ff8fb0",
  minPlayers: 3,
  maxPlayers: 10,

  create: () => ({
    phase: "lobby", round: 0, subject: "", fraudId: "", order: [], turn: 0,
    words: [], accuserId: "", scores: {}, result: null, used: [],
  }),

  join: (state, player) => (state.scores[player.id] === undefined
    ? { ...state, scores: { ...state.scores, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<RoomState> => {
    if (action === "start" || action === "again") {
      const players = Object.keys(state.scores);
      if (players.length < 3) return state;
      const subject = await freshSubject(state.used, ctx);
      // Shuffle the speaking order: who goes first is most of the luck, so it
      // should not be the same person every game.
      const order = [...players];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      return {
        ...state,
        phase: "speaking",
        round: 1,
        subject,
        used: [...state.used, subject].slice(-20),
        fraudId: players[Math.floor(ctx.random() * players.length)]!,
        order,
        turn: 0,
        words: [],
        accuserId: "",
        result: null,
      };
    }

    if (action === "word" && state.phase === "speaking") {
      // Only the player whose turn it is, so the circle stays a circle.
      if (state.order[state.turn] !== player.id) return state;
      const word = (value ?? "").trim().slice(0, 24);
      if (!word) return state;
      const words = [...state.words, { playerId: player.id, word }];
      const nextTurn = state.turn + 1;
      if (nextTurn < state.order.length) return { ...state, words, turn: nextTurn };
      // The circle closed. One full round of words is not enough to accuse on —
      // the table is only asked from the SECOND completed circle onwards, and
      // after every circle after that.
      const completed = state.round;
      return {
        ...state,
        words,
        turn: 0,
        round: completed + 1,
        phase: completed >= ACCUSE_FROM_ROUND ? "accusing" : "speaking",
      };
    }

    // "I think I know" — from here it is a bet, not a vote.
    if (action === "accuse" && state.phase === "accusing") {
      return { ...state, accuserId: player.id };
    }

    if (action === "keep-going" && state.phase === "accusing") {
      return { ...state, phase: "speaking", accuserId: "" };
    }

    if (action === "name" && state.phase === "accusing" && state.accuserId === player.id) {
      const accusedId = (value ?? "").trim();
      // `!scores[id]` would be true for anyone on ZERO points, quietly making
      // the players most likely to be accused unaccusable.
      if (!accusedId || state.scores[accusedId] === undefined) return state;
      const correct = accusedId === state.fraudId;
      const scores = { ...state.scores };
      if (correct) {
        // Everyone but the fraud takes a point; the caller takes an extra.
        for (const id of Object.keys(scores)) if (id !== state.fraudId) scores[id] = (scores[id] ?? 0) + 1;
        scores[player.id] = (scores[player.id] ?? 0) + 1;
      } else {
        // A wrong call ends it and hands the fraud the round outright.
        scores[state.fraudId] = (scores[state.fraudId] ?? 0) + 3;
      }
      return {
        ...state,
        phase: "reveal",
        scores,
        result: { accuserId: player.id, accusedId, correct, subject: state.subject },
      };
    }
    return state;
  },

  render: (state, players) => {
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
    const speaker = state.order[state.turn];
    const trail = state.words.map((w) => `${nameOf(w.playerId)}: ${w.word}`);
    const lastWord = state.words[state.words.length - 1];

    const face = {
      title: state.phase === "lobby" ? "Read the Room" : `Read the Room · round ${state.round}`,
      body:
        state.phase === "lobby"
          ? players.length < 3 ? `Three phones needed. ${players.length} so far.` : "Everyone has a phone. Press Start."
          : state.phase === "speaking"
            ? `${nameOf(speaker ?? "")}, say one word.`
            : state.phase === "accusing"
              ? state.accuserId ? `${nameOf(state.accuserId)} is naming someone.` : "Anyone got it? Or go round again."
              : state.result
                ? state.result.correct
                  ? `Got them. It was ${nameOf(state.fraudId)}. The thing was ${state.result.subject}.`
                  : `Wrong. ${nameOf(state.result.accusedId)} was innocent — the fraud was ${nameOf(state.fraudId)}.`
                : "",
      big: state.phase === "speaking" && lastWord ? lastWord.word : undefined,
      mood: state.phase === "reveal"
        ? (state.result?.correct ? "excited" : "mischievous")
        : state.phase === "accusing" ? "suspicious" : "curious",
      color: state.phase === "reveal" ? (state.result?.correct ? "#5ce0b8" : "#ff5470") : "#ff8fb0",
      scene: state.phase === "reveal" ? (state.result?.correct ? "confetti" : null) : null,
      // He runs the circle out loud: naming who is up is what keeps a table of
      // strangers moving without anyone having to take charge.
      speak:
        state.phase === "speaking" && state.words.length === 0 && state.round === 1
          ? "Everyone has the same thing, except one of you. Say one word each. Go."
          : state.phase === "speaking" ? `${nameOf(speaker ?? "")}.`
            : state.phase === "reveal" && state.result
              ? state.result.correct
                ? `Correct. ${nameOf(state.fraudId)} was the fraud, and the thing was ${state.result.subject}.`
                : `No. ${nameOf(state.result.accusedId)} was innocent. ${nameOf(state.fraudId)} gets away with it.`
              : undefined,
      scores: players.map((p) => ({ name: p.name, score: state.scores[p.id] ?? 0, active: p.id === speaker && state.phase === "speaking" })),
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const isFraud = p.id === state.fraudId;

      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Read the Room",
          body: players.length < 3
            ? `Waiting for phones. ${players.length} of 3.`
            : "Everyone gets the same thing. One of you gets FRAUD, and has to fake it.",
          choices: players.length >= 3 ? [{ action: "start", label: "Start" }] : [],
        };
      } else if (state.phase === "speaking") {
        const mine = state.order[state.turn] === p.id;
        phones[p.id] = {
          // The secret is on screen the whole time, because forgetting your own
          // word is not a fun way to lose.
          title: isFraud ? "You are the FRAUD" : state.subject,
          body: mine
            ? isFraud
              ? "Your turn. Say something that sounds like you know."
              : "Your turn. One word related to it — not too obvious."
            : `${nameOf(speaker ?? "")} is up.`,
          secret: trail.length ? trail.join("  ·  ") : undefined,
          input: mine ? { action: "word", placeholder: "one word", maxLength: 24 } : undefined,
          yourTurn: mine,
        };
      } else if (state.phase === "accusing") {
        if (state.accuserId === p.id) {
          phones[p.id] = {
            title: "Name the fraud",
            body: "Right, and everyone but them scores. Wrong, and the fraud takes the round.",
            choices: players.filter((o) => o.id !== p.id).map((o) => ({ action: "name", label: o.name, value: o.id })),
            yourTurn: true,
          };
        } else if (state.accuserId) {
          phones[p.id] = { title: "Hold on", body: `${nameOf(state.accuserId)} thinks they have it.`, secret: trail.join("  ·  ") };
        } else {
          phones[p.id] = {
            title: isFraud ? "You are the FRAUD" : state.subject,
            body: "Do you know who it is? Calling it wrong hands them the round.",
            secret: trail.join("  ·  "),
            choices: [
              { action: "accuse", label: "I know who it is" },
              { action: "keep-going", label: "Go round again" },
            ],
          };
        }
      } else {
        phones[p.id] = {
          title: state.result?.correct ? "Caught" : "Got away with it",
          body: isFraud
            ? `You were the fraud. The thing was ${state.result?.subject}.`
            : `It was ${nameOf(state.fraudId)}. The thing was ${state.result?.subject}.`,
          secret: trail.join("  ·  "),
          choices: [{ action: "again", label: "Another round" }],
        };
      }
    }
    return { face, phones };
  },
};

/** Something concrete enough that everyone can find a word for it. */
async function freshSubject(used: string[], ctx: GameContext): Promise<string> {
  try {
    const raw = await ctx.narrate(
      [
        "Name ONE thing for a party guessing game: a place, a well known fictional character, or an event.",
        "It must be something almost anyone could say a related word about — 'a hospital', 'Batman', 'a wedding'.",
        `Do not pick any of these: ${used.join(", ") || "none yet"}.`,
        "Reply with the thing only, under four words, no punctuation.",
      ].join("\n"),
      12,
    );
    const s = raw.trim().replace(/^["']|["'.]+$/g, "");
    if (s && s.length <= 30 && !used.includes(s)) return s;
  } catch { /* fall through */ }
  const spare = OFFLINE.filter((o) => !used.includes(o));
  const pool = spare.length ? spare : OFFLINE;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
