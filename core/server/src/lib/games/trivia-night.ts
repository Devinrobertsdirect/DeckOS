import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";
import { addScores, topScores, flush, type Standing } from "./persist.js";

/**
 * Trivia Night — he asks what it should be about, then writes the whole thing.
 *
 * Quizbee is the quiz YOU wrote and kept. This is the opposite: nobody prepared
 * anything, somebody says "eighties films" and forty seconds later there is a
 * twenty-one question round about eighties films. That is a thing only a machine
 * with a brain in it can do, and it is the difference between owning a robot and
 * owning a box of cards.
 *
 * He asks two things and then gets out of the way: the subject, and how long you
 * want to be here. Five questions is a queue at a stand, ten is a coffee, and
 * twenty-one is an actual evening.
 *
 * Questions are generated in BATCHES while you play. Waiting forty seconds in
 * silence for a full set of twenty-one would lose the room; waiting eight
 * seconds for the first five and quietly writing the rest while people argue
 * about question two does not.
 */

type Phase = "subject" | "size" | "writing" | "asking" | "scoring" | "final";

interface Q {
  q: string;
  answers: string[];
  correct: number;
}

const SHAPES = ["▲", "◆", "●", "■"];
const SECONDS = 20;
const BASE_POINTS = 500;
/** How many to write at a time. Enough to stay ahead, small enough to be quick. */
const BATCH = 5;

export interface TriviaState {
  phase: Phase;
  subject: string;
  /** How many questions the round is meant to be. */
  target: number;
  questions: Q[];
  index: number;
  askedAt: number;
  answers: Record<string, { pick: number; ms: number }>;
  points: Record<string, number>;
  /** True while a batch is being written, so the face can say so. */
  writing: boolean;
  board: Standing[];
  notice: string;
}

export const triviaNight: GameDefinition<TriviaState> = {
  id: "trivia-night",
  title: "Trivia Night",
  blurb: "Name a subject. He writes the whole quiz on the spot.",
  icon: "🧠",
  color: "#4d8cff",
  minPlayers: 1,
  maxPlayers: 12,
  tickMs: 500,

  create: () => ({
    phase: "subject", subject: "", target: 10, questions: [], index: 0, askedAt: 0,
    answers: {}, points: {}, writing: false, board: [], notice: "",
  }),

  join: (state, player) => (state.points[player.id] === undefined
    ? { ...state, points: { ...state.points, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<TriviaState> => {
    if (action === "subject" && state.phase === "subject") {
      const subject = (value ?? "").trim().slice(0, 60);
      if (!subject) return state;
      // He asks the size straight after the subject, which is the natural order:
      // you know what you want to talk about before you know how long for.
      return { ...state, subject, phase: "size" };
    }

    if (action === "size" && state.phase === "size") {
      const target = Number(value);
      if (![5, 10, 21].includes(target)) return state;
      const first = await writeBatch(state.subject, [], Math.min(BATCH, target), ctx);
      if (!first.length) {
        return { ...state, phase: "subject", notice: "I could not think of anything for that. Try another subject." };
      }
      return {
        ...state,
        target,
        questions: first,
        phase: "asking",
        index: 0,
        askedAt: ctx.now,
        answers: {},
        points: {},
        notice: "",
      };
    }

    if (action === "answer" && state.phase === "asking") {
      if (state.answers[player.id]) return state;
      const pick = Number(value);
      if (!Number.isInteger(pick) || pick < 0 || pick > 3) return state;
      const q = state.questions[state.index];
      if (!q) return state;
      const ms = Math.max(1, ctx.now - state.askedAt);
      const answers = { ...state.answers, [player.id]: { pick, ms } };
      const points = { ...state.points };
      if (pick === q.correct) {
        const speed = Math.max(0, 1 - ms / (SECONDS * 1000));
        points[player.id] = (points[player.id] ?? 0) + BASE_POINTS + Math.round(BASE_POINTS * speed);
      }
      const roster = ctx.players.map((p) => p.id);
      const allIn = roster.length > 0 && roster.every((id) => answers[id]);
      return { ...state, answers, points, phase: allIn ? "scoring" : "asking" };
    }

    if (action === "next" && state.phase === "scoring") {
      const next = state.index + 1;
      if (next >= state.target) {
        await addScores("trivia-night", ctx.players.map((p) => ({ name: p.name, points: state.points[p.id] ?? 0 })));
        await flush();
        return { ...state, phase: "final", board: await topScores("trivia-night", 5) };
      }
      // Top the tank up if we are running low and there are more to write.
      let questions = state.questions;
      if (next >= questions.length - 1 && questions.length < state.target) {
        const more = await writeBatch(state.subject, questions, Math.min(BATCH, state.target - questions.length), ctx);
        questions = [...questions, ...more];
      }
      if (!questions[next]) {
        // The brain dried up. End gracefully on what we have rather than
        // stranding the room on a question that does not exist.
        await addScores("trivia-night", ctx.players.map((p) => ({ name: p.name, points: state.points[p.id] ?? 0 })));
        await flush();
        return { ...state, phase: "final", board: await topScores("trivia-night", 5), notice: "That is all I had." };
      }
      return { ...state, questions, phase: "asking", index: next, askedAt: ctx.now, answers: {} };
    }

    if (action === "again" && state.phase === "final") {
      return {
        ...state, phase: "subject", subject: "", questions: [], index: 0,
        answers: {}, points: {}, notice: "",
      };
    }
    return state;
  },

  tick: (state, ctx): TriviaState => {
    if (state.phase !== "asking") return state;
    if (ctx.now - state.askedAt < SECONDS * 1000) return state;
    return { ...state, phase: "scoring" };
  },

  render: (state, players) => {
    const q = state.questions[state.index];
    const table = players
      .map((p) => ({ name: p.name, score: state.points[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const secsLeft = state.phase === "asking" ? Math.max(0, SECONDS - Math.floor((Date.now() - state.askedAt) / 1000)) : 0;

    const face = {
      title:
        state.phase === "subject" ? "Trivia Night"
          : state.phase === "size" ? state.subject
            : state.phase === "final" ? "Final scores"
              : `${state.subject} · ${state.index + 1}/${state.target}`,
      body:
        state.phase === "subject" ? (state.notice || "What should it be about? Anything at all.")
          : state.phase === "size" ? "How long have we got?"
            : state.phase === "writing" ? "Writing your quiz."
              : state.phase === "asking" ? (q?.q ?? "")
                : state.phase === "scoring" ? (q ? `Answer: ${q.answers[q.correct]}` : "")
                  : table.length ? `${table[0]!.name} wins with ${table[0]!.score}.` : "Nobody played.",
      big: state.phase === "asking" ? String(secsLeft) : undefined,
      mood: state.phase === "scoring" ? "excited" : state.phase === "asking" ? "curious" : state.phase === "final" ? "starstruck" : "thinking",
      color: "#4d8cff",
      scene: state.phase === "final" ? "confetti" : null,
      speak:
        state.phase === "subject" ? "What should the quiz be about?"
          : state.phase === "size" ? `${state.subject}. Good. Short, medium or long?`
            : state.phase === "asking" && Object.keys(state.answers).length === 0 && q
              ? `${q.q}. ${q.answers.map((a, i) => `${SHAPES[i]} ${a}`).join(". ")}`
              : state.phase === "scoring" && q ? `It was ${q.answers[q.correct]}.`
                : state.phase === "final" && table[0] ? `${table[0].name} wins with ${table[0].score}.` : undefined,
      scores: state.phase === "asking" || state.phase === "scoring" || state.phase === "final" ? table : undefined,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      if (state.phase === "subject") {
        phones[p.id] = {
          title: "Pick a subject",
          body: state.notice || "Anything: eighties films, the periodic table, your own town.",
          input: { action: "subject", placeholder: "what is it about?", maxLength: 60 },
          yourTurn: true,
        };
      } else if (state.phase === "size") {
        phones[p.id] = {
          title: state.subject,
          body: "How many questions?",
          choices: [
            { action: "size", label: "Short — 5", value: "5" },
            { action: "size", label: "Medium — 10", value: "10" },
            { action: "size", label: "Long — 21", value: "21" },
          ],
          yourTurn: true,
        };
      } else if (state.phase === "asking") {
        const mine = state.answers[p.id];
        phones[p.id] = {
          title: mine ? "Locked in" : `${secsLeft}s`,
          body: mine ? "Eyes up." : "Look at his face, then tap.",
          choices: mine ? [] : SHAPES.map((s, i) => ({ action: "answer", label: s, value: String(i) })),
          yourTurn: !mine,
        };
      } else if (state.phase === "scoring") {
        const mine = state.answers[p.id];
        const right = mine && q && mine.pick === q.correct;
        phones[p.id] = {
          title: right ? "Correct" : mine ? "Wrong" : "Too slow",
          body: q ? `${q.answers[q.correct]}${right ? `  ·  ${state.points[p.id] ?? 0} total` : ""}` : "",
          choices: [{ action: "next", label: state.index + 1 >= state.target ? "Final scores" : "Next question" }],
        };
      } else {
        phones[p.id] = {
          title: "Final",
          body: `${table.map((t) => `${t.name} ${t.score}`).join("\n")}${state.board.length ? `\n\nAll time: ${state.board.map((b) => `${b.name} ${b.points}`).join("  ·  ")}` : ""}`,
          choices: [{ action: "again", label: "Another subject" }],
        };
      }
    }
    return { face, phones };
  },
};

/**
 * Write a batch of questions about the subject.
 *
 * Asked for a strict shape and parsed strictly: a malformed question is dropped
 * rather than shown, because a trivia question with three answers or no correct
 * one is worse than one fewer question. Previous questions are passed back so it
 * does not ask the same thing twice in a long round.
 */
async function writeBatch(subject: string, sofar: Q[], count: number, ctx: GameContext): Promise<Q[]> {
  const asked = sofar.slice(-8).map((q) => q.q).join(" | ");
  try {
    const raw = await ctx.ask(
      [
        `Write ${count} multiple choice trivia questions about: ${subject}`,
        "Mixed difficulty, factual, no opinions, no trick questions.",
        asked ? `Do NOT repeat any of these: ${asked}` : "",
        "Use exactly this form for each, and nothing else:",
        "Q: <question, under twenty words>",
        "A: <answer> | <answer> | <answer> | <answer>",
        "C: <1, 2, 3 or 4 — which answer is correct>",
      ].filter(Boolean).join("\n"),
      90 * count,
    );

    const out: Q[] = [];
    const blocks = raw.split(/\n(?=Q:)/i);
    for (const block of blocks) {
      const q = block.match(/^Q:\s*(.+)$/im)?.[1]?.trim();
      const answers = (block.match(/^A:\s*(.+)$/im)?.[1] ?? "")
        .split("|").map((a) => a.trim()).filter(Boolean);
      const correct = Number(block.match(/^C:\s*(\d)/im)?.[1]) - 1;
      // Strict: four answers and a correct index inside them, or it is dropped.
      if (q && answers.length === 4 && Number.isInteger(correct) && correct >= 0 && correct <= 3) {
        out.push({ q, answers, correct });
      }
    }
    return out.slice(0, count);
  } catch {
    return [];
  }
}
