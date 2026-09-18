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
  /**
   * There is deliberately no per-player gap reservation here. It was in the
   * state as `assigned` and never written or read, which is worse than absent:
   * it reads like a promise that the game hands each phone its own gap, and it
   * never did. The gap a phone is showing travels on the ACTION instead (see
   * `word:<index>` below), which is the only place it can travel, because
   * render() is pure and cannot book a gap out to anybody.
   */
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

/** The input action carries the gap it was showing: "word:3". */
const WORD_ACTION = /^word(?::(\d+))?$/;

/**
 * Tidy a submitted word before it goes into the story.
 *
 * Sentence punctuation has to come out, because the finished story is split
 * into sentences to be read aloud: a player typing "Mr. Blobby" would otherwise
 * cut a line in half and leave him solemnly announcing "MR." on its own.
 */
function cleanWord(value: string | undefined): string {
  return (value ?? "").replace(/[.!?]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30).trim();
}

/**
 * Which gap this word should go in, given the gap the phone was showing.
 *
 * Every phone is shown the SAME next gap at the same time, so two people
 * answering at once is the normal case, not the rare one. The old code put each
 * arriving word into whatever gap happened to be free, which meant the second
 * person was asked for a body part and had their elbow filed under "a number" —
 * silently, and only visible thirty seconds later when he read it out.
 *
 * So the phone says which gap it was asking about. If somebody got there first
 * we look for another OPEN gap asking for exactly the same thing (stories
 * repeat "an adjective" often enough that this usually works). Failing that the
 * word answers a question that is no longer open, so it is dropped and the
 * phone simply re-asks with the gap that is.
 */
function placeFor(slots: Slot[], wanted: number): number {
  if (wanted < 0) return slots.findIndex((s) => !s.word);  // a voice answer, or an older phone
  if (slots[wanted] && !slots[wanted]!.word) return wanted;
  const asked = slots[wanted]?.prompt;
  return asked ? slots.findIndex((s) => !s.word && s.prompt === asked) : -1;
}

/**
 * All the words are in: stitch the story up and break it into SENTENCES.
 *
 * Splitting on the gaps instead was the obvious thing and it read badly: every
 * line ended on the inserted word and the next began mid-clause ("...warming
 * your ELBOW" / "over a low heat. Add JUGGLING"). Read out loud that is a
 * stammer. Sentences are the unit he should speak in.
 */
function stitch(state: MadState): MadState {
  const whole = state.parts
    .map((part, i) => part + (state.slots[i] ? state.slots[i]!.word.toUpperCase() : ""))
    .join("")
    // The gaps leave a space before punctuation — but not before an ellipsis,
    // which is a pause somebody wrote on purpose and wants the room to hear.
    .replace(/\s+(?!\.\.)([.,!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  // An ellipsis is not the end of a sentence. "Any questions? ... You would
  // like to be paid in BEES." used to split into a line reading "Any
  // questions?..." and nothing else, which is a beat with no joke on the end of
  // it. The two lookarounds keep both halves of the pause on the same line.
  const lines = whole.split(/(?<=[.!?])(?<!\.\.)\s+(?!\.)/).map((l) => l.trim()).filter(Boolean);
  return { ...state, lines, phase: "reading", readIndex: 0 };
}

export const madLibrarian: GameDefinition<MadState> = {
  id: "mad-librarian",
  title: "Mad Librarian",
  blurb: "Hand in a word. Do not ask what it is for. He will read the result aloud.",
  icon: "📚",
  color: "#9ee04a",
  minPlayers: 1,
  maxPlayers: 8,

  create: () => ({
    phase: "lobby", parts: [], slots: [], readIndex: 0, lines: [], title: "", round: 0,
  }),

  join: (state) => state,

  // Nothing in here awaits anything, and it should stay that way. The engine
  // does read-modify-write on the session state around `await act(...)`, so the
  // moment this function suspends, two phones pressing together can have one of
  // them write over the other's word. A madlib does not need the brain.
  act: async (state, player, action, value, ctx): Promise<MadState> => {
    // Only from a standing start. A straggler's phone can be a round behind and
    // still be showing "Start"; pressing it used to throw away everybody's
    // words and deal a fresh story out from under them.
    if ((action === "start" && state.phase === "lobby") || (action === "again" && state.phase === "done")) {
      const story = STORIES[Math.floor(ctx.random() * STORIES.length)]!;
      const slots: Slot[] = story.asks.map((prompt) => ({ prompt, word: "", byId: "" }));
      return {
        ...state,
        phase: "collecting",
        round: state.round + 1,
        title: story.title,
        parts: story.parts,
        slots,
        readIndex: 0,
        lines: [],
      };
    }

    const asked = WORD_ACTION.exec(action);
    if (asked && state.phase === "collecting") {
      const word = cleanWord(value);
      if (!word) return state;
      // Gaps are taken as people answer rather than dealt out up front, so one
      // fast person can carry a quiet table and nothing stalls waiting on
      // somebody who wandered off. That is deliberate, and it costs a slow
      // player at most the current story: the next one starts wide open, and
      // everybody still hears the read-out either way.
      const idx = placeFor(state.slots, asked[1] ? Number(asked[1]) : -1);
      if (idx < 0) return state;
      const slots = state.slots.map((s, i) => (i === idx ? { ...s, word, byId: player.id } : s));

      if (slots.some((s) => !s.word)) return { ...state, slots };
      return stitch({ ...state, slots });
    }

    if (action === "read-next") {
      // A safety valve, not a normal path: if a state ever arrives with every
      // gap filled but still in collecting — an older save, a restore that
      // landed mid-stitch — the phones would have no button and no box and the
      // table would be stuck. This is the way out.
      if (state.phase === "collecting" && state.slots.length > 0 && state.slots.every((s) => s.word)) {
        return stitch(state);
      }
      if (state.phase !== "reading") return state;
      // The button carries the line it was showing. Everyone gets a Next, so
      // two people pressing on the same beat used to advance twice and eat a
      // line of the story — the one thing this game cannot afford to lose.
      const at = Number(value);
      if (Number.isInteger(at) && at !== state.readIndex) return state;
      const next = state.readIndex + 1;
      return next >= state.lines.length
        ? { ...state, readIndex: next, phase: "done" }
        : { ...state, readIndex: next };
    }
    return state;
  },

  render: (state, players) => {
    const filled = state.slots.filter((s) => s.word).length;
    const nextIdx = state.slots.findIndex((s) => !s.word);
    const nextGap = nextIdx < 0 ? undefined : state.slots[nextIdx];
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
          // The prompt is ALL they see. No story, no context, no hint. This is
          // also the whole view a phone that joins mid-round gets, which is
          // exactly right: a latecomer is no worse informed than anybody else.
          body: nextGap ? "Type it and send. No clues, that is the point." : "Waiting for the last word.",
          // The gap number rides along with the answer, so a word typed while
          // somebody else was submitting cannot land under the wrong question.
          input: nextGap ? { action: `word:${nextIdx}`, placeholder: nextGap.prompt, maxLength: 30 } : undefined,
          // Never leave a phone with nothing to press and nothing to type.
          choices: nextGap ? undefined : [{ action: "read-next", label: "Read it out" }],
          secret: mine.length ? `You gave: ${mine.join(", ")}` : undefined,
          yourTurn: !!nextGap,
        };
      } else if (state.phase === "reading") {
        phones[p.id] = {
          title: `${state.readIndex + 1} of ${state.lines.length}`,
          body: line ?? "",
          // The value is the line this button was drawn for. A phone button
          // sends its LABEL unless told otherwise, and "Next line" tells act()
          // nothing about which line the presser could actually see.
          choices: [{
            action: "read-next",
            label: state.readIndex + 1 >= state.lines.length ? "Finish" : "Next line",
            value: String(state.readIndex),
          }],
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
