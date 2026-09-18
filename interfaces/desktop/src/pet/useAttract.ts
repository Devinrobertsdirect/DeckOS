import { useEffect, useRef, useState } from "react";

/**
 * useAttract — the booth loop.
 *
 * A robot on a table is invisible until it moves. Left alone he used to sit
 * perfectly still, which reads as "switched off" from two metres away, so
 * nobody comes over and the best demo in the world never runs.
 *
 * After a stretch of quiet he starts doing small, unhurried things: looking
 * around the room, the occasional pleased expression, and now and then one
 * short spoken invitation. Everything here is gentle on purpose — a robot that
 * shouts at passers-by every ten seconds is worse than a still one, and every
 * spoken line costs voice credits, so the invitations are rare and come from a
 * fixed set (which means they are already in the on-device voice cache and are
 * free after the first run).
 *
 * Any sign of a person — a word heard, a touch, a show starting — ends it at
 * once and resets the clock.
 */

/** Quiet time before he starts trying to catch an eye. */
const IDLE_BEFORE_MS = 60_000;
/** How often he does something small and visual. */
const GESTURE_EVERY_MS = 14_000;
/** How often he actually says something. Rare on purpose. */
const INVITE_EVERY_MS = 150_000;

export interface AttractHooks {
  /** Look somewhere (-1..1 of the face radius). */
  glanceAt: (x: number, y: number, ms?: number) => void;
  /** Flash a mood, as the shows do. */
  mood: (name: string, color?: string) => void;
  /** Say one short line. Should be a fixed line, so it comes from the cache. */
  say: (text: string) => void;
  /** True when anything else is happening — a turn, a show, an overlay. */
  busy: boolean;
  /** Bumped whenever a person does anything at all. */
  lastInteractionAt: number;
  /** Off switch (settings / demo day). */
  enabled?: boolean;
}

const INVITES = [
  "Hello. I am Nobi. Say hello back.",
  "Hi. Ask me anything.",
  "I am Nobi. Try saying, hey Nobi.",
  "Say hey Nobi, and I will wake up properly.",
];

const GESTURES: Array<{ x: number; y: number; mood?: string }> = [
  { x: -0.8, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.3, y: -0.5, mood: "curious" },
  { x: -0.4, y: -0.4 }, { x: 0, y: 0.5, mood: "happy" }, { x: 0.6, y: -0.2 },
  { x: -0.6, y: -0.15, mood: "proud" },
];

export function useAttract({ glanceAt, mood, say, busy, lastInteractionAt, enabled = true }: AttractHooks) {
  const [attracting, setAttracting] = useState(false);
  const gestureAt = useRef(0);
  const inviteAt = useRef(0);
  const step = useRef(0);
  // Keep the callbacks fresh without restarting the timer every render.
  const cbs = useRef({ glanceAt, mood, say });
  cbs.current = { glanceAt, mood, say };

  useEffect(() => {
    if (!enabled) { setAttracting(false); return; }
    const id = window.setInterval(() => {
      const idleFor = Date.now() - lastInteractionAt;
      if (busy || idleFor < IDLE_BEFORE_MS) {
        setAttracting(false);
        // Reset the cadence so the first gesture after a conversation is not instant.
        gestureAt.current = Date.now();
        inviteAt.current = Date.now();
        return;
      }
      setAttracting(true);
      const now = Date.now();
      if (now - gestureAt.current >= GESTURE_EVERY_MS) {
        gestureAt.current = now;
        const g = GESTURES[step.current++ % GESTURES.length]!;
        cbs.current.glanceAt(g.x, g.y, 2600);
        if (g.mood) cbs.current.mood(g.mood);
      }
      if (now - inviteAt.current >= INVITE_EVERY_MS) {
        inviteAt.current = now;
        cbs.current.say(INVITES[Math.floor(Math.random() * INVITES.length)]!);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [busy, lastInteractionAt, enabled]);

  return attracting;
}

/** The fixed invitations, so they can be pre-rendered into the voice cache. */
export const ATTRACT_LINES = INVITES;
