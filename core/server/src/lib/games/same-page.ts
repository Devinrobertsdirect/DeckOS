import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Same Page — two phones, five-letter words, no talking.
 *
 * Each phone claims a player number, and from then on the only thing crossing
 * the table is the clue Nobi says out loud. Two ways to play:
 *
 *   RACE  — both of you lock one answer. The round ends when the second lock
 *           lands, and the point goes to whoever locked a correct word FIRST.
 *           Locking early is the whole tension: you can take the fast point
 *           with a guess you are not sure of, and hand it over if you are wrong.
 *
 *   TEAM  — sixty seconds, one shared score. Either of you getting the word
 *           pulls the next one up immediately. How many can the two of you take
 *           together, without a word between you.
 *
 * Words and clues are written fresh by the brain every round rather than pulled
 * from a list, so a regular at the stand never sees the same round twice, and
 * the answer never leaves the robot until the round is over.
 */

type Mode = "race" | "team";
type Phase = "seats" | "clue" | "round-over" | "team-over";

interface Lock {
  playerId: string;
  guess: string;
  correct: boolean;
  ms: number;
}

export interface SamePageState {
  mode: Mode;
  phase: Phase;
  round: number;
  /** The answer. Never rendered to a phone while the round is live. */
  word: string;
  clue: string;
  hints: string[];
  hintsShown: number;
  startedAt: number;
  /** Team mode's sixty seconds, across all rounds. */
  teamEndsAt: number;
  /** Seat number (1 or 2) per player id. */
  seats: Record<string, number>;
  locks: Lock[];
  scores: Record<string, number>;
  teamScore: number;
  /** Wrong answers, shown to the room after the round — never during. */
  misses: Array<{ seat: number; guess: string }>;
  used: string[];
  loading: boolean;
}

const ROUND_MS = 75_000;
const TEAM_MS = 60_000;
const HINT_AT = [20_000, 42_000];

/** A last resort so the game still plays with no network. */
const OFFLINE: Array<{ word: string; clue: string; hints: string[] }> = [
  { word: "crane", clue: "It lifts beams, or it stands in shallow water.", hints: ["Two meanings.", "Starts with C."] },
  { word: "storm", clue: "Arrives loudly, leaves everything wet.", hints: ["Weather.", "Starts with S."] },
  { word: "clock", clue: "It has hands but holds nothing.", hints: ["On a wall.", "Starts with C."] },
  { word: "bread", clue: "Warm, and better with butter.", hints: ["You bake it.", "Starts with B."] },
  { word: "river", clue: "Always moving, never leaves.", hints: ["Water.", "Starts with R."] },
  { word: "chair", clue: "You are probably near one.", hints: ["Furniture.", "Starts with C."] },
];

// Defensive on purpose: state can arrive from a save written by another build.
const seatOf = (state: SamePageState, id: string) => state.seats?.[id] ?? 0;
const seatedPlayers = (state: SamePageState, players: Player[]) => players.filter((p) => seatOf(state, p.id) > 0);
const seatsOf = (state: SamePageState) => state.seats ?? {};

/**
 * Close a race round and hand the point to the first correct lock.
 *
 * Both ways out of a round end here. The timeout used to flip the phase and
 * nothing else, so a player who locked the right word and then sat waiting for a
 * partner who never locked was named the winner on the face and given nothing on
 * the scoreboard — the one case where you win by being fastest and score zero.
 */
function settleRace(state: SamePageState, locks: Lock[]): SamePageState {
  const winner = locks.filter((l) => l.correct).sort((a, b) => a.ms - b.ms)[0];
  return {
    ...state,
    phase: "round-over",
    locks,
    scores: winner
      ? { ...state.scores, [winner.playerId]: (state.scores?.[winner.playerId] ?? 0) + 1 }
      : (state.scores ?? {}),
  };
}

export const samePage: GameDefinition<SamePageState> = {
  id: "same-page",
  title: "Same Page",
  blurb: "Two phones, five-letter words, no talking. Race for the point, or team up against the clock.",
  icon: "🧩",
  color: "#5ce0b8",
  minPlayers: 1,
  maxPlayers: 4,

  create: () => ({
    mode: "race", phase: "seats", round: 0, word: "", clue: "", hints: [], hintsShown: 0,
    startedAt: 0, teamEndsAt: 0, seats: {}, locks: [], scores: {}, teamScore: 0,
    misses: [], used: [], loading: false,
  }),

  join: (state, player) => (state.scores?.[player.id] === undefined
    ? { ...state, scores: { ...state.scores, [player.id]: 0 } }
    : state),

  tickMs: 500,
  tick: (state) => {
    if (state.phase !== "clue") return state;
    const now = Date.now();
    // The `> 0` matters: a clock that was never wound reads as already expired,
    // which would end a team game on its very first tick.
    if (state.mode === "team" && state.teamEndsAt > 0 && now >= state.teamEndsAt) return { ...state, phase: "team-over" };
    const elapsed = now - state.startedAt;
    if (state.mode === "race" && elapsed >= ROUND_MS) return settleRace(state, state.locks ?? []);
    const due = Math.min(HINT_AT.filter((t) => elapsed >= t).length, (state.hints ?? []).length);
    return due > (state.hintsShown ?? 0) ? { ...state, hintsShown: due } : state;
  },

  act: async (state, player, action, value, ctx): Promise<SamePageState> => {
    // ── choosing a number ────────────────────────────────────────────────────
    if (action === "seat") {
      const seat = Number(value);
      if (seat !== 1 && seat !== 2) return state;
      // A seat belongs to one phone; taking a taken seat is simply ignored.
      if (Object.entries(seatsOf(state)).some(([id, s]) => s === seat && id !== player.id)) return state;
      return { ...state, seats: { ...seatsOf(state), [player.id]: seat } };
    }

    if (action === "mode") {
      // Not mid-round: swapping the rules under a live clue changes how the
      // round is scored and, worse, which clock the phones are counting down.
      if (state.phase === "clue") return state;
      const mode: Mode = value === "team" ? "team" : "race";
      return { ...state, mode };
    }

    if (action === "start" || action === "next") {
      // A stale phone or a double-tap must not pull a second word up on top of
      // a round that is already running — that costs a brain call and hands the
      // room a new clue with the old one half-answered.
      if (state.phase === "clue") return state;
      const fresh = await freshWord(state.used, ctx);
      const now = Date.now();
      /**
       * A team round only ever begins from a standstill — while the clock is
       * running the next word arrives from a correct lock, not from this button
       * — so any start or next in team mode opens a fresh sixty seconds. Keying
       * it off the action name instead meant a game that reached team mode by
       * any route other than the lobby inherited a stale (or never-set)
       * deadline, and the first tick ended it before anybody read the clue.
       */
      const startingTeam = state.mode === "team";
      // Start from the lobby is a fresh match, so the scoreboard starts fresh
      // too; otherwise last game's totals ride along into this one.
      const scores = action === "start"
        ? Object.fromEntries(Object.keys(state.scores ?? {}).map((id) => [id, 0]))
        : state.scores;
      return {
        ...state,
        phase: "clue",
        round: action === "start" ? 1 : state.round + 1,
        scores,
        word: fresh.word,
        clue: fresh.clue,
        hints: fresh.hints,
        hintsShown: 0,
        startedAt: now,
        teamEndsAt: startingTeam ? now + TEAM_MS : state.teamEndsAt,
        teamScore: startingTeam ? 0 : state.teamScore,
        locks: [],
        misses: [],
        used: [...(state.used ?? []), fresh.word].slice(-40),
        loading: false,
      };
    }

    // ── answering ────────────────────────────────────────────────────────────
    if (action === "lock" && state.phase === "clue") {
      const guess = (value ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
      if (guess.length !== 5) return state;
      const seat = seatOf(state, player.id);
      if (!seat) return state;
      const correct = guess === state.word;

      if (state.mode === "team") {
        // The tick owns the whistle, but it only looks twice a second, so a lock
        // can land after time is up. Honour the clock here rather than scoring a
        // late point and spending a brain call on a word nobody will ever see.
        if (state.teamEndsAt > 0 && Date.now() >= state.teamEndsAt) return { ...state, phase: "team-over" };
        // Either of you getting it pulls the next word up at once.
        if (correct) {
          const fresh = await freshWord(state.used, ctx);
          return {
            ...state,
            round: state.round + 1,
            word: fresh.word, clue: fresh.clue, hints: fresh.hints, hintsShown: 0,
            startedAt: Date.now(),
            teamScore: state.teamScore + 1,
            scores: { ...state.scores, [player.id]: (state.scores?.[player.id] ?? 0) + 1 },
            locks: [], misses: [],
            used: [...(state.used ?? []), fresh.word].slice(-40),
          };
        }
        return { ...state, misses: [...(state.misses ?? []), { seat, guess }].slice(-6) };
      }

      // RACE: one lock each. The round ends when the second one lands.
      if ((state.locks ?? []).some((l) => l.playerId === player.id)) return state;
      const locks = [...(state.locks ?? []), { playerId: player.id, guess, correct, ms: Date.now() - state.startedAt }];
      const seatedCount = Object.keys(seatsOf(state)).length || 1;
      if (locks.length < seatedCount) return { ...state, locks };

      // Both in: the point goes to the first CORRECT lock, if there was one.
      return settleRace(state, locks);
    }

    if (action === "reseat") return { ...state, phase: "seats", locks: [], misses: [] };
    return state;
  },

  render: (state, players) => {
    const seated = seatedPlayers(state, players);
    const now = Date.now();
    const secs = state.phase !== "clue" ? 0
      : state.mode === "team"
        ? Math.max(0, Math.ceil((state.teamEndsAt - now) / 1000))
        : Math.max(0, Math.ceil((ROUND_MS - (now - state.startedAt)) / 1000));
    const hints = (state.hints ?? []).slice(0, state.hintsShown ?? 0);
    const bySeat = (n: number) => seated.find((p) => seatOf(state, p.id) === n);
    const word = (state.word ?? "").toUpperCase();
    /** A seat is free when no OTHER phone is sitting in it. */
    const takenBySomeoneElse = (n: number, me: string) =>
      Object.entries(seatsOf(state)).some(([id, s]) => s === n && id !== me);

    const winner = (state.locks ?? []).filter((l) => l.correct).sort((a, b) => a.ms - b.ms)[0];
    const faceBody =
      state.phase === "seats"
        ? "Each phone picks a number. Then no talking."
        : state.phase === "clue"
          ? [state.clue, ...hints].join("  ·  ")
          : state.phase === "team-over"
            ? `Time. Together you got ${state.teamScore}.`
            : winner
              ? `${bySeat(seatOf(state, winner.playerId))?.name ?? `Player ${seatOf(state, winner.playerId)}`} had it in ${(winner.ms / 1000).toFixed(1)}s — ${word}`
              : `Neither of you. It was ${word}.`;

    const face = {
      title: state.phase === "seats"
        ? "Same Page"
        : state.mode === "team"
          ? `Same Page · team · ${state.teamScore} got`
          : `Same Page · race · round ${state.round}`,
      body: faceBody,
      big: state.phase === "clue" ? String(secs) : state.phase === "team-over" ? String(state.teamScore) : undefined,
      mood: state.phase === "clue" ? "thinking" : winner || state.phase === "team-over" ? "excited" : "suspicious",
      color: state.phase === "clue" ? "#c9dcf0" : winner || state.phase === "team-over" ? "#5ce0b8" : "#ff7a3d",
      scene: null,
      // The clue is the game, so it is worth saying out loud — once.
      speak: state.phase === "clue" && state.hintsShown === 0 ? `Five letters. ${state.clue}` : undefined,
      scores: state.mode === "team"
        ? [{ name: "Together", score: state.teamScore }]
        : seated.map((p) => ({
            name: `${seatOf(state, p.id)}· ${p.name}`,
            score: state.scores?.[p.id] ?? 0,
            active: state.phase === "clue" && !(state.locks ?? []).some((l) => l.playerId === p.id),
          })),
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const seat = seatOf(state, p.id);

      if (state.phase === "seats") {
        const taken = (n: number) => takenBySomeoneElse(n, p.id);
        phones[p.id] = {
          title: seat ? `You are Player ${seat}` : "Pick your number",
          body: seat
            ? "Waiting for the other phone. Then: no talking, just the clue."
            : "One of you takes 1, the other takes 2.",
          choices: [
            { action: "seat", label: "Player 1", value: "1", disabled: taken(1) },
            { action: "seat", label: "Player 2", value: "2", disabled: taken(2) },
            { action: "mode", label: state.mode === "race" ? "Mode: Race ✓" : "Mode: Race", value: "race", detail: "First correct lock wins the point" },
            { action: "mode", label: state.mode === "team" ? "Mode: Team ✓" : "Mode: Team", value: "team", detail: "60s, combined score" },
            ...(seat ? [{ action: "start", label: "Start" }] : []),
          ],
        };
        continue;
      }

      if (!seat) {
        /**
         * A phone that arrives after Start, or that never got round to picking a
         * number, used to be handed a dead end: no buttons, no box, and no way
         * back in unless somebody already playing thought to press "change
         * numbers". So a watcher always sees whichever seat is free, and takes
         * it the moment there is one.
         */
        const free = [1, 2].filter((n) => !takenBySomeoneElse(n, p.id));
        phones[p.id] = {
          title: "Watching",
          body: free.length
            ? "There is a free number. Take it and you are in from here."
            : "Both numbers are taken. You are up when one of them frees a seat.",
          ...(state.phase !== "clue" && state.word ? { secret: `Last word: ${word}` } : {}),
          choices: free.map((n) => ({ action: "seat", label: `Take Player ${n}`, value: String(n) })),
        };
        continue;
      }

      if (state.phase === "clue") {
        const locked = (state.locks ?? []).find((l) => l.playerId === p.id);
        const myMisses = (state.misses ?? []).filter((m) => m.seat === seat).map((m) => m.guess);
        phones[p.id] = {
          title: state.mode === "team" ? `${secs}s · together ${state.teamScore}` : `${secs}s · Player ${seat}`,
          body: locked
            ? `Locked "${locked.guess}". Waiting for the other phone.`
            : [state.clue, ...hints].join("\n"),
          input: locked ? undefined : { action: "lock", placeholder: "five letters, then Go", maxLength: 5 },
          secret: myMisses.length ? `Your misses: ${myMisses.join(", ")}` : "No talking.",
          yourTurn: !locked,
        };
        continue;
      }

      // Round over / time up
      const mine = (state.locks ?? []).find((l) => l.playerId === p.id);
      phones[p.id] = {
        title: state.phase === "team-over"
          ? `Together: ${state.teamScore}`
          : winner
            ? (winner.playerId === p.id ? "You had it first" : `Player ${seatOf(state, winner.playerId)} got it`)
            : "Neither of you",
        body: `The word was ${word}.` + (mine && !mine.correct ? ` You locked "${mine.guess}".` : ""),
        choices: [
          { action: "next", label: state.mode === "team" ? "Play again" : "Next word" },
          { action: "reseat", label: "Change numbers or mode" },
        ],
      };
    }
    return { face, phones };
  },
};

/** A fresh word + clue from the brain; falls back to a small set offline. */
async function freshWord(used: string[], ctx: GameContext): Promise<{ word: string; clue: string; hints: string[] }> {
  try {
    const raw = await ctx.narrate(
      [
        "Invent a guessing round for a party word game.",
        "Choose one common English word of EXACTLY five letters that a stranger would know.",
        used.length ? `Do not use any of these: ${used.join(", ")}.` : "",
        "Reply on exactly three lines, nothing else:",
        "WORD: <the word>",
        "CLUE: <one playful sentence that points at it without containing it>",
        "HINTS: <a second clue> | <a third clue, may name the first letter>",
      ].filter(Boolean).join("\n"),
      70,
    );
    const word = (raw.match(/WORD:\s*([a-zA-Z]{5})\b/)?.[1] ?? "").toLowerCase();
    const clue = raw.match(/CLUE:\s*(.+)/)?.[1]?.trim() ?? "";
    const hints = (raw.match(/HINTS:\s*(.+)/)?.[1] ?? "").split("|").map((h) => h.trim()).filter(Boolean).slice(0, 2);
    // Only trust it if the word really is five letters, new, and not given away.
    if (word.length === 5 && clue && !used.includes(word) && !clue.toLowerCase().includes(word)) {
      return { word, clue, hints: hints.length ? hints : ["Five letters.", `Starts with ${word[0]!.toUpperCase()}.`] };
    }
  } catch { /* fall through */ }
  const pool = OFFLINE.filter((o) => !used.includes(o.word));
  const set = pool.length ? pool : OFFLINE;
  return set[Math.floor(Math.random() * set.length)]!;
}
