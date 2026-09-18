import type { GameDefinition, GameContext, Player } from "./types.js";

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
  /** Whose turn, as an index into the seated players. */
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
  return seated.length ? seated[state.turn % seated.length] : undefined;
}

export const devsDungeon: GameDefinition<DungeonState> = {
  id: "devs-dungeon",
  title: "Dev's Dungeon",
  blurb: "A co-op adventure Nobi narrates. Your phone holds your secrets and your rolls.",
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
    // Begin: the narrator sets the scene once everyone is in.
    if (action === "begin" && state.phase === "intro") {
      return { ...state, phase: "turn", pendingRoll: undefined };
    }

    // Rolling is private and happens BEFORE choosing, so the player knows their
    // odds while they decide — and can lie about them to the table.
    if (action === "roll" && state.phase === "turn" && !state.pendingRoll) {
      const value = 1 + Math.floor(ctx.random() * 6);
      return { ...state, pendingRoll: { playerId: player.id, value } };
    }

    if (action === "choose" && state.phase === "turn") {
      const choice = (value ?? "").slice(0, 120).trim();
      if (!choice) return state;
      const roll = state.pendingRoll?.playerId === player.id ? state.pendingRoll.value : 1 + Math.floor(ctx.random() * 6);
      const char = state.chars[player.id];
      const outcome = roll >= 5 ? "it goes well" : roll >= 3 ? "it half works" : "it goes badly";

      const thinking = { ...state, thinking: true };
      void thinking; // the caller re-renders before awaiting; kept for clarity

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
      return {
        ...state,
        phase: torch <= 0 || !alive ? "over" : "turn",
        turn: state.turn + 1,
        round: state.round + 1,
        scene: told,
        log: [...state.log, told].slice(-12),
        chars,
        options,
        pendingRoll: undefined,
        thinking: false,
        torch,
      };
    }

    if (action === "restart") {
      return { ...devsDungeon.create({ players: [] }), chars: state.chars, phase: "turn" };
    }
    return state;
  },

  render: (state, players) => {
    const seated = seatOrder(players);
    const active = current(state, players);
    const torchMood = state.torch > 60 ? "happy" : state.torch > 30 ? "curious" : "suspicious";
    const face = {
      title: state.phase === "over" ? "The torch is out" : `Dev's Dungeon · round ${state.round}`,
      body: state.phase === "intro"
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
      if (state.phase === "intro") {
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
        };
        continue;
      }
      const roll = state.pendingRoll?.playerId === p.id ? state.pendingRoll.value : null;
      phones[p.id] = {
        title: "Your turn",
        body: state.thinking ? "Nobi is telling it…" : state.scene,
        yourTurn: true,
        secret: char?.secret,
        choices: roll === null
          ? [{ action: "roll", label: "Roll in secret", detail: "Only you will see it" }]
          : state.options.map((o) => ({ action: "choose", label: o, detail: `You rolled ${roll}` })),
        input: roll === null ? undefined : { action: "choose", placeholder: "…or say what you do", maxLength: 100 },
      };
    }
    return { face, phones };
  },
};

/** Four short options for the next turn. Falls back to the standing set. */
async function nextOptions(scene: string, ctx: GameContext): Promise<string[]> {
  try {
    const raw = await ctx.narrate(
      `A dungeon adventure just reached this moment: "${scene}"\n` +
      `Give exactly four things a player could try next. Two to four words each. ` +
      `One per line, no numbering, no punctuation at the end.`,
      40,
    );
    const lines = raw.split("\n").map((l) => l.replace(/^[-*\d.\s]+/, "").trim()).filter((l) => l && l.length <= 28).slice(0, 4);
    return lines.length === 4 ? lines : FALLBACK_OPTIONS;
  } catch {
    return FALLBACK_OPTIONS;
  }
}
