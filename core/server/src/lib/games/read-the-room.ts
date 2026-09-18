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
  /**
   * HIS word — one related to the subject, given before anyone speaks and left
   * on screen all game. Without it the fraud speaking first has literally
   * nothing, which is not a hard round, it is an unplayable one. One word is
   * enough to bluff from and nowhere near enough to be safe.
   */
  seed: string;
  fraudId: string;
  /**
   * Turn order, fixed for the round so "the circle" means something.
   *
   * Anyone who joins mid-round is deliberately NOT in here. Adding them would
   * put a player in the naming list who cannot possibly be the fraud, and since
   * naming wrong hands the fraud the round outright, that is a trap rather than
   * a welcome. They pick up their points from the next round.
   */
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
const OFFLINE: Array<{ subject: string; seed: string }> = [
  { subject: "a hospital", seed: "bed" }, { subject: "Batman", seed: "night" },
  { subject: "a wedding", seed: "dress" }, { subject: "the beach", seed: "sand" },
  { subject: "a supermarket", seed: "trolley" }, { subject: "Harry Potter", seed: "school" },
  { subject: "a gym", seed: "sweat" }, { subject: "an aeroplane", seed: "window" },
  { subject: "a farm", seed: "mud" }, { subject: "a birthday party", seed: "candles" },
  { subject: "a courtroom", seed: "silence" }, { subject: "space", seed: "cold" },
  { subject: "a barber shop", seed: "mirror" }, { subject: "Christmas", seed: "lights" },
  { subject: "a zoo", seed: "fence" }, { subject: "a haunted house", seed: "stairs" },
  { subject: "a football match", seed: "crowd" }, { subject: "a coffee shop", seed: "queue" },
  { subject: "a library", seed: "quiet" }, { subject: "a casino", seed: "chips" },
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
    phase: "lobby", round: 0, subject: "", seed: "", fraudId: "", order: [], turn: 0,
    words: [], accuserId: "", scores: {}, result: null, used: [],
  }),

  // A score entry only. The circle for the round in play is already dealt, so a
  // late arrival watches this one and is seated when the next one is shuffled.
  join: (state, player) => (state.scores[player.id] === undefined
    ? { ...state, scores: { ...state.scores, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<RoomState> => {
    if (action === "start" || action === "again") {
      // Only ever from the two phases that offer it. Without this a stale phone
      // holding the lobby frame can reshuffle the circle mid-round, which reads
      // as the game randomly forgetting itself.
      if (state.phase !== "lobby" && state.phase !== "reveal") return state;
      // The roster, not the score table: someone who has drifted off still has
      // a score, and seating a phone that is no longer there stalls the circle.
      const players = ctx.players.length ? ctx.players.map((p) => p.id) : Object.keys(state.scores);
      if (players.length < 3) return state;
      const { subject, seed } = await freshSubject(state.used, ctx);
      // Shuffle the speaking order: who goes first is most of the luck, so it
      // should not be the same person every game.
      const order = [...players];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      // Everyone at the table starts the round on a score, including anyone who
      // sat the last one out. A missing entry is not the same as zero here:
      // `scores` is also the list of who may be named.
      const scores = { ...state.scores };
      for (const id of players) if (scores[id] === undefined) scores[id] = 0;
      return {
        ...state,
        phase: "speaking",
        round: 1,
        subject,
        seed,
        used: [...state.used, subject].slice(-20),
        fraudId: players[Math.floor(ctx.random() * players.length)]!,
        order,
        scores,
        turn: 0,
        words: [],
        accuserId: "",
        result: null,
      };
    }

    if (action === "word" && state.phase === "speaking") {
      // Only the player whose turn it is, so the circle stays a circle.
      if (state.order[state.turn] !== player.id) return state;
      // ONE word. A phone keyboard will happily send a sentence, and a sentence
      // from an honest player gives the fraud the whole subject for free.
      const word = (value ?? "").trim().split(/\s+/)[0]?.slice(0, 24) ?? "";
      if (!word) return state;
      return advance(state, [...state.words, { playerId: player.id, word }]);
    }

    if (action === "skip" && state.phase === "speaking") {
      // A phone that has locked, gone flat or left the room stops the circle
      // dead, and nothing in the engine removes a player from the table. So the
      // rest of the table can move past whoever is up. Only THEY cannot press
      // it: if you are the one holding everyone up, type your word.
      if (state.order[state.turn] === player.id) return state;
      return advance(state, state.words);
    }

    // "I think I know" — from here it is a bet, not a vote.
    if (action === "accuse" && state.phase === "accusing") {
      // First hand up owns the call. Without this the second presser silently
      // takes the bet off the first, who is left watching someone else stake
      // the round on their behalf.
      if (state.accuserId) return state;
      return { ...state, accuserId: player.id };
    }

    if (action === "unaccuse" && state.phase === "accusing" && state.accuserId) {
      // Anyone can hand the call back — the accuser having second thoughts, or
      // the table when the accuser has gone quiet. The alternative is a phase
      // where everybody else has no button at all and the round never ends.
      return { ...state, accuserId: "" };
    }

    if (action === "keep-going" && state.phase === "accusing" && !state.accuserId) {
      // Another circle, and the accusation is offered again when it closes.
      return { ...state, phase: "speaking", round: state.round + 1, turn: 0, accuserId: "" };
    }

    if (action === "name" && state.phase === "accusing" && state.accuserId === player.id) {
      const accusedId = (value ?? "").trim();
      // `!scores[id]` would be true for anyone on ZERO points, quietly making
      // the players most likely to be accused unaccusable. And the name must be
      // someone in the circle: a player who joined mid-round was never dealt a
      // card, so naming them could only ever lose.
      if (!accusedId || accusedId === player.id) return state;
      if (state.scores[accusedId] === undefined || !state.order.includes(accusedId)) return state;
      const correct = accusedId === state.fraudId;
      const scores = { ...state.scores };
      if (correct) {
        // Everyone in the circle but the fraud takes a point; the caller takes
        // an extra. Scoring off `scores` instead would pay somebody who joined
        // after the cards were dealt and never said a word.
        for (const id of state.order) if (id !== state.fraudId) scores[id] = (scores[id] ?? 0) + 1;
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
            ? `${nameOf(speaker ?? "")}, say one word.${lastWord ? `   (last: ${lastWord.word})` : ""}`
            : state.phase === "accusing"
              ? state.accuserId ? `${nameOf(state.accuserId)} is naming someone.` : "Anyone got it? Or go round again."
              : state.result
                ? state.result.correct
                  ? `Got them. It was ${nameOf(state.fraudId)}. The thing was ${state.result.subject}.`
                  : `Wrong. ${nameOf(state.result.accusedId)} was innocent — the fraud was ${nameOf(state.fraudId)}.`
                : "",
      // The seed word stays on his face for the whole round, next to the round
      // number. It is the one thing everybody — fraud included — can see.
      big: state.phase !== "lobby" && state.seed ? state.seed.toUpperCase() : undefined,
      mood: state.phase === "reveal"
        ? (state.result?.correct ? "excited" : "mischievous")
        : state.phase === "accusing" ? "suspicious" : "curious",
      color: state.phase === "reveal" ? (state.result?.correct ? "#5ce0b8" : "#ff5470") : "#ff8fb0",
      scene: state.phase === "reveal" ? (state.result?.correct ? "confetti" : null) : null,
      // He runs the circle out loud: naming who is up is what keeps a table of
      // strangers moving without anyone having to take charge.
      speak:
        state.phase === "speaking" && state.words.length === 0 && state.round === 1
          ? `Everyone has the same thing, except one of you. I will start. My word is ${state.seed}. Now one word each.`
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
      } else if (!state.order.includes(p.id)) {
        // Joined after the cards were dealt. They watch the words go past with
        // no secret of their own, and they are told WHY they have no buttons —
        // a phone with nothing on it just looks broken.
        phones[p.id] = {
          title: "You are in next round",
          body: "This one was dealt before you sat down. Watch the words — you are in from the next round.",
          secret: trail.length ? trail.join("  ·  ") : undefined,
        };
      } else if (state.phase === "speaking") {
        const mine = state.order[state.turn] === p.id;
        phones[p.id] = {
          // The secret is on screen the whole time, because forgetting your own
          // word is not a fun way to lose.
          title: isFraud ? "You are the FRAUD" : state.subject,
          body: mine
            ? isFraud
              ? `His word was "${state.seed}". Say something that sounds like you know.`
              : "Your turn. One word related to it — not too obvious."
            : `${nameOf(speaker ?? "")} is up.   His word: ${state.seed}`,
          secret: trail.length ? trail.join("  ·  ") : undefined,
          input: mine ? { action: "word", placeholder: "one word", maxLength: 24 } : undefined,
          // The rest of the table can move past a phone that has died or left.
          // Nothing else can: the robot has no way of knowing a player has gone.
          choices: mine ? [] : [{ action: "skip", label: `Skip ${nameOf(speaker ?? "")}` }],
          yourTurn: mine,
        };
      } else if (state.phase === "accusing") {
        if (state.accuserId === p.id) {
          phones[p.id] = {
            title: "Name the fraud",
            body: "Right, and everyone but them scores. Wrong, and the fraud takes the round.",
            // Only players in the circle: naming a late arrival is a guaranteed
            // loss, and a button that can only lose should not be on the phone.
            choices: [
              ...players
                .filter((o) => o.id !== p.id && state.order.includes(o.id))
                .map((o) => ({ action: "name", label: o.name, value: o.id })),
              { action: "unaccuse", label: "Actually, not sure" },
            ],
            yourTurn: true,
          };
        } else if (state.accuserId) {
          phones[p.id] = {
            title: "Hold on",
            body: `${nameOf(state.accuserId)} thinks they have it.`,
            secret: trail.join("  ·  "),
            // One button, so a call nobody follows through on cannot freeze the
            // table on a screen with nothing to press.
            choices: [{ action: "unaccuse", label: "Take it back" }],
          };
        } else {
          phones[p.id] = {
            title: isFraud ? "You are the FRAUD" : state.subject,
            body: `His word was "${state.seed}". Do you know who it is? Calling it wrong hands them the round.`,
            secret: trail.join("  ·  "),
            choices: [
              { action: "accuse", label: "I know who it is" },
              { action: "keep-going", label: "Go round again" },
            ],
          };
        }
      } else {
        const thing = state.result?.subject || state.subject;
        phones[p.id] = {
          title: state.result?.correct ? "Caught" : "Got away with it",
          body: (isFraud
            ? `You were the fraud. The thing was ${thing}.`
            : `It was ${nameOf(state.fraudId)}. The thing was ${thing}.`)
            + (players.length < 3 ? " Another phone is needed for another round." : ""),
          secret: trail.join("  ·  "),
          // Three phones or the button would do nothing when pressed, which
          // looks exactly like a broken game rather than a short table.
          choices: players.length >= 3
            ? [{ action: "again", label: "Another round" }]
            : [],
        };
      }
    }
    return { face, phones };
  },
};

/**
 * Hand the turn on, and close the circle when it comes back round.
 *
 * A word and a skip share this because the two have to agree on when a circle
 * has ended: two copies of the same arithmetic is how you end up in "speaking"
 * with the turn pointing off the end of the order and not one phone able to do
 * anything.
 *
 * The round number is the circle being SPOKEN, so it is bumped when another
 * circle starts rather than when one finishes — otherwise his face announces
 * round three while the table is still being asked about circle two.
 */
function advance(state: RoomState, words: RoomState["words"]): RoomState {
  const nextTurn = state.turn + 1;
  if (nextTurn < state.order.length) return { ...state, words, turn: nextTurn };
  // A circle has closed. One circle of words is not enough to bet on, so the
  // table is only asked from the SECOND completed circle onwards — and then
  // after every circle, so "go round again" can never loop away from the offer.
  if (state.round >= ACCUSE_FROM_ROUND) return { ...state, words, turn: 0, phase: "accusing", accuserId: "" };
  return { ...state, words, turn: 0, round: state.round + 1, phase: "speaking" };
}

/**
 * A subject, and HIS opening word for it.
 *
 * Both come from one call because they have to agree: a seed word that does not
 * actually relate to the subject would mislead the honest players as much as
 * the fraud, and two separate calls can disagree.
 */
async function freshSubject(used: string[], ctx: GameContext): Promise<{ subject: string; seed: string }> {
  try {
    const raw = await ctx.narrate(
      [
        "Pick ONE thing for a party guessing game: a place, a well known fictional character, or an event.",
        "It must be something almost anyone could say a related word about — 'a hospital', 'Batman', 'a wedding'.",
        `Do not pick any of these: ${used.join(", ") || "none yet"}.`,
        "Then give ONE word related to it that a player might say — obvious is fine, it is the opening word.",
        "Reply in exactly this form and nothing else:",
        "THING: <the thing, under four words>",
        "WORD: <one single word>",
      ].join("\n"),
      30,
    );
    const subject = raw.match(/^THING:\s*(.+)$/im)?.[1]?.trim().replace(/^["']|["'.]+$/g, "") ?? "";
    // First token only, THEN strip punctuation. Stripping first turned a
    // two-word answer into one run-on word, which is a rotten seed to bluff off.
    const seed = (raw.match(/^WORD:\s*(.+)$/im)?.[1]?.trim().split(/\s+/)[0] ?? "").replace(/[^A-Za-z-]/g, "");
    const seen = used.map((u) => u.toLowerCase());
    if (subject && seed && subject.length <= 30 && !seen.includes(subject.toLowerCase())) return { subject, seed };
  } catch { /* fall through */ }
  // The brain being unreachable must never leave a blank subject on the phones,
  // so the offline pool is the floor rather than a nicety.
  const spare = OFFLINE.filter((o) => !used.includes(o.subject));
  const pool = spare.length ? spare : OFFLINE;
  return pool[Math.floor(ctx.random() * pool.length)]!;
}
