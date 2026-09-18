import type { GameDefinition, Player } from "./types.js";

/**
 * Dev's Dungeon — a co-op adventure told out loud.
 *
 * Nobi is the narrator and the dungeon master. The room hears the story in his
 * voice and watches the scene on his face; each player's phone holds what only
 * they know — their character, their private options, and the result of a roll
 * nobody else sees until they choose to act on it.
 *
 * The secret roll is the heart of it. A player is told "you rolled a 3" before
 * they pick, so the interesting decision is not "what do I want to happen" but
 * "do I tell the others how bad my odds are". That is a thing you can only do
 * when every player has their own screen, which is exactly what a room full of
 * phones is.
 *
 * Turn-based on purpose: the brain writes the prose, which takes a couple of
 * seconds, and a couple of seconds is nothing when someone is already talking
 * about what they are going to do.
 */

type Phase = "lobby" | "intro" | "turn" | "resolving" | "over";

interface Character {
  playerId: string;
  name: string;
  /** Flavour only, but it steers the narration and gives people something to play. */
  role: string;
  hp: number;
  /** Something only this player is told at the start. Makes table talk better. */
  secret: string;
}

export interface DungeonState {
  phase: Phase;
  /**
   * Whose turn, as an index into the seated players — kept IN RANGE rather than
   * counted up forever. A running count that is modded at render time quietly
   * hands the turn to somebody else the moment a seventh phone changes the
   * length of the table, so the count is wrapped when the turn advances instead.
   */
  turn: number;
  round: number;
  /** The last thing Nobi narrated — shown on the face and spoken. */
  scene: string;
  /** Short history, fed back to the brain so the story stays coherent. */
  log: string[];
  chars: Record<string, Character>;
  /** The roll the current player has been shown, before they choose. */
  pendingRoll?: { playerId: string; value: number };
  /** Options for the current turn. Generated with the scene. */
  options: string[];
  /** Set while the brain is writing, so phones can show a spinner instead of stale buttons. */
  thinking: boolean;
  torch: number;   // 0..100, the shared clock: it burns down and the dungeon gets meaner
}

const ROLES = [
  { role: "the Tinkerer", secret: "You can repair one broken thing per adventure. Nobody else knows." },
  { role: "the Quiet One", secret: "You heard something behind the party three rooms ago. You have not mentioned it." },
  { role: "the Optimist", secret: "You are carrying the only rope. You forgot to say so." },
  { role: "the Cartographer", secret: "Your map is wrong in one place and you are not sure which." },
  { role: "the Cook", secret: "You are out of food. You have been pretending otherwise." },
  { role: "the Sceptic", secret: "You do not believe the dungeon is real. You may be right." },
];

const OPENING =
  "A door closes behind you that you do not remember opening. The corridor smells of cold iron and old rain. " +
  "Somewhere ahead, something is keeping time.";

/** Kept short: these are read aloud and shown on a small round screen. */
const FALLBACK_OPTIONS = ["Press on", "Listen first", "Search the walls", "Call out"];

function seatOrder(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.seat - b.seat);
}

function current(state: DungeonState, players: Player[]): Player | undefined {
  const seated = seatOrder(players);
  if (!seated.length) return undefined;
  // The modulo is belt and braces: turn is kept in range, but a save from a
  // fuller table must never index past the end and leave the phones blank.
  return seated[state.turn % seated.length];
}

/** Turn gate. Everything that moves the story on has to pass this first. */
function isCurrent(state: DungeonState, players: Player[], player: Player): boolean {
  return current(state, players)?.id === player.id;
}

export const devsDungeon: GameDefinition<DungeonState> = {
  id: "devs-dungeon",
  title: "Dev's Dungeon",
  blurb: "A co-op adventure Nobi narrates. Your phone holds your secrets and your rolls.",
  icon: "⚔️",
  color: "#9b7ff0",
  minPlayers: 1,
  maxPlayers: 6,

  create: ({ players }) => ({
    phase: players.length ? "intro" : "lobby",
    turn: 0,
    round: 1,
    scene: OPENING,
    log: [OPENING],
    chars: {},
    options: FALLBACK_OPTIONS,
    thinking: false,
    torch: 100,
  }),

  join: (state, player) => {
    if (state.chars[player.id]) return state;
    const taken = Object.values(state.chars).map((c) => c.role);
    const pick = ROLES.find((r) => !taken.includes(r.role)) ?? ROLES[0]!;
    return {
      ...state,
      phase: state.phase === "lobby" ? "intro" : state.phase,
      chars: { ...state.chars, [player.id]: { playerId: player.id, name: player.name, role: pick.role, hp: 3, secret: pick.secret } },
    };
  },

  act: async (state, player, action, value, ctx): Promise<DungeonState> => {
    // Begin: the narrator sets the scene once everyone is in. Accepts any
    // waiting phase, not just "intro", so the Begin button on a phone always
    // does the thing it says — a restored lobby used to swallow the press.
    if (action === "begin" && state.phase !== "turn" && state.phase !== "over") {
      return { ...state, phase: "turn", turn: 0, pendingRoll: undefined };
    }

    // Rolling is private and happens BEFORE choosing, so the player knows their
    // odds while they decide — and can lie about them to the table.
    //
    // Two gates, both learned the hard way. The turn gate stops a phone that is
    // a frame behind rolling out of order; and a pending roll left over by
    // somebody who is no longer the current player is thrown away rather than
    // blocking, because the old `!state.pendingRoll` test meant one stale press
    // froze the whole table with no button that could unfreeze it.
    if (action === "roll" && state.phase === "turn" && isCurrent(state, ctx.players, player)) {
      if (state.pendingRoll?.playerId === player.id) return state;  // no re-rolling until you like it
      const rolled = 1 + Math.floor(ctx.random() * 6);
      return { ...state, pendingRoll: { playerId: player.id, value: rolled } };
    }

    // Someone wandered off mid-turn. Anyone else may move the story past them,
    // otherwise a table of six waits forever on a phone that is in a pocket.
    if (action === "skip" && state.phase === "turn" && !isCurrent(state, ctx.players, player)) {
      const seats = Math.max(1, ctx.players.length);
      const wrapped = (state.turn + 1) % seats;
      return {
        ...state,
        turn: wrapped,
        round: wrapped === 0 ? state.round + 1 : state.round,
        pendingRoll: undefined,
      };
    }

    if (action === "choose" && state.phase === "turn" && isCurrent(state, ctx.players, player)) {
      const choice = (value ?? "").slice(0, 120).trim();
      if (!choice) return state;
      const roll = state.pendingRoll?.playerId === player.id ? state.pendingRoll.value : 1 + Math.floor(ctx.random() * 6);
      const char = state.chars[player.id];
      const outcome = roll >= 5 ? "it goes well" : roll >= 3 ? "it half works" : "it goes badly";

      // No "thinking" frame is published here: act() returns once, at the end,
      // so setting the flag on a throwaway copy fooled nobody. The phone keeps
      // the last scene for the second or two the brain is writing.

      // One call, not two. Narration and the next four options come back
      // together: a second round trip doubled the wait between someone choosing
      // and the room hearing what happened, and that gap is the whole game.
      const prompt = [
        `You are narrating a co-operative dungeon adventure for a room of people, out loud, in a dry warm voice.`,
        `Story so far: ${state.log.slice(-4).join(" ")}`,
        `${char?.name ?? "A player"} (${char?.role ?? "an adventurer"}) chose: "${choice}". They rolled ${roll} of 6, so ${outcome}.`,
        `Write what happens in 2 to 3 short sentences. Present tense. End somewhere the next person must react to.`,
        `Do not ask a question and do not mention dice or rolls.`,
        `Then a final line exactly like this, four things a player could try next, two to four words each:`,
        `OPTIONS: first | second | third | fourth`,
      ].join("\n");
      let told = "";
      let parsed: string[] = [];
      try {
        const raw = await ctx.narrate(prompt, 90);
        const m = raw.match(/OPTIONS:\s*(.+)$/im);
        if (m) {
          parsed = m[1]!.split("|").map((o) => o.trim()).filter((o) => o && o.length <= 28).slice(0, 4);
          told = raw.slice(0, m.index).trim();
        } else {
          told = raw.trim();
        }
      } catch { told = ""; }
      if (!told) {
        told = roll >= 5
          ? `${char?.name ?? "You"} ${choice.toLowerCase()}. It works, and the corridor gives a little ground.`
          : roll >= 3
            ? `${char?.name ?? "You"} ${choice.toLowerCase()}. Something shifts, but not enough.`
            : `${char?.name ?? "You"} ${choice.toLowerCase()}. The dungeon does not care for it.`;
      }

      // The torch is the shared clock: bad rolls burn it faster.
      const burn = roll >= 5 ? 6 : roll >= 3 ? 10 : 16;
      const torch = Math.max(0, state.torch - burn);
      const chars = { ...state.chars };
      if (roll <= 2 && char) chars[player.id] = { ...char, hp: Math.max(0, char.hp - 1) };

      const options = parsed.length === 4 ? parsed : FALLBACK_OPTIONS;
      const alive = Object.values(chars).some((c) => c.hp > 0);
      // A round is once around the table, not once per person — the face says
      // "round 3" to a room, and a room counts the way people count.
      const seats = Math.max(1, ctx.players.length);
      const wrapped = (state.turn + 1) % seats;
      return {
        ...state,
        phase: torch <= 0 || !alive ? "over" : "turn",
        turn: wrapped,
        round: wrapped === 0 ? state.round + 1 : state.round,
        scene: told,
        log: [...state.log, told].slice(-12),
        chars,
        options,
        pendingRoll: undefined,
        thinking: false,
        torch,
      };
    }

    // Only from the ending. Unguarded, one stale press from a pocket wiped a
    // story the table was halfway through telling.
    if (action === "restart" && state.phase === "over") {
      // The party comes back whole. Carrying the old hit points over meant a
      // wiped party restarted dead and the next choice ended the game again,
      // which reads as a broken button rather than a new adventure.
      const chars: Record<string, Character> = {};
      for (const [id, c] of Object.entries(state.chars)) chars[id] = { ...c, hp: 3 };
      return { ...devsDungeon.create({ players: [] }), chars, phase: "turn" };
    }
    return state;
  },

  render: (state, players) => {
    const seated = seatOrder(players);
    const active = current(state, players);
    // Anything that is not a live turn or the ending is the waiting room. Saying
    // it once here means a phase nobody thought about — a restored "lobby", the
    // reserved "resolving" — still draws a card with a button on it instead of
    // an empty screen.
    const waiting = state.phase !== "turn" && state.phase !== "over";
    const torchMood = state.torch > 60 ? "happy" : state.torch > 30 ? "curious" : "suspicious";
    const face = {
      title: state.phase === "over" ? "The torch is out" : `Dev's Dungeon · round ${state.round}`,
      body: waiting
        ? "Everyone with a phone is in. Press Begin when you are ready."
        : state.thinking ? "…" : state.scene,
      mood: state.phase === "over" ? "sad" : torchMood,
      color: state.torch > 30 ? "#f5b83d" : "#ff7a3d",
      scene: state.phase === "over" ? "out" : "lab",
      speak: state.phase === "turn" && !state.thinking ? state.scene : undefined,
      scores: seated.map((p) => ({
        name: p.name,
        score: state.chars[p.id]?.hp ?? 3,
        active: active?.id === p.id,
      })),
      canvas: { torch: state.torch },
    };

    const phones: Record<string, import("./types.js").PhoneView> = {};
    for (const p of seated) {
      const char = state.chars[p.id];
      const mine = active?.id === p.id;
      if (waiting) {
        phones[p.id] = {
          title: char ? `${char.name}, ${char.role}` : "Waiting",
          body: "When everyone has joined, someone presses Begin.",
          secret: char?.secret,
          choices: [{ action: "begin", label: "Begin the descent" }],
        };
        continue;
      }
      if (state.phase === "over") {
        phones[p.id] = {
          title: "The torch is out",
          body: "You are somewhere in the dark now. That is a fine place to stop.",
          choices: [{ action: "restart", label: "Again, from the top" }],
        };
        continue;
      }
      if (!mine) {
        phones[p.id] = {
          title: `${active?.name ?? "Someone"} is deciding`,
          body: "Talk to them. Lie if you like.",
          secret: char?.secret,
          yourTurn: false,
          // The one button a waiting player needs: the way out of a turn that
          // belongs to a phone somebody has put in their pocket.
          choices: [{ action: "skip", value: "skip", label: `Move on without ${active?.name ?? "them"}`, detail: "Only if they have wandered off" }],
        };
        continue;
      }
      const roll = state.pendingRoll?.playerId === p.id ? state.pendingRoll.value : null;
      phones[p.id] = {
        title: "Your turn",
        body: state.thinking ? "Nobi is telling it…" : state.scene,
        yourTurn: true,
        secret: char?.secret,
        // act() reads the choice as the words themselves, so label and value are
        // the same thing here — set explicitly all the same, because a button
        // whose value is implied is one refactor away from being unplayable.
        choices: roll === null
          ? [{ action: "roll", value: "roll", label: "Roll in secret", detail: "Only you will see it" }]
          : (state.options.length ? state.options : FALLBACK_OPTIONS)
              .map((o) => ({ action: "choose", value: o, label: o, detail: `You rolled ${roll}` })),
        // The text box comes with the options and not before them: without it, a
        // turn whose options failed to generate would be a screen with nothing
        // on it to press.
        input: roll === null ? undefined : { action: "choose", placeholder: "…or say what you do", maxLength: 100 },
      };
    }
    return { face, phones };
  },
};
