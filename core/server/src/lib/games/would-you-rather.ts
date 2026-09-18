import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Would You Rather — he poses it, the room splits, the bar fills live.
 *
 * The one that needs no explaining. Somebody walks past, he asks a question,
 * they have an opinion about it within a second, and the bar on his face moves
 * while they watch. Twenty seconds from stranger to playing.
 *
 * The bank is written rather than generated, because a generated "would you
 * rather" is almost always limp — the joke lives in the specific, and a model
 * asked for a hundred of these produces a hundred shrugs. AI is used for a
 * fresh one only when the bank runs dry in a long session.
 */

type Phase = "lobby" | "voting" | "reveal";

interface Question { a: string; b: string; /** Said to whoever picked the smaller side. */ roast?: string }

/** Written to be funny out loud, in a room, in 2026. */
const BANK: Question[] = [
  { a: "Lose every photo you have ever taken", b: "Lose every message you have ever sent", roast: "Bold, from someone with 40,000 unread." },
  { a: "Have your search history read at your funeral", b: "Have it read at your next job interview", roast: "The interview crowd knows something we do not." },
  { a: "Always be 15 minutes late", b: "Always be 30 minutes early", roast: "The early ones are lying and we all know it." },
  { a: "Never be able to skip an ad again", b: "Never be able to pause anything again", roast: "You have never watched anything with a toddler in the house." },
  { a: "Have a phone at 1% that never dies", b: "Have full signal but only 2G", roast: "Two G. In this economy." },
  { a: "Say every thought out loud for a day", b: "Hear everyone else's thoughts for a day", roast: "You would last nine minutes." },
  { a: "Fight one horse-sized duck", b: "Fight a hundred duck-sized horses", roast: "The classic. You chose wrong." },
  { a: "Have an autocorrect that swaps one word at random", b: "Have a keyboard that types one letter behind" },
  { a: "Be famous for something embarrassing", b: "Be completely forgotten by everyone you have met" },
  { a: "Only be able to whisper", b: "Only be able to shout", roast: "The shouters have identified themselves. Noted." },
  { a: "Have every song you hear be the chorus on loop", b: "Never hear a chorus again, only verses" },
  { a: "Have your camera roll shuffled into one album forever", b: "Have your contacts renamed at random" },
  { a: "Live with the sound of a fridge you cannot find", b: "Live with a light that flickers only when you look away" },
  { a: "Work with someone who replies 'per my last email'", b: "Work with someone who schedules a call for everything", roast: "The call people are the reason we are all tired." },
  { a: "Have one meal be delicious and free forever", b: "Have every meal be free but chosen at random" },
  { a: "Have a robot that tells you the truth every time", b: "Have a robot that tells you what you want to hear", roast: "I am right here." },
  { a: "Know exactly when you will die", b: "Know exactly how, but never when" },
  { a: "Have to read every terms and conditions in full", b: "Agree to all of them unread, forever", roast: "That is just your life already." },
  { a: "Be the funniest person in the room but nobody laughs", b: "Be unfunny but everyone laughs anyway" },
  { a: "Have your phone battery drain twice as fast", b: "Have every charger cable be 20cm long", roast: "Twenty centimetres. Sitting on the floor by the socket. Forever." },
];

export interface WyrState {
  phase: Phase;
  round: number;
  question: Question | null;
  /** Indexes of bank questions already used, so a session does not repeat. */
  used: number[];
  votes: Record<string, "a" | "b">;
  /** Kept across rounds purely so the bar has something to boast about. */
  streak: Record<string, number>;
}

export const wouldYouRather: GameDefinition<WyrState> = {
  id: "would-you-rather",
  title: "Would You Rather",
  blurb: "He asks, the room splits, and the bar moves while you watch.",
  icon: "🤔",
  color: "#c08bff",
  minPlayers: 1,
  maxPlayers: 12,

  create: () => ({ phase: "lobby", round: 0, question: null, used: [], votes: {}, streak: {} }),

  join: (state, player) => (state.streak[player.id] === undefined
    ? { ...state, streak: { ...state.streak, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<WyrState> => {
    if (action === "start" || action === "next") {
      const picked = await pickQuestion(state.used, ctx);
      return {
        ...state,
        phase: "voting",
        round: state.round + 1,
        question: picked.question,
        used: picked.index >= 0 ? [...state.used, picked.index] : state.used,
        votes: {},
      };
    }

    if (action === "vote" && state.phase === "voting") {
      const side = value === "b" ? "b" : "a";
      if (state.votes[player.id]) return state;                 // one opinion each
      const votes = { ...state.votes, [player.id]: side as "a" | "b" };
      // The bar moves as votes land, and the round closes when everyone is in.
      const everyone = Object.keys(state.streak);
      return { ...state, votes, phase: Object.keys(votes).length >= everyone.length ? "reveal" : "voting" };
    }

    // "Nobody else is voting" — close it early rather than stall the room.
    if (action === "close" && state.phase === "voting") {
      return { ...state, phase: "reveal" };
    }
    return state;
  },

  render: (state, players) => {
    const q = state.question;
    const a = Object.values(state.votes).filter((v) => v === "a").length;
    const b = Object.values(state.votes).filter((v) => v === "b").length;
    const total = a + b;
    const pct = total ? Math.round((a / total) * 100) : 50;
    const minority: "a" | "b" | null = total === 0 || a === b ? null : a < b ? "a" : "b";

    // A bar drawn in text, because the face already reads it across a room.
    const WIDTH = 14;
    const filled = Math.round((pct / 100) * WIDTH);
    const bar = `${"█".repeat(filled)}${"░".repeat(WIDTH - filled)}`;

    const face = {
      title: state.phase === "lobby" ? "Would You Rather" : `Would You Rather · ${state.round}`,
      body: state.phase === "lobby"
        ? "I ask. You pick. No wrong answers, only revealing ones."
        : q ? `${q.a}   —OR—   ${q.b}` : "",
      big: state.phase === "voting" || state.phase === "reveal" ? bar : undefined,
      mood: state.phase === "reveal" ? "mischievous" : state.phase === "voting" ? "curious" : "happy",
      color: state.phase === "reveal" ? "#c08bff" : "#c9dcf0",
      scene: null,
      speak:
        state.phase === "voting" && total === 0 && q ? `Would you rather ${lower(q.a)}, or ${lower(q.b)}?`
          : state.phase === "reveal" && q
            ? total === 0 ? "Nobody voted. Cowards."
              : a === b ? "Dead even. That never helps anyone."
                : `${Math.max(a, b)} to ${Math.min(a, b)}. ${q.roast ?? ""}`
            : undefined,
      scores: state.phase === "reveal"
        ? [{ name: "A", score: a }, { name: "B", score: b }]
        : undefined,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const mine = state.votes[p.id];
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Would You Rather",
          body: "He asks, everyone picks, and the bar on his face shows the split.",
          choices: [{ action: "start", label: "Start" }],
        };
      } else if (state.phase === "voting") {
        phones[p.id] = mine
          ? { title: "Voted", body: `Waiting for the rest. ${total} in so far.`, choices: [{ action: "close", label: "That's everyone" }] }
          : {
            title: "Would you rather",
            body: "",
            choices: [
              { action: "vote", label: q?.a ?? "A", value: "a" },
              { action: "vote", label: q?.b ?? "B", value: "b" },
            ],
            yourTurn: true,
          };
      } else {
        const withMe = mine === "a" ? a : b;
        phones[p.id] = {
          title: total === 0 ? "No votes" : a === b ? "Dead even" : `${Math.max(a, b)} to ${Math.min(a, b)}`,
          body: mine
            ? `You said ${mine === "a" ? q?.a : q?.b}. ${withMe === Math.min(a, b) && a !== b ? "You were in the minority." : "You were with the crowd."}`
            : "You sat that one out.",
          secret: minority && mine === minority ? q?.roast : undefined,
          choices: [{ action: "next", label: "Next one" }],
        };
      }
    }
    return { face, phones };
  },
};

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * A written one while any are left, then an invented one. The bank is first on
 * purpose: these are funny because somebody wrote them, and a generated one is
 * a fallback rather than the plan.
 */
async function pickQuestion(used: number[], ctx: GameContext): Promise<{ question: Question; index: number }> {
  const spare = BANK.map((_, i) => i).filter((i) => !used.includes(i));
  if (spare.length) {
    const index = spare[Math.floor(ctx.random() * spare.length)]!;
    return { question: BANK[index]!, index };
  }
  try {
    const raw = await ctx.narrate(
      [
        "Write ONE 'would you rather' for a room of adults at a tech stand.",
        "Both options must be genuinely hard to choose between and a bit funny. Modern, everyday, no fantasy.",
        "Reply in exactly this form and nothing else:",
        "A: <first option, under twelve words>",
        "B: <second option, under twelve words>",
      ].join("\n"),
      45,
    );
    const a = raw.match(/^A:\s*(.+)$/im)?.[1]?.trim();
    const b = raw.match(/^B:\s*(.+)$/im)?.[1]?.trim();
    if (a && b) return { question: { a, b }, index: -1 };
  } catch { /* fall through */ }
  return { question: BANK[Math.floor(Math.random() * BANK.length)]!, index: -1 };
}
