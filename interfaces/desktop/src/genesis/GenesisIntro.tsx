import { useCallback, useEffect, useRef, useState } from "react";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice, getVoiceEngine } from "@/genesis/useAtlasVoice";
import { buildGenesisScript, type GenesisBeat } from "@/genesis/genesisScript";
import { PROVIDERS } from "@/genesis/providers";
import { getUserName, markIntroDone } from "@/lib/uiMode";

/**
 * The Genesis intro — the single fullscreen moment where Atlas wakes, finds
 * the user, and introduces itself. No menus, no chrome. Just the face going
 * through its expression library, timed to a spoken madlib script.
 *
 * It opens asleep (a sculpture on a dock). One tap wakes it — that tap is also
 * the user gesture browsers require before audio can play. Then it runs the
 * script beat by beat: hold the beat's expression, speak the line, breathe.
 */
export function GenesisIntro({ onComplete }: { onComplete: () => void }) {
  const { speak, stop } = useAtlasVoice();
  const [started, setStarted] = useState(false);
  const [faceState, setFaceState] = useState<FaceState>("sleeping");
  const [caption, setCaption] = useState<string>("");
  const [finishing, setFinishing] = useState(false);
  const cancelledRef = useRef(false);
  const beatsRef = useRef<GenesisBeat[]>([]);

  // Build the script once, weaving in the name + which minds are connected.
  const prepare = useCallback(async () => {
    let connected: string[] = [];
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const { config } = (await res.json()) as { config: Record<string, string> };
        connected = PROVIDERS.filter(
          (p) => typeof config[p.keyName] === "string" && config[p.keyName]!.trim().length > 0,
        ).map((p) => p.name);
      }
    } catch { /* offline — narrate the generic path */ }

    beatsRef.current = buildGenesisScript({
      name: getUserName(),
      providers: connected,
      premiumVoice: getVoiceEngine() === "server",
      hour: new Date().getHours(),
    });
  }, []);

  const finish = useCallback(() => {
    cancelledRef.current = true;
    stop();
    setFinishing(true);
    markIntroDone();
    // let the fade play, then hand off
    window.setTimeout(onComplete, 650);
  }, [stop, onComplete]);

  const runBeats = useCallback(async () => {
    for (const beat of beatsRef.current) {
      if (cancelledRef.current) return;
      // While speaking, a plain "idle" beat gets talking-cadence motion; the
      // expressive poses (happy, excited, thinking…) are shown as-authored.
      const speakingState: FaceState = beat.expression === "idle" ? "talking" : beat.expression;
      setFaceState(beat.text ? speakingState : beat.expression);
      setCaption(beat.text);

      if (beat.text) {
        await speak(beat.text);
      }
      if (cancelledRef.current) return;
      // settle back toward the authored expression, then hold a beat of silence
      setFaceState(beat.expression);
      if (beat.hold) await new Promise((r) => setTimeout(r, beat.hold));
    }
    if (!cancelledRef.current) finish();
  }, [speak, finish]);

  const begin = useCallback(async () => {
    if (started) return;
    setStarted(true);
    await prepare();
    // wake: eyes open and find you
    setFaceState("idle");
    await new Promise((r) => setTimeout(r, 400));
    void runBeats();
  }, [started, prepare, runBeats]);

  useEffect(() => () => { cancelledRef.current = true; stop(); }, [stop]);

  return (
    <div
      onClick={!started ? begin : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "clamp(1.5rem, 5vh, 3rem)",
        background:
          "radial-gradient(120% 120% at 50% 35%, #16222e 0%, #0c1219 60%, #080b10 100%)",
        cursor: !started ? "pointer" : "default",
        opacity: finishing ? 0 : 1,
        transition: "opacity 0.6s ease",
        userSelect: "none",
        overflow: "hidden",
      }}
    >
      {/* faint drifting starfield for depth */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(1px 1px at 20% 30%, rgba(201,220,240,0.25), transparent), radial-gradient(1px 1px at 70% 60%, rgba(201,220,240,0.18), transparent), radial-gradient(1px 1px at 45% 80%, rgba(201,220,240,0.15), transparent)" }} />

      <AtlasFace
        mode="auto"
        state={faceState}
        size={Math.min(340, typeof window !== "undefined" ? window.innerWidth * 0.7 : 340)}
        activity={faceState === "thinking" ? 0.85 : faceState === "talking" ? 0.55 : 0.2}
      />

      {/* caption / subtitle */}
      <div
        style={{
          minHeight: "4.5rem",
          maxWidth: "42rem",
          padding: "0 1.5rem",
          textAlign: "center",
          fontSize: "clamp(1.05rem, 2.4vw, 1.6rem)",
          lineHeight: 1.5,
          color: "#dbe6f2",
          fontWeight: 300,
          letterSpacing: "0.01em",
          transition: "opacity 0.3s ease",
          textShadow: "0 2px 20px rgba(0,0,0,0.5)",
        }}
      >
        {caption}
      </div>

      {!started && (
        <div style={{
          position: "absolute", bottom: "12%", left: 0, right: 0, textAlign: "center",
          fontFamily: "ui-monospace, monospace", fontSize: "0.8rem", letterSpacing: "0.35em",
          textTransform: "uppercase", color: "rgba(201,220,240,0.55)",
          animation: "atlasPulse 2.4s ease-in-out infinite",
        }}>
          tap to wake Atlas
        </div>
      )}

      {started && !finishing && (
        <button
          onClick={finish}
          style={{
            position: "absolute", bottom: "5%", right: "5%",
            background: "transparent", border: "1px solid rgba(201,220,240,0.25)",
            color: "rgba(201,220,240,0.6)", padding: "0.5rem 1.1rem", borderRadius: "999px",
            fontFamily: "ui-monospace, monospace", fontSize: "0.7rem", letterSpacing: "0.2em",
            textTransform: "uppercase", cursor: "pointer",
          }}
        >
          Skip intro
        </button>
      )}

      <style>{`@keyframes atlasPulse { 0%,100% { opacity: 0.35 } 50% { opacity: 0.9 } }`}</style>
    </div>
  );
}
