import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Mad Librarian — everyone hands in a word, nobody knows the sentence.
 *
 * Each phone is asked for one thing, and one thing only: "a body part", "a verb
 * ending in ing", "something you would find in a drawer". Nobody sees the story
 * those words are going into, which is the entire joke — you are not being
 * funny, you are being ambushed by your own answer thirty seconds later.
 *
 * Then he reads the finished thing aloud, ONE LINE AT A TIME, with the words
 * that were handed in sitting in it. That is the payoff and it belongs to his
 * voice: a madlib read silently off a phone is a worksheet, and a madlib read
 * out by a small robot with a straight face is the best thirty seconds at a
 * stand. He does not rush it, and he does not explain the joke.
 *
 * The Librarian is the character he puts on for it — patient, over-precise,
 * quietly delighted by nonsense. Which is to say, a librarian.
 */

type Phase = "lobby" | "collecting" | "reading" | "done";

interface Slot { prompt: string; word: string; byId: string }

export interface MadState {
  phase: Phase;
  /** The story, split into pieces with SLOTS between them. */
  parts: string[];
  slots: Slot[];
  /** Which slot each player is currently being asked for. */
  assigned: Record<string, number>;
  /** How far through reading it aloud we are. */
  readIndex: number;
  /** The finished lines, built once everything is in. */
  lines: string[];
  title: string;
  round: number;
}

/**
 * Written stories. Each is `parts` (the fixed text) and `asks` (what to request
 * for each gap) — parts.length is always asks.length + 1.
 *
 * Written rather than generated for the same reason the jokes are: a model asked
 * for a madlib produces something that reads like a madlib, and the funny ones
 * are funny because of where the gaps are, not what is in them.
 */
const STORIES: Array<{ title: string; parts: string[]; asks: string[] }> = [
  {
    title: "The Job Interview",
    parts: [
      "Thank you for coming in. I see from your CV that you spent four years ",
      ". Impressive. And your greatest weakness is ",
      "? We all have one. Now, this role requires you to handle ",
      " daily, while remaining ",
      ". Any questions? ... You would like to be paid in ",
      ". Right. We will be in touch.",
    ],
    asks: ["a verb ending in -ing", "an adjective", "a plural noun", "an adjective", "a plural noun"],
  },
  {
    title: "The Nature Documentary",
    parts: [
      "Here, on the plains of ",
      ", we find the common ",
      ". Notice how it uses its ",
      " to attract a mate. The male will ",
      " for up to ",
      " hours. Nature is, above all, ",
      ".",
    ],
    asks: ["a place", "an animal", "a body part", "a verb", "a number", "an adjective"],
  },
  {
    title: "The Recipe",
    parts: [
      "Begin by warming your ",
      " over a low heat. Add ",
      " grams of ",
      " and stir ",
      " until it begins to ",
      ". Serve immediately, garnished with ",
      ". Serves four, or one, depending.",
    ],
    asks: ["something in a kitchen", "a number", "a food", "an adverb", "a verb", "something you would not eat"],
  },
  {
    title: "The Robot Instruction Manual",
    parts: [
      "Congratulations on your new ",
      ". To begin, place it near a ",
      " and speak the word '",
      "' clearly. If the unit begins ",
      ", this is normal. Do NOT ",
      " the unit. In case of ",
      ", consult your nearest ",
      ".",
    ],
    asks: ["a noun", "a piece of furniture", "a word", "a verb ending in -ing", "a verb", "a disaster", "a job title"],
  },
  {
    title: "The Local News",
    parts: [
      "Police are appealing for witnesses after a ",
      " was discovered ",
      " outside the town ",
      " on Tuesday. A spokesperson described the scene as '",
      "'. Residents are advised to avoid ",
      " until further notice.",
    ],
    asks: ["an animal", "a verb ending in -ing", "a building", "an adjective", "a plural noun"],
  },
];

export const madLibrarian: GameDefinition<MadState> = {
  id: "mad-librarian",
  title: "Mad Librarian",
  blurb: "Hand in a word. Do not ask what it is for. He will read the result aloud.",
  icon: "📚",
  color: "#9ee04a",
  minPlayers: 1,
  maxPlayers: 8,

  create: () => ({
    phase: "lobby", parts: [], slots: [], assigned: {}, readIndex: 0, lines: [], title: "", round: 0,
  }),

  join: (state) => state,

  act: async (state, player, action, value, ctx): Promise<MadState> => {
    if (action === "start" || action === "again") {
      const story = STORIES[Math.floor(ctx.random() * STORIES.length)]!;
      const slots: Slot[] = story.asks.map((prompt) => ({ prompt, word: "", byId: "" }));
      return {
        ...state,
        phase: "collecting",
        round: state.round + 1,
        title: story.title,
        parts: story.parts,
        slots,
        assigned: {},
        readIndex: 0,
        lines: [],
      };
    }

    if (action === "word" && state.phase === "collecting") {
      const word = (value ?? "").trim().slice(0, 30);
      if (!word) return state;
      // Fill the first gap nobody has taken. Players are handed gaps as they
      // answer rather than assigned up front, so one fast person can carry a
      // quiet table and nothing stalls waiting on somebody who wandered off.
      const idx = state.slots.findIndex((s) => !s.word);
      if (idx < 0) return state;
      const slots = state.slots.map((s, i) => (i === idx ? { ...s, word, byId: player.id } : s));

      if (slots.some((s) => !s.word)) return { ...state, slots };

      // All in. Stitch the story together, then break it into SENTENCES.
      //
      // Splitting on the gaps instead was the obvious thing and it read badly:
      // every line ended on the inserted word and the next began mid-clause
      // ("...warming your ELBOW" / "over a low heat. Add JUGGLING"). Read out
      // loud that is a stammer. Sentences are the unit he should speak in.
      const whole = state.parts
        .map((part, i) => part + (slots[i] ? slots[i]!.word.toUpperCase() : ""))
        .join("")
        .replace(/\s+([.,!?])/g, "$1")   // the gaps leave gaps before punctuation
        .replace(/\s{2,}/g, " ")
        .trim();
      const lines = whole.split(/(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean);
      return { ...state, slots, lines, phase: "reading", readIndex: 0 };
    }

    if (action === "read-next" && state.phase === "reading") {
      const next = state.readIndex + 1;
      return next >= state.lines.length
        ? { ...state, readIndex: next, phase: "done" }
        : { ...state, readIndex: next };
    }
    return state;
  },

  render: (state, players) => {
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
    const filled = state.slots.filter((s) => s.word).length;
    const nextGap = state.slots.find((s) => !s.word);
    const line = state.lines[state.readIndex];

    const face = {
      title: state.phase === "lobby" ? "Mad Librarian" : state.title,
      body:
        state.phase === "lobby" ? "Give me a word. Do not ask what it is for."
          : state.phase === "collecting" ? `${filled} of ${state.slots.length} words in.`
            : state.phase === "reading" ? (line ?? "")
              : "That is the whole story. I did warn you.",
      mood: state.phase === "reading" ? "happy" : state.phase === "done" ? "mischievous" : "thinking",
      color: "#9ee04a",
      scene: state.phase === "done" ? "confetti" : null,
      // The reading IS the game. One line per press, in his own voice, and no
      // commentary from him — a straight face is what makes it land.
      speak: state.phase === "reading" ? line
        : state.phase === "lobby" ? "Everyone give me one word. I will not tell you what it is for."
          : state.phase === "done" ? "That is the story. You did that." : undefined,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const mine = state.slots.filter((s) => s.byId === p.id).map((s) => s.word);
      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Mad Librarian",
          body: "He asks for words. You will not be told what they are for until he reads it out.",
          choices: [{ action: "start", label: "Start" }],
        };
      } else if (state.phase === "collecting") {
        phones[p.id] = {
          title: nextGap ? nextGap.prompt : "All in",
          // The prompt is ALL they see. No story, no context, no hint.
          body: nextGap ? "Type it and send. No clues, that is the point." : "Waiting for the last word.",
          input: nextGap ? { action: "word", placeholder: nextGap.prompt, maxLength: 30 } : undefined,
          secret: mine.length ? `You gave: ${mine.join(", ")}` : undefined,
          yourTurn: !!nextGap,
        };
      } else if (state.phase === "reading") {
        phones[p.id] = {
          title: `${state.readIndex + 1} of ${state.lines.length}`,
          body: line ?? "",
          choices: [{ action: "read-next", label: state.readIndex + 1 >= state.lines.length ? "Finish" : "Next line" }],
        };
      } else {
        phones[p.id] = {
          title: state.title,
          body: state.lines.join(" "),
          secret: mine.length ? `Your words: ${mine.join(", ")}` : undefined,
          choices: [{ action: "again", label: "Another story" }],
        };
      }
    }
    return { face, phones };
  },
};

/** Kept for a later variant that has the brain invent a story shape. */
export async function inventedStory(ctx: GameContext): Promise<{ title: string; parts: string[]; asks: string[] } | null> {
  try {
    const raw = await ctx.narrate(
      [
        "Write a six sentence madlib story with exactly five gaps, for reading aloud to a room.",
        "Mark each gap as {a noun} / {a verb ending in -ing} / {an adjective} etc — the words inside braces are what the player is asked for.",
        "Reply with a TITLE: line, then the story. Nothing else.",
      ].join("\n"),
      160,
    );
    const title = raw.match(/^TITLE:\s*(.+)$/im)?.[1]?.trim() ?? "A Story";
    const body = raw.replace(/^TITLE:.*$/im, "").trim();
    const asks = [...body.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!.trim());
    const parts = body.split(/\{[^}]+\}/);
    if (asks.length >= 3 && parts.length === asks.length + 1) return { title, parts, asks };
  } catch { /* fall through */ }
  return null;
}
