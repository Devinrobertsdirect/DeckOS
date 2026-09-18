import { useEffect, useMemo, useRef, useState } from "react";

/**
 * FaceCaption — the on-screen subtitle for whatever Nobi is saying right now.
 *
 * It runs ACROSS the screen, never down it. The old version wrapped to four
 * lines and grew downward, which on the 480px round bezel pushed the last line
 * off the glass exactly when the sentence mattered most. This one is a single
 * line that reveals word by word as he speaks and slides left to keep the
 * newest word in view, like a teleprompter: the height never changes, so it
 * cannot run off the bottom, and the words arrive in time with the voice.
 *
 * Reveal timing: driven by `progress` (0..1 of the audio actually playing) when
 * the caller has it, so the words land on the syllables. With no progress it
 * falls back to a steady reading pace, which is still far better than dumping
 * the whole sentence at once.
 *
 * Lifecycle: while a turn is in flight (`busy`) the caption holds; a few
 * seconds after he goes quiet it fades back to the resting hint.
 */

/** How long a finished reply lingers before it fades back to the hint. */
const LINGER_MS = 6000;
/** Fallback reveal pace when no audio progress is available (words/minute). */
const FALLBACK_WPM = 165;

export function FaceCaption({
  text,
  hint,
  busy,
  progress,
  listening,
}: {
  /** The live reply / message text (PetShell's `caption`). Empty = resting. */
  text: string;
  /** Muted fallback shown when nothing is being said. */
  hint: string;
  /** A turn is in flight (thinking/talking) — hold the caption fully visible. */
  busy: boolean;
  /** 0..1 through the audio for this line, when the caller knows it. */
  progress?: number;
  /** Someone is talking to him right now — show it, plainly. */
  listening?: boolean;
}) {
  const [faded, setFaded] = useState(false);
  const [shown, setShown] = useState(0);          // words revealed so far
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef<HTMLSpanElement | null>(null);

  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);

  // Fade the finished line out after it has had its moment.
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setFaded(false);
    if (!text || busy) return;
    timer.current = setTimeout(() => setFaded(true), LINGER_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [text, busy]);

  // Reveal. Real audio progress when we have it; a steady pace when we do not.
  useEffect(() => {
    setShown(0);
    if (!words.length) return;
    if (typeof progress === "number") return;      // the other effect drives it
    const step = 60000 / FALLBACK_WPM;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= words.length) window.clearInterval(id);
    }, step);
    return () => window.clearInterval(id);
  }, [words, progress]);

  useEffect(() => {
    if (typeof progress !== "number" || !words.length) return;
    // Slightly ahead of the audio reads as natural; exactly on it reads as late.
    setShown(Math.min(words.length, Math.ceil(progress * words.length + 0.35)));
  }, [progress, words.length]);

  // Keep the newest word in frame: slide the rail so the tail sits at the right.
  useEffect(() => {
    const rail = railRef.current, tail = tailRef.current;
    if (!rail || !tail) return;
    const over = tail.offsetLeft + tail.offsetWidth - rail.clientWidth + 16;
    rail.scrollTo({ left: Math.max(0, over), behavior: "smooth" });
  }, [shown]);

  const showCaption = !!text && !faded;
  const visible = words.slice(0, Math.max(1, shown)).join(" ");

  return (
    <div className="relative flex min-h-[3.25rem] w-full items-center justify-center">
      {/* resting hint — cross-fades in whenever nothing is actively captioned */}
      <span aria-hidden={showCaption || listening}
        className={"pointer-events-none absolute inset-0 flex items-center justify-center text-center text-base font-normal text-muted-foreground transition-opacity duration-500 sm:text-lg " +
          (showCaption || listening ? "opacity-0" : "opacity-100")}>
        {hint}
      </span>

      {/* listening — unmistakable, so a stranger knows he is hearing them */}
      <span aria-hidden={!listening}
        className={"pointer-events-none absolute inset-0 flex items-center justify-center gap-2 transition-opacity duration-200 " +
          (listening && !showCaption ? "opacity-100" : "opacity-0")}>
        <span className="text-sm font-medium uppercase tracking-[0.3em] text-primary/80">listening</span>
        <span className="flex items-end gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="block w-[3px] rounded-full bg-primary"
              style={{ height: 14, animation: `nobiBar 900ms ${i * 140}ms ease-in-out infinite` }} />
          ))}
        </span>
      </span>

      {/* the live caption — ONE line, revealed word by word, scrolling sideways */}
      <div aria-live="polite"
        className={"relative w-full max-w-[19rem] overflow-hidden rounded-2xl border border-primary/20 bg-background/60 px-4 py-2 shadow-[0_0_24px_rgba(var(--primary-rgb),0.10)] backdrop-blur-sm transition-opacity duration-300 sm:max-w-lg " +
          (showCaption ? "opacity-100" : "opacity-0")}
        style={{
          // fade the edges so a word sliding out of frame dissolves rather than being chopped
          maskImage: "linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%)",
        }}>
        <div ref={railRef} className="no-scrollbar overflow-x-hidden whitespace-nowrap text-center text-xl font-medium leading-snug text-foreground sm:text-2xl">
          {words.map((w, i) => (
            <span key={i} ref={i === Math.max(0, shown) - 1 ? tailRef : undefined}
              className="transition-opacity duration-150"
              style={{ opacity: i < shown ? 1 : 0 }}>
              {w}{i < words.length - 1 ? " " : ""}
            </span>
          ))}
          {!words.length && <span>{visible}</span>}
        </div>
      </div>

      <style>{`@keyframes nobiBar{0%,100%{height:6px;opacity:.55}50%{height:20px;opacity:1}}
        .no-scrollbar::-webkit-scrollbar{display:none}.no-scrollbar{scrollbar-width:none}`}</style>
    </div>
  );
}
