import { useCallback, useEffect, useRef } from "react";

/**
 * Wake-from-sleep input — while the face is dormant, the whole surface is a
 * wake switch.
 *
 * The robot must be wakeable hands-free or keyboard-only, so wake can come
 * from any of:
 *   1. ANY key (except while typing in an input/textarea) — eyes open.
 *      Enter/Space go further: wake AND drop straight into listen/talk mode.
 *   2. A pointer tap/click anywhere — eyes open.
 *   3. Detected speech — the caller pipes its EXISTING voice pipeline into
 *      `notifySpeech()` (Web Speech today, the robot's Whisper+VAD stack
 *      tomorrow). This hook deliberately owns no audio of its own, so wake
 *      stays provider-agnostic.
 *
 * Listeners attach only while `asleep` and detach on wake/unmount — zero cost
 * while the face is awake.
 */

export interface WakeOptions {
  /** True while the face is sleeping/dormant — listeners attach only then. */
  asleep: boolean;
  /** Open the eyes (leave sleep, nothing more). */
  onWake: () => void;
  /** Open the eyes AND engage the listen/talk flow (Enter/Space, speech). */
  onWakeAndListen: () => void;
}

/** Typing surfaces where a keystroke means text entry, not "wake up". */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Controls that already own Enter/Space activation — don't hijack them. */
function isInteractive(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.closest("button, a, [role='button']") !== null;
}

export function useWake({ asleep, onWake, onWakeAndListen }: WakeOptions) {
  // Keep the latest values without re-attaching listeners every render.
  const asleepRef = useRef(asleep);
  const onWakeRef = useRef(onWake);
  const onWakeAndListenRef = useRef(onWakeAndListen);
  asleepRef.current = asleep;
  onWakeRef.current = onWake;
  onWakeAndListenRef.current = onWakeAndListen;

  useEffect(() => {
    if (!asleep) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!asleepRef.current || e.repeat) return;
      if (isEditable(e.target)) return;
      if ((e.key === "Enter" || e.key === " ") && !isInteractive(e.target)) {
        // Space would scroll the kiosk page; both would re-fire on whatever
        // happens to hold focus — swallow the default while we're the target.
        e.preventDefault();
        onWakeAndListenRef.current();
        return;
      }
      onWakeRef.current();
    };

    // pointerdown (not click) so a touch wakes the face the instant it lands.
    const onPointerDown = () => {
      if (asleepRef.current) onWakeRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [asleep]);

  // Voice wake: the caller reports speech activity from whatever listening
  // pipeline it already runs; while asleep that counts as "wake and talk".
  // Stable identity — safe to hand to effects or event handlers.
  const notifySpeech = useCallback(() => {
    if (asleepRef.current) onWakeAndListenRef.current();
  }, []);

  return { notifySpeech };
}
