import type { GameDefinition, PhoneView, Player } from "./types.js";
import { readGameData, writeGameData, addScores, topScores, flush, type Standing } from "./persist.js";

/**
 * Quizbee — you write the quiz, the room plays it.
 *
 * The familiar shape: a question on the big screen with four coloured answers,
 * four coloured buttons on every phone, and points for being both right and
 * fast. What makes it worth building here rather than using the website that
 * already does this is that the big screen is a robot with a face, who reads
 * the question out, reacts to the answers and knows everyone's name.
 *
 * The important part is that a quiz is WRITTEN ONCE AND KEPT. You build it at
 * your kitchen table on a Tuesday, and it is still there at the stand on
 * Saturday, and still there next month. That is what separates this from the
 * AI trivia game: this one is yours.
 *
 * Phones show COLOURS AND SHAPES, not the answer text. It keeps heads up and
 * looking at the robot, which is the whole reason he is in the room.
 */

type Phase = "menu" | "building" | "lobby" | "asking" | "scoring" | "final";

export interface QuizQuestion {
  q: string;
  /** Exactly four, in the order they appear. */
  answers: string[];
  /** Index into `answers`. */
  correct: number;
}

export interface Quiz {
  id: string;
  name: string;
  questions: QuizQuestion[];
  madeAt: string;
}

/** What survives between sessions. */
interface Saved { quizzes: Quiz[] }

export interface QuizbeeState {
  phase: Phase;
  /** Quizzes loaded from the durable store at menu time. */
  quizzes: Quiz[];
  /** The quiz being played, or the one being written. */
  quiz: Quiz | null;
  /** Question index while playing. */
  index: number;
  /** When the current question went up, for speed scoring. */
  askedAt: number;
  /** playerId -> which answer they tapped, and how fast. */
  answers: Record<string, { pick: number; ms: number }>;
  points: Record<string, number>;
  /** While building: the question being written. */
  draft: { q: string; answers: string[]; correct: number };
  /** The leaderboard that outlives the session. */
  board: Standing[];
  notice: string;
}

/** Kahoot's shapes, near enough. Colour is the thing people actually use. */
const SHAPES = ["▲", "◆", "●", "■"];
const COLOURS = ["#ff4d4d", "#4d8cff", "#f5b83d", "#3ddc84"];
const SECONDS = 20;
/** Right answer is worth this, plus up to the same again for speed. */
const BASE_POINTS = 500;

export const quizbee: GameDefinition<QuizbeeState> = {
  id: "quizbee",
  title: "Quizbee",
  blurb: "Write a quiz once, keep it forever, and let the room fight over it.",
  icon: "🐝",
  color: "#f5b83d",
  minPlayers: 1,
  maxPlayers: 12,
  tickMs: 500,

  create: () => ({
    phase: "menu", quizzes: [], quiz: null, index: 0, askedAt: 0,
    answers: {}, points: {}, draft: { q: "", answers: [], correct: 0 }, board: [], notice: "",
  }),

  join: (state, player) => (state.points[player.id] === undefined
    ? { ...state, points: { ...state.points, [player.id]: 0 } }
    : state),

  act: async (state, player, action, value, ctx): Promise<QuizbeeState> => {
    // ── the menu ──────────────────────────────────────────────────────────
    if (action === "menu" || action === "refresh") {
      const saved = await readGameData<Saved>("quizbee", { quizzes: [] });
      const board = await topScores("quizbee", 5);
      return { ...state, phase: "menu", quizzes: saved.quizzes, board, quiz: null, notice: "" };
    }

    if (action === "new-quiz") {
      return {
        ...state,
        phase: "building",
        quiz: { id: `q${Date.now().toString(36)}`, name: "", questions: [], madeAt: new Date().toISOString() },
        draft: { q: "", answers: [], correct: 0 },
        notice: "",
      };
    }

    if (action === "play" && value) {
      const saved = await readGameData<Saved>("quizbee", { quizzes: [] });
      const quiz = saved.quizzes.find((q) => q.id === value);
      if (!quiz || !quiz.questions.length) return { ...state, notice: "That quiz has no questions." };
      return { ...state, phase: "lobby", quiz, index: 0, answers: {}, points: {}, notice: "" };
    }

    if (action === "delete" && value) {
      const saved = await readGameData<Saved>("quizbee", { quizzes: [] });
      const quizzes = saved.quizzes.filter((q) => q.id !== value);
      await writeGameData("quizbee", { quizzes });
      await flush();
      return { ...state, quizzes, notice: "Deleted." };
    }

    // ── writing a quiz ────────────────────────────────────────────────────
    if (action === "name-quiz" && state.phase === "building" && state.quiz) {
      const name = (value ?? "").trim().slice(0, 40);
      if (!name) return state;
      return { ...state, quiz: { ...state.quiz, name } };
    }

    if (action === "draft-q" && state.phase === "building") {
      const q = (value ?? "").trim().slice(0, 140);
      if (!q) return state;
      return { ...state, draft: { q, answers: [], correct: 0 } };
    }

    if (action === "draft-a" && state.phase === "building") {
      const a = (value ?? "").trim().slice(0, 60);
      if (!a || state.draft.answers.length >= 4) return state;
      return { ...state, draft: { ...state.draft, answers: [...state.draft.answers, a] } };
    }

    // Mark which of the four is right, and the question is banked.
    if (action === "correct" && state.phase === "building" && state.quiz) {
      const idx = Number(value);
      const d = state.draft;
      if (!Number.isInteger(idx) || idx < 0 || idx > 3) return state;
      if (!d.q || d.answers.length !== 4) return state;
      const quiz = { ...state.quiz, questions: [...state.quiz.questions, { q: d.q, answers: d.answers, correct: idx }] };
      return { ...state, quiz, draft: { q: "", answers: [], correct: 0 }, notice: `${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"} so far.` };
    }

    if (action === "save-quiz" && state.phase === "building" && state.quiz) {
      if (!state.quiz.questions.length) return { ...state, notice: "Add a question first." };
      const quiz = { ...state.quiz, name: state.quiz.name || `Quiz ${new Date().toLocaleDateString()}` };
      const saved = await readGameData<Saved>("quizbee", { quizzes: [] });
      // Replace by id if this quiz is being edited, otherwise add it.
      const quizzes = [...saved.quizzes.filter((q) => q.id !== quiz.id), quiz];
      await writeGameData("quizbee", { quizzes });
      // Forced, because a quiz somebody just typed out must not be lost to a
      // power cut in the next eight hundred milliseconds.
      await flush();
      return { ...state, phase: "menu", quizzes, quiz: null, notice: `Saved "${quiz.name}".` };
    }

    // ── playing ───────────────────────────────────────────────────────────
    if (action === "begin" && state.phase === "lobby" && state.quiz) {
      return { ...state, phase: "asking", index: 0, askedAt: ctx.now, answers: {}, points: {} };
    }

    if (action === "answer" && state.phase === "asking" && state.quiz) {
      if (state.answers[player.id]) return state;                  // one shot each
      const pick = Number(value);
      if (!Number.isInteger(pick) || pick < 0 || pick > 3) return state;
      const ms = Math.max(1, ctx.now - state.askedAt);
      const answers = { ...state.answers, [player.id]: { pick, ms } };

      const q = state.quiz.questions[state.index]!;
      const points = { ...state.points };
      if (pick === q.correct) {
        // Right is worth the base; the speed bonus decays over the 20 seconds,
        // so answering instantly is worth about double answering at the buzzer.
        const speed = Math.max(0, 1 - ms / (SECONDS * 1000));
        points[player.id] = (points[player.id] ?? 0) + BASE_POINTS + Math.round(BASE_POINTS * speed);
      }

      // The ROSTER is who is at the table, not who happens to have a points
      // entry. `points` is wiped when a quiz starts, so reading the roster off
      // it meant an empty object, `[].every()` is true, and the very first tap
      // ended the question for everybody. The same mistake was found in Quick
      // Colors by a separate pass; it is the natural one to make here.
      const roster = ctx.players.map((p) => p.id);
      const allIn = roster.length > 0 && roster.every((id) => answers[id]);
      return { ...state, answers, points, phase: allIn ? "scoring" : "asking" };
    }

    if (action === "next" && state.phase === "scoring" && state.quiz) {
      const next = state.index + 1;
      if (next >= state.quiz.questions.length) {
        // Bank the results on the lifetime board before anyone walks away.
        await addScores("quizbee", ctx.players.map((p) => ({ name: p.name, points: state.points[p.id] ?? 0 })));
        await flush();
        const board = await topScores("quizbee", 5);
        return { ...state, phase: "final", board };
      }
      return { ...state, phase: "asking", index: next, askedAt: ctx.now, answers: {} };
    }

    if (action === "again" && state.phase === "final") {
      return { ...state, phase: "lobby", index: 0, answers: {}, points: {} };
    }
    return state;
  },

  tick: (state, ctx): QuizbeeState => {
    // The 20 second clock. Anyone who has not answered simply scores nothing.
    if (state.phase !== "asking") return state;
    if (ctx.now - state.askedAt < SECONDS * 1000) return state;
    return { ...state, phase: "scoring" };
  },

  render: (state, players) => {
    const q = state.quiz?.questions[state.index];
    const total = state.quiz?.questions.length ?? 0;
    const table = players
      .map((p) => ({ name: p.name, score: state.points[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const secsLeft = state.phase === "asking" ? Math.max(0, SECONDS - Math.floor((Date.now() - state.askedAt) / 1000)) : 0;

    const face = {
      title:
        state.phase === "menu" ? "Quizbee"
          : state.phase === "building" ? `Writing: ${state.quiz?.name || "untitled"}`
            : state.phase === "lobby" ? (state.quiz?.name ?? "Quizbee")
              : state.phase === "final" ? "Final scores"
                : `${state.quiz?.name ?? ""} · ${state.index + 1}/${total}`,
      body:
        state.phase === "menu"
          ? state.quizzes.length ? `${state.quizzes.length} quiz${state.quizzes.length === 1 ? "" : "zes"} saved. ${state.notice}` : "No quizzes yet. Write one on your phone."
          : state.phase === "building"
            ? state.draft.q
              ? `${state.draft.q}   (${state.draft.answers.length}/4 answers)`
              : `${state.quiz?.questions.length ?? 0} questions written. ${state.notice}`
            : state.phase === "lobby" ? `${total} questions. ${players.length} playing.`
              : state.phase === "asking" ? (q?.q ?? "")
                : state.phase === "scoring"
                  ? q ? `Answer: ${q.answers[q.correct]}` : ""
                  : table.length ? `${table[0]!.name} wins with ${table[0]!.score}.` : "Nobody played.",
      // The four answers live on HIS face; the phones only show colours.
      big: state.phase === "asking" ? String(secsLeft) : undefined,
      mood: state.phase === "scoring" ? "excited" : state.phase === "asking" ? "curious" : state.phase === "final" ? "starstruck" : "happy",
      color: state.phase === "asking" ? "#f5b83d" : "#c9dcf0",
      scene: state.phase === "final" ? "confetti" : null,
      speak:
        state.phase === "asking" && Object.keys(state.answers).length === 0 && q
          ? `${q.q}. ${q.answers.map((a, i) => `${SHAPES[i]} ${a}`).join(". ")}`
          : state.phase === "scoring" && q ? `It was ${q.answers[q.correct]}.`
            : state.phase === "final" && table[0] ? `${table[0].name} wins with ${table[0].score} points.` : undefined,
      scores: state.phase === "asking" || state.phase === "scoring" || state.phase === "final" ? table : undefined,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      if (state.phase === "menu") {
        phones[p.id] = {
          title: "Quizbee",
          body: state.quizzes.length
            ? `${state.notice || "Pick a quiz, or write a new one."}${state.board.length ? `\n\nAll time: ${state.board.map((b) => `${b.name} ${b.points}`).join("  ·  ")}` : ""}`
            : "No quizzes saved yet. Write one — it will still be here next week.",
          choices: [
            ...state.quizzes.map((qz) => ({ action: "play", label: `${qz.name} (${qz.questions.length})`, value: qz.id })),
            { action: "new-quiz", label: "Write a new quiz" },
          ],
        };
      } else if (state.phase === "building") {
        const d = state.draft;
        if (!state.quiz?.name) {
          phones[p.id] = { title: "Name the quiz", body: "Something you will recognise next month.", input: { action: "name-quiz", placeholder: "quiz name", maxLength: 40 }, yourTurn: true };
        } else if (!d.q) {
          phones[p.id] = {
            title: `Question ${(state.quiz.questions.length ?? 0) + 1}`,
            body: state.notice || "Type the question.",
            input: { action: "draft-q", placeholder: "the question", maxLength: 140 },
            choices: state.quiz.questions.length ? [{ action: "save-quiz", label: "Save and finish" }] : [],
            yourTurn: true,
          };
        } else if (d.answers.length < 4) {
          phones[p.id] = {
            title: `Answer ${d.answers.length + 1} of 4`,
            body: `${d.q}\n\n${d.answers.map((a, i) => `${SHAPES[i]} ${a}`).join("\n")}`,
            input: { action: "draft-a", placeholder: `answer ${d.answers.length + 1}`, maxLength: 60 },
            yourTurn: true,
          };
        } else {
          phones[p.id] = {
            title: "Which one is right?",
            body: d.q,
            choices: d.answers.map((a, i) => ({ action: "correct", label: `${SHAPES[i]}  ${a}`, value: String(i) })),
            yourTurn: true,
          };
        }
      } else if (state.phase === "lobby") {
        phones[p.id] = {
          title: state.quiz?.name ?? "Quizbee",
          body: `${total} questions. Everyone in? Press go.`,
          choices: [{ action: "begin", label: "Go" }, { action: "menu", label: "Back" }],
        };
      } else if (state.phase === "asking") {
        const mine = state.answers[p.id];
        phones[p.id] = {
          title: mine ? "Locked in" : `${secsLeft}s`,
          // Deliberately NO answer text. Colours and shapes only, so heads stay
          // up and looking at him rather than down at a phone.
          body: mine ? "Eyes up." : "Look at his face, then tap.",
          choices: mine ? [] : SHAPES.map((s, i) => ({ action: "answer", label: s, value: String(i) })),
          yourTurn: !mine,
        };
      } else if (state.phase === "scoring") {
        const mine = state.answers[p.id];
        const right = mine && q && mine.pick === q.correct;
        phones[p.id] = {
          title: right ? "Correct" : mine ? "Wrong" : "Too slow",
          body: q ? `${q.answers[q.correct]}${right ? `  ·  +${(state.points[p.id] ?? 0)} total` : ""}` : "",
          choices: [{ action: "next", label: state.index + 1 >= total ? "Final scores" : "Next question" }],
        };
      } else {
        phones[p.id] = {
          title: "Final",
          body: `${table.map((t) => `${t.name} ${t.score}`).join("\n")}${state.board.length ? `\n\nAll time: ${state.board.map((b) => `${b.name} ${b.points}`).join("  ·  ")}` : ""}`,
          choices: [{ action: "again", label: "Play it again" }, { action: "menu", label: "Other quizzes" }],
        };
      }
    }
    return { face, phones };
  },
};

/** Exported for the remote, which offers the colours for the four answers. */
export const QUIZBEE_COLOURS = COLOURS;
