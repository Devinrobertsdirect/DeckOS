import type { GameDefinition, GameContext, PhoneView, Player } from "./types.js";

/**
 * Bodies — a house party, a body in the morning, and a robot who saw everything.
 *
 * This is werewolf, but the narrator is in the room and he is a machine. The
 * moment the whole game is built around is NIGHT: his eyes visibly shut on the
 * faceplate, he keeps talking in the dark, and the killers do their work on
 * their phones while everyone else stares at a robot pretending to be asleep.
 * No app does that, because no app is sitting on the table looking at you.
 *
 * Seven roles, dealt by head count so four players is still a real game and ten
 * is still survivable for the town:
 *
 *   Killer      — picks the body. Knows the other killers.
 *   Inspector   — one name a night, and Nobi tells them privately what he saw.
 *   Medic       — one name a night, and that person cannot die tonight.
 *   Jester      — wins ALONE by being voted out, and each night either plants
 *                 evidence on somebody innocent (the Inspector reads them as
 *                 guilty) or makes a scene to draw the table onto themselves.
 *                 Killed at night, the Jester simply loses — the fun is that
 *                 they must get the TABLE to do it.
 *   Whisperer   — once per game, may ask Nobi any yes/no question about the
 *                 night and he answers on their phone alone, never aloud. This
 *                 role only exists because there is a brain in the room.
 *   Sleepwalker — hears one extra word of the night narration that Nobi never
 *                 says out loud: a letter that really is in a killer's name.
 *   Guest       — no power, and that is fine, because every living player also
 *                 gets to leave a rumour in the dark and one is read aloud at
 *                 dawn with no name on it. A table where four people have a
 *                 secret job and three have nothing is a table where three
 *                 people put their phones down.
 *
 * Every phase is on a clock as well as on a button. A social deduction game
 * where one pocketed phone freezes the night forever is not a party game, it is
 * a hostage situation, so the night, the day, the vote and the verdict all run
 * out on their own and anyone present can push things along.
 */

type Phase = "lobby" | "night" | "day" | "vote" | "verdict" | "over";

type Role =
  | "killer"
  | "inspector"
  | "medic"
  | "jester"
  | "whisperer"
  | "sleepwalker"
  | "guest";

export interface BodiesState {
  phase: Phase;
  /** 1-based once the first night starts. Shown on his face all game. */
  night: number;
  /**
   * The cohort the cards were dealt to, in dealing order.
   *
   * Win conditions count off THIS, never off the live roster: a phone that
   * reloads or a player who steps out for a smoke must not be able to flip the
   * game to "the killers have taken the house" and back again. Presence decides
   * who we wait for; the cohort decides who is still in the story.
   */
  seated: string[];
  roles: Record<string, Role>;
  /** Death order, so the face can list the bodies in the order they turned up. */
  dead: string[];

  // ---- night bookkeeping, wiped at the start of every night ----
  /** Who the killers have settled on. Any killer may move it until dawn. */
  killTarget: string;
  protectId: string;
  /** The Medic may not sit on one person all game. */
  lastProtectId: string;
  inspectorTarget: string;
  /** The Jester's planted evidence — reads as guilty to the Inspector tonight. */
  framedId: string;
  /** The Jester making a scene: Nobi drops their name at dawn, unprompted. */
  sceneId: string;
  /** Everyone who has finished with the night. Emptied each dusk. */
  nightDone: string[];
  /** Rumours typed in the dark by the living, and whispers from the dead. */
  rumours: Array<{ playerId: string; text: string; dead: boolean }>;

  // ---- what the morning found ----
  lastVictimId: string;
  /** True when the killers picked someone the Medic was already sitting with. */
  lastSaved: boolean;
  /** His dawn line, written before it is spoken so a tick can end the night too. */
  dawnLine: string;
  /** The rumour he reads out at dawn, anonymised. */
  dawnRumour: string;

  // ---- private per-player findings, appended to and never read as a roster ----
  notes: Record<string, string[]>;
  /** The Whisperer's one question, spent or not. */
  whisperSpent: boolean;

  // ---- day and vote ----
  /** Living players who have said they are ready to vote. */
  ready: string[];
  /** voter id -> target id, or the literal "nobody" for an abstention. */
  votes: Record<string, string>;
  lastVerdict: null | {
    executedId: string;
    /** Empty when the table hung nobody. */
    role: Role | "";
    tie: boolean;
  };
  winner: "" | "town" | "killers" | "jester";
  /** Ticks left in the phase. Always compared with <= 0, never for truthiness. */
  timer: number;
}

const TICK_MS = 1000;
/** Long enough to read your phone and think; short enough that nobody wanders off. */
const NIGHT_TICKS = 100;
const DAY_TICKS = 180;
const VOTE_TICKS = 60;
const VERDICT_TICKS = 14;
/** How long his opening line for a phase stays in `speak`, in ticks. */
const SPEAK_WINDOW = 10;
/** A stubborn table will type rumours all night; the last dozen is plenty. */
const RUMOUR_MAX = 12;
const NOTES_MAX = 8;

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;

/**
 * Who is dealt what, by head count.
 *
 * Written out per count rather than computed, because the interesting balance
 * decisions are not a formula: the Jester is in from four players because a
 * four-hand game with one killer is otherwise solved by the Inspector in two
 * nights, and the third killer only appears at ten because two killers in a
 * house of ten never get to the parity they need.
 */
const DEAL: Record<number, Role[]> = {
  4: ["killer", "inspector", "medic", "jester"],
  5: ["killer", "inspector", "medic", "jester", "guest"],
  6: ["killer", "inspector", "medic", "jester", "sleepwalker", "guest"],
  7: ["killer", "killer", "inspector", "medic", "jester", "sleepwalker", "guest"],
  8: ["killer", "killer", "inspector", "medic", "jester", "sleepwalker", "whisperer", "guest"],
  9: ["killer", "killer", "inspector", "medic", "jester", "sleepwalker", "whisperer", "guest", "guest"],
  10: ["killer", "killer", "killer", "inspector", "medic", "jester", "sleepwalker", "whisperer", "guest", "guest"],
};

const ROLE_TITLE: Record<Role, string> = {
  killer: "You are a KILLER",
  inspector: "You are the INSPECTOR",
  medic: "You are the MEDIC",
  jester: "You are the JESTER",
  whisperer: "You are the WHISPERER",
  sleepwalker: "You are the SLEEPWALKER",
  guest: "You are a GUEST",
};

const ROLE_BRIEF: Record<Role, string> = {
  killer: "Choose the body each night. Survive the table by day.",
  inspector: "One name a night. Nobi tells you what he saw, and only you.",
  medic: "One name a night. They cannot die tonight. Not the same name twice running.",
  jester: "You win alone, and only by being voted out. Plant evidence, or make a scene.",
  whisperer: "Once, all game, you may ask Nobi a yes or no question in the dark.",
  sleepwalker: "You hear one word of the night that nobody else hears.",
  guest: "No powers. Just a mouth, a vote, and an alibi.",
};

/**
 * Written dawn lines, one per outcome.
 *
 * These are not a nicety — the night can END ON A TICK, and tick() is
 * synchronous, so there is no opportunity to await the brain at the moment the
 * body is found. Every night therefore gets a written line first and the brain
 * only ever gets to REPLACE it, from act(), where awaiting is allowed. A dead
 * network costs flavour and never costs a game.
 */
const DEATH_LINES = [
  "I kept my eyes shut, as agreed. I heard a door, and then I heard less of NAME than there used to be.",
  "Bad news about NAME. Good news: the carpet was already that colour.",
  "NAME is no longer with us. I did warn everyone about the stairs. I did not mention the other thing.",
  "We are one NAME lighter this morning. Somebody in this room knows exactly how much lighter.",
  "NAME went to bed. NAME did not get up. I am not a detective, but I can count.",
];
const SAVED_LINES = [
  "Somebody tried. Somebody else was already standing there. Nothing to sweep up.",
  "There was a great deal of creeping about and absolutely no result. How embarrassing for them.",
  "An attempt was made. It was, and I say this kindly, a shambles. Everyone is alive.",
];
const QUIET_LINES = [
  "Nothing happened last night. That is somehow worse.",
  "No body. Either someone lost their nerve or someone is being clever.",
  "A quiet night. Enjoy it. Historically, it does not hold.",
];

/** Names read back from the roster, never from a state table that can grow ghosts. */
function nameFrom(players: Player[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? "someone";
}

/** The cohort minus the bodies. The live roster has no say in this on purpose. */
function livingIds(state: BodiesState): string[] {
  return state.seated.filter((id) => !state.dead.includes(id));
}

function idsWithRole(state: BodiesState, role: Role): string[] {
  return livingIds(state).filter((id) => state.roles[id] === role);
}

/** Living AND holding a phone right now — the only people worth waiting for. */
function livingPresent(state: BodiesState, players: Player[]): string[] {
  const here = new Set(players.map((p) => p.id));
  return livingIds(state).filter((id) => here.has(id));
}

/**
 * Has the night finished on its own?
 *
 * Presence, not cohort: a killer who has walked off with their phone would
 * otherwise hold the table in the dark until the timer, every single night.
 * The killers count as done the moment a target exists, because a second killer
 * idling should not block the first one's decision.
 */
function nightSettled(state: BodiesState, players: Player[]): boolean {
  const waitingOn = livingPresent(state, players).filter((id) => {
    if (state.nightDone.includes(id)) return false;
    if (state.roles[id] === "killer" && state.killTarget !== "") return false;
    return true;
  });
  return waitingOn.length === 0;
}

/**
 * Who has won, if anyone.
 *
 * Counted off the cohort so it cannot flicker with connectivity. Killers take
 * the house at parity rather than at a majority: once they match the rest of
 * the room the vote can no longer go against them, and playing that out is four
 * minutes of everyone watching a foregone conclusion.
 */
function outcome(state: BodiesState): "" | "town" | "killers" {
  const living = livingIds(state);
  const killers = living.filter((id) => state.roles[id] === "killer");
  if (killers.length === 0) return "town";
  if (killers.length * 2 >= living.length) return "killers";
  return "";
}

/** One letter that genuinely appears in a living killer's name. Never a lie. */
function sleepwalkerLetter(state: BodiesState, ctx: GameContext): string {
  const killers = idsWithRole(state, "killer");
  if (killers.length === 0) return "";
  const pick = killers[Math.floor(ctx.random() * killers.length)] ?? "";
  const letters = nameFrom(ctx.players, pick).toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters.length) return "";
  return letters.charAt(Math.floor(ctx.random() * letters.length));
}

/** Deal the cards. Shuffled, so the same seat is not the killer every game. */
function dealRoles(ids: string[], ctx: GameContext): Record<string, Role> {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  // Clamped rather than trusted: engine limits should hold, but a deal that
  // falls off the end of the table would hand half the room `undefined` as a
  // role and every one of them a phone with nothing on it.
  const size = Math.min(Math.max(order.length, MIN_PLAYERS), MAX_PLAYERS);
  const cards = DEAL[size] ?? DEAL[MIN_PLAYERS] ?? [];
  const roles: Record<string, Role> = {};
  order.forEach((id, i) => { roles[id] = cards[i] ?? "guest"; });
  return roles;
}

/** Dusk. Everything to do with last night is cleared here and nowhere else. */
function beginNight(state: BodiesState, keepProtect: string): BodiesState {
  return {
    ...state,
    phase: "night",
    night: state.night + 1,
    killTarget: "",
    protectId: "",
    lastProtectId: keepProtect,
    inspectorTarget: "",
    framedId: "",
    sceneId: "",
    nightDone: [],
    // Rumours are NOT wiped here. They are emptied when one is read out at
    // dawn, so a whisper left by a ghost during the day still gets its airing
    // rather than being thrown away the moment the lights go off.
    ready: [],
    votes: {},
    timer: NIGHT_TICKS,
  };
}

/**
 * Dawn. Resolves the kill, files the Inspector's finding, and writes his line.
 *
 * Deliberately synchronous: both act() and tick() can end a night, and only one
 * of them may await. See DEATH_LINES.
 */
function resolveNight(state: BodiesState, ctx: GameContext): BodiesState {
  const living = livingIds(state);
  const target = state.killTarget !== "" && living.includes(state.killTarget) ? state.killTarget : "";
  const saved = target !== "" && target === state.protectId;
  const victimId = target !== "" && !saved ? target : "";

  const notes = { ...state.notes };
  const append = (id: string, line: string) => {
    notes[id] = [line, ...(notes[id] ?? [])].slice(0, NOTES_MAX);
  };

  // The Inspector's finding is filed even if he is the one who dies tonight —
  // it simply never gets read, which is a much better story than it vanishing.
  const inspectorId = idsWithRole(state, "inspector")[0] ?? "";
  if (inspectorId !== "" && state.inspectorTarget !== "") {
    const t = state.inspectorTarget;
    const guilty = state.roles[t] === "killer" || t === state.framedId;
    append(inspectorId, `Night ${state.night}: ${nameFrom(ctx.players, t)} — ${guilty ? "blood on their hands" : "nothing on them"}.`);
  }

  const sleeperId = idsWithRole(state, "sleepwalker")[0] ?? "";
  if (sleeperId !== "") {
    const letter = sleepwalkerLetter(state, ctx);
    append(sleeperId, letter !== ""
      ? `Night ${state.night}: you heard him mutter one letter — ${letter}. It is in a killer's name.`
      : `Night ${state.night}: he said nothing you could use.`);
  }

  const dead = victimId !== "" ? [...state.dead, victimId] : state.dead;

  // One rumour, read out with no name attached. Anonymity is the entire point:
  // an attributed rumour is just a person talking, and people can already talk.
  const pool = state.rumours.filter((r) => r.text.trim() !== "");
  const chosen = pool.length > 0 ? pool[Math.floor(ctx.random() * pool.length)] : undefined;
  const dawnRumour = chosen
    ? `${chosen.dead ? "One of the dead is restless" : "Someone left a note"}: "${chosen.text}"`
    : "";

  let line: string;
  if (victimId !== "") {
    const pick = DEATH_LINES[Math.floor(ctx.random() * DEATH_LINES.length)] ?? DEATH_LINES[0] ?? "NAME is dead.";
    line = pick.replace(/NAME/g, nameFrom(ctx.players, victimId));
  } else if (saved) {
    line = SAVED_LINES[Math.floor(ctx.random() * SAVED_LINES.length)] ?? SAVED_LINES[0] ?? "Nobody died.";
  } else {
    line = QUIET_LINES[Math.floor(ctx.random() * QUIET_LINES.length)] ?? QUIET_LINES[0] ?? "Nobody died.";
  }
  // The Jester's scene is appended rather than replacing the death, because the
  // Jester wants to be NOTICED next to a body, not instead of one.
  if (state.sceneId !== "" && !dead.includes(state.sceneId)) {
    line += ` Also, and I mention it only for completeness: ${nameFrom(ctx.players, state.sceneId)} was up and about at an hour I would describe as suspicious.`;
  }

  const next: BodiesState = {
    ...state,
    phase: "day",
    dead,
    notes,
    lastVictimId: victimId,
    lastSaved: saved,
    dawnLine: line,
    dawnRumour,
    rumours: [],
    ready: [],
    votes: {},
    timer: DAY_TICKS,
  };
  const won = outcome(next);
  if (won !== "") return { ...next, phase: "over", winner: won, timer: 0 };
  return next;
}

/** Count the votes and hang whoever the table settled on. */
function resolveVote(state: BodiesState): BodiesState {
  const living = livingIds(state);
  const tally: Record<string, number> = {};
  for (const [voter, target] of Object.entries(state.votes)) {
    if (!living.includes(voter)) continue;            // a ghost's vote does not count
    if (target === "nobody" || !living.includes(target)) continue;
    tally[target] = (tally[target] ?? 0) + 1;
  }
  let best = "";
  let bestN = 0;
  let tie = false;
  for (const [id, n] of Object.entries(tally)) {
    if (n > bestN) { best = id; bestN = n; tie = false; }
    else if (n === bestN && n > 0) { tie = true; }
  }
  // A tie hangs nobody. Picking one at random would make the table's careful
  // three-three split into a coin flip, which is the opposite of the game.
  const executedId = tie || bestN === 0 ? "" : best;
  const dead = executedId !== "" ? [...state.dead, executedId] : state.dead;
  const role = executedId !== "" ? (state.roles[executedId] ?? "guest") : "";

  const next: BodiesState = {
    ...state,
    phase: "verdict",
    dead,
    lastVerdict: { executedId, role, tie: tie && bestN > 0 },
    timer: VERDICT_TICKS,
    ready: [],
  };
  // The Jester beats everybody, including a town that was one hanging away from
  // winning. That is the deal, and it is why the Jester is worth playing.
  if (role === "jester") return { ...next, phase: "over", winner: "jester", timer: 0 };
  const won = outcome(next);
  if (won !== "") return { ...next, phase: "over", winner: won, timer: 0 };
  return next;
}

/**
 * Let the brain rewrite his dawn line, and shrug it off if it cannot.
 *
 * Prose, so narrate() rather than ask(). The line already exists before this is
 * called, so the worst case is the written one, which was always going to be
 * good enough.
 */
async function dressDawn(state: BodiesState, ctx: GameContext): Promise<BodiesState> {
  if (state.phase !== "day") return state;
  const victim = state.lastVictimId !== "" ? nameFrom(ctx.players, state.lastVictimId) : "";
  try {
    const raw = await ctx.narrate(
      [
        "You are a small desk robot narrating a murder mystery party game to the room.",
        "Dry, theatrical, faintly put upon. Never gory, never graphic, no blood described.",
        victim !== ""
          ? `Announce that ${victim} was found dead this morning.`
          : state.lastSaved
            ? "Announce that somebody tried to kill in the night and failed completely."
            : "Announce that nothing happened in the night, and imply that this is ominous.",
        "Two sentences at most. Reply with the announcement only.",
      ].join("\n"),
      40,
    );
    const line = raw.trim().replace(/^["']|["']$/g, "");
    if (line.length > 12 && line.length < 260) {
      const tail = state.sceneId !== "" && !state.dead.includes(state.sceneId)
        ? ` Also, for completeness: ${nameFrom(ctx.players, state.sceneId)} was up and about at an hour I would call suspicious.`
        : "";
      return { ...state, dawnLine: line + tail };
    }
  } catch { /* the written line stands */ }
  return state;
}

export const bodies: GameDefinition<BodiesState> = {
  id: "bodies",
  title: "Bodies",
  blurb: "Somebody in this room is killing the others. Nobi shuts his eyes and lets them.",
  icon: "🕯️",
  color: "#8b5cf6",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  tickMs: TICK_MS,

  create: () => ({
    phase: "lobby",
    night: 0,
    seated: [],
    roles: {},
    dead: [],
    killTarget: "",
    protectId: "",
    lastProtectId: "",
    inspectorTarget: "",
    framedId: "",
    sceneId: "",
    nightDone: [],
    rumours: [],
    lastVictimId: "",
    lastSaved: false,
    dawnLine: "",
    dawnRumour: "",
    notes: {},
    whisperSpent: false,
    ready: [],
    votes: {},
    lastVerdict: null,
    winner: "",
    timer: 0,
  }),

  /**
   * Nothing is stored on join, and that is the decision.
   *
   * The cards were dealt to a fixed cohort; anyone who turns up after that is a
   * spectator until the next game, which render() works out by asking whether
   * they are in `seated`. Writing them into a table here would leave a ghost
   * entry behind for every phone that ever passed through — the exact bug that
   * has bitten four of the sibling games — and dealing them a card mid-game
   * would quietly break the balance the head count was chosen for.
   */
  join: (state) => state,

  act: async (state, player, action, value, ctx): Promise<BodiesState> => {
    const living = livingIds(state);
    const isLiving = living.includes(player.id);
    const role = state.roles[player.id];

    if (action === "start" || action === "again") {
      // Only from the two screens that offer it, or a phone left on an old
      // frame can reshuffle the house while a night is in progress.
      if (state.phase !== "lobby" && state.phase !== "over") return state;
      const ids = ctx.players.map((p) => p.id);
      if (ids.length < MIN_PLAYERS || ids.length > MAX_PLAYERS) return state;
      const fresh: BodiesState = {
        ...bodies.create({ players: ctx.players }),
        seated: ids,
        roles: dealRoles(ids, ctx),
      };
      return beginNight(fresh, "");
    }

    /**
     * The dead keep their keyboard, in every phase.
     *
     * It is the only thing they have left, and it is handled up here rather
     * than inside each phase because a ghost whose box quietly stopped working
     * halfway through the game reads as a bug and puts the phone in a pocket —
     * taking that player's commentary out of the room for the rest of the night.
     */
    if (action === "whisper" && !isLiving && state.seated.includes(player.id)) {
      const text = (value ?? "").trim().slice(0, 60);
      if (!text) return state;
      return { ...state, rumours: [...state.rumours, { playerId: player.id, text, dead: true }].slice(-RUMOUR_MAX) };
    }

    // ---------------- night ----------------
    if (state.phase === "night") {
      if (!isLiving) return state;

      if (action === "kill" && role === "killer") {
        const target = (value ?? "").trim();
        if (!living.includes(target) || state.roles[target] === "killer") return state;
        // Every living killer is settled once one of them has chosen, but any
        // of them may still move it before dawn — they are meant to argue.
        const done = new Set(state.nightDone);
        for (const id of idsWithRole(state, "killer")) done.add(id);
        return { ...state, killTarget: target, nightDone: [...done] };
      }

      if (action === "protect" && role === "medic") {
        const target = (value ?? "").trim();
        if (!living.includes(target)) return state;
        // No sitting on the same person night after night, which would otherwise
        // turn the Medic into a wall rather than a decision.
        if (target === state.lastProtectId) return state;
        return { ...state, protectId: target, nightDone: [...new Set([...state.nightDone, player.id])] };
      }

      if (action === "inspect" && role === "inspector") {
        const target = (value ?? "").trim();
        if (!living.includes(target) || target === player.id) return state;
        return { ...state, inspectorTarget: target, nightDone: [...new Set([...state.nightDone, player.id])] };
      }

      if (action === "plant" && role === "jester") {
        const target = (value ?? "").trim();
        if (!living.includes(target) || target === player.id) return state;
        return { ...state, framedId: target, sceneId: "", nightDone: [...new Set([...state.nightDone, player.id])] };
      }

      if (action === "scene" && role === "jester") {
        // The other half of the Jester: instead of framing somebody, hand the
        // table your own name at dawn and hope they are hasty about it.
        return { ...state, sceneId: player.id, framedId: "", nightDone: [...new Set([...state.nightDone, player.id])] };
      }

      if (action === "whisper-ask" && role === "whisperer") {
        if (state.whisperSpent) return state;
        const q = (value ?? "").trim().slice(0, 120);
        if (!q) return state;
        // Structured answer, so ask() rather than narrate(). The secret table
        // goes into the prompt and the answer comes back to ONE phone, so this
        // never leaks past the person who spent their one question.
        const table = state.seated
          .map((id) => `${nameFrom(ctx.players, id)} — ${state.roles[id] ?? "guest"}${state.dead.includes(id) ? " (dead)" : ""}`)
          .join("; ");
        try {
          const raw = await ctx.ask(
            [
              "You are the silent narrator of a murder mystery party game and you know everything.",
              `The secret table is: ${table}.`,
              `Last night the killers chose: ${state.killTarget !== "" ? nameFrom(ctx.players, state.killTarget) : "nobody yet"}.`,
              `A player asks, in secret: "${q}"`,
              "Answer truthfully from the table above.",
              "Reply with exactly one word: YES, NO, or UNCLEAR.",
            ].join("\n"),
            4,
          );
          const word = raw.toUpperCase().match(/\b(YES|NO|UNCLEAR)\b/)?.[1];
          if (word) {
            const notes = { ...state.notes };
            notes[player.id] = [`"${q}" — he said ${word}.`, ...(notes[player.id] ?? [])].slice(0, NOTES_MAX);
            return {
              ...state,
              whisperSpent: true,
              notes,
              nightDone: [...new Set([...state.nightDone, player.id])],
            };
          }
        } catch { /* fall through — the question is NOT spent */ }
        // A dead network must cost the Whisperer nothing. Their one question is
        // the whole role; losing it to a timeout would be unforgivable.
        const notes = { ...state.notes };
        notes[player.id] = ["He was quiet. Your question is still yours — try again tomorrow night.", ...(notes[player.id] ?? [])].slice(0, NOTES_MAX);
        return { ...state, notes };
      }

      if (action === "rumour") {
        const text = (value ?? "").trim().slice(0, 60);
        if (!text) return state;
        return { ...state, rumours: [...state.rumours, { playerId: player.id, text, dead: false }].slice(-RUMOUR_MAX) };
      }

      if (action === "sleep") {
        // Every living player has this, including the ones with a job. Somebody
        // who cannot decide, or does not want to use their power tonight, must
        // still be able to end their own night — otherwise one indecisive
        // Inspector holds nine people in the dark for a hundred seconds.
        const nightDone = [...new Set([...state.nightDone, player.id])];
        const settled = nightSettled({ ...state, nightDone }, ctx.players);
        const next = { ...state, nightDone };
        if (!settled) return next;
        return dressDawn(resolveNight(next, ctx), ctx);
      }
      return state;
    }

    // ---------------- day ----------------
    if (state.phase === "day") {
      if (action === "ready" && isLiving) {
        const ready = [...new Set([...state.ready, player.id])];
        const present = livingPresent(state, ctx.players);
        // A majority of the phones actually in the room, so a table that has
        // lost two players to the kitchen can still call a vote.
        const needed = Math.max(2, Math.ceil(present.length / 2));
        if (ready.filter((id) => present.includes(id)).length >= needed) {
          return { ...state, ready, phase: "vote", votes: {}, timer: VOTE_TICKS };
        }
        return { ...state, ready };
      }
      if (action === "unready" && isLiving) {
        return { ...state, ready: state.ready.filter((id) => id !== player.id) };
      }
      return state;
    }

    // ---------------- vote ----------------
    if (state.phase === "vote") {
      if (action === "vote" && isLiving) {
        const target = (value ?? "").trim();
        if (target !== "nobody" && !living.includes(target)) return state;
        const votes = { ...state.votes, [player.id]: target };
        const present = livingPresent(state, ctx.players);
        // Everyone who is actually here has voted. Waiting on an absent phone
        // is what the timer is for, not what the table is for.
        const allIn = present.every((id) => votes[id] !== undefined);
        const next = { ...state, votes };
        if (!allIn) return next;
        return resolveVote(next);
      }
      return state;
    }

    // ---------------- verdict ----------------
    if (state.phase === "verdict" && action === "next") {
      return beginNight(state, state.protectId);
    }
    return state;
  },

  tick: (state, ctx): BodiesState => {
    if (state.phase === "lobby" || state.phase === "over") return state;

    // The clock is the safety net for a phone in a pocket; the completion
    // checks are the fast path for a table that is all present and decided.
    if (state.phase === "night") {
      if (nightSettled(state, ctx.players)) return resolveNight(state, ctx);
      const timer = state.timer - 1;
      if (timer > 0) return { ...state, timer };
      return resolveNight({ ...state, timer: 0 }, ctx);
    }

    if (state.phase === "day") {
      const timer = state.timer - 1;
      if (timer > 0) return { ...state, timer };
      return { ...state, phase: "vote", votes: {}, timer: VOTE_TICKS };
    }

    if (state.phase === "vote") {
      const timer = state.timer - 1;
      if (timer > 0) return { ...state, timer };
      // Whatever is in the box at the bell is the verdict, abstentions and all.
      return resolveVote({ ...state, timer: 0 });
    }

    // verdict: the night comes round on its own, because the one person most
    // likely to be holding a pocketed phone is whoever just got hanged.
    const timer = state.timer - 1;
    if (timer > 0) return { ...state, timer };
    return beginNight(state, state.protectId);
  },

  render: (state, players) => {
    const nameOf = (id: string) => nameFrom(players, id);
    const living = livingIds(state);
    const dead = state.dead;
    const killers = state.seated.filter((id) => state.roles[id] === "killer");
    const enough = players.length >= MIN_PLAYERS && players.length <= MAX_PLAYERS;
    const victim = state.lastVictimId;
    const verdict = state.lastVerdict;

    const graveyard = dead.length
      ? dead.map((id) => `${nameOf(id)} (${state.roles[id] ?? "guest"})`).join("  ·  ")
      : "";

    const dayBody = [
      state.dawnLine,
      state.dawnRumour,
    ].filter((s) => s !== "").join("   ");

    const verdictBody = verdict
      ? verdict.executedId === ""
        ? verdict.tie ? "Dead heat. Nobody hangs today." : "No majority. Nobody hangs today."
        : `${nameOf(verdict.executedId)} was ${verdict.role === "killer" ? "a KILLER" : verdict.role === "jester" ? "the JESTER" : `the ${String(verdict.role).toUpperCase()}`}.`
      : "";

    const winBody =
      state.winner === "jester"
        ? `${nameOf(verdict?.executedId ?? "")} was the Jester, and you did exactly what they wanted. They win alone.`
        : state.winner === "killers"
          ? `The killers take the house: ${killers.map(nameOf).join(" and ")}.`
          : state.winner === "town"
            ? `Every killer is in the ground. The house survives. They were ${killers.map(nameOf).join(" and ")}.`
            : "";

    const face = {
      title:
        state.phase === "lobby" ? "Bodies"
          : state.phase === "night" ? `Night ${state.night}`
            : state.phase === "over" ? "Bodies"
              : `Day ${state.night}`,
      body:
        state.phase === "lobby"
          ? players.length < MIN_PLAYERS
            ? `Four phones at least. ${players.length} so far.`
            : players.length > MAX_PLAYERS
              ? "Ten is the most this house holds."
              : "Everyone has a phone. Press Start and I will shut my eyes."
          : state.phase === "night" ? "My eyes are shut. Check your phone. Do not say it out loud."
            : state.phase === "day" ? dayBody
              : state.phase === "vote" ? "Vote on your phone. You may vote for nobody."
                : state.phase === "verdict" ? verdictBody
                  : winBody,
      big:
        state.phase === "night" ? "· · ·"
          : state.phase === "vote" ? `${state.timer}`
            : state.phase === "day" ? (victim !== "" ? nameOf(victim).toUpperCase() : state.lastSaved ? "SAVED" : "NOBODY")
              : undefined,
      /**
       * The eyes closing is the game. Everything else here is dressing around
       * the second the room goes quiet because a robot pretended to fall asleep.
       */
      mood:
        state.phase === "night" ? "sleeping"
          : state.phase === "day" ? (victim !== "" ? "sad" : "suspicious")
            : state.phase === "vote" ? "thinking"
              : state.phase === "verdict" ? (verdict?.role === "killer" ? "excited" : "shocked")
                : state.phase === "over" ? (state.winner === "town" ? "starstruck" : "mischievous")
                  : "curious",
      color:
        state.phase === "night" ? "#243b6b"
          : state.phase === "day" ? (victim !== "" ? "#ff5470" : "#c9dcf0")
            : state.phase === "vote" ? "#ffb703"
              : state.phase === "over" ? (state.winner === "town" ? "#5ce0b8" : "#8b5cf6")
                : "#8b5cf6",
      scene: state.phase === "over" && state.winner === "town" ? "confetti" : null,
      /**
       * He only talks at the top of a phase. A narrator who repeats the same
       * sentence every poll is not theatrical, he is a fault condition.
       */
      speak:
        state.phase === "night" && state.timer > NIGHT_TICKS - SPEAK_WINDOW
          ? state.night === 1
            ? "Right. Everyone shut up and look at your phone. I am closing my eyes, and I want you all to remember that whatever happens next, I saw nothing."
            : "Eyes closed. Go on then."
          : state.phase === "day" && state.timer > DAY_TICKS - SPEAK_WINDOW
            ? dayBody
            : state.phase === "vote" && state.timer > VOTE_TICKS - SPEAK_WINDOW
              ? "Time to point at somebody. Vote on your phones."
              : state.phase === "verdict" && state.timer > VERDICT_TICKS - SPEAK_WINDOW
                ? verdictBody
                : state.phase === "over" ? winBody
                  : undefined,
      // Not a score: one for the living, zero for the bodies. It is the single
      // thing the room most needs to see from across a table.
      scores: players
        .filter((p) => state.seated.includes(p.id))
        .map((p) => ({
          name: p.name,
          score: living.includes(p.id) ? 1 : 0,
          active: state.phase === "vote" && state.votes[p.id] !== undefined,
        })),
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      const role = state.roles[p.id];
      const alive = living.includes(p.id);
      const seated = state.seated.includes(p.id);
      const myNotes = state.notes[p.id] ?? [];
      const others = living.filter((id) => id !== p.id);

      if (state.phase === "lobby") {
        phones[p.id] = {
          title: "Bodies",
          body: players.length < MIN_PLAYERS
            ? `Waiting for phones. ${players.length} of ${MIN_PLAYERS}. Four is the fewest that makes a real game.`
            : players.length > MAX_PLAYERS
              ? "Too many for one house. Ten at most."
              : "Some of you will be killers. One of you wants to be blamed. Nobi shuts his eyes and narrates.",
          choices: enough ? [{ action: "start", label: "Start" }] : [],
        };
        continue;
      }

      if (!seated) {
        // Dealt out before they sat down. They are told exactly why, and they
        // still see the story — a phone with nothing on it reads as broken.
        phones[p.id] = {
          title: "You are watching this one",
          body: "The cards were dealt before you sat down, and slipping you one now would break the balance. You are in from the next game.",
          secret: graveyard !== "" ? `Bodies so far: ${graveyard}` : "No bodies yet.",
          choices: state.phase === "over" && enough ? [{ action: "again", label: "Play again" }] : [],
        };
        continue;
      }

      if (state.phase === "over") {
        phones[p.id] = {
          title:
            state.winner === "jester" ? "The Jester wins"
              : state.winner === "killers" ? "The killers win"
                : "The house wins",
          body: `${winBody} You were the ${String(role ?? "guest").toUpperCase()}.`,
          secret: graveyard !== "" ? `Bodies: ${graveyard}` : undefined,
          choices: enough ? [{ action: "again", label: "Play again" }] : [],
        };
        continue;
      }

      if (!alive) {
        // Dead, and still holding a phone with something to do on it every
        // single phase. A ghost with no buttons puts the phone in a pocket and
        // takes their commentary with them.
        phones[p.id] = {
          title: "You are dead",
          body: state.phase === "night"
            ? "Nothing can hurt you now. Leave a whisper and he may mutter it at dawn, with no name on it."
            : "You know everything and may say none of it. Whisper instead.",
          secret: `You were the ${String(role ?? "guest").toUpperCase()}.   Bodies: ${graveyard}`,
          input: { action: "whisper", placeholder: "a whisper from the dead", maxLength: 60 },
        };
        continue;
      }

      // ---- living, mid-game ----
      const done = state.nightDone.includes(p.id) || (role === "killer" && state.killTarget !== "");
      const secret = [
        `${ROLE_TITLE[role ?? "guest"]}. ${ROLE_BRIEF[role ?? "guest"]}`,
        role === "killer" && killers.length > 1
          ? `With you: ${killers.filter((id) => id !== p.id).map(nameOf).join(", ")}`
          : "",
        myNotes.length ? myNotes.join("   ") : "",
      ].filter((s) => s !== "").join("   ·   ");

      if (state.phase === "night") {
        // Everyone's night ends with the same button, so no phase can ever wait
        // on a player who has no move left to make.
        const sleepChoice = { action: "sleep", label: done ? "Done — go to sleep" : "Skip tonight" };

        if (role === "killer") {
          phones[p.id] = {
            title: "Choose the body",
            body: state.killTarget !== ""
              ? `Settled on ${nameOf(state.killTarget)}. You can still change it until dawn.`
              : "Pick one. If there are two of you, agree — the last choice stands.",
            secret,
            choices: [
              ...others
                .filter((id) => state.roles[id] !== "killer")
                .map((id) => ({ action: "kill", label: nameOf(id), value: id })),
              sleepChoice,
            ],
            input: { action: "rumour", placeholder: "leave a rumour (optional)", maxLength: 60 },
            yourTurn: true,
          };
        } else if (role === "medic") {
          phones[p.id] = {
            title: "Who are you sitting with?",
            body: state.lastProtectId !== ""
              ? `Not ${nameOf(state.lastProtectId)} again — you were with them last night.`
              : "They cannot die tonight. You may sit with yourself.",
            secret,
            choices: [
              ...living
                .filter((id) => id !== state.lastProtectId)
                .map((id) => ({
                  action: "protect",
                  label: id === p.id ? "Stay in your own room" : nameOf(id),
                  value: id,
                })),
              sleepChoice,
            ],
            yourTurn: true,
          };
        } else if (role === "inspector") {
          phones[p.id] = {
            title: "One name",
            body: "He will tell you what he saw, and only you. Evidence can be planted, so weigh it.",
            secret,
            choices: [
              ...others.map((id) => ({ action: "inspect", label: nameOf(id), value: id })),
              sleepChoice,
            ],
            yourTurn: true,
          };
        } else if (role === "jester") {
          phones[p.id] = {
            title: "Be insufferable",
            body: "Plant evidence and the Inspector reads them as a killer tonight. Or make a scene and let him drop your own name at dawn.",
            secret,
            choices: [
              ...others.map((id) => ({ action: "plant", label: `Plant it on ${nameOf(id)}`, value: id })),
              { action: "scene", label: "Make a scene (about yourself)" },
              sleepChoice,
            ],
            yourTurn: true,
          };
        } else if (role === "whisperer") {
          phones[p.id] = {
            title: state.whisperSpent ? "You have had your question" : "Ask him one thing",
            body: state.whisperSpent
              ? "He will not answer twice. Leave a rumour instead."
              : "Any yes or no question, once, all game. He answers here and nowhere else.",
            secret,
            input: state.whisperSpent
              ? { action: "rumour", placeholder: "leave a rumour", maxLength: 60 }
              : { action: "whisper-ask", placeholder: "is the killer sitting next to me?", maxLength: 120 },
            choices: [sleepChoice],
            yourTurn: !state.whisperSpent,
          };
        } else if (role === "sleepwalker") {
          phones[p.id] = {
            title: "Listen",
            body: "You do not act. You hear one word of the night that nobody else hears, and it arrives at dawn.",
            secret,
            input: { action: "rumour", placeholder: "leave a rumour (optional)", maxLength: 60 },
            choices: [sleepChoice],
          };
        } else {
          phones[p.id] = {
            title: "Stay in bed",
            body: "No powers tonight. Leave a rumour in the dark and he will read one out at dawn with no name attached.",
            secret,
            input: { action: "rumour", placeholder: "a rumour", maxLength: 60 },
            choices: [sleepChoice],
          };
        }
        continue;
      }

      if (state.phase === "day") {
        const iAmReady = state.ready.includes(p.id);
        phones[p.id] = {
          title: victim !== "" ? `${nameOf(victim)} is dead` : state.lastSaved ? "Nobody died" : "A quiet night",
          body: "Argue. Lie if it suits you. When enough of you are ready, the vote opens.",
          secret,
          choices: [
            iAmReady
              ? { action: "unready", label: "Actually, hold on" }
              : { action: "ready", label: "Ready to vote" },
          ],
        };
        continue;
      }

      if (state.phase === "vote") {
        const mine = state.votes[p.id];
        phones[p.id] = {
          title: mine !== undefined ? `You voted ${mine === "nobody" ? "for nobody" : nameOf(mine)}` : "Point at somebody",
          body: "A tie hangs nobody. You may change your mind until the clock runs out.",
          secret,
          choices: [
            ...others.map((id) => ({ action: "vote", label: nameOf(id), value: id })),
            { action: "vote", label: "Nobody", value: "nobody" },
          ],
          yourTurn: mine === undefined,
        };
        continue;
      }

      // verdict
      phones[p.id] = {
        title: verdict && verdict.executedId === p.id ? "They hanged you" : "The verdict",
        body: verdictBody,
        secret,
        // Anyone can push on to the night early; it also comes on its own.
        choices: [{ action: "next", label: "Into the night" }],
      };
    }

    return { face, phones };
  },
};
