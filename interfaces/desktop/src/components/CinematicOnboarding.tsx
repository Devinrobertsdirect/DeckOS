import { useState, useEffect, useRef, useCallback } from "react";
import { AIFace, type FaceStyle } from "@/components/AIFace";
import { applyColor, getStoredColor, type ColorScheme } from "@/components/Onboarding";

const API_BASE = "/api";

export const CINEMATIC_KEY = "deckos_cinematic_done";
export const FACE_STYLE_KEY = "deckos_face_style";
export const VOICE_KEY      = "deckos_voice";
export const AI_NAME_KEY    = "deckos_ai_name";

export function isCinematicDone(): boolean {
  try {
    if (localStorage.getItem(CINEMATIC_KEY) === "true") return true;
    const alreadyInitialized = localStorage.getItem("jarvis.initialized") === "true";
    if (alreadyInitialized) {
      localStorage.setItem(CINEMATIC_KEY, "true");
      return true;
    }
    return false;
  } catch { return false; }
}

interface Props {
  onComplete: () => void;
}

type Step = "boot" | "name" | "gender" | "quiz" | "voice" | "face" | "firstcontact";

const GENDERS = [
  { value: "neutral",   label: "NEUTRAL",     desc: "No gender pronoun preference",  symbol: "◈" },
  { value: "male",      label: "MALE",        desc: "He / Him pronouns",              symbol: "♂" },
  { value: "female",    label: "FEMALE",      desc: "She / Her pronouns",             symbol: "♀" },
  { value: "nonbinary", label: "NON-BINARY",  desc: "They / Them pronouns",           symbol: "⬡" },
] as const;

export const QUIZ_QUESTIONS = [
  {
    id: "verbosity",
    prompt: "DIAGNOSTIC 01 — RESPONSE PROTOCOL",
    question: "How should your AI communicate?",
    options: [
      { label: "CONCISE — Short, precise answers only",             value: 0.15 },
      { label: "BALANCED — Context when it matters",               value: 0.5  },
      { label: "VERBOSE — Full analysis and explanation always",   value: 0.85 },
    ],
  },
  {
    id: "humor",
    prompt: "DIAGNOSTIC 02 — PERSONALITY MATRIX",
    question: "Personality calibration: humor level?",
    options: [
      { label: "FORMAL — Professional tone at all times",          value: 0.05 },
      { label: "SUBTLE — Occasional wit when appropriate",         value: 0.4  },
      { label: "PLAYFUL — Wit and banter encouraged",              value: 0.8  },
    ],
  },
  {
    id: "proactivity",
    prompt: "DIAGNOSTIC 03 — INITIATIVE ENGINE",
    question: "How proactive should your AI be?",
    options: [
      { label: "REACTIVE — Respond only when asked",               value: 0.1  },
      { label: "ADVISORY — Suggest when relevant",                 value: 0.5  },
      { label: "PROACTIVE — Anticipate needs and act first",       value: 0.9  },
    ],
  },
  {
    id: "formality",
    prompt: "DIAGNOSTIC 04 — COMMUNICATION STYLE",
    question: "Preferred interaction tone?",
    options: [
      { label: "CLINICAL — Pure data, no personality",             value: 0.05 },
      { label: "COLLEGIAL — Professional but personable",          value: 0.5  },
      { label: "CASUAL — Conversational and direct",               value: 0.85 },
    ],
  },
  {
    id: "analyticalDepth",
    prompt: "DIAGNOSTIC 05 — REASONING DEPTH",
    question: "How deep should analysis go by default?",
    options: [
      { label: "SURFACE — Quick decisions, minimal analysis",      value: 0.15 },
      { label: "MODERATE — Reasonable depth on complex topics",    value: 0.5  },
      { label: "DEEP — Full reasoning chains for everything",      value: 0.9  },
    ],
  },
];

export const VOICE_OPTIONS = [
  {
    id: "onyx",
    label: "ONYX",
    description: "Deep, authoritative — the classic command voice",
    sample: "All systems nominal. I am online and ready to assist.",
  },
  {
    id: "alloy",
    label: "ALLOY",
    description: "Neutral, clear — precise and efficient",
    sample: "Command center initialized. How can I assist you today?",
  },
  {
    id: "nova",
    label: "NOVA",
    description: "Crisp, energetic — sharp intelligence",
    sample: "I am ready. Awaiting your first directive.",
  },
];

export const FACE_OPTIONS: { id: FaceStyle; label: string; description: string }[] = [
  {
    id: "vocoder",
    label: "VOCODER",
    description: "Retro radio-linen — horizontal bars like a vintage robot mouth",
  },
  {
    id: "oscilloscope",
    label: "OSCILLOSCOPE",
    description: "Classic sine-wave audio visualizer",
  },
  {
    id: "iris",
    label: "IRIS",
    description: "Geometric aperture that dilates with speech",
  },
  {
    id: "spectrum",
    label: "SPECTRUM",
    description: "Vertical frequency bar chart",
  },
];

const BOOT_LINES = [
  "BIOS v4.2.1 — POST complete",
  "CPU: 16-core neural processor detected",
  "RAM: 128GB unified memory … OK",
  "STORAGE: 2TB NVMe array … OK",
  "NETWORK: Secure mesh established",
  "COGNITIVE MODEL: loading identity layer …",
  "COGNITIVE MODEL: loading preference layer …",
  "COGNITIVE MODEL: loading behavior patterns …",
  "INFERENCE ENGINE: initializing cortex tier",
  "PLUGIN SYSTEM: scanning registry … 0 plugins loaded",
  "SECURITY LAYER: certificates verified",
  "ENCRYPTION: AES-256 active",
  "AUTONOMY ENGINE: standby mode",
  "TIMELINE: event bus listening",
  "SYSTEM CHECK: all subsystems nominal",
  "WARNING: NO USER PROFILE FOUND",
  "WARNING: AI IDENTITY NOT CONFIGURED",
  "⚠ FIRST BOOT DETECTED — BEGINNING CALIBRATION",
];

function BootStep({ onComplete }: { onComplete: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState(0);
  const [flicker, setFlicker] = useState(false);
  const indexRef = useRef(0);
  const color = `hsl(var(--primary))`;

  useEffect(() => {
    let cancelled = false;

    async function runLines() {
      for (let i = 0; i < BOOT_LINES.length; i++) {
        if (cancelled) break;
        await new Promise<void>((r) => setTimeout(r, 60 + Math.random() * 80));
        setLines((prev) => [...prev, BOOT_LINES[i]!]);
        setProgress(Math.round(((i + 1) / BOOT_LINES.length) * 100));

        if (i >= BOOT_LINES.length - 3) {
          setFlicker(true);
          await new Promise<void>((r) => setTimeout(r, 120));
          setFlicker(false);
          await new Promise<void>((r) => setTimeout(r, 80));
          setFlicker(true);
          await new Promise<void>((r) => setTimeout(r, 60));
          setFlicker(false);
        }
      }
      if (!cancelled) {
        await new Promise<void>((r) => setTimeout(r, 900));
        setDone(true);
      }
    }

    runLines();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-black">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 4px)",
          animation: "scanlines 8s linear infinite",
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      <div
        className="relative z-10 w-full max-w-3xl px-8"
        style={{ opacity: flicker ? 0.3 : 1, transition: "opacity 0.04s" }}
      >
        <div
          className="font-mono text-xs leading-relaxed overflow-hidden"
          style={{
            color: "rgba(63,132,243,0.85)",
            height: "340px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
          }}
        >
          {lines.map((line, i) => (
            <div
              key={i}
              className="opacity-0"
              style={{
                animation: `fadeInLine 0.15s ease forwards`,
                color: line.includes("WARNING") || line.includes("⚠")
                  ? (line.includes("DETECTED") ? "#f03248" : "#ffc820")
                  : i >= lines.length - 2
                  ? "#3f84f3"
                  : "rgba(63,132,243,0.65)",
                fontWeight: line.includes("⚠") ? "700" : "400",
                fontSize: line.includes("⚠") ? "0.85rem" : "0.72rem",
                letterSpacing: line.includes("⚠") ? "0.1em" : "0.04em",
                textShadow: line.includes("⚠") ? "0 0 10px currentColor" : "none",
              }}
            >
              {line.includes("⚠") ? line : `> ${line}`}
            </div>
          ))}
          {!done && (
            <div className="font-mono text-xs" style={{ color: "rgba(63,132,243,0.5)" }}>
              <span style={{ animation: "blink 1s step-end infinite" }}>█</span>
            </div>
          )}
        </div>

        <div className="mt-6">
          <div className="flex justify-between mb-1 font-mono text-xs" style={{ color: "rgba(63,132,243,0.5)" }}>
            <span>SYSTEM INITIALIZATION</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-1 rounded-full" style={{ background: "rgba(63,132,243,0.12)" }}>
            <div
              className="h-1 rounded-full"
              style={{
                width: `${progress}%`,
                background: "linear-gradient(90deg, #1a4fc8, #3f84f3)",
                boxShadow: "0 0 8px #3f84f3",
                transition: "width 0.15s ease",
              }}
            />
          </div>
        </div>

        {done && (
          <div
            className="mt-8 text-center"
            style={{ animation: "fadeInLine 0.5s ease forwards" }}
          >
            <button
              onClick={onComplete}
              className="font-mono font-bold text-sm tracking-widest border px-8 py-3 uppercase"
              style={{
                borderColor: "#f03248",
                color: "#f03248",
                background: "rgba(240,50,72,0.08)",
                boxShadow: "0 0 20px rgba(240,50,72,0.3)",
                animation: "pulseGlow 2s ease-in-out infinite",
                cursor: "pointer",
                letterSpacing: "0.2em",
              }}
            >
              INITIATE CALIBRATION
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes scanlines {
          0%   { background-position: 0 0; }
          100% { background-position: 0 100%; }
        }
        @keyframes fadeInLine {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(240,50,72,0.3); }
          50%       { box-shadow: 0 0 30px rgba(240,50,72,0.6); }
        }
      `}</style>
    </div>
  );
}

function NameStep({ onComplete }: { onComplete: (name: string) => void }) {
  const [name, setName] = useState("");
  const [typing, setTyping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-lg">
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: "rgba(63,132,243,0.5)" }}>
          CALIBRATION — STEP 1 OF 6
        </div>
        <div className="mb-1 font-mono text-xs tracking-widest uppercase" style={{ color: "#ffc820" }}>
          IDENTITY ASSIGNMENT
        </div>
        <h2
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: "var(--font-sans)", color: "var(--color-foreground)", letterSpacing: "0.05em" }}
        >
          Name your AI
        </h2>
        <p className="text-sm mb-8" style={{ color: "rgba(var(--primary-rgb),0.6)", fontFamily: "var(--font-mono)" }}>
          Your AI will use this name to identify itself. This becomes part of its core identity.
        </p>

        <div className="relative mb-6">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setTyping(true); }}
            onBlur={() => setTyping(false)}
            placeholder="e.g. JARVIS, ARIA, NOVA …"
            maxLength={24}
            className="w-full bg-transparent border-b-2 text-2xl font-bold tracking-widest uppercase outline-none pb-3"
            style={{
              borderColor: typing || name ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.2)",
              color: "var(--color-foreground)",
              fontFamily: "var(--font-mono)",
              caretColor: "var(--color-primary)",
              transition: "border-color 0.2s",
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onComplete(name.trim()); }}
          />
          {name && (
            <div
              className="absolute right-0 bottom-4 font-mono text-xs"
              style={{ color: "rgba(var(--primary-rgb),0.4)" }}
            >
              {name.length}/24
            </div>
          )}
        </div>

        <button
          onClick={() => name.trim() && onComplete(name.trim())}
          disabled={!name.trim()}
          className="w-full py-3 font-mono font-bold tracking-widest uppercase text-sm border transition-all"
          style={{
            borderColor: name.trim() ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.15)",
            color: name.trim() ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.3)",
            background: name.trim() ? "rgba(var(--primary-rgb),0.08)" : "transparent",
            boxShadow: name.trim() ? "0 0 20px rgba(var(--primary-rgb),0.15)" : "none",
            cursor: name.trim() ? "pointer" : "not-allowed",
          }}
        >
          CONFIRM IDENTITY →
        </button>
      </div>
    </div>
  );
}

function GenderStep({ aiName, onComplete }: { aiName: string; onComplete: (gender: string) => void }) {
  const [selected, setSelected] = useState<string>("neutral");
  const [confirmed, setConfirmed] = useState(false);

  function handleConfirm() {
    if (confirmed) return;
    setConfirmed(true);
    setTimeout(() => onComplete(selected), 300);
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-xl">
        <div className="font-mono text-xs tracking-widest mb-2" style={{ color: "rgba(63,132,243,0.5)" }}>
          CALIBRATION — STEP 2 OF 6
        </div>
        <div className="mb-1 font-mono text-xs tracking-widest uppercase" style={{ color: "#ffc820" }}>
          VOICE PERSONA
        </div>
        <h2
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: "var(--font-sans)", color: "var(--color-foreground)", letterSpacing: "0.05em" }}
        >
          Gender / Pronouns
        </h2>
        <p className="text-sm mb-8" style={{ color: "rgba(var(--primary-rgb),0.6)", fontFamily: "var(--font-mono)" }}>
          {aiName} will use this to choose the right voice and pronouns. You can change this later.
        </p>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {GENDERS.map((g) => {
            const active = selected === g.value;
            return (
              <button
                key={g.value}
                onClick={() => setSelected(g.value)}
                className="relative text-left p-4 border transition-all"
                style={{
                  borderColor:   active ? "var(--color-primary)" : "rgba(63,132,243,0.15)",
                  background:    active ? "rgba(63,132,243,0.1)" : "rgba(63,132,243,0.03)",
                  boxShadow:     active ? "0 0 20px rgba(63,132,243,0.15), inset 0 0 12px rgba(63,132,243,0.05)" : "none",
                  transform:     active ? "scale(1.02)" : "scale(1)",
                  transitionDuration: "0.2s",
                }}
              >
                <div
                  className="font-mono text-xl mb-2"
                  style={{ color: active ? "var(--color-primary)" : "rgba(63,132,243,0.35)" }}
                >
                  {g.symbol}
                </div>
                <div
                  className="font-mono text-sm font-bold tracking-widest"
                  style={{ color: active ? "var(--color-foreground)" : "rgba(var(--primary-rgb),0.55)" }}
                >
                  {g.label}
                </div>
                <div
                  className="font-mono text-xs mt-1"
                  style={{ color: active ? "rgba(var(--primary-rgb),0.65)" : "rgba(var(--primary-rgb),0.35)" }}
                >
                  {g.desc}
                </div>
                {active && (
                  <div
                    className="absolute top-2 right-2 font-mono text-xs"
                    style={{ color: "var(--color-primary)" }}
                  >
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={handleConfirm}
          disabled={confirmed}
          className="w-full py-3 font-mono font-bold tracking-widest uppercase text-sm border transition-all"
          style={{
            borderColor: "var(--color-primary)",
            color:        confirmed ? "rgba(var(--primary-rgb),0.4)" : "var(--color-primary)",
            background:   "rgba(var(--primary-rgb),0.08)",
            boxShadow:    confirmed ? "none" : "0 0 20px rgba(var(--primary-rgb),0.15)",
            cursor:       confirmed ? "not-allowed" : "pointer",
          }}
        >
          {confirmed ? "CONFIRMED…" : "CONFIRM SELECTION →"}
        </button>
      </div>
    </div>
  );
}

function QuizStep({ aiName, onComplete }: { aiName: string; onComplete: (answers: Record<string, number>) => void }) {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  const q = QUIZ_QUESTIONS[currentQ]!;
  const progress = ((currentQ) / QUIZ_QUESTIONS.length) * 100;

  function handleSelect(idx: number) {
    if (transitioning) return;
    setSelected(idx);
    setTimeout(() => {
      setTransitioning(true);
      const newAnswers = { ...answers, [q.id]: q.options[idx]!.value };
      setAnswers(newAnswers);
      setTimeout(() => {
        if (currentQ + 1 < QUIZ_QUESTIONS.length) {
          setCurrentQ((c) => c + 1);
          setSelected(null);
          setTransitioning(false);
        } else {
          onComplete(newAnswers);
        }
      }, 400);
    }, 300);
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-xl">
        <div className="flex justify-between items-center mb-4">
          <div className="font-mono text-xs tracking-widest" style={{ color: "rgba(63,132,243,0.5)" }}>
            CALIBRATION — STEP 3 OF 6
          </div>
          <div className="font-mono text-xs tracking-widest" style={{ color: "rgba(63,132,243,0.5)" }}>
            {currentQ + 1}/{QUIZ_QUESTIONS.length}
          </div>
        </div>

        <div className="w-full h-0.5 mb-6 rounded-full" style={{ background: "rgba(63,132,243,0.1)" }}>
          <div
            className="h-0.5 rounded-full"
            style={{
              width: `${progress}%`,
              background: "var(--color-primary)",
              boxShadow: "0 0 6px var(--color-primary)",
              transition: "width 0.4s ease",
            }}
          />
        </div>

        <div
          style={{
            opacity: transitioning ? 0 : 1,
            transform: transitioning ? "translateX(20px)" : "translateX(0)",
            transition: "all 0.3s ease",
          }}
        >
          <div className="font-mono text-xs tracking-widest mb-2 uppercase" style={{ color: "#ffc820" }}>
            {q.prompt}
          </div>
          <h2
            className="text-xl font-bold mb-6"
            style={{ fontFamily: "var(--font-sans)", color: "var(--color-foreground)", letterSpacing: "0.02em" }}
          >
            {q.question}
          </h2>

          <div className="space-y-3">
            {q.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSelect(i)}
                className="w-full text-left p-4 border font-mono text-sm transition-all"
                style={{
                  borderColor: selected === i
                    ? "var(--color-primary)"
                    : "rgba(var(--primary-rgb),0.15)",
                  background: selected === i
                    ? "rgba(var(--primary-rgb),0.12)"
                    : "rgba(var(--primary-rgb),0.03)",
                  color: selected === i
                    ? "var(--color-primary)"
                    : "var(--color-foreground)",
                  boxShadow: selected === i ? "0 0 16px rgba(var(--primary-rgb),0.2)" : "none",
                  transform: selected === i ? "translateX(4px)" : "translateX(0)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-5 h-5 border flex items-center justify-center text-xs"
                    style={{
                      borderColor: selected === i ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.3)",
                      color: selected === i ? "var(--color-primary)" : "transparent",
                    }}
                  >
                    {selected === i ? "✓" : ""}
                  </span>
                  <span>{opt.label}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type ElevenLabsVoice = { id: string; name: string; category: string };

function useElevenLabsVoices() {
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${API_BASE}/vision/elevenlabs/voices`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.voices) setVoices(d.voices); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { voices, loading };
}

function useLocalTtsAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    fetch(`${API_BASE}/features`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.tts?.local) setAvailable(true); })
      .catch(() => {});
  }, []);
  return available;
}

const LOCAL_VOICE_OPTIONS = [
  {
    id: "local-male",
    label: "ARGUS — MALE",
    description: "Deep, authoritative offline voice — no cloud required",
    sample: "All systems nominal. I am online and ready to assist.",
  },
  {
    id: "local-female",
    label: "ARIA — FEMALE",
    description: "Clear, energetic offline voice — no cloud required",
    sample: "I am ready. Awaiting your first directive.",
  },
];

const SAMPLE_TEXT = "Systems online. Voice synthesis module calibrated and ready for command.";

function VoiceStep({ aiName, onComplete }: { aiName: string; onComplete: (voice: string) => void }) {
  const [selected, setSelected] = useState<string>("onyx");
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { voices: elVoices, loading: elLoading } = useElevenLabsVoices();
  const hasElevenLabs = elVoices.length > 0;
  const hasLocal = useLocalTtsAvailable();

  async function playSample(voiceId: string, sampleText: string) {
    if (playing === voiceId) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    setPlaying(voiceId);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/vision/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sampleText, voice: voiceId }),
      });
      if (!res.ok) throw new Error("TTS unavailable");
      const data = await res.json() as { audio?: string; format?: string };
      if (!data.audio) throw new Error("No audio in response");
      const url = `data:audio/${data.format ?? "mp3"};base64,${data.audio}`;
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      const { attachAmplitudeAnalyser } = await import("@/lib/audioAnalyser");
      attachAmplitudeAnalyser(audio);
      audio.onended = () => setPlaying(null);
      audio.onerror = () => setPlaying(null);
      await audio.play();
    } catch {
      setPlaying(null);
      setError("TTS not configured — select any voice to continue.");
    }
  }

  useEffect(() => { return () => { audioRef.current?.pause(); }; }, []);

  function VoiceRow({ id, label, description, sample }: { id: string; label: string; description: string; sample: string }) {
    const isPlaying = playing === id;
    const isSelected = selected === id;
    return (
      <div
        className="border p-4 cursor-pointer transition-all"
        style={{
          borderColor: isSelected ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.15)",
          background: isSelected ? "rgba(var(--primary-rgb),0.07)" : "rgba(var(--primary-rgb),0.02)",
          boxShadow: isSelected ? "0 0 20px rgba(var(--primary-rgb),0.12)" : "none",
        }}
        onClick={() => setSelected(id)}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div
              className="font-mono font-bold text-sm tracking-widest mb-0.5"
              style={{ color: isSelected ? "var(--color-primary)" : "var(--color-foreground)" }}
            >
              {label}
            </div>
            <div className="font-mono text-xs" style={{ color: "rgba(var(--primary-rgb),0.5)" }}>
              {description}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); playSample(id, sample); }}
            className="flex-shrink-0 ml-4 font-mono text-xs tracking-widest px-3 py-2 border transition-all"
            style={{
              borderColor: isPlaying ? "#11d97a" : "rgba(var(--primary-rgb),0.25)",
              color: isPlaying ? "#11d97a" : "rgba(var(--primary-rgb),0.6)",
              background: isPlaying ? "rgba(17,217,122,0.08)" : "transparent",
            }}
          >
            {isPlaying ? "■ STOP" : "▶ PLAY"}
          </button>
        </div>
        {isPlaying && (
          <div className="mt-3 flex items-center gap-1 h-4">
            {Array.from({ length: 24 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  background: "var(--color-primary)",
                  height: `${20 + Math.random() * 80}%`,
                  animation: `voiceBar ${0.4 + Math.random() * 0.4}s ease-in-out infinite alternate`,
                  animationDelay: `${i * 0.04}s`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-8 overflow-y-auto py-8">
      <div className="w-full max-w-xl">
        <div className="font-mono text-xs tracking-widest mb-1" style={{ color: "rgba(63,132,243,0.5)" }}>
          CALIBRATION — STEP 4 OF 6
        </div>
        <div className="font-mono text-xs tracking-widest uppercase mb-2" style={{ color: "#ffc820" }}>
          VOICE SYNTHESIS MODULE
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-sans)", color: "var(--color-foreground)" }}>
          Select {aiName}'s voice
        </h2>
        <p className="text-xs mb-6 font-mono" style={{ color: "rgba(var(--primary-rgb),0.5)" }}>
          Click each option to hear a preview.
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 font-mono text-xs border" style={{ borderColor: "#ffc82050", color: "#ffc820", background: "rgba(255,200,32,0.05)" }}>
            {error}
          </div>
        )}

        {!elLoading && hasElevenLabs && (
          <div className="mb-4">
            <div className="font-mono text-[9px] tracking-widest uppercase mb-2 flex items-center gap-2" style={{ color: "rgba(var(--primary-rgb),0.4)" }}>
              <span className="px-1.5 py-0.5 border text-[8px]" style={{ borderColor: "rgba(var(--primary-rgb),0.3)", color: "rgba(var(--primary-rgb),0.6)" }}>ELEVENLABS</span>
              Your connected voices
            </div>
            <div className="space-y-2">
              {elVoices.map((v) => (
                <VoiceRow
                  key={v.id}
                  id={v.id}
                  label={v.name.toUpperCase()}
                  description={v.category === "premade" ? "ElevenLabs premade voice" : v.category === "cloned" ? "Voice clone" : v.category}
                  sample={SAMPLE_TEXT}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          {hasElevenLabs && (
            <div className="font-mono text-[9px] tracking-widest uppercase mb-2 flex items-center gap-2" style={{ color: "rgba(var(--primary-rgb),0.4)" }}>
              <span className="px-1.5 py-0.5 border text-[8px]" style={{ borderColor: "rgba(var(--primary-rgb),0.2)", color: "rgba(var(--primary-rgb),0.4)" }}>OPENAI</span>
              Standard voices
            </div>
          )}
          <div className="space-y-3">
            {VOICE_OPTIONS.map((v) => (
              <VoiceRow key={v.id} id={v.id} label={v.label} description={v.description} sample={v.sample} />
            ))}
          </div>
        </div>

        {hasLocal && (
          <div className="mt-4">
            <div className="font-mono text-[9px] tracking-widest uppercase mb-2 flex items-center gap-2" style={{ color: "rgba(var(--primary-rgb),0.4)" }}>
              <span className="px-1.5 py-0.5 border text-[8px]" style={{ borderColor: "#11d97a50", color: "#11d97a" }}>OFFLINE</span>
              Local voices — no API key required
            </div>
            <div className="space-y-2">
              {LOCAL_VOICE_OPTIONS.map((v) => (
                <VoiceRow key={v.id} id={v.id} label={v.label} description={v.description} sample={v.sample} />
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => onComplete(selected)}
          className="w-full mt-6 py-3 font-mono font-bold tracking-widest uppercase text-sm border transition-all"
          style={{
            borderColor: "var(--color-primary)",
            color: "var(--color-primary)",
            background: "rgba(var(--primary-rgb),0.08)",
            boxShadow: "0 0 20px rgba(var(--primary-rgb),0.15)",
            cursor: "pointer",
          }}
        >
          LOCK IN VOICE →
        </button>

        <style>{`
          @keyframes voiceBar {
            from { transform: scaleY(0.3); }
            to   { transform: scaleY(1); }
          }
        `}</style>
      </div>
    </div>
  );
}

function FaceStep({ aiName, onComplete }: { aiName: string; onComplete: (face: FaceStyle) => void }) {
  const [selected, setSelected] = useState<FaceStyle>("vocoder");
  const [speaking, setSpeaking] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setSpeaking((s) => !s), 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-2xl">
        <div className="font-mono text-xs tracking-widest mb-1" style={{ color: "rgba(63,132,243,0.5)" }}>
          CALIBRATION — STEP 5 OF 6
        </div>
        <div className="font-mono text-xs tracking-widest uppercase mb-2" style={{ color: "#ffc820" }}>
          VISUAL INTERFACE MODULE
        </div>
        <h2
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: "var(--font-sans)", color: "var(--color-foreground)" }}
        >
          Choose {aiName}'s face
        </h2>
        <p className="text-xs mb-6 font-mono" style={{ color: "rgba(var(--primary-rgb),0.5)" }}>
          This animation will react to {aiName}'s speech throughout the command center.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {FACE_OPTIONS.map((f) => {
            const isSelected = selected === f.id;
            return (
              <div
                key={f.id}
                onClick={() => setSelected(f.id)}
                className="border p-4 cursor-pointer transition-all flex flex-col items-center"
                style={{
                  borderColor: isSelected ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.15)",
                  background: isSelected ? "rgba(var(--primary-rgb),0.07)" : "rgba(var(--primary-rgb),0.02)",
                  boxShadow: isSelected ? "0 0 24px rgba(var(--primary-rgb),0.15)" : "none",
                  transform: isSelected ? "scale(1.02)" : "scale(1)",
                  transition: "all 0.2s ease",
                }}
              >
                <div className="mb-3 flex items-center justify-center" style={{ height: 60 }}>
                  <AIFace
                    style={f.id}
                    speaking={isSelected ? speaking : false}
                    size={f.id === "iris" ? 60 : 100}
                    color={isSelected ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.3)"}
                  />
                </div>
                <div
                  className="font-mono font-bold text-xs tracking-widest mb-1"
                  style={{ color: isSelected ? "var(--color-primary)" : "var(--color-muted-foreground)" }}
                >
                  {f.label}
                </div>
                <div className="font-mono text-xs text-center" style={{ color: "rgba(var(--primary-rgb),0.4)", fontSize: "0.65rem" }}>
                  {f.description}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => onComplete(selected)}
          className="w-full py-3 font-mono font-bold tracking-widest uppercase text-sm border transition-all"
          style={{
            borderColor: "var(--color-primary)",
            color: "var(--color-primary)",
            background: "rgba(var(--primary-rgb),0.08)",
            boxShadow: "0 0 20px rgba(var(--primary-rgb),0.15)",
            cursor: "pointer",
          }}
        >
          CONFIRM INTERFACE →
        </button>
      </div>
    </div>
  );
}

function FirstContactStep({
  aiName,
  voice,
  faceStyle,
  quizAnswers,
  onComplete,
}: {
  aiName: string;
  voice: string;
  faceStyle: FaceStyle;
  quizAnswers: Record<string, number>;
  onComplete: () => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const verbosity = quizAnswers["verbosity"] ?? 0.5;
  const formality = quizAnswers["formality"] ?? 0.5;
  const humor     = quizAnswers["humor"] ?? 0.4;

  const toneWord   = formality > 0.6 ? "casual and direct" : formality > 0.3 ? "balanced and collegial" : "precise and professional";
  const humorWord  = humor > 0.6 ? "with occasional wit" : humor > 0.3 ? "with subtle personality" : "formally";
  const lengthWord = verbosity > 0.6 ? "Give a thorough, detailed introduction." : verbosity > 0.3 ? "Keep it concise but warm." : "Be extremely brief.";

  const systemPrompt = `You are ${aiName}, a JARVIS-style AI command center. Your personality: ${toneWord}, speaking ${humorWord}. ${lengthWord} You are meeting your user for the first time. Introduce yourself with your name, reference that you have been calibrated and personalized, and ask the user one opening question to learn about them. Sound like an intelligent, alive AI — not a generic chatbot. Avoid markdown. Speak naturally.`;

  useEffect(() => {
    let cancelled = false;

    async function runFirstContact() {
      try {
        const res = await fetch(`${API_BASE}/ai-router/infer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `Introduce yourself as ${aiName} for the first time.`,
            mode: "deep",
            task: "chat",
            context: [{ role: "system", content: systemPrompt }],
          }),
        });

        if (res.ok) {
          const data = await res.json() as { response?: string };
          const intro = data.response ?? `Online. I am ${aiName}, your personal AI command center. Calibration complete — I have been shaped to your preferences. What shall we accomplish today?`;
          if (!cancelled) setText(intro);
        } else {
          throw new Error("AI offline");
        }
      } catch {
        if (!cancelled) {
          setText(`Online. I am ${aiName}, your personal AI command center. All systems are nominal and I have been calibrated to your preferences. I am ready to serve. What shall we accomplish today?`);
        }
      }
      if (!cancelled) setLoading(false);
    }

    runFirstContact();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading || !text) return;
    let cancelled = false;

    async function speak() {
      setSpeaking(true);
      try {
        const res = await fetch(`${API_BASE}/vision/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 500), voice }),
        });
        if (!res.ok) throw new Error("TTS unavailable");
        const data = await res.json() as { audio?: string; format?: string };
        if (!data.audio) throw new Error("No audio in response");
        const url = `data:audio/${data.format ?? "mp3"};base64,${data.audio}`;
        const audio = new Audio(url);
        audioRef.current = audio;
        const { attachAmplitudeAnalyser } = await import("@/lib/audioAnalyser");
        attachAmplitudeAnalyser(audio);
        audio.onended = () => { if (!cancelled) { setSpeaking(false); setDone(true); } };
        audio.onerror = () => { if (!cancelled) { setSpeaking(false); setDone(true); } };
        await audio.play();
      } catch {
        if (!cancelled) {
          setSpeaking(false);
          setTimeout(() => { if (!cancelled) setDone(true); }, 3000);
        }
      }
    }

    speak();
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [loading, text]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-lg flex flex-col items-center text-center">
        <div className="font-mono text-xs tracking-widest mb-6" style={{ color: "rgba(63,132,243,0.5)" }}>
          CALIBRATION — STEP 6 OF 6 — FIRST CONTACT
        </div>

        <div
          className="mb-6 flex items-center justify-center border"
          style={{
            width: 160,
            height: faceStyle === "iris" ? 160 : 90,
            borderColor: speaking ? "var(--color-primary)" : "rgba(var(--primary-rgb),0.2)",
            background: "rgba(var(--primary-rgb),0.04)",
            boxShadow: speaking ? "0 0 30px rgba(var(--primary-rgb),0.25), inset 0 0 30px rgba(var(--primary-rgb),0.05)" : "none",
            transition: "all 0.3s ease",
          }}
        >
          <AIFace
            style={faceStyle}
            speaking={speaking}
            size={faceStyle === "iris" ? 140 : 150}
            color="var(--color-primary)"
          />
        </div>

        <div
          className="font-mono font-bold text-lg tracking-widest mb-4"
          style={{ color: "var(--color-primary)", textShadow: "0 0 20px rgba(var(--primary-rgb),0.5)" }}
        >
          {aiName}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 font-mono text-xs" style={{ color: "rgba(var(--primary-rgb),0.5)" }}>
            <span style={{ animation: "blink 1s step-end infinite" }}>■</span>
            <span>SYNTHESIZING INTRODUCTION …</span>
          </div>
        ) : (
          <div
            className="font-mono text-sm leading-relaxed mb-8"
            style={{
              color: speaking ? "var(--color-foreground)" : "rgba(var(--primary-rgb),0.7)",
              maxWidth: 440,
              animation: "fadeInLine 0.5s ease forwards",
              transition: "color 0.5s",
            }}
          >
            &ldquo;{text}&rdquo;
          </div>
        )}

        {done && (
          <button
            onClick={onComplete}
            className="px-10 py-3 font-mono font-bold tracking-widest uppercase text-sm border transition-all"
            style={{
              borderColor: "#11d97a",
              color: "#11d97a",
              background: "rgba(17,217,122,0.08)",
              boxShadow: "0 0 20px rgba(17,217,122,0.2)",
              cursor: "pointer",
              animation: "fadeInLine 0.4s ease forwards",
            }}
          >
            ENTER COMMAND CENTER →
          </button>
        )}

        {speaking && !done && (
          <div className="flex items-center gap-2 font-mono text-xs mt-4" style={{ color: "rgba(var(--primary-rgb),0.4)" }}>
            <span style={{ animation: "blink 0.5s step-end infinite" }}>●</span>
            <span>TRANSMITTING</span>
          </div>
        )}

        <style>{`
          @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
          @keyframes fadeInLine {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}

/** Map a local-* voice ID to OpenAI voice + gender for DB persistence. */
function resolveLocalVoice(voiceId: string): { voice: string; gender: string } | null {
  if (voiceId === "local-male")     return { voice: "onyx",  gender: "male" };
  if (voiceId === "local-female")   return { voice: "nova",  gender: "female" };
  if (voiceId === "local-nonbinary") return { voice: "alloy", gender: "nonbinary" };
  return null;
}

export function CinematicOnboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("boot");
  const [aiName, setAiName] = useState("JARVIS");
  const [voice, setVoice] = useState("onyx");
  const [gender, setGender] = useState<string | null>(null);
  const [faceStyle, setFaceStyle] = useState<FaceStyle>("vocoder");
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [fadeOut, setFadeOut] = useState(false);

  async function writeToUCM(
    name: string,
    answers: Record<string, number>,
    voiceId: string,
    face: FaceStyle,
    selectedGender: string,
  ) {
    try {
      const identityData: Record<string, unknown> = {
        aiName: name,
        gender: selectedGender,
        onboardingComplete: true,
        onboardingVersion: 2,
        firstContactAt: new Date().toISOString(),
      };
      const preferencesData: Record<string, unknown> = {
        voice: voiceId,
        faceStyle: face,
        verbosityLevel: answers["verbosity"] ?? 0.5,
        humorLevel: answers["humor"] ?? 0.4,
        proactivityLevel: answers["proactivity"] ?? 0.5,
        toneFormality: answers["formality"] ?? 0.5,
        analyticalDepth: answers["analyticalDepth"] ?? 0.5,
      };

      await Promise.all([
        fetch(`${API_BASE}/ucm/identity`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: identityData, merge: true }),
        }),
        fetch(`${API_BASE}/ucm/preferences`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: preferencesData, merge: true }),
        }),
      ]);
    } catch {
    }
  }

  function handleBootComplete() {
    setStep("name");
  }

  function handleNameComplete(name: string) {
    setAiName(name);
    localStorage.setItem(AI_NAME_KEY, name);
    setStep("gender");
  }

  function handleGenderComplete(selectedGender: string) {
    setGender(selectedGender);
    // Eagerly persist gender so local TTS uses it from the voice step onward
    fetch(`${API_BASE}/ai/persona`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: selectedGender }),
    }).catch(() => {});
    setStep("quiz");
  }

  function handleQuizComplete(answers: Record<string, number>) {
    setQuizAnswers(answers);
    setStep("voice");
  }

  function handleVoiceComplete(voiceId: string) {
    const local = resolveLocalVoice(voiceId);
    const openAiVoiceIds = new Set(VOICE_OPTIONS.map((v) => v.id));
    if (local) {
      // Local voice selected — map to cloud-compatible ID.
      // Do NOT overwrite explicit gender-step selection; gender step is source of truth.
      setVoice(local.voice);
      localStorage.setItem(VOICE_KEY, local.voice);
      // Clear any stale ElevenLabs voice ID — not needed for local TTS
      fetch(`${API_BASE}/config/ELEVENLABS_VOICE_ID`, { method: "DELETE" }).catch(() => {});
    } else {
      setVoice(voiceId);
      localStorage.setItem(VOICE_KEY, voiceId);
      if (!openAiVoiceIds.has(voiceId)) {
        // ElevenLabs voice — persist ID to backend config so all TTS paths use it
        fetch(`${API_BASE}/config`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ELEVENLABS_VOICE_ID: voiceId }),
        }).catch(() => {});
      } else {
        // OpenAI standard voice — clear any stale ElevenLabs voice ID
        fetch(`${API_BASE}/config/ELEVENLABS_VOICE_ID`, { method: "DELETE" }).catch(() => {});
      }
    }
    setStep("face");
  }

  function handleFaceComplete(face: FaceStyle) {
    setFaceStyle(face);
    localStorage.setItem(FACE_STYLE_KEY, face);
    setStep("firstcontact");
  }

  async function handleFirstContactComplete() {
    const finalGender = gender ?? "neutral";
    // Authoritative persona PUT at completion — ensures gender is persisted even if
    // the earlier eager PUT (handleGenderComplete) failed due to a network error.
    await fetch(`${API_BASE}/ai/persona`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: finalGender }),
    }).catch(() => {});
    await writeToUCM(aiName, quizAnswers, voice, faceStyle, finalGender);
    localStorage.setItem(CINEMATIC_KEY, "true");
    localStorage.setItem("jarvis.initialized", "true");
    localStorage.setItem("jarvis.user", JSON.stringify({
      aiName,
      systemName: aiName,
      voiceMode: false,
      userName: "",
      answers: Object.entries(quizAnswers).map(([q, a]) => ({ q, a: String(a) })),
      color: getStoredColor(),
      photoDataUrl: null,
      photoComment: null,
      visualMode: "cinematic",
      ollamaUrl: "http://localhost:11434",
    }));
    setFadeOut(true);
    setTimeout(() => onComplete(), 500);
  }

  const stepIndex = ["boot", "name", "gender", "quiz", "voice", "face", "firstcontact"].indexOf(step);

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        background: "hsl(220 50% 4%)",
        opacity: fadeOut ? 0 : 1,
        transition: "opacity 0.5s ease",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 80% 80% at 50% 50%, rgba(63,132,243,0.04) 0%, transparent 70%)",
        }}
      />

      {step !== "boot" && (
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: "rgba(63,132,243,0.08)" }}>
          <div
            className="h-0.5"
            style={{
              width: `${(stepIndex / 6) * 100}%`,
              background: "linear-gradient(90deg, rgba(63,132,243,0.3), var(--color-primary))",
              transition: "width 0.6s ease",
            }}
          />
        </div>
      )}

      <div className="w-full h-full">
        {step === "boot"   && <BootStep onComplete={handleBootComplete} />}
        {step === "name"   && <NameStep onComplete={handleNameComplete} />}
        {step === "gender" && <GenderStep aiName={aiName} onComplete={handleGenderComplete} />}
        {step === "quiz"   && <QuizStep aiName={aiName} onComplete={handleQuizComplete} />}
        {step === "voice" && <VoiceStep aiName={aiName} onComplete={handleVoiceComplete} />}
        {step === "face" && <FaceStep aiName={aiName} onComplete={handleFaceComplete} />}
        {step === "firstcontact" && (
          <FirstContactStep
            aiName={aiName}
            voice={voice}
            faceStyle={faceStyle}
            quizAnswers={quizAnswers}
            onComplete={handleFirstContactComplete}
          />
        )}
      </div>
    </div>
  );
}
