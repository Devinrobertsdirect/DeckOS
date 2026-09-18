import type { GameDefinition, PhoneView, Player } from "./types.js";

/**
 * Meteor — the game that could only exist on this machine.
 *
 * His face is a circle, which is the wrong shape for almost every game ever
 * made and exactly the right shape for this one. Meteors fall inward from every
 * angle toward his eyes. Each player holds an arc of shield on the rim and turns
 * it with their phone. A meteor that reaches the middle hits HIM, and he reacts
 * to it — the screen is not a playfield with a face behind it, the face IS the
 * thing you are defending. That is the whole idea, and it is why this is worth
 * building rather than another quiz.
 *
 * Everything lives in polar coordinates because the screen does. An angle in
 * degrees clockwise from the top, and a radius from 1.0 (the rim) to 0.0 (his
 * eyes). The face draws it; the server owns it.
 *
 * Co-op, not competitive: two or three people defending one small robot from
 * space is a better twenty seconds at a stand than two people racing.
 */

type Phase = "lobby" | "playing" | "over";

interface Meteor {
  id: number;
  /** Degrees clockwise from the top of the circle. */
  angle: number;
  /** 1.0 at the rim, 0.0 at his eyes. */
  radius: number;
  /** Radius units per tick. */
  speed: number;
  /** Big ones need two hits, and they look different. */
  size: 1 | 2;
  hp: number;
}

export interface MeteorState {
  phase: Phase;
  wave: number;
  score: number;
  lives: number;
  meteors: Meteor[];
  nextId: number;
  /** Player id → the centre angle of their shield arc. */
  shields: Record<string, number>;
  /** Ticks until the next meteor spawns. */
  spawnIn: number;
  /** Set for one tick when something happened, so the face can react. */
  flash?: "block" | "hit" | "wave";
  ticks: number;
}

/** How wide each player's shield arc is, in degrees. */
const SHIELD_ARC = 46;
/** A meteor is blocked when it crosses this radius under a shield. */
const SHIELD_RADIUS = 0.84;
/** Turn rate per button press, in degrees. */
const TURN_STEP = 16;
/**
 * Five, not three. Tested undefended, three lives was gone in ten seconds — and
 * the person playing this is usually a stranger holding a phone they have never
 * used, standing at a stand, being handed a game with no instructions. The first
 * twenty seconds have to be survivable while you work out which way is which.
 */
const START_LIVES = 5;
const TICK_MS = 70;

export const meteor: GameDefinition<MeteorState> = {
  id: "meteor",
  title: "Meteor",
  blurb: "Meteors are falling toward his face from every angle. Turn your shield. Protect the robot.",
  icon: "☄️",
  color: "#ff7a45",
  minPlayers: 1,
  maxPlayers: 4,
  tickMs: TICK_MS,

  create: () => ({
    phase: "lobby", wave: 0, score: 0, lives: START_LIVES, meteors: [], nextId: 1,
    shields: {}, spawnIn: 0, ticks: 0,
  }),

  join: (state, player) => (state.shields[player.id] === undefined
    // New shields start spread around the rim rather than stacked on top of
    // each other, so a second player is instantly useful without moving.
    ? { ...state, shields: { ...state.shields, [player.id]: (Object.keys(state.shields).length * 90) % 360 } }
    : state),

  act: (state, player, action, value): MeteorState => {
    if (action === "start" || action === "again") {
      return {
        ...state,
        phase: "playing", wave: 1, score: 0, lives: START_LIVES,
        meteors: [], spawnIn: 6, flash: undefined, ticks: 0,
      };
    }
    if (state.phase !== "playing") return state;

    const at = state.shields[player.id] ?? 0;
    // A held d-pad sends repeats; each one is a step, which makes fine aiming
    // possible without needing a real analogue control on a phone.
    if (action === "left") return { ...state, shields: { ...state.shields, [player.id]: (at - TURN_STEP + 360) % 360 } };
    if (action === "right") return { ...state, shields: { ...state.shields, [player.id]: (at + TURN_STEP) % 360 } };
    // Tilt / drag gives an absolute angle when the phone can offer one.
    if (action === "aim") {
      const deg = Number(value);
      if (Number.isFinite(deg)) return { ...state, shields: { ...state.shields, [player.id]: ((deg % 360) + 360) % 360 } };
    }
    return state;
  },

  tick: (state, ctx): MeteorState => {
    if (state.phase !== "playing") return state;

    let { score, lives, wave, nextId, spawnIn } = state;
    let flash: MeteorState["flash"];
    const shieldAngles = Object.values(state.shields);
    const meteors: Meteor[] = [];

    for (const m of state.meteors) {
      const radius = m.radius - m.speed;

      // Crossing the shield line: is anyone's arc covering that angle?
      if (m.radius > SHIELD_RADIUS && radius <= SHIELD_RADIUS) {
        const covered = shieldAngles.some((s) => angularGap(s, m.angle) <= SHIELD_ARC / 2);
        if (covered) {
          const hp = m.hp - 1;
          if (hp <= 0) { score += m.size === 2 ? 30 : 10; flash = "block"; continue; }
          // A big one survives the first hit and is thrown back out to the rim,
          // so it has to be dealt with a second time. Cheap drama, reads well.
          meteors.push({ ...m, hp, radius: 1, speed: m.speed * 1.12 });
          score += 5;
          flash = "block";
          continue;
        }
      }

      if (radius <= 0.12) { lives -= 1; flash = "hit"; continue; }
      meteors.push({ ...m, radius });
    }

    // Spawning. Waves get faster and denser, and every fifth wave is announced.
    spawnIn -= 1;
    if (spawnIn <= 0) {
      const size: 1 | 2 = wave >= 3 && ctx.random() < 0.22 ? 2 : 1;
      meteors.push({
        id: nextId,
        angle: Math.floor(ctx.random() * 360),
        radius: 1,
        // Slow enough at wave 1 to cross in about nine seconds, which is time to
        // see it, decide, and turn. The ramp does the work after that.
        speed: 0.0065 + Math.min(wave, 12) * 0.0015 + ctx.random() * 0.003,
        size,
        hp: size,
      });
      nextId += 1;
      spawnIn = Math.max(7, 34 - wave * 1.8);
    }

    const ticks = state.ticks + 1;
    // A wave is just a difficulty step on a clock. No lulls: the pressure only
    // ever goes up, which is what makes a twenty second game worth replaying.
    if (ticks % 170 === 0) { wave += 1; flash = "wave"; }

    if (lives <= 0) return { ...state, phase: "over", meteors: [], lives: 0, score, wave, flash: "hit", ticks };
    return { ...state, meteors, score, lives, wave, nextId, spawnIn, flash, ticks };
  },

  render: (state, players) => {
    const face = {
      title: state.phase === "lobby" ? "Meteor" : `Meteor · wave ${state.wave}`,
      body:
        state.phase === "lobby"
          ? "Meteors are coming for my face. Turn your shield and keep them off me."
          : state.phase === "over"
            ? `They got through. ${state.score} points, wave ${state.wave}.`
            : undefined,
      big: state.phase === "playing" ? String(state.score) : undefined,
      // He is genuinely in this: scared while they fall, hurt when one lands.
      mood: state.phase === "over" ? "sad" : state.flash === "hit" ? "shocked" : state.phase === "playing" ? "surprised" : "happy",
      color: state.flash === "hit" ? "#ff5470" : state.flash === "block" ? "#ffd166" : "#ff7a45",
      scene: null,
      speak:
        state.phase === "lobby" ? "Meteors. Coming for my face. Turn your shield, friend, and keep them off me."
          : state.phase === "over" ? `That is that. ${state.score} points. Eureka is not the word I would use.`
            : undefined,
      // No score strip. This is co-op — there is ONE score and it is already the
      // big number, and the previous version put each player's shield ANGLE in
      // the score column, so the face cheerfully announced "Devin 274".
      scores: undefined,
      // Everything the face needs to draw the round playfield. Polar, because
      // the screen is a circle and pretending otherwise wastes the hardware.
      canvas: {
        kind: "meteor",
        phase: state.phase,
        lives: state.lives,
        flash: state.flash ?? null,
        shieldArc: SHIELD_ARC,
        shieldRadius: SHIELD_RADIUS,
        shields: players.map((p) => ({ name: p.name, angle: state.shields[p.id] ?? 0 })),
        meteors: state.meteors.map((m) => ({ id: m.id, angle: m.angle, radius: m.radius, size: m.size })),
      },
    };

    const phones: Record<string, PhoneView> = {};
    for (const p of players) {
      phones[p.id] = state.phase === "playing"
        ? {
          title: `Wave ${state.wave} · ${state.score}`,
          body: `${"♥".repeat(Math.max(0, state.lives))} — turn your shield.`,
          pad: "dpad",
          yourTurn: true,
        }
        : {
          title: "Meteor",
          body: state.phase === "over"
            ? `${state.score} points, wave ${state.wave}. He will forgive you.`
            : "Everyone gets an arc of shield. Turn it with the pad. Nothing reaches his eyes.",
          choices: [{ action: state.phase === "over" ? "again" : "start", label: state.phase === "over" ? "Again" : "Start" }],
        };
    }
    return { face, phones };
  },
};

/** Smallest angle between two bearings, in degrees. */
function angularGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
