/**
 * motion.ts — one motion language for the whole face.
 *
 * Every surface was inventing its own durations and curves, so a card sliding
 * in and an overlay fading out felt like they came from different products.
 * These are the only numbers anything should reach for. They are deliberately
 * few: a handful of durations, one easing per intent, and the two pauses that
 * make speech feel human (a breath after a sentence, a beat before a reply).
 *
 * Nothing here is clever. The value is that it is SHARED.
 */

/** Durations, in milliseconds. */
export const MOTION = {
  /** A state flicker: a blink, a colour change, a tap response. */
  instant: 120,
  /** The default: something appears, moves or leaves. */
  quick: 260,
  /** A considered move — a card arriving, a scene changing. */
  settle: 420,
  /** Something travelling a long way across the screen. */
  travel: 900,
  /** A held beat, so the eye can land before the next thing happens. */
  breath: 600,
  /** The pause after he finishes a sentence before the scene moves on. */
  afterSpeech: 420,
  /** The longest dead air a beat may hold once its line has been spoken. */
  maxDeadAir: 1200,
} as const;

/**
 * Easings, named by intent rather than by curve, so call sites read as
 * choreography. `enter` overshoots very slightly — that tiny bit of
 * anticipation is most of what separates "animated" from "alive".
 */
export const EASE = {
  enter: "cubic-bezier(.22,.9,.3,1.06)",
  exit: "cubic-bezier(.4,0,.9,.4)",
  move: "cubic-bezier(.4,0,.2,1)",
  breathe: "cubic-bezier(.45,0,.55,1)",
} as const;

/** A CSS transition string in the shared language: `trans("opacity", "quick")`. */
export function trans(props: string, dur: keyof typeof MOTION = "quick", ease: keyof typeof EASE = "move"): string {
  return props.split(",").map((p) => `${p.trim()} ${MOTION[dur]}ms ${EASE[ease]}`).join(", ");
}
