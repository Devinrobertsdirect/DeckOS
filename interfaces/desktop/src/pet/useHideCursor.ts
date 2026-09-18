import { useEffect } from "react";

/**
 * useHideCursor — take the mouse pointer off his face.
 *
 * The Pi boots into a kiosk with a real X cursor sitting wherever the pointer
 * was last left, which on a robot's face is usually somewhere in the middle of
 * one eye. It is the single most out-of-character thing on the screen: a little
 * white arrow parked on a creature that is supposed to be looking at you.
 *
 * Done here rather than with `unclutter` on the Pi on purpose — it needs no
 * package, no root, no system change, no per-robot setup step, and it ships
 * with the face to every Nobi that ever gets built. It also behaves better than
 * unclutter does: the cursor comes straight back the moment the mouse moves,
 * so the machine is still usable when someone plugs a mouse in to fix something.
 *
 * Touch is left alone — a tap should never leave a pointer behind.
 */
export function useHideCursor(idleMs = 2500): void {
  useEffect(() => {
    let timer: number | undefined;
    let hidden = false;

    const show = () => {
      if (hidden) { document.body.style.cursor = ""; hidden = false; }
    };
    const hide = () => {
      if (!hidden) { document.body.style.cursor = "none"; hidden = true; }
    };
    const bump = () => {
      show();
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, idleMs);
    };

    // Start hidden: nobody has touched the mouse since boot, and the pointer is
    // already sitting on his face by the time this runs.
    timer = window.setTimeout(hide, idleMs);

    window.addEventListener("mousemove", bump, { passive: true });
    window.addEventListener("mousedown", bump, { passive: true });
    window.addEventListener("wheel", bump, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousemove", bump);
      window.removeEventListener("mousedown", bump);
      window.removeEventListener("wheel", bump);
      document.body.style.cursor = "";
    };
  }, [idleMs]);
}
