import type { GameDefinition, PhoneView } from "./types.js";
import { readGameData, writeGameData, flush } from "./persist.js";

/**
 * Focus Companion — the app that earns him a place on the desk on a Tuesday.
 *
 * Everything else in this folder is for a room full of people. This is for one
 * person, alone, trying to get an hour of work done. A kitchen timer already
 * exists and costs four pounds, so a robot that only counts down is a worse
 * kitchen timer. What he can do that the timer cannot is SIT THERE AND BE
 * CALM — a creature on the desk, breathing at a rate you can borrow, that goes
 * quiet and dim while you work and only speaks at the boundaries.
 *
 * So the design rule that everything below follows: during a focus block he is
 * UNOBTRUSIVE. Dim, slow, no sudden motion, no numbers unless asked, and above
 * all silent. Interrupting somebody's concentration is the one unforgivable bug
 * in this app, so `speak` is emitted only when sound is on AND the state is
 * sitting on a block boundary — see `transition`, which lives for exactly one
 * frame.
 *
 * Three modes in one app, because they are the same machine:
 *   focus  — a work block (default 25 minutes), counted toward a lifetime tally
 *   break  — a short rest (default 5), counted toward nothing
 *   timer  — a plain "ten minute timer", no ceremony, no tally
 *
 * ---------------------------------------------------------------------------
 * THE CANVAS PAYLOAD  (face.canvas — a renderer will be written against this)
 * ---------------------------------------------------------------------------
 * One envelope for all five animations. The renderer switches on `anim` for the
 * artwork and reads the shared fields for timing, brightness and colour. Every
 * field is present on every frame; nothing is optional except where marked.
 *
 * {
 *   kind: "focus",                       // always
 *   anim: "breathe"|"tide"|"orbit"|"grove"|"candle",
 *   mode: "focus"|"break"|"timer",
 *   phase: "idle"|"running"|"paused"|"done",
 *
 *   // --- time -------------------------------------------------------------
 *   // The server ticks once a second; the face should NOT step once a second.
 *   // `endsAt` and `anchor` are absolute epoch milliseconds, so the renderer
 *   // can run its own 60fps clock off Date.now() and stay perfectly smooth
 *   // between frames, and stay phase-locked across a reconnect. `remainingMs`
 *   // and `progress` are the server's snapshot, correct at frame time, and are
 *   // the ones to trust while paused (when endsAt is null).
 *   anchor: number|null,                 // epoch ms the current block began
 *   endsAt: number|null,                 // epoch ms it ends; null when not running
 *   blockMs: number,                     // full length of the current block
 *   remainingMs: number,                 // 0 .. blockMs
 *   elapsedMs: number,                   // blockMs - remainingMs
 *   progress: number,                    // 0 .. 1 through the block
 *   clock: string,                       // "24:59", preformatted
 *   showClock: boolean,                  // false in deep focus: no numerals
 *
 *   // --- mood -------------------------------------------------------------
 *   brightness: number,                  // 0 .. 1 target for the whole drawing
 *   dimMs: number,                       // ease to that brightness over this long
 *   cycleMs: number,                     // the animation's core rhythm, one loop
 *   palette: { base, accent, glow },     // hex, chosen per mode
 *
 *   // --- sound ------------------------------------------------------------
 *   // null means SILENT: the preference is off, so play nothing at all.
 *   audio: null | {
 *     bed: "air"|"waves"|"drone"|"forest"|"fire"|"none",
 *     volume: number,                    // 0 .. 1, already reduced for focus
 *     cue: "start"|"end"|null,           // a single soft chime, one frame only
 *   },
 *
 *   // --- the tally --------------------------------------------------------
 *   lifetime: number,                    // completed focus blocks, ever
 *   today: number,                       // completed in this sitting
 *
 *   // --- per-animation ----------------------------------------------------
 *   detail: { ... }   // shape depends on `anim`, documented at animDetail()
 * }
 *
 * The five animations and what each is meant to feel like:
 *
 *   breathe — a rhythm to borrow. The whole disc swells and settles on a box
 *             pattern (4 in, 4 hold, 4 out, 4 rest) and his eyes soften nearly
 *             shut on the exhale. Nothing tells the time; you just breathe with
 *             him. Best for the first minutes of a block, or for anxiety.
 *   tide    — a slow sea. A flat waterline creeps up the circle across the
 *             block with a barely-there swell, his eyes floating above it like
 *             two buoys. On a break the tide drains instead of rises. The
 *             passage of time is a level, not a number.
 *   orbit   — one still point and two small bodies. A fast mote sweeps the rim
 *             once a minute, a heavier one once per block, both phase-locked to
 *             `anchor`. Glanceable: where the big one sits IS the clock, and
 *             you never have to read anything.
 *   grove   — something growing. A single thin stem climbs from the bottom of
 *             the circle and puts out one leaf every few minutes; at the end a
 *             bud opens. Almost entirely still — the only motion in the whole
 *             block is a leaf quietly arriving. The least distracting of the
 *             five and the best for deep work.
 *   candle  — something spending itself. A column of wax burns down as the
 *             block does, with a flame that flickers within a few percent and
 *             never jumps. Gutters out at the end, leaves a warm ember through
 *             the break. Gives the block a cost, which some people work better
 *             against.
 */

export type FocusAnim = "breathe" | "tide" | "orbit" | "grove" | "candle";
type Mode = "focus" | "break" | "timer";
type Phase = "idle" | "running" | "paused" | "done";
/**
 * A block boundary, set for exactly ONE frame.
 *
 * This is the only thing in the app permitted to make him speak, and it is
 * cleared at the top of the next tick, the same way Meteor clears `flash`. If
 * it lived any longer he would repeat himself on every poll, and a companion
 * that says "stand up" forty times is worse than one that says nothing.
 */
type Transition =
  | "focus-start" | "break-start" | "timer-start"
  | "focus-done" | "break-done" | "timer-done"
  | null;

/** Which screen the phone is showing. Only ever one at a time, never a dead end. */
type Panel = "home" | "anim" | "times";

/** Everything that must survive a restart, a reboot and next Tuesday. */
interface Prefs {
  anim: FocusAnim;
  focusMin: number;
  breakMin: number;
  timerMin: number;
  sound: boolean;
  /** Completed focus blocks, for the whole life of the robot. */
  lifetime: number;
}

export interface FocusState {
  phase: Phase;
  mode: Mode;
  /** Epoch ms the current block began. Null when idle. */
  anchor: number | null;
  /**
   * Epoch ms the current block ends. THE clock.
   *
   * Deliberately a deadline rather than a counter being decremented once a
   * second: the brain can restart in the middle of a fifty minute block, and
   * the engine saves and reloads game state, so a deadline comes back correct
   * while a counter would come back frozen at whatever it was when the process
   * died. Same reason the back arrow (which stops the ticker entirely) does not
   * cost you any time.
   */
  endsAt: number | null;
  /** Milliseconds left at the moment of the pause. Null unless paused. */
  pausedLeftMs: number | null;
  blockMs: number;
  /**
   * The server's snapshot of time left, refreshed each tick.
   *
   * render() is handed only (state, players) — no clock — so the remaining time
   * has to be carried in the state for the face to be able to show it.
   */
  remainingMs: number;
  prefs: Prefs;
  /** False until the durable preferences have been read back off disk. */
  loaded: boolean;
  /** Focus blocks finished in this sitting, as opposed to ever. */
  today: number;
  panel: Panel;
  transition: Transition;
  notice: string;
}

const ID = "focus";
const MIN = 60_000;

const DEFAULTS: Prefs = {
  anim: "breathe",
  focusMin: 25,
  breakMin: 5,
  timerMin: 10,
  sound: true,
  lifetime: 0,
};

/** Offered on the phone. Anything in 1..180 is accepted, these are just the taps. */
const FOCUS_PRESETS = [15, 25, 45, 50, 90];
const BREAK_PRESETS = [3, 5, 10, 15];
const TIMER_PRESETS = [1, 5, 10, 20, 60];

const ANIMS: Array<{ id: FocusAnim; label: string; detail: string; bed: "air" | "waves" | "drone" | "forest" | "fire" }> = [
  { id: "breathe", label: "Breathe", detail: "I breathe, you copy. Four in, four out.", bed: "air" },
  { id: "tide", label: "Tide", detail: "A sea that rises while you work.", bed: "waves" },
  { id: "orbit", label: "Orbit", detail: "Two small moons. Where they are is the time.", bed: "drone" },
  { id: "grove", label: "Grove", detail: "A stem that puts out a leaf every few minutes.", bed: "forest" },
  { id: "candle", label: "Candle", detail: "A candle burning down to the end of the block.", bed: "fire" },
];

/**
 * A module-level mirror of the durable preferences.
 *
 * tick() is synchronous by contract, so it cannot await the store, and the face
 * should not sit there showing somebody else's default animation until the
 * first button press. So the read is kicked off once, lands in this cache, and
 * the next tick picks it up. act() awaits it properly, because a press can
 * afford a millisecond and must never write stale preferences back over good
 * ones.
 */
let cached: Prefs | null = null;
let loading: Promise<Prefs> | null = null;

function normalise(raw: Partial<Prefs> | null | undefined): Prefs {
  const p = raw ?? {};
  const anim = ANIMS.some((a) => a.id === p.anim) ? (p.anim as FocusAnim) : DEFAULTS.anim;
  return {
    anim,
    focusMin: clampMin(p.focusMin, DEFAULTS.focusMin),
    breakMin: clampMin(p.breakMin, DEFAULTS.breakMin),
    timerMin: clampMin(p.timerMin, DEFAULTS.timerMin),
    // Explicitly a boolean test, not a truthiness one: `false` is a real,
    // deliberate, hard-won setting here and must never be read as "unset" and
    // quietly replaced by the default of on.
    sound: typeof p.sound === "boolean" ? p.sound : DEFAULTS.sound,
    // Likewise a lifetime of 0 is a perfectly good number on day one.
    lifetime: Number.isFinite(p.lifetime) ? Math.max(0, Math.floor(p.lifetime as number)) : 0,
  };
}

function clampMin(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(180, Math.max(1, Math.round(n)));
}

async function loadPrefs(): Promise<Prefs> {
  if (cached) return cached;
  if (!loading) {
    loading = readGameData<Partial<Prefs>>(ID, DEFAULTS)
      .then((raw) => { cached = normalise(raw); return cached; })
      .catch(() => { cached = { ...DEFAULTS }; return cached; });
  }
  return loading;
}

/** Non-blocking peek, for tick(). Null means "not back yet, try next second". */
function peekPrefs(): Prefs | null {
  if (cached) return cached;
  void loadPrefs();
  return null;
}

/**
 * Save, and force it out immediately.
 *
 * The store batches writes by design, which is right for a quiz being typed and
 * wrong here: the reason a lifetime tally is worth having at all is that it is
 * still there after the plug gets pulled, and the moment somebody is most
 * likely to unplug him is right after a block finishes.
 */
function savePrefs(next: Prefs): void {
  cached = next;
  void writeGameData(ID, next).then(() => flush()).catch(() => { /* the app still works, it just forgets */ });
}

export const focus: GameDefinition<FocusState> = {
  id: ID,
  title: "Focus Companion",
  blurb: "Work in quiet blocks with a calm creature on your desk. Timer, focus sessions and ambience in one.",
  icon: "🌙",
  color: "#7a9bff",
  minPlayers: 1,
  /**
   * One person is the point, but a desk is not a locked room. Anyone who picks
   * up a phone gets the same controls rather than a "somebody else is using
   * this" wall, because two people sharing a pomodoro at one table is a real
   * thing and a second phone should help, not block.
   */
  maxPlayers: 6,
  /**
   * Once a second is plenty. The face animates off `anchor` and `endsAt` at its
   * own frame rate; all this tick does is refresh a snapshot and notice when a
   * deadline has passed, so it stays cheap enough to leave running for an hour.
   */
  tickMs: 1000,

  create: () => ({
    phase: "idle",
    mode: "focus",
    anchor: null,
    endsAt: null,
    pausedLeftMs: null,
    blockMs: DEFAULTS.focusMin * MIN,
    remainingMs: DEFAULTS.focusMin * MIN,
    // Start from whatever has already been read back, if anything has; the
    // first tick will fill this in properly either way.
    prefs: cached ? { ...cached } : { ...DEFAULTS },
    loaded: cached !== null,
    today: 0,
    panel: "home",
    transition: null,
    notice: "",
  }),

  // Nothing is stored per person: the roster is ctx.players / the render
  // argument, and this app keeps no per-player table to drift out of step
  // with it.
  join: (state) => state,

  act: async (state, player, action, value, ctx): Promise<FocusState> => {
    // Always work from the real preferences. A phone that presses a button
    // within the first second of the app opening must not write the defaults
    // back over a year of settings.
    const prefs = state.loaded ? state.prefs : await loadPrefs();
    const base: FocusState = state.loaded ? state : { ...state, prefs: { ...prefs }, loaded: true };

    // ── moving between phone screens ────────────────────────────────────────
    if (action === "panel") {
      const panel: Panel = value === "anim" ? "anim" : value === "times" ? "times" : "home";
      return { ...base, panel, notice: "" };
    }

    // ── starting a block ────────────────────────────────────────────────────
    if (action === "start") {
      const mode: Mode = value === "break" ? "break" : value === "timer" ? "timer" : "focus";
      return begin(base, mode, ctx.now);
    }

    // ── pause / resume ──────────────────────────────────────────────────────
    if (action === "pause") {
      if (base.phase !== "running" || base.endsAt === null) return base;
      const left = Math.max(0, base.endsAt - ctx.now);
      return { ...base, phase: "paused", pausedLeftMs: left, remainingMs: left, endsAt: null, notice: "" };
    }

    if (action === "resume") {
      // `!== null` rather than a truthy test on purpose: a session paused with
      // exactly zero seconds on it is a legitimate state, and `if (left)` would
      // refuse to resume it and strand the phone on a Resume button that did
      // nothing.
      if (base.phase !== "paused" || base.pausedLeftMs === null) return base;
      const left = base.pausedLeftMs;
      return { ...base, phase: "running", endsAt: ctx.now + left, pausedLeftMs: null, remainingMs: left, notice: "" };
    }

    // ── stop, back to the start ─────────────────────────────────────────────
    if (action === "stop") {
      return {
        ...base,
        phase: "idle",
        anchor: null,
        endsAt: null,
        pausedLeftMs: null,
        blockMs: base.prefs.focusMin * MIN,
        remainingMs: base.prefs.focusMin * MIN,
        mode: "focus",
        panel: "home",
        transition: null,
        notice: "",
      };
    }

    // ── skip to the other side ──────────────────────────────────────────────
    if (action === "skip") {
      // An abandoned focus block does NOT count toward the lifetime tally. The
      // tally is only worth looking at if every number in it was actually sat
      // through, otherwise it is just a count of button presses.
      if (base.mode === "break") return begin(base, "focus", ctx.now);
      if (base.mode === "timer") return begin(base, "timer", ctx.now);
      return begin(base, "break", ctx.now);
    }

    // ── preferences ─────────────────────────────────────────────────────────
    if (action === "anim") {
      const pick = ANIMS.find((a) => a.id === value);
      if (!pick) return base;
      const next = { ...base.prefs, anim: pick.id };
      savePrefs(next);
      return { ...base, prefs: next, panel: "home", notice: `${pick.label}.` };
    }

    if (action === "sound") {
      // The button sends "on"/"off" explicitly rather than its own label,
      // because the label reads "Sound off" when sound is currently ON and a
      // value defaulting to the label would toggle exactly backwards.
      const on = value === "on" ? true : value === "off" ? false : !base.prefs.sound;
      const next = { ...base.prefs, sound: on };
      savePrefs(next);
      return { ...base, prefs: next, notice: on ? "Sound on." : "Silent." };
    }

    if (action === "focus-min" || action === "break-min" || action === "timer-min") {
      const mins = clampMin(value, action === "focus-min" ? base.prefs.focusMin : action === "break-min" ? base.prefs.breakMin : base.prefs.timerMin);
      const next: Prefs = action === "focus-min"
        ? { ...base.prefs, focusMin: mins }
        : action === "break-min"
          ? { ...base.prefs, breakMin: mins }
          : { ...base.prefs, timerMin: mins };
      savePrefs(next);
      // Changing a length while idle should move the number on his face too,
      // otherwise you set forty five minutes and he keeps promising twenty five.
      const idleMs = next.focusMin * MIN;
      const restIdle = base.phase === "idle"
        ? { blockMs: idleMs, remainingMs: idleMs }
        : {};
      return { ...base, prefs: next, ...restIdle, notice: `${mins} minutes.` };
    }

    // Unknown or stale action: leave the state exactly as it was. Phones poll,
    // so a press from a screen that has already moved on is normal, not an error.
    void player;
    return base;
  },

  tick: (state, ctx): FocusState => {
    let s = state;

    // Preferences may have landed since the last second.
    if (!s.loaded) {
      const p = peekPrefs();
      if (p) {
        const idleMs = p.focusMin * MIN;
        s = s.phase === "idle"
          ? { ...s, prefs: { ...p }, loaded: true, blockMs: idleMs, remainingMs: idleMs }
          : { ...s, prefs: { ...p }, loaded: true };
      }
    }

    // A transition lives for one frame and no longer. Cleared FIRST, so that a
    // boundary crossed further down this same tick still gets its one frame.
    if (s.transition !== null) s = { ...s, transition: null };

    if (s.phase !== "running" || s.endsAt === null) return s;

    const left = s.endsAt - ctx.now;
    if (left > 0) {
      // Cheap: one subtraction and a copy. No list walking, no allocation per
      // element, nothing that grows with uptime.
      return s.remainingMs === left ? s : { ...s, remainingMs: left };
    }

    // The block is over.
    const finished = s.mode;
    const counts = finished === "focus";
    const prefs = counts ? { ...s.prefs, lifetime: s.prefs.lifetime + 1 } : s.prefs;
    if (counts) savePrefs(prefs);
    return {
      ...s,
      phase: "done",
      endsAt: null,
      pausedLeftMs: null,
      remainingMs: 0,
      prefs,
      today: counts ? s.today + 1 : s.today,
      panel: "home",
      transition: finished === "focus" ? "focus-done" : finished === "break" ? "break-done" : "timer-done",
    };
  },

  render: (state, players) => {
    const { prefs, phase, mode } = state;
    const blockMs = Math.max(1, state.blockMs);
    const remainingMs = Math.max(0, Math.min(blockMs, state.remainingMs));
    const elapsedMs = blockMs - remainingMs;
    const progress = phase === "idle" ? 0 : elapsedMs / blockMs;
    const deep = phase === "running" && mode === "focus";
    const anim = ANIMS.find((a) => a.id === prefs.anim) ?? ANIMS[0];

    // The one place he is allowed to speak. Sound off, or anywhere that is not
    // a block boundary, and this stays undefined — which is the whole promise
    // of the app.
    const speak = prefs.sound && state.transition !== null ? lineFor(state) : undefined;

    const palette = mode === "break"
      ? { base: "#123033", accent: "#57d6c4", glow: "#9ff5e6" }
      : mode === "timer"
        ? { base: "#1b1a2b", accent: "#c9a0ff", glow: "#e7d4ff" }
        : { base: "#101527", accent: "#7a9bff", glow: "#cfe0ff" };

    const face = {
      title: phase === "idle" ? "Focus" : headline(state),
      body: phase === "idle"
        ? `${prefs.focusMin} minutes of work, ${prefs.breakMin} of rest. ${anim.label}.`
        : phase === "done"
          ? doneBody(state)
          : phase === "paused"
            ? "Paused. I will wait."
            // Nothing chatty during a block: the face is the animation, and a
            // sentence sitting under it is one more thing pulling the eye.
            : undefined,
      // In deep focus there is deliberately no big number. A countdown in your
      // peripheral vision is the single most distracting thing a focus app can
      // put on a desk, so the time is on the phone and in the shape of the
      // drawing, not shouted across the room.
      big: deep ? undefined : phase === "idle" ? undefined : formatClock(remainingMs),
      mood: phase === "done"
        ? (mode === "focus" ? "proud" : "happy")
        : phase === "paused"
          ? "neutral"
          : deep
            ? "calm"
            : mode === "break"
              ? "happy"
              : "neutral",
      color: palette.accent,
      scene: null,
      speak,
      // No score strip. There is one person and one number, and it is a
      // lifetime tally rather than a competition.
      scores: undefined,
      canvas: {
        kind: "focus",
        anim: anim.id,
        mode,
        phase,
        anchor: state.anchor,
        endsAt: state.endsAt,
        blockMs,
        remainingMs,
        elapsedMs,
        progress,
        clock: formatClock(remainingMs),
        showClock: !deep,
        // Deep focus is genuinely dim. Bright enough to see he is alive from
        // the corner of your eye, dark enough that he is not competing with
        // the screen you are actually working on.
        brightness: phase === "idle" ? 0.85 : phase === "done" ? 0.9 : phase === "paused" ? 0.5 : deep ? 0.22 : 0.6,
        // Slow fades only. A brightness step that lands in a quarter of a
        // second reads as a flash and takes your eye every time.
        dimMs: deep ? 6000 : 1200,
        cycleMs: cycleFor(anim.id, blockMs),
        palette,
        audio: prefs.sound
          ? {
            bed: phase === "running" ? anim.bed : "none",
            // A bed you can hear over is a bed you notice. Focus sits lower
            // than a break on purpose.
            volume: phase !== "running" ? 0 : deep ? 0.22 : 0.34,
            cue: state.transition === null
              ? null
              : state.transition.endsWith("-start") ? "start" : "end",
          }
          : null,
        lifetime: prefs.lifetime,
        today: state.today,
        detail: animDetail(anim.id, mode, phase, progress, blockMs),
      },
    };

    // Every player, every phase, gets a way forward. The controls are the same
    // for everybody: this is one person's session that a second phone may
    // happen to be looking at, not a turn order.
    const view = phoneView(state, anim.label);
    const phones: Record<string, PhoneView> = {};
    for (const p of players) phones[p.id] = view;
    return { face, phones };
  },
};

/** Start a block of the given mode, from now. */
function begin(state: FocusState, mode: Mode, now: number): FocusState {
  const mins = mode === "focus" ? state.prefs.focusMin : mode === "break" ? state.prefs.breakMin : state.prefs.timerMin;
  const blockMs = Math.max(1, mins) * MIN;
  return {
    ...state,
    phase: "running",
    mode,
    anchor: now,
    endsAt: now + blockMs,
    pausedLeftMs: null,
    blockMs,
    remainingMs: blockMs,
    panel: "home",
    transition: mode === "focus" ? "focus-start" : mode === "break" ? "break-start" : "timer-start",
    notice: "",
  };
}

/**
 * What he says at a boundary, and only at a boundary.
 *
 * Short, flat, and finished in under three seconds. A companion that delivers a
 * paragraph when your block ends has undone the block.
 */
function lineFor(state: FocusState): string | undefined {
  const mins = Math.max(1, Math.round(state.blockMs / MIN));
  switch (state.transition) {
    case "focus-start": return `${mins} minutes. I will be quiet now.`;
    case "break-start": return `${mins} minutes. Look at something far away.`;
    case "timer-start": return `${mins} minutes on the clock.`;
    case "focus-done": return `That is ${mins} minutes. Stand up.`;
    case "break-done": return "Break is over. Back to it.";
    case "timer-done": return "Time.";
    default: return undefined;
  }
}

function headline(state: FocusState): string {
  if (state.mode === "break") return "Break";
  if (state.mode === "timer") return "Timer";
  return "Focus";
}

function doneBody(state: FocusState): string {
  if (state.mode === "break") return "That is the break. Ready when you are.";
  if (state.mode === "timer") return "Time is up.";
  const n = state.prefs.lifetime;
  // `n` can legitimately be 0 on the very first run, so this branches on the
  // number rather than on its truthiness.
  return n === 1 ? "One session done. The first one." : `Done. That is ${n} sessions all told.`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The core loop length of each animation, in ms. */
function cycleFor(anim: FocusAnim, blockMs: number): number {
  switch (anim) {
    case "breathe": return 16_000;        // 4-4-4-4 box breathing
    case "tide": return 11_000;           // one slow swell
    case "orbit": return 60_000;          // the fast mote goes round once a minute
    case "grove": return blockMs;         // the growth IS the block
    case "candle": return 2_400;          // the flicker, nothing more
  }
}

/**
 * The per-animation half of the payload.
 *
 * detail, by `anim`:
 *   breathe { pattern: [inMs, holdMs, outMs, restMs], stage, stageProgress,
 *             scaleMin, scaleMax, lidMin, lidMax }
 *       stage is one of "in"|"hold"|"out"|"rest" — a snapshot hint only; the
 *       renderer should recompute it from anchor + pattern for smoothness.
 *       scale* is how far the disc swells; lid* is how far the eyelids close on
 *       the exhale (0 open, 1 shut).
 *   tide   { level, direction: "rise"|"fall", swellAmp, swellMs, eyeLine }
 *       level 0..1 is the waterline as a fraction of the circle's height.
 *       eyeLine is the height his eyes sit at, so the renderer can float them
 *       and know when the water is about to reach them.
 *   orbit  { bodies: [{ id, radius, periodMs, phase, size }] }
 *       radius 0..1 from centre to rim, phase 0..1 of the way round at
 *       `anchor`, periodMs one full revolution, size in face pixels.
 *   grove  { leaves, totalLeaves, stem, budOpen, sway }
 *       leaves of totalLeaves are out; stem 0..1 is its height; sway is the
 *       maximum drift in degrees, deliberately tiny.
 *   candle { wax, flame, jitter, ember }
 *       wax 0..1 is the column remaining, flame 0..1 its strength (0 once the
 *       block ends), jitter the fraction the flame may vary by, ember true
 *       while a finished candle still glows.
 */
function animDetail(anim: FocusAnim, mode: Mode, phase: Phase, progress: number, blockMs: number): Record<string, unknown> {
  const running = phase === "running";
  switch (anim) {
    case "breathe": {
      const pattern = [4000, 4000, 4000, 4000];
      const cycle = 16_000;
      const at = ((blockMs * progress) % cycle + cycle) % cycle;
      const stage = at < 4000 ? "in" : at < 8000 ? "hold" : at < 12_000 ? "out" : "rest";
      const within = (at % 4000) / 4000;
      return {
        pattern,
        stage,
        stageProgress: within,
        scaleMin: 0.86,
        scaleMax: 1.0,
        lidMin: 0.1,
        lidMax: 0.78,
      };
    }
    case "tide": {
      // A break DRAINS. It is the same picture running the other way, and it
      // reads instantly as "this is the other kind of time".
      const direction = mode === "break" ? "fall" : "rise";
      const level = direction === "fall" ? 1 - progress : progress;
      return { level, direction, swellAmp: 0.018, swellMs: 11_000, eyeLine: 0.58 };
    }
    case "orbit": {
      return {
        bodies: [
          { id: "minute", radius: 0.88, periodMs: 60_000, phase: 0, size: 6 },
          { id: "block", radius: 0.66, periodMs: Math.max(60_000, blockMs), phase: 0, size: 13 },
        ],
      };
    }
    case "grove": {
      // One leaf every few minutes: often enough to notice once, rare enough
      // never to be motion you have to ignore.
      const total = Math.max(3, Math.min(12, Math.round(blockMs / MIN / 2.5)));
      return {
        leaves: Math.min(total, Math.floor(progress * total)),
        totalLeaves: total,
        stem: Math.min(1, 0.12 + progress * 0.88),
        budOpen: phase === "done",
        sway: 1.5,
      };
    }
    case "candle": {
      return {
        wax: Math.max(0, 1 - progress),
        flame: running ? 1 : phase === "paused" ? 0.45 : 0,
        jitter: 0.05,
        ember: phase === "done" || phase === "paused",
      };
    }
  }
}

/** One phone screen, shared by everyone holding one. */
function phoneView(state: FocusState, animLabel: string): PhoneView {
  const { prefs, phase, mode, panel } = state;
  const soundBtn = {
    action: "sound",
    label: prefs.sound ? "Sound off" : "Sound on",
    // Explicit, because the label is the OPPOSITE of the current setting.
    value: prefs.sound ? "off" : "on",
    detail: prefs.sound ? "He speaks at the boundaries and plays ambience." : "Silent. Nothing but the picture.",
  };

  if (panel === "anim") {
    return {
      title: "Pick an animation",
      body: `Now: ${animLabel}.`,
      choices: [
        ...ANIMS.map((a) => ({
          action: "anim",
          label: a.label,
          // The action compares against the id, which is not the words on the
          // button, so the value has to be set.
          value: a.id,
          detail: a.detail,
          disabled: a.id === prefs.anim,
        })),
        { action: "panel", label: "Back", value: "home" },
      ],
    };
  }

  if (panel === "times") {
    return {
      title: "Lengths",
      body: `Focus ${prefs.focusMin} · break ${prefs.breakMin} · timer ${prefs.timerMin}.`,
      choices: [
        ...FOCUS_PRESETS.map((m) => ({ action: "focus-min", label: `Focus ${m}`, value: String(m), disabled: m === prefs.focusMin })),
        ...BREAK_PRESETS.map((m) => ({ action: "break-min", label: `Break ${m}`, value: String(m), disabled: m === prefs.breakMin })),
        ...TIMER_PRESETS.map((m) => ({ action: "timer-min", label: `Timer ${m}`, value: String(m), disabled: m === prefs.timerMin })),
        { action: "panel", label: "Back", value: "home" },
      ],
    };
  }

  const tally = prefs.lifetime === 0
    ? "No sessions yet."
    : `${prefs.lifetime} session${prefs.lifetime === 1 ? "" : "s"} all told${state.today > 0 ? `, ${state.today} today` : ""}.`;

  if (phase === "running" || phase === "paused") {
    const running = phase === "running";
    return {
      title: `${headline(state)} · ${formatClock(state.remainingMs)}`,
      body: running ? "He is quiet until the end." : "Paused. Nothing is being lost.",
      choices: [
        running
          ? { action: "pause", label: "Pause" }
          : { action: "resume", label: "Resume" },
        mode === "focus"
          ? { action: "skip", label: "Skip to break" }
          : mode === "break"
            ? { action: "skip", label: "Back to focus" }
            : { action: "skip", label: "Restart timer" },
        { action: "stop", label: "Stop" },
        { action: "panel", label: "Animation", value: "anim", detail: animLabel },
        soundBtn,
      ],
      yourTurn: true,
    };
  }

  if (phase === "done") {
    return {
      title: mode === "focus" ? "Session done" : mode === "break" ? "Break over" : "Time",
      body: tally,
      choices: [
        // The obvious next thing first, then everything else, so there is never
        // a card whose only button is the one you did not want.
        ...(mode === "focus" ? [{ action: "start", label: `Break ${prefs.breakMin}`, value: "break" }] : []),
        { action: "start", label: `Focus ${prefs.focusMin}`, value: "focus" },
        { action: "start", label: `Timer ${prefs.timerMin}`, value: "timer" },
        { action: "panel", label: "Lengths", value: "times" },
        { action: "stop", label: "Done" },
      ],
      yourTurn: true,
    };
  }

  // Idle.
  return {
    title: "Focus Companion",
    // The notice is the acknowledgement of the last setting change. Without it
    // a tap on "Focus 45" changes a number nobody can see and reads as a dead
    // button.
    body: state.notice ? `${state.notice} ${tally}` : tally,
    choices: [
      { action: "start", label: `Focus ${prefs.focusMin}`, value: "focus", detail: "A work block. This one counts." },
      { action: "start", label: `Break ${prefs.breakMin}`, value: "break" },
      { action: "start", label: `Timer ${prefs.timerMin}`, value: "timer", detail: "Just a timer. No ceremony." },
      { action: "panel", label: "Animation", value: "anim", detail: animLabel },
      { action: "panel", label: "Lengths", value: "times" },
      soundBtn,
    ],
    yourTurn: true,
  };
}
