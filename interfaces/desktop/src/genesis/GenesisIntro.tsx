import { useCallback, useEffect, useRef, useState } from "react";
import { AtlasFace, type FaceState } from "@/components/faces/AtlasFace";
import { useAtlasVoice, getVoiceEngine, warmUpVoices } from "@/genesis/useAtlasVoice";
import { buildGenesisScript, type GenesisBeat } from "@/genesis/genesisScript";
import { PROVIDERS } from "@/genesis/providers";
import { getUserName, getBotName, markIntroDone } from "@/lib/uiMode";
import { stripEmoji } from "@/lib/stripText";

const AI_BEATS_CACHE = "atlas_intro_beats";
const VALID_EXPR: FaceState[] = ["idle", "happy", "listening", "thinking", "excited", "confused"];

/** Fetch Atlas's own AI-written introduction. Returns null on any failure. */
async function fetchAiBeats(): Promise<GenesisBeat[] | null> {
  // A reload shouldn't re-pay generation — reuse this session's script.
  try {
    const cached = sessionStorage.getItem(AI_BEATS_CACHE);
    if (cached) {
      const beats = JSON.parse(cached) as GenesisBeat[];
      if (Array.isArray(beats) && beats.length >= 3) return beats;
    }
  } catch { /* ignore */ }

  let providers: string[] = [];
  try {
    const cfg = await fetch("/api/config");
    if (cfg.ok) {
      const { config } = (await cfg.json()) as { config: Record<string, string> };
      providers = PROVIDERS.filter(
        (p) => typeof config[p.keyName] === "string" && config[p.keyName]!.trim().length > 0,
      ).map((p) => p.name);
    }
  } catch { /* offline */ }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 22000);
    const res = await fetch("/api/genesis/intro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: getUserName(), botName: getBotName(), providers }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const { beats } = (await res.json()) as { beats?: Array<{ expression: string; text: string }> };
    if (!Array.isArray(beats) || beats.length < 3) return null;
    const mapped: GenesisBeat[] = beats
      .filter((b) => b && typeof b.text === "string" && b.text.trim())
      .map((b) => ({
        expression: (VALID_EXPR.includes(b.expression as FaceState) ? b.expression : "idle") as FaceState,
        text: b.text.trim(),
        hold: 180,
      }));
    if (mapped.length < 3) return null;
    try { sessionStorage.setItem(AI_BEATS_CACHE, JSON.stringify(mapped)); } catch { /* ignore */ }
    return mapped;
  } catch {
    return null;
  }
}

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
  // Atlas's AI-written intro is fetched on mount so it's ready by the time the
  // user taps to wake it (fast cloud models arrive in a couple of seconds).
  const aiBeatsRef = useRef<GenesisBeat[] | null>(null);

  useEffect(() => {
    warmUpVoices();
    void fetchAiBeats().then((b) => { aiBeatsRef.current = b; });
  }, []);

  // Static hand-written fallback, used if the AI intro isn't ready in time.
  const staticBeats = useCallback((): GenesisBeat[] => {
    let connected: string[] = [];
    try {
      const raw = sessionStorage.getItem("atlas_connected_providers");
      if (raw) connected = JSON.parse(raw);
    } catch { /* ignore */ }
    return buildGenesisScript({
      name: getUserName(),
      botName: getBotName(),
      providers: connected,
      premiumVoice: getVoiceEngine() === "server",
      hour: new Date().getHours(),
    });
  }, []);

  const prepare = useCallback(async () => {
    // Give the AI intro a brief chance to land, then fall back to static — the
    // user never waits on a slow model.
    if (!aiBeatsRef.current) {
      await Promise.race([
        (async () => { while (!aiBeatsRef.current) await new Promise((r) => setTimeout(r, 150)); })(),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    }
    beatsRef.current = aiBeatsRef.current ?? staticBeats();
  }, [staticBeats]);

  const finish = useCallback(() => {
    cancelledRef.current = true;
    stop();
    setFinishing(true);
    markIntroDone();
    // let the fade play, then hand off
    window.setTimeout(onComplete, 650);
  }, [stop, onComplete]);

  const runBeats = useCallback(async () => {
    const beats = beatsRef.current;
    // A rotating "glance" before each line keeps the eyes from repeating and
    // makes Atlas feel like it's thinking between sentences.
    const GLANCES: FaceState[] = ["listening", "thinking", "idle", "happy"];
    for (let i = 0; i < beats.length; i++) {
      if (cancelledRef.current) return;
      const beat = beats[i]!;

      if (i > 0 && beat.text) {
        setFaceState(GLANCES[i % GLANCES.length]!);
        await new Promise((r) => setTimeout(r, 150));
        if (cancelledRef.current) return;
      }

      // While speaking, a plain "idle" beat gets talking-cadence motion; the
      // expressive poses (happy, excited, thinking…) are shown as-authored.
      const speakingState: FaceState = beat.expression === "idle" ? "talking" : beat.expression;
      setFaceState(beat.text ? speakingState : beat.expression);
      setCaption(stripEmoji(beat.text));

      if (beat.text) {
        await speak(beat.text);
      }
      if (cancelledRef.current) return;
      // brief settle, capped so the whole intro stays brisk
      setFaceState(beat.expression);
      const hold = beat.hold ?? 0;
      if (hold) await new Promise((r) => setTimeout(r, Math.min(hold, 240)));
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
          tap to wake Neura
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
