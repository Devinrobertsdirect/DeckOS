import { useEffect, useRef, useState } from "react";

/**
 * FaceCaption — the on-screen subtitle for whatever Nobi is saying right now.
 *
 * It presents PetShell's EXISTING `caption` reply text (no second network/TTS
 * path — same state the history panel records) legibly ON the face screen: a
 * soft primary-tinted HUD strip with a blurred backdrop so the words stay
 * readable over the animated face, width-capped and clamped to a few lines so
 * it always sits inside the 480×480 round bezel (never under it). This is what
 * makes the robot usable with a Bluetooth speaker — you can READ the reply, not
 * just hear it.
 *
 * Lifecycle: while a turn is in flight (`busy` — thinking/talking) the caption
 * holds at full opacity; a few seconds after Nobi goes quiet it fades away and
 * the container collapses back to the resting hint (the words live on in the
 * history panel). An empty caption simply shows the muted prompt hint.
 */

/** How long a finished reply lingers before it fades back to the hint. */
const LINGER_MS = 6000;

export function FaceCaption({
  text,
  hint,
  busy,
}: {
  /** The live reply / message text (PetShell's `caption`). Empty = resting. */
  text: string;
  /** Muted fallback shown when nothing is being said. */
  hint: string;
  /** A turn is in flight (thinking/talking) — hold the caption fully visible. */
  busy: boolean;
}) {
  // Once a reply settles (turn done, no longer busy) start a linger timer; when
  // it fires we fade the caption out. New text or a fresh turn resets it.
  const [faded, setFaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setFaded(false);
    if (!text || busy) return; // nothing to fade, or still speaking — hold it up
    timer.current = setTimeout(() => setFaded(true), LINGER_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [text, busy]);

  const showCaption = !!text && !faded;

  return (
    <div className="relative flex min-h-[3.25rem] w-full items-center justify-center">
      {/* resting hint — cross-fades in whenever nothing is actively captioned */}
      <span aria-hidden={showCaption}
        className={"pointer-events-none absolute inset-0 flex items-center justify-center text-center text-base font-normal text-muted-foreground transition-opacity duration-500 sm:text-lg " +
          (showCaption ? "opacity-0" : "opacity-100")}>
        {hint}
      </span>

      {/* the live caption — readable weight inside a subtle HUD frame; clamps to
          four lines and caps its width so it stays inside the round bezel. */}
      <p aria-live="polite"
        className={"relative max-w-[17rem] overflow-hidden rounded-2xl border border-primary/20 bg-background/60 px-4 py-2 text-center text-xl font-medium leading-snug text-foreground line-clamp-4 shadow-[0_0_24px_rgba(var(--primary-rgb),0.10)] backdrop-blur-sm transition-[max-height,opacity] duration-500 sm:max-w-md sm:text-2xl " +
          (showCaption ? "max-h-40 opacity-100" : "max-h-0 opacity-0")}>
        {text}
      </p>
    </div>
  );
}
