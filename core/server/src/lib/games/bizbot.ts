import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * BizBot — twenty questions, except the thing he is guessing is your problem.
 *
 * You tell him what you want advice about. He then becomes BIZBOT, Thought
 * Leader, and interrogates you one question at a time the way a real consultant
 * would if a real consultant were a small robot wearing an invisible headset.
 * At the end he delivers The Insight: a slide's worth of confident nonsense
 * wrapped around one piece of advice that is genuinely, annoyingly correct.
 *
 * The joke only works if the advice is real. A parody of a guru that gives bad
 * advice is just a bad guru — the comedy is in the packaging (the framework, the
 * acronym, the pause before the reveal) sitting on top of something you could
 * actually go and do on Monday. So the brain is told, explicitly, that the
 * substance must be sound and only the delivery is a bit.
 *
 * It is a GAME MODE, not a persona switch: he puts the character on at the start
 * and takes it off at the end, and everyone in the room can see him do it.
 */

type Phase = "lobby" | "topic" | "asking" | "thinking" | "insight";

interface Exchange { q: string; a: string }

export interface BizState {
  phase: Phase;
  /** Whose session this is — BizBot advises one person at a time, publicly. */
  clientId: string;
  topic: string;
  /** The running interrogation. */
  history: Exchange[];
  /** The question on the table right now. */
  current: string;
  /** Multiple-choice answers when he offers them, so it plays fast in a crowd. */
  options: string[];
  askedCount: number;
  /** How many questions this session gets before the reveal. */
  budget: number;
  insight?: { framework: string; verdict: string; action: string; zinger: string };
  /** The room's reaction to the reveal — the only score BizBot keeps. */
  applause: Record<string, "yes" | "no">;
  error?: string;
}

/** The character, in his own words. Used for every brain call in this game. */
const PERSONA =
  "You are BIZBOT: a small desk robot wearing an invisible headset, doing an " +
  "affectionate parody of a business guru. You speak in confident declaratives, " +
  "you love a framework and an acronym, you say things like 'let me push back on " +
  "that' and 'what I'm hearing is', and you treat every trivial detail as a " +
  "profound signal. CRITICAL: the parody is the DELIVERY ONLY. The substance must " +
  "be genuinely good, specific, practical advice that the person could act on this " +
  "week. Never give advice that is actually bad, risky, or hollow. No financial, " +
  "legal or medical advice — steer those to a professional, in character. " +
  "Never break character mid-answer, and never mention that you are a parody.";

/**
 * Openers, so the first question lands instantly instead of waiting on a brain
 * call. Each one carries its OWN answer buttons — they used to share a single
 * hardcoded set, so two of the three openers came with three replies that had
 * nothing to do with the question being asked.
 */
const OPENERS: Array<{ q: string; options: string[] }> = [
  {
    q: "Before we begin. How honest do you want me to be?",
    options: ["Brutally honest", "Kind, but honest", "Just tell me what to do"],
  },
  {
    q: "First question, and it is the big one. What does winning actually look like here?",
    options: ["More money", "Less chaos", "I genuinely do not know"],
  },
  {
    q: "Let me start where everyone is afraid to start. Who is this actually for?",
    options: ["Customers", "My boss", "Honestly, me"],
  },
];

/**
 * The brain is allowed to be slow. It is not allowed to be silent forever.
 *
 * The engine awaits act() before it publishes a new frame, so a narrate() that
 * never settles does not merely lose a line of prose — it freezes the whole
 * table on the previous question with the client's press apparently ignored,
 * and there is no button anywhere that can rescue it. Every brain call in this
 * game therefore races a clock and falls through to the written material.
 */
const NARRATE_MS = 8_000;

/**
 * A hard ceiling on the intake. It cannot be reached at the default budget of
 * seven, but nothing outside this file guarantees the budget stays seven, and a
 * transcript that grows without bound is both a memory leak in a session that is
 * never ended and an ever-growing prompt that quietly costs more every question.
 */
const MAX_HISTORY = 24;

const FALLBACK_QUESTIONS = [
  "What have you already tried that did not work?",
  "Who else is affected if nothing changes?",
  "What would you do if you had twice the time?",
  "What is the part of this you keep avoiding?",
  "If this worked perfectly, what is the first thing you would notice?",
];

const nameOf = (players: Player[], id: string) => players.find((p) => p.id === id)?.name ?? "friend";

/**
 * Is the person being consulted still at the table? A phone can lock and a
 * player can walk off, and every path through the middle of this game is gated
 * on the client: only they may type the topic, only they may answer, only their
 * phone carries the skip button. If they leave, the room is left staring at a
 * question nobody is allowed to answer with no button between them and the end
 * of the game. When the chair is empty the room may take it, or move him along.
 */
const clientSeated = (players: Player[], state: BizState) =>
  !!state.clientId && players.some((p) => p.id === state.clientId);

export const bizbot: GameDefinition<BizState> = {
  id: "bizbot",
  title: "BizBot",
  blurb: "Twenty questions about your business, your job or your life. Then an insight, delivered with unearned confidence.",
  icon: "📈",
  color: "#F5B83D",
  minPlayers: 1,
  maxPlayers: 8,

  create: () => ({
    phase: "lobby", clientId: "", topic: "", history: [], current: "", options: [],
    askedCount: 0, budget: 7, applause: {},
  }),

  join: (state) => state,

  act: async (state, player, action, value, ctx): Promise<BizState> => {
    if (action === "consult") {
      // Whoever presses the button is the client. Everyone else is the audience,
      // which is most of the fun — being consulted at is a spectator sport.
      //
      // The chair is only up for grabs between sessions, or when the person
      // sitting in it has left the table. Without that second clause a walked-off
      // client strands the room; without the first, a second player pressing
      // "Consult me" a beat after the first would wipe a session already in
      // progress — the topic, the intake and all — out from under them.
      const free = state.phase === "lobby" || state.phase === "insight" || !clientSeated(ctx.players, state);
      if (!free) return state;
      return { ...state, phase: "topic", clientId: player.id, topic: "", history: [], current: "", options: [], askedCount: 0, insight: undefined, applause: {}, error: undefined };
    }

    if (action === "topic" && state.phase === "topic") {
      // Only the client's phone shows the box, but the route behind it is open
      // to anyone who can name the action, so the rule lives here too.
      if (player.id !== state.clientId) return state;
      const topic = (value ?? "").trim().slice(0, 120);
      if (!topic) return state;
      // Math.random() never returns exactly 1, but a ctx.random() that did would
      // index past the end and the non-null assertion would hand us undefined.
      const opener = OPENERS[Math.min(OPENERS.length - 1, Math.floor(ctx.random() * OPENERS.length))]!;
      return {
        ...state,
        phase: "asking",
        topic,
        current: opener.q,
        options: opener.options,
        askedCount: 1,
      };
    }

    if (action === "answer" && state.phase === "asking") {
      if (player.id !== state.clientId) return state;
      const answer = (value ?? "").trim().slice(0, 200);
      if (!answer) return state;
      const history = [...state.history, { q: state.current, a: answer }].slice(-MAX_HISTORY);

      // Out of questions: time for the part with the slide.
      if (state.askedCount >= state.budget) {
        return { ...state, history, phase: "thinking", current: "", options: [] };
      }

      const next = await nextQuestion(state.topic, history, ctx);
      return {
        ...state,
        history,
        current: next.question,
        options: next.options,
        askedCount: state.askedCount + 1,
      };
    }

    // He has heard enough. One brain call for the whole reveal.
    if (action === "reveal" && state.phase === "thinking") {
      const insight = await buildInsight(state.topic, state.history, ctx);
      return { ...state, phase: "insight", insight };
    }

    // "Skip to the answer" — because sometimes the room has had enough of the bit.
    // It works from ANY question, including before the opener is answered: the
    // reveal only ever needed the topic, and the intake it does have.
    if (action === "cut-to-it" && state.phase === "asking") {
      if (player.id !== state.clientId && clientSeated(ctx.players, state)) return state;
      return { ...state, phase: "thinking", current: "", options: [] };
    }

    if (action === "applaud" && state.phase === "insight") {
      // The buttons set an explicit value, so match on that — but a button whose
      // value went missing would otherwise fall through as applause, so accept
      // the printed label as well and only then default to the kind reading.
      const said = (value ?? "").trim().toLowerCase();
      const vote: "yes" | "no" = said === "no" || said === "get off the stage" ? "no" : "yes";
      return { ...state, applause: { ...state.applause, [player.id]: vote } };
    }

    return state;
  },

  render: (state, players) => {
    const client = nameOf(players, state.clientId);
    const seated = clientSeated(players, state);
    const yes = Object.values(state.applause).filter((v) => v === "yes").length;
    const no = Object.values(state.applause).filter((v) => v === "no").length;

    const face = {
      title: state.phase === "lobby" ? "BizBot" : `BizBot · ${state.topic || "intake"}`,
      body:
        state.phase === "lobby"
          ? "Tell me what is not working. I will tell you what it really is."
          : state.phase === "topic"
            ? `${client} is typing their problem. Sizing them up.`
            : state.phase === "asking"
              ? state.current
              : state.phase === "thinking"
                ? "Synthesising. Do not speak to me."
                : state.insight
                  ? `${state.insight.framework} — ${state.insight.verdict}`
                  : "",
      big: state.phase === "asking" ? `${state.askedCount}/${state.budget}` : undefined,
      mood: state.phase === "insight" ? "starstruck" : state.phase === "thinking" ? "thinking" : "suspicious",
      color: state.phase === "insight" ? "#F5B83D" : "#7fb3ff",
      scene: null,
      // He performs this. The whole game is the performance, so the speaking
      // lines are chosen to be the moments a room would actually watch.
      speak:
        state.phase === "asking" ? state.current
          : state.phase === "thinking" ? "Hmm. Let me run that again. I am seeing a pattern."
            : state.phase === "insight" && state.insight
              ? `${state.insight.framework}. ${state.insight.verdict} Here is what you do. ${state.insight.action} ${state.insight.zinger}`
              : undefined,
      scores: state.phase === "insight"
        ? [{ name: "Worth it", score: yes }, { name: "Get off the stage", score: no }]
        : undefined,
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const isClient = p.id === state.clientId;

      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "BizBot",
          body: "Twenty questions about your business, your job, or your life. Then one insight, delivered like it cost you four thousand dollars.",
          choices: [{ action: "consult", label: "Consult me" }],
        };
      } else if (state.phase === "topic") {
        phones[p.id] = isClient
          ? {
            title: "What are we solving?",
            body: "A sentence is plenty. Work, money, a decision you keep putting off.",
            input: { action: "topic", placeholder: "e.g. nobody is buying the thing", maxLength: 120 },
            yourTurn: true,
          }
          : seated
            ? { title: "BizBot is engaged", body: `${client} has the floor. Enjoy this.` }
            : {
              title: "The chair is empty",
              body: "Whoever he was sizing up has wandered off. He has not noticed yet.",
              choices: [{ action: "consult", label: "Take the chair" }],
            };
      } else if (state.phase === "asking") {
        phones[p.id] = isClient
          ? {
            title: `Question ${state.askedCount} of ${state.budget}`,
            body: state.current,
            choices: [
              ...state.options.map((o) => ({ action: "answer", label: o })),
              { action: "cut-to-it", label: "Skip to the insight" },
            ],
            input: { action: "answer", placeholder: "or say it your own way", maxLength: 200 },
            yourTurn: true,
          }
          : {
            title: "BizBot asks",
            body: state.current,
            secret: seated ? `${client} is on question ${state.askedCount} of ${state.budget}.` : undefined,
            // The audience watches and no more, right up until the client walks
            // off. Then the only two buttons in the game that can reach the end
            // are on a phone nobody is holding, so the room gets them instead.
            choices: seated ? undefined : [
              { action: "cut-to-it", label: "Skip to the insight" },
              { action: "consult", label: "Take the chair" },
            ],
          };
      } else if (state.phase === "thinking") {
        phones[p.id] = {
          title: "He is synthesising",
          body: "This is the part where he looks out of the window.",
          choices: [{ action: "reveal", label: "Give us the insight" }],
        };
      } else {
        const i = state.insight;
        phones[p.id] = {
          title: i?.framework ?? "The Insight",
          body: i ? `${i.verdict}\n\nDo this: ${i.action}` : "He lost his train of thought. It happens to the best of us.",
          secret: isClient ? i?.zinger : undefined,
          choices: [
            { action: "applaud", label: "Actually useful", value: "yes" },
            { action: "applaud", label: "Get off the stage", value: "no" },
            { action: "consult", label: "My turn" },
          ],
        };
      }
    }
    return { face, phones };
  },
};

/**
 * ctx.narrate with a deadline. It rejects rather than resolving empty, so the
 * callers' existing catch blocks are the single place the written material takes
 * over — a slow brain and a dead one now look identical from the game's side.
 */
async function narrateBy(ctx: GameContext, prompt: string, maxWords: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ctx.narrate(prompt, maxWords),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("narrate timed out")), NARRATE_MS);
      }),
    ]);
  } finally {
    // The loser of the race is abandoned, not cancelled; at least do not leave a
    // pending timer holding the process open after the brain came back in time.
    if (timer) clearTimeout(timer);
  }
}

/**
 * The next question. One short brain call, and a real fallback — a consultant
 * who stops mid-interrogation because the network blinked is not in character.
 */
async function nextQuestion(
  topic: string,
  history: Exchange[],
  ctx: GameContext,
): Promise<{ question: string; options: string[] }> {
  const transcript = history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n");
  try {
    const raw = await narrateBy(
      ctx,
      [
        PERSONA,
        `The person wants advice about: ${topic}`,
        transcript ? `So far:\n${transcript}` : "",
        "Ask your NEXT question. It must dig somewhere the previous answers did not go —",
        "never rephrase a question you already asked. Under eighteen words.",
        "Then offer three short answers they could tap, each under five words, genuinely different from each other.",
        "Reply in exactly this form and nothing else:",
        "Q: <the question>",
        "A: <option> | <option> | <option>",
      ].filter(Boolean).join("\n"),
      70,
    );
    const q = raw.match(/^Q:\s*(.+)$/im)?.[1]?.trim() ?? "";
    const opts = (raw.match(/^A:\s*(.+)$/im)?.[1] ?? "")
      .split("|").map((o) => o.trim()).filter(Boolean).slice(0, 3);
    if (q) return { question: q, options: opts };
  } catch { /* fall through */ }
  const asked = new Set(history.map((h) => h.q));
  const spare = FALLBACK_QUESTIONS.find((q) => !asked.has(q)) ?? FALLBACK_QUESTIONS[0]!;
  return { question: spare, options: ["A lot", "A little", "I would rather not say"] };
}

/** The reveal: framework, verdict, one concrete action, and a closing line. */
async function buildInsight(
  topic: string,
  history: Exchange[],
  ctx: GameContext,
): Promise<BizState["insight"]> {
  // Skipping to the insight on question one is allowed, so the intake can be
  // empty. Saying so beats handing the brain a blank heading and hoping.
  const transcript = history.length
    ? history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n")
    : "(none — they cut you off before you got an answer out of them, so work from the topic alone and be decisive about it)";
  try {
    const raw = await narrateBy(
      ctx,
      [
        PERSONA,
        `Topic: ${topic}`,
        `The intake:\n${transcript}`,
        "Deliver the insight. Four lines, exactly this form, nothing else:",
        "FRAMEWORK: <invent a grandly named framework or acronym, under six words>",
        "VERDICT: <what is actually going on, one or two sentences, said with total confidence>",
        "ACTION: <ONE specific thing to do this week. Concrete. Genuinely good advice. Under thirty words.>",
        "ZINGER: <a closing line that is funny because it is smug, under fifteen words>",
      ].join("\n"),
      130,
    );
    const pick = (k: string) => raw.match(new RegExp(`^${k}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";
    const framework = pick("FRAMEWORK");
    const verdict = pick("VERDICT");
    const action = pick("ACTION");
    if (framework && verdict && action) {
      return { framework, verdict, action, zinger: pick("ZINGER") || "You are welcome." };
    }
  } catch { /* fall through */ }
  // Offline, he is still right about this, which is the joke.
  return {
    framework: "The One Conversation Principle",
    verdict: "You do not have an information problem. You have a conversation you have been avoiding.",
    action: "Pick the one person whose answer would change what you do, and ask them this week. Write the question down first.",
    zinger: "I could have told you that in one question. I asked seven for the theatre of it.",
  };
}
