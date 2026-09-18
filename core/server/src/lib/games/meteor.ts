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
/**
 * Turn rate per button press, in degrees.
 *
 * A phone d-pad held down repeats at roughly ten presses a second, so this is
 * really a rate: ten degrees a press is a hundred degrees a second, which walks
 * the whole rim in about three and a half seconds and still lets a single tap
 * nudge the arc by less than half its own width. The old sixteen swept a
 * hundred and sixty degrees a second — hold the pad for a quarter of a second
 * and you had already gone past the thing you were aiming at, which reads as
 * the game ignoring you rather than as you overshooting.
 */
const TURN_STEP = 10;
/**
 * A hard ceiling on how many meteors may be alive at once.
 *
 * Nothing in the ramp should ever reach this — at the fastest wave the spawn
 * gap and the flight time settle at about five on screen — but tick() is the
 * one function here that runs fourteen times a second forever, and an arcade
 * game that quietly grows its own workload is how a robot at a stand ends up
 * unresponsive an hour in. Cheap insurance against a future tuning mistake.
 */
const MAX_METEORS = 24;
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
    // each other, so a second player is instantly useful without moving. The
    // spread comes off the SEAT, not off how many shields happen to be in the
    // record: a shield left behind by an earlier roster used to shift everyone
    // after it, so the third person to pick up a phone could be handed the same
    // stretch of rim as the second and neither of them would know why they were
    // both failing to cover the other side.
    ? { ...state, shields: { ...state.shields, [player.id]: seatAngle(player) } }
    : state),

  act: (state, player, action, value): MeteorState => {
    if (action === "start" || action === "again") {
      // Only ever from the lobby or the game-over card. Phones poll, so a phone
      // that was a beat behind could still be showing the Start button while
      // the round is already running, and one stale tap would wipe everybody
      // else's score mid-game with no way to tell what had happened.
      if (state.phase === "playing") return state;
      return {
        ...state,
        phase: "playing", wave: 1, score: 0, lives: START_LIVES,
        meteors: [], nextId: 1, spawnIn: 6, flash: undefined, ticks: 0,
      };
    }
    if (state.phase !== "playing") return state;

    // Falling back to the seat rather than to zero: if a player somehow has no
    // shield yet, their first press should move the arc they are about to be
    // drawn holding, not teleport it to the top of the circle.
    const at = state.shields[player.id] ?? seatAngle(player);
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

    // Only shields belonging to somebody still at the table may block anything.
    // The record is keyed by player id and nothing ever took an entry out of it,
    // so a phone that dropped off left an arc behind that the face no longer
    // draws — render() maps over the live roster — but that tick() still counted.
    // The result was meteors visibly bouncing off empty rim, which looks like
    // the game cheating rather than like a bug. An empty roster is left alone:
    // there is nobody to defend, and wiping the record on a spurious empty
    // frame would throw away angles the players had already set.
    const liveIds = ctx.players.length ? new Set(ctx.players.map((p) => p.id)) : null;
    const shieldEntries = Object.entries(state.shields)
      .filter(([id]) => !liveIds || liveIds.has(id));
    const shieldAngles = shieldEntries.map(([, angle]) => angle);
    // And drop the dead keys for good, so the record cannot creep upwards over
    // a long uptime. Only rebuilt when something actually went stale.
    const shields = shieldEntries.length === Object.keys(state.shields).length
      ? state.shields
      : Object.fromEntries(shieldEntries);

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

    // Spawning. Waves get faster and denser.
    spawnIn -= 1;
    if (spawnIn <= 0 && meteors.length >= MAX_METEORS) {
      // At the ceiling. Hold the counter at one rather than letting it run off
      // downwards for as long as the sky is full, because a counter sitting at
      // minus four hundred would then fire a meteor on every single tick the
      // moment one was cleared.
      spawnIn = 1;
    } else if (spawnIn <= 0) {
      const size: 1 | 2 = wave >= 3 && ctx.random() < 0.22 ? 2 : 1;
      meteors.push({
        id: nextId,
        angle: Math.floor(ctx.random() * 360),
        radius: 1,
        // Slow enough at wave 1 to cross in about seven seconds, which is time
        // to see it, decide, and turn. The ramp does the work after that.
        speed: 0.0065 + Math.min(wave, 12) * 0.0015 + ctx.random() * 0.003,
        size,
        hp: size,
      });
      nextId += 1;
      // The gap between meteors is what actually sets how long a round lasts
      // with nobody defending, and that number matters more than it sounds:
      // the first person to hold this phone is a stranger at a stand who has
      // not worked out which button turns which way yet. At 34 - wave * 1.8 the
      // five lives were gone in about sixteen seconds, and a good part of that
      // was spent discovering that the game had already started. Widened so an
      // undefended round runs a little over twenty seconds, which is long
      // enough to lose two lives learning the controls and still play. The ramp
      // is steeper to pay for the wider start, so the pressure at the top end
      // arrives at the same point in the round it always did.
      spawnIn = Math.max(8, 54 - wave * 3);
    }

    const ticks = state.ticks + 1;
    // A wave is just a difficulty step on a clock. No lulls: the pressure only
    // ever goes up, which is what makes a twenty second game worth replaying.
    // A hit and a wave step can land on the same tick, and only one flash fits
    // on a face. The hit wins: one of them costs a life and the other is
    // bookkeeping, and a red rim is the only warning the room gets.
    if (ticks % 170 === 0) { wave += 1; flash = flash ?? "wave"; }

    // Several meteors can land on the same tick, so lives can step past zero on
    // the way down; the room must never be shown a negative heart count and the
    // phones must never be asked to repeat "♥" a negative number of times.
    if (lives <= 0) return { ...state, shields, phase: "over", meteors: [], lives: 0, score, wave, flash: "hit", ticks };
    return { ...state, shields, meteors, score, lives, wave, nextId, spawnIn, flash, ticks };
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
        lives: Math.max(0, state.lives),
        flash: state.flash ?? null,
        shieldArc: SHIELD_ARC,
        shieldRadius: SHIELD_RADIUS,
        // Drawn from the live roster, which is also what tick() blocks with, so
        // every arc on the rim is one that can actually stop something. The seat
        // fallback matches act(): a player mid-join is drawn where their first
        // press will move from, not parked at twelve o'clock on top of seat one.
        shields: players.map((p) => ({ name: p.name, angle: state.shields[p.id] ?? seatAngle(p) })),
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

/**
 * Where a player's shield starts, from their seat.
 *
 * Four seats, four quarters of the rim. Seats are handed out in join order and
 * never reused within a session, so the same phone always comes back to the
 * same quarter — which matters more than it looks, because the first thing a
 * returning player does is look for their own colour on the circle.
 */
function seatAngle(player: Player): number {
  const seat = Number.isFinite(player.seat) ? Math.max(0, Math.floor(player.seat)) : 0;
  return (seat * 90) % 360;
}

/** Smallest angle between two bearings, in degrees. */
function angularGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
