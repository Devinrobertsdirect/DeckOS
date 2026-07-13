import { useState, useEffect, useRef, useCallback } from "react";
import { AIFace } from "@/components/AIFace";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type ColorScheme = "blue" | "green" | "yellow" | "red";
export type VisualMode  = "minimal" | "standard" | "cinematic";

export interface UserConfig {
  color:       ColorScheme;
  aiName:      string;
  systemName:  string; // alias kept for layout compat
  voiceMode:   boolean;
  userName:    string;
  photoDataUrl:  string | null;
  photoComment:  string | null;
  answers:     { q: string; a: string }[];
  visualMode:  VisualMode;
  ollamaUrl:   string;
}

type Phase = "color" | "boot" | "ai_name" | "api_keys" | "voice_mode" | "user_name"
           | "photo" | "questions" | "visual_mode" | "mobile_setup" | "activation";

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────
const STORAGE_KEY = "jarvis.user";
const INIT_KEY    = "jarvis.initialized";

export function getStoredConfig(): UserConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserConfig) : null;
  } catch { return null; }
}

export function isInitialized(): boolean {
  try { return localStorage.getItem(INIT_KEY) === "true"; } catch { return false; }
}

// ─────────────────────────────────────────────
// Color system
// ─────────────────────────────────────────────
const COLOR_LABEL: Record<ColorScheme, string> = {
  blue:   "COBALT",
  green:  "EMERALD",
  yellow: "AMBER",
  red:    "CRIMSON",
};
const COLOR_HEX: Record<ColorScheme, string> = {
  blue:   "#3f84f3",
  green:  "#11d97a",
  yellow: "#ffc820",
  red:    "#f03248",
};
const COLOR_DESC: Record<ColorScheme, string> = {
  blue:   "deep focus",
  green:  "growth & clarity",
  yellow: "energy & focus",
  red:    "decisive authority",
};

export function applyColor(c: ColorScheme) {
  document.documentElement.setAttribute("data-color", c);
  localStorage.setItem("deckos_color", c);
  localStorage.removeItem("deckos_color_hex");
  const root = document.documentElement;
  for (const prop of ["--primary", "--primary-rgb", "--foreground", "--border",
    "--card-foreground", "--card-border", "--popover-foreground", "--popover-border",
    "--muted-foreground", "--accent", "--accent-foreground", "--ring", "--input"]) {
    root.style.removeProperty(prop);
  }
}
export function getStoredColor(): ColorScheme {
  return (localStorage.getItem("deckos_color") as ColorScheme) ?? "blue";
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r1)      h = 60 * (((g1 - b1) / delta) % 6);
    else if (max === g1) h = 60 * ((b1 - r1) / delta + 2);
    else                 h = 60 * ((r1 - g1) / delta + 4);
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

export function applyHexColor(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const H = Math.round(h), S = Math.round(s), L = Math.round(l);
  document.documentElement.removeAttribute("data-color");
  const root = document.documentElement;
  root.style.setProperty("--primary",           `${H} ${S}% ${L}%`);
  root.style.setProperty("--primary-rgb",        `${r}, ${g}, ${b}`);
  root.style.setProperty("--foreground",         `${H} 70% 80%`);
  root.style.setProperty("--border",             `${H} 60% 28%`);
  root.style.setProperty("--card-foreground",    `${H} 70% 80%`);
  root.style.setProperty("--card-border",        `${H} 60% 28%`);
  root.style.setProperty("--popover-foreground", `${H} 70% 80%`);
  root.style.setProperty("--popover-border",     `${H} 60% 28%`);
  root.style.setProperty("--muted-foreground",   `${H} 40% 68%`);
  root.style.setProperty("--accent",             `${H} 80% 18%`);
  root.style.setProperty("--accent-foreground",  `${H} 80% 90%`);
  root.style.setProperty("--ring",               `${H} ${S}% ${L}%`);
  root.style.setProperty("--input",              `${H} 60% 28%`);
  localStorage.setItem("deckos_color_hex", hex);
  localStorage.removeItem("deckos_color");
}

// ─────────────────────────────────────────────
// Typewriter hook
// ─────────────────────────────────────────────
function useTypewriter(text: string, speed = 28, startDelay = 0) {
  const [out, setOut]   = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setOut(""); setDone(false);
    let cancel = false;
    const t = setTimeout(() => {
      let i = 0;
      const iv = setInterval(() => {
        if (cancel) { clearInterval(iv); return; }
        i++;
        setOut(text.slice(0, i));
        if (i >= text.length) { clearInterval(iv); setDone(true); }
      }, speed);
    }, startDelay);
    return () => { cancel = true; clearTimeout(t); };
  }, [text, speed, startDelay]);
  return { out, done };
}

// ─────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────
async function apiTts(text: string): Promise<void> {
  try {
    const res = await fetch("/api/vision/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const { audio, format } = (await res.json()) as { audio: string; format: string };
    const el = new Audio(`data:audio/${format};base64,${audio}`);
    const { attachAmplitudeAnalyser } = await import("@/lib/audioAnalyser");
    attachAmplitudeAnalyser(el);
    await new Promise<void>((resolve) => {
      el.onended = () => resolve();
      el.onerror = () => resolve();
      el.play().catch(() => resolve());
    });
  } catch { /* silent fallback */ }
}

async function apiVision(base64: string, mimeType = "image/jpeg"): Promise<string> {
  const res = await fetch("/api/vision/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, mimeType }),
  });
  if (!res.ok) throw new Error("Vision API error");
  const { response } = (await res.json()) as { response: string };
  return response;
}

async function apiStt(blob: Blob): Promise<string> {
  const b64 = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
  const res = await fetch("/api/vision/stt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: b64 }),
  });
  if (!res.ok) return "";
  const { transcript } = (await res.json()) as { transcript: string };
  return transcript ?? "";
}

// ─────────────────────────────────────────────
// Voice recorder hook
// ─────────────────────────────────────────────
function useVoiceRecorder() {
  const mrRef     = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mrRef.current  = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250);
      setRecording(true);
    } catch { /* permission denied */ }
  }, []);

  const stop = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const mr = mrRef.current;
      if (!mr || mr.state === "inactive") { setRecording(false); resolve(""); return; }
      mr.onstop = async () => {
        setRecording(false);
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType });
          const transcript = await apiStt(blob);
          resolve(transcript);
        } catch { resolve(""); }
        mr.stream.getTracks().forEach((t) => t.stop());
      };
      mr.stop();
    });
  }, []);

  return { recording, start, stop };
}

// ─────────────────────────────────────────────
// TTS hook — tracks speaking state
// ─────────────────────────────────────────────
function useTts() {
  const [speaking, setSpeaking] = useState(false);
  const busy = useRef(false);

  const speak = useCallback(async (text: string) => {
    if (busy.current) return;
    busy.current = true;
    setSpeaking(true);
    try { await apiTts(text); }
    finally { busy.current = false; setSpeaking(false); }
  }, []);

  return { speak, speaking };
}

// ─────────────────────────────────────────────
// HUD shared pieces
// ─────────────────────────────────────────────
function HudCorners() {
  return (
    <>
      <span className="absolute top-4 left-4 w-6 h-6 border-t-2 border-l-2 border-primary/40" />
      <span className="absolute top-4 right-4 w-6 h-6 border-t-2 border-r-2 border-primary/40" />
      <span className="absolute bottom-4 left-4 w-6 h-6 border-b-2 border-l-2 border-primary/40" />
      <span className="absolute bottom-4 right-4 w-6 h-6 border-b-2 border-r-2 border-primary/40" />
    </>
  );
}

function Scanline() {
  return <div className="scanline" />;
}

function ObPanel({ children, className = "", speaking = false }: {
  children: React.ReactNode; className?: string; speaking?: boolean;
}) {
  return (
    <div
      className={`relative border bg-background/80 backdrop-blur-sm p-8 font-mono
        bg-[image:linear-gradient(rgba(var(--primary-rgb),0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(var(--primary-rgb),0.04)_1px,transparent_1px)]
        bg-[size:28px_28px] transition-all duration-300 ${className}`}
      style={{
        borderColor: speaking ? "rgba(var(--primary-rgb),0.55)" : "rgba(var(--primary-rgb),0.2)",
        animation: speaking ? "ob-panel-pulse 1.8s ease-in-out infinite" : "none",
      }}
    >
      {children}
    </div>
  );
}

function SpeakingWave() {
  return (
    <span className="inline-flex items-end gap-px h-3.5 ml-1" aria-hidden>
      {[1, 3, 0, 4, 2, 3, 1].map((d, i) => (
        <span
          key={i}
          className="inline-block w-[2px] bg-primary rounded-full"
          style={{ animation: `speaking-bar 0.55s ${d * 0.07}s ease-in-out infinite alternate` }}
        />
      ))}
    </span>
  );
}

function ObInput({
  value, onChange, placeholder, autoFocus = false, onEnter,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  autoFocus?: boolean; onEnter?: () => void;
}) {
  return (
    <input
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
      placeholder={placeholder}
      className="w-full bg-transparent border-b-2 border-primary/50 focus:border-primary
        text-primary text-2xl font-mono tracking-widest outline-none py-2
        placeholder:text-primary/20 transition-colors duration-300"
    />
  );
}

function ObButton({
  onClick, children, disabled = false, variant = "primary",
}: {
  onClick: () => void; children: React.ReactNode;
  disabled?: boolean; variant?: "primary" | "ghost";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-mono text-sm tracking-widest uppercase px-6 py-3 transition-all duration-300
        disabled:opacity-30 disabled:cursor-not-allowed
        ${variant === "primary"
          ? "border border-primary text-primary hover:bg-primary/10 hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.3)] active:scale-95"
          : "text-primary/40 hover:text-primary/60 underline underline-offset-4"
        }`}
    >
      {children}
    </button>
  );
}

function MicButton({
  recording, onStart, onStop, transcribing,
}: {
  recording: boolean; onStart: () => void; onStop: () => void; transcribing: boolean;
}) {
  return (
    <button
      onClick={recording ? onStop : onStart}
      disabled={transcribing}
      className={`relative w-16 h-16 rounded-full border-2 flex items-center justify-center
        transition-all duration-300 font-mono text-xs
        ${transcribing
          ? "border-primary/30 text-primary/30 cursor-wait"
          : recording
            ? "border-red-400 text-red-400 animate-pulse shadow-[0_0_24px_rgba(240,50,72,0.5)]"
            : "border-primary/60 text-primary hover:border-primary hover:shadow-[0_0_16px_rgba(var(--primary-rgb),0.4)]"
        }`}
    >
      {transcribing ? (
        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="60" strokeDashoffset="15" />
        </svg>
      ) : recording ? (
        <span className="flex items-end gap-[2px] h-5">
          {[2, 4, 1, 3, 5, 2, 4].map((d, i) => (
            <span
              key={i}
              className="inline-block w-[2px] bg-red-400 rounded-full"
              style={{ animation: `rec-wave ${0.3 + (i % 3) * 0.12}s ${d * 0.06}s ease-in-out infinite alternate` }}
            />
          ))}
        </span>
      ) : (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// Phase 0: Color Picker
// ─────────────────────────────────────────────
function ColorPickPhase({ onNext }: { onNext: (c: ColorScheme) => void }) {
  const [selected, setSelected] = useState<ColorScheme>("blue");
  const [visible, setVisible]   = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(t);
  }, []);

  function pick(c: ColorScheme) {
    setSelected(c);
    applyColor(c);
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50">
      <HudCorners />
      <Scanline />
      <div
        className={`flex flex-col items-center gap-12 transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        <div className="text-center space-y-1">
          <div className="text-primary/30 font-mono text-xs tracking-[0.4em] uppercase">
            DeckOS // First Boot
          </div>
          <div className="text-primary font-mono text-xl tracking-[0.3em] uppercase">
            Choose Your System Color
          </div>
        </div>

        <div className="flex gap-8 items-center">
          {(["blue", "green", "yellow", "red"] as ColorScheme[]).map((c) => (
            <button
              key={c}
              onClick={() => pick(c)}
              className="flex flex-col items-center gap-3 group"
            >
              <div
                className={`w-14 h-14 rounded-full border-2 transition-all duration-300
                  ${selected === c
                    ? "scale-110 border-transparent shadow-[0_0_32px_8px_var(--dot-glow)]"
                    : "border-white/20 opacity-50 hover:opacity-80 hover:scale-105"
                  }`}
                style={{
                  backgroundColor: COLOR_HEX[c],
                  // @ts-ignore
                  "--dot-glow": COLOR_HEX[c] + "80",
                }}
              />
              <div className={`font-mono text-xs tracking-widest transition-all duration-300
                ${selected === c ? "text-primary" : "text-primary/30 group-hover:text-primary/50"}`}>
                {COLOR_LABEL[c]}
              </div>
              {selected === c && (
                <div className="font-mono text-[10px] text-primary/50 tracking-wider text-center max-w-[80px]">
                  {COLOR_DESC[c]}
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-4">
          <div
            className="flex items-center justify-center border"
            style={{
              width: 120,
              height: 68,
              borderColor: "rgba(var(--primary-rgb),0.25)",
              background: "rgba(var(--primary-rgb),0.04)",
              boxShadow: "0 0 20px rgba(var(--primary-rgb),0.12)",
              transition: "border-color 0.3s, box-shadow 0.3s",
            }}
          >
            <AIFace
              style="vocoder"
              speaking={true}
              size={110}
              color="var(--color-primary)"
            />
          </div>
          <ObButton onClick={() => onNext(selected)}>
            Confirm — Begin Setup →
          </ObButton>
          <div className="font-mono text-xs text-primary/20">You can change this at any time</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 1: Boot
// ─────────────────────────────────────────────
const BOOT_LINES = [
  { label: "KERNEL.CORE",       delay: 400  },
  { label: "MEMORY.SUBSYSTEM",  delay: 700  },
  { label: "EVENT.BUS",         delay: 1000 },
  { label: "COGNITIVE.STACK",   delay: 1300 },
  { label: "INFERENCE.ENGINE",  delay: 1600 },
  { label: "INITIATIVE.SYSTEM", delay: 1900 },
  { label: "NARRATIVE.LAYER",   delay: 2200 },
  { label: "ALL SYSTEMS NOMINAL.", delay: 2700, special: true },
];

function BootPhase({ aiName, onNext }: { aiName: string; onNext: () => void }) {
  const [lines, setLines] = useState<typeof BOOT_LINES>([]);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    BOOT_LINES.forEach((l, i) => {
      setTimeout(() => setLines((prev) => [...prev, l]), l.delay);
      setTimeout(() => setProgress(((i + 1) / BOOT_LINES.length) * 100), l.delay);
    });
    setTimeout(() => { setDone(true); setTimeout(onNext, 700); }, 3400);
  }, [onNext]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50">
      <HudCorners />
      <Scanline />
      <div className="w-full max-w-xl px-4 space-y-6 animate-[ob-fade-in_0.6s_ease_both]">
        <div className="text-center space-y-1 mb-2">
          <div className="text-primary font-sans text-4xl font-bold tracking-[0.3em] uppercase
            drop-shadow-[0_0_20px_rgba(var(--primary-rgb),0.7)] animate-[ob-glow-in_1s_ease_both]">
            DECK OS
          </div>
          <div className="text-primary/40 font-mono text-xs tracking-widest">{aiName} — FIRST BOOT</div>
        </div>

        <div className="h-1 w-full bg-primary/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 shadow-[0_0_8px_rgba(var(--primary-rgb),0.8)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ObPanel>
          <div className="space-y-1.5 min-h-[180px]">
            {lines.map((l, i) => (
              <div
                key={i}
                className={`flex items-center justify-between animate-[ob-slide-in_0.25s_ease_both]
                  ${l.special ? "text-primary mt-2 font-bold" : "text-primary/70"} font-mono text-sm`}
              >
                <span className="tracking-wider">&gt;&gt; {l.label}</span>
                {!l.special && (
                  <span className="text-green-400 text-xs tracking-widest">[ OK ]</span>
                )}
              </div>
            ))}
            {!done && (
              <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
            )}
          </div>
        </ObPanel>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 2: AI Name
// ─────────────────────────────────────────────
function AiNamePhase({ voiceMode, onNext }: { voiceMode: boolean; onNext: (name: string) => void }) {
  const [name, setName] = useState("JARVIS");
  const prompt = "I am your AI command layer. I manage memory, goals, and context across every device you use.\n\nBefore we go any further — what shall you call me?";
  const { out, done } = useTypewriter(prompt, 22, 200);
  const { speak, speaking } = useTts();

  useEffect(() => {
    if (!voiceMode) return;
    const t = setTimeout(() => speak("I am your AI command layer. Before we go any further — what shall you call me?"), 350);
    return () => clearTimeout(t);
  }, [voiceMode, speak]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className="w-full max-w-xl space-y-8 animate-[ob-fade-in_0.5s_ease_both]">
        <ObPanel speaking={speaking}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 font-mono text-xs text-primary/30 tracking-widest uppercase">
              SYSTEM {speaking && <SpeakingWave />}
            </div>
            <div className="font-mono text-primary/80 text-sm leading-relaxed whitespace-pre-line min-h-[72px]">
              {out}
              {!done && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
            </div>
          </div>
        </ObPanel>

        {done && (
          <div className="space-y-6 animate-[ob-fade-in_0.4s_ease_both]">
            <div className="space-y-2">
              <div className="font-mono text-xs text-primary/30 tracking-widest uppercase">AI Designation</div>
              <ObInput
                value={name}
                onChange={(v) => setName(v.toUpperCase())}
                placeholder="JARVIS"
                autoFocus
                onEnter={() => name.trim() && onNext(name.trim())}
              />
            </div>
            <ObButton onClick={() => name.trim() && onNext(name.trim())} disabled={!name.trim()}>
              Set Designation →
            </ObButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 3: API Keys (ElevenLabs + OpenAI STT)
// ─────────────────────────────────────────────
const EL_PRESET_VOICES = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", desc: "Deep, authoritative" },
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", desc: "Calm, professional" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", desc: "Confident, warm" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", desc: "Friendly, clear" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", desc: "Strong, steady" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", desc: "Expressive, natural" },
];

async function saveConfig(key: string, value: string): Promise<void> {
  await fetch("/api/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
}

// ── ApiKeysPhase ─────────────────────────────────────────────────────────────
// Integration cards config
interface IntegrationDef {
  id: string;
  name: string;
  badge: "RECOMMENDED" | "OPTIONAL";
  badgeColor: string;
  placeholder: string;
  getKeyUrl: string;
  getKeyLabel: string;
  tagline: string;
  description: string; // plain-English accordion body
  extras?: "elevenlabs_voice";
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "ELEVENLABS_API_KEY",
    name: "ElevenLabs",
    badge: "RECOMMENDED",
    badgeColor: "text-[#11d97a] border-[#11d97a]/30 bg-[#11d97a]/5",
    placeholder: "sk_••••••••••••••••",
    getKeyUrl: "https://elevenlabs.io/app/settings/api-keys",
    getKeyLabel: "Free at elevenlabs.io →",
    tagline: "Voice output — gives Ollama's responses a real speaking voice",
    description:
      "Ollama handles the thinking and decides what to say. ElevenLabs does one job: speaks those words out loud in a voice that sounds genuinely human, not robotic. You choose the voice. Without it, responses are text-only. Free accounts include 10,000 characters per month — more than enough for daily use.",
    extras: "elevenlabs_voice",
  },
  {
    id: "OPENAI_API_KEY",
    name: "OpenAI",
    badge: "RECOMMENDED",
    badgeColor: "text-[#11d97a] border-[#11d97a]/30 bg-[#11d97a]/5",
    placeholder: "sk-••••••••••••••••",
    getKeyUrl: "https://platform.openai.com/api-keys",
    getKeyLabel: "Get key at openai.com →",
    tagline: "Voice input + image vision + cloud backup when Ollama is offline",
    description:
      "This key handles three specialist jobs, each separate from Ollama's core thinking. First: voice input — OpenAI Whisper listens to your microphone and converts speech to text so Ollama can understand you. Second: image vision — share a photo and Ollama can see and describe it. Third: cloud fallback — if Ollama goes offline, the system quietly routes to GPT-4 and switches back the moment Ollama returns. Your local Ollama always has priority.",
  },
  {
    id: "ANTHROPIC_API_KEY",
    name: "Anthropic",
    badge: "OPTIONAL",
    badgeColor: "text-[#ffc820] border-[#ffc820]/30 bg-[#ffc820]/5",
    placeholder: "sk-ant-••••••••••••••••",
    getKeyUrl: "https://console.anthropic.com/settings/keys",
    getKeyLabel: "Get key at anthropic.com →",
    tagline: "Claude as a second cloud backup — alternative style to GPT-4",
    description:
      "A second cloud backup alongside OpenAI. Ollama always runs first. If Ollama is offline, the system checks for OpenAI, then Anthropic — each as a fallback in sequence. Claude brings a different reasoning style than GPT-4, so having both means you're never without a brain, even away from home. Neither replaces Ollama — they're bench strength.",
  },
];

function IntegrationCard({
  def,
  aiName,
}: {
  def: IntegrationDef;
  aiName: string;
}) {
  const [value, setValue]         = useState("");
  const [show, setShow]           = useState(false);
  const [open, setOpen]           = useState(false);
  const [voiceId, setVoiceId]     = useState(EL_PRESET_VOICES[0].id);
  const [testing, setTesting]     = useState(false);
  const [testOk, setTestOk]       = useState<boolean | null>(null);
  const [saved, setSaved]         = useState(false);

  const hasValue = value.trim().length > 0;

  async function testVoice() {
    if (!hasValue) return;
    setTesting(true);
    setTestOk(null);
    try {
      await saveConfig("ELEVENLABS_API_KEY", value.trim());
      await saveConfig("ELEVENLABS_VOICE_ID", voiceId);
      await saveConfig("TTS_PROVIDER", "elevenlabs");
      await apiTts(`Hello. I am ${aiName}. Voice connection confirmed.`);
      setTestOk(true);
      setSaved(true);
    } catch {
      setTestOk(false);
    } finally {
      setTesting(false);
    }
  }

  // Expose the current value so the parent can collect it on save
  // (We use a data attribute trick via a hidden input the parent reads)
  return (
    <div className={`border transition-all duration-300 ${hasValue ? "border-primary/40 bg-primary/4" : "border-primary/15 bg-transparent"}`}>
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        {/* Left: name + badge */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-bold text-primary tracking-widest uppercase">
              {def.name}
            </span>
            <span className={`font-mono text-[9px] tracking-widest uppercase border px-1.5 py-0.5 ${def.badgeColor}`}>
              {def.badge}
            </span>
            {saved && (
              <span className="font-mono text-[9px] text-[#11d97a] tracking-widest">✓ SAVED</span>
            )}
          </div>
          <div className="font-mono text-xs text-primary/40 leading-relaxed">{def.tagline}</div>
        </div>
        {/* Right: get-key link */}
        <a
          href={def.getKeyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-primary/35 hover:text-primary/70 underline underline-offset-2 transition-colors shrink-0 mt-0.5"
        >
          {def.getKeyLabel}
        </a>
      </div>

      {/* Key input */}
      <div className="px-4 pb-3">
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => { setValue(e.target.value); setTestOk(null); setSaved(false); }}
            placeholder={def.placeholder}
            data-config-key={def.id}
            data-config-value={value}
            className="w-full bg-transparent border-b border-primary/25 focus:border-primary
              text-primary font-mono text-sm tracking-wider outline-none py-2 pr-8
              placeholder:text-primary/18 transition-colors duration-200"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-0 top-1/2 -translate-y-1/2 text-primary/30 hover:text-primary/60 transition-colors"
          >
            {show ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ElevenLabs extras: voice picker + test */}
      {def.extras === "elevenlabs_voice" && hasValue && (
        <div className="px-4 pb-4 space-y-3 animate-[ob-fade-in_0.3s_ease_both]">
          {/* Hidden input so handleContinue collects the voice ID too */}
          <input type="hidden" data-config-key="ELEVENLABS_VOICE_ID" value={voiceId} readOnly />
          <div className="font-mono text-[10px] text-primary/35 uppercase tracking-widest">Pick a voice</div>
          <div className="grid grid-cols-3 gap-1.5">
            {EL_PRESET_VOICES.map((v) => (
              <button
                key={v.id}
                onClick={() => { setVoiceId(v.id); setTestOk(null); }}
                className={`border px-2.5 py-1.5 text-left transition-all duration-200
                  ${voiceId === v.id
                    ? "border-primary bg-primary/10"
                    : "border-primary/15 hover:border-primary/35"
                  }`}
              >
                <div className={`font-mono text-[11px] font-bold ${voiceId === v.id ? "text-primary" : "text-primary/55"}`}>
                  {v.name}
                </div>
                <div className="font-mono text-[9px] text-primary/30 mt-0.5">{v.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={testVoice}
              disabled={testing}
              className="font-mono text-[10px] tracking-widest uppercase border border-primary/30 px-3 py-1.5
                text-primary/60 hover:border-primary hover:text-primary transition-all disabled:opacity-40 disabled:cursor-wait"
            >
              {testing ? "Testing..." : "▶ Play Test"}
            </button>
            {testOk === true  && <span className="font-mono text-[10px] text-[#11d97a] tracking-wider">VOICE OK</span>}
            {testOk === false && <span className="font-mono text-[10px] text-[#f03248] tracking-wider">CHECK KEY</span>}
          </div>
        </div>
      )}

      {/* Accordion — What does this unlock? */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 border-t border-primary/10
          font-mono text-[10px] text-primary/35 hover:text-primary/60 transition-colors text-left"
      >
        <span className="tracking-widest uppercase">What does this unlock?</span>
        <span className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div className="px-4 pb-4 animate-[ob-fade-in_0.2s_ease_both]">
          <p className="font-mono text-xs text-primary/50 leading-relaxed border-l-2 border-primary/20 pl-3">
            {def.description}
          </p>
        </div>
      )}
    </div>
  );
}

function ApiKeysPhase({ aiName, onNext }: { aiName: string; onNext: () => void }) {
  const [visible, setVisible] = useState(false);
  const [saving, setSaving]   = useState(false);

  useEffect(() => { setTimeout(() => setVisible(true), 300); }, []);

  async function handleContinue() {
    setSaving(true);
    try {
      // Collect all filled keys from the hidden data attributes
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-config-key]");
      const batch: Record<string, string> = {};
      inputs.forEach((el) => {
        const k = el.getAttribute("data-config-key") ?? "";
        const v = el.value.trim();
        if (k && v) batch[k] = v;
      });

      if (Object.keys(batch).length > 0) {
        // If ElevenLabs key is present, also set provider
        if (batch["ELEVENLABS_API_KEY"]) {
          batch["TTS_PROVIDER"] = "elevenlabs";
        }
        await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        });
      }
    } finally {
      setSaving(false);
      onNext();
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6 overflow-y-auto">
      <HudCorners />
      <Scanline />
      <div className={`w-full max-w-xl py-8 space-y-6 transition-all duration-500
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>

        {/* Header */}
        <div className="text-center space-y-2">
          <div className="text-primary/40 font-mono text-xs tracking-[0.4em] uppercase">Setup — Integrations</div>
          <div className="text-primary font-mono text-xl tracking-widest">Connect your tools</div>
          <div className="text-primary/40 font-mono text-xs leading-relaxed max-w-sm mx-auto">
            Ollama is your AI engine — local, private, and always free.
            Each integration below is a specialist that works alongside it.
          </div>
        </div>

        {/* Routing overview */}
        <div className="border border-primary/12 bg-primary/3 p-4 space-y-2.5">
          <div className="font-mono text-[9px] text-primary/30 tracking-[0.35em] uppercase">How they work together</div>
          <div className="space-y-1.5">
            {[
              { role: "THINKS",   who: "Ollama (local)",          always: true  },
              { role: "SPEAKS",   who: "ElevenLabs",              always: false },
              { role: "LISTENS",  who: "OpenAI Whisper",          always: false },
              { role: "SEES",     who: "OpenAI Vision",           always: false },
              { role: "BACKUP",   who: "OpenAI → Anthropic",      always: false },
            ].map(({ role, who, always }) => (
              <div key={role} className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-primary/30 tracking-widest w-14 shrink-0">{role}</span>
                <span className="w-px h-3 bg-primary/15 shrink-0" />
                <span className={`font-mono text-[10px] tracking-wide ${always ? "text-primary font-bold" : "text-primary/50"}`}>
                  {who}
                </span>
                {always && (
                  <span className="font-mono text-[8px] text-primary/30 tracking-widest border border-primary/15 px-1 py-px">ALWAYS ON</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Integration cards */}
        <div className="space-y-3">
          {INTEGRATIONS.map((def) => (
            <IntegrationCard key={def.id} def={def} aiName={aiName} />
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <ObButton onClick={handleContinue} disabled={saving}>
            {saving ? "Saving..." : "Continue →"}
          </ObButton>
          <div className="font-mono text-[10px] text-primary/25 tracking-wider">
            You can add or change these any time in Settings → API Keys
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 4: Voice Mode
// ─────────────────────────────────────────────
function VoiceModePhase({ aiName, onNext }: { aiName: string; onNext: (voice: boolean) => void }) {
  const [visible, setVisible]     = useState(false);
  const [selected, setSelected]   = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { setTimeout(() => setVisible(true), 300); }, []);

  function pick(voice: boolean) {
    setSelected(voice);
  }

  function confirm() {
    if (selected === null) return;
    setConfirming(true);
    // Fire TTS in background — never block the flow waiting for it
    if (selected) {
      apiTts(`Voice mode activated. I'll speak to you out loud, ${aiName} is ready.`).catch(() => {});
    }
    setTimeout(() => onNext(selected), 300);
  }

  const options = [
    {
      voice: true,
      icon: (
        <svg className="w-9 h-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ),
      title: "VOICE",
      tag: "RECOMMENDED",
      bullets: [
        `Speak to ${aiName} — it speaks back`,
        "Microphone button stays visible",
        "Responses read aloud by default",
      ],
    },
    {
      voice: false,
      icon: (
        <svg className="w-9 h-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M8 9h8M8 13h4" />
        </svg>
      ),
      title: "TEXT",
      tag: null,
      bullets: [
        "Type commands and questions",
        "Everything stays silent",
        "Voice still available on demand",
      ],
    },
  ];

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className={`w-full max-w-xl space-y-6 transition-all duration-500
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>

        <div className="text-center space-y-2">
          <div className="text-primary/40 font-mono text-xs tracking-[0.4em] uppercase">Interaction Protocol</div>
          <div className="text-primary font-mono text-xl tracking-widest">
            What's your primary way to talk to me?
          </div>
          <div className="text-primary/35 font-mono text-xs tracking-wider">
            You can change this any time in Settings
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {options.map(({ voice, icon, title, tag, bullets }) => {
            const isSelected = selected === voice;
            return (
              <button
                key={title}
                onClick={() => pick(voice)}
                className={`group relative border p-6 text-left flex flex-col gap-4
                  transition-all duration-300 active:scale-[0.98]
                  ${isSelected
                    ? "border-primary bg-primary/8 shadow-[0_0_28px_rgba(var(--primary-rgb),0.2)]"
                    : "border-primary/20 hover:border-primary/50 hover:bg-primary/4"
                  }`}
              >
                {tag && (
                  <div className={`absolute top-2 right-2 font-mono text-[9px] tracking-widest
                    ${isSelected ? "text-primary" : "text-primary/40"}`}>
                    {tag}
                  </div>
                )}
                {isSelected && (
                  <div className="absolute top-2 left-2 w-2 h-2 rounded-full bg-primary animate-pulse" />
                )}
                <div className={`transition-colors duration-200 ${isSelected ? "text-primary" : "text-primary/60 group-hover:text-primary/80"}`}>
                  {icon}
                </div>
                <div className="space-y-2">
                  <div className={`font-mono text-sm font-bold tracking-widest transition-colors
                    ${isSelected ? "text-primary" : "text-primary/70"}`}>
                    {title}
                  </div>
                  <ul className="space-y-1">
                    {bullets.map((b, i) => (
                      <li key={i} className={`font-mono text-xs leading-relaxed flex items-start gap-1.5
                        ${isSelected ? "text-primary/70" : "text-primary/40"}`}>
                        <span className="mt-px opacity-50">—</span>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col items-center gap-2">
          <ObButton
            onClick={confirm}
            disabled={selected === null || confirming}
          >
            {confirming
              ? "Configuring..."
              : selected === null
                ? "Select an option above"
                : `Confirm — ${selected ? "Voice" : "Text"} Mode →`}
          </ObButton>
          {selected === null && (
            <div className="font-mono text-xs text-primary/20">Choose one to continue</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 4: User Name
// ─────────────────────────────────────────────
function UserNamePhase({
  voiceMode, aiName, onNext,
}: { voiceMode: boolean; aiName: string; onNext: (name: string) => void }) {
  const [name, setName]             = useState("");
  const { recording, start, stop }  = useVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const question = `What shall I call you, Commander?`;
  const { out, done } = useTypewriter(question, 28, 300);
  const { speak, speaking } = useTts();

  useEffect(() => {
    if (!voiceMode) return;
    const t = setTimeout(() => speak(question), 350);
    return () => clearTimeout(t);
  }, [voiceMode, speak, question]);

  async function handleVoice() {
    if (recording) {
      setTranscribing(true);
      const t = await stop();
      setTranscribing(false);
      if (t) setName(t.trim());
    } else {
      await start();
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className="w-full max-w-xl space-y-8 animate-[ob-fade-in_0.5s_ease_both]">
        <ObPanel speaking={speaking}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono text-xs text-primary/30 tracking-widest uppercase">
              {aiName} {speaking && <SpeakingWave />}
            </div>
            <div className="font-mono text-primary/80 text-sm leading-relaxed min-h-[24px]">
              {out}
              {!done && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
            </div>
          </div>
        </ObPanel>

        {done && (
          <div className="space-y-6 animate-[ob-fade-in_0.4s_ease_both]">
            <div className="space-y-2">
              <div className="font-mono text-xs text-primary/30 tracking-widest uppercase">Your Name or Callsign</div>
              <div className="flex items-end gap-4">
                <ObInput
                  value={name}
                  onChange={setName}
                  placeholder="Commander"
                  autoFocus={!voiceMode}
                  onEnter={() => name.trim() && onNext(name.trim())}
                />
                {voiceMode && (
                  <MicButton
                    recording={recording}
                    onStart={handleVoice}
                    onStop={handleVoice}
                    transcribing={transcribing}
                  />
                )}
              </div>
            </div>
            <ObButton onClick={() => name.trim() && onNext(name.trim())} disabled={!name.trim()}>
              Confirm →
            </ObButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 5: Photo
// ─────────────────────────────────────────────
function PhotoPhase({
  voiceMode, aiName, userName, onNext,
}: {
  voiceMode: boolean; aiName: string; userName: string;
  onNext: (photo: string | null, comment: string | null) => void;
}) {
  const [mode, setMode]             = useState<"choose" | "camera" | "preview">("choose");
  const [photoDataUrl, setPhoto]    = useState<string | null>(null);
  const [comment, setComment]       = useState<string | null>(null);
  const [analyzing, setAnalyzing]   = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { out, done } = useTypewriter(`Let me see you, ${userName}. Share a photo — I'll keep it between us.`, 24, 300);
  const { speak, speaking } = useTts();

  useEffect(() => {
    if (!voiceMode) return;
    const t = setTimeout(() => speak(`Let me see you, ${userName}. Share a photo and I'll tell you what I see.`), 350);
    return () => clearTimeout(t);
  }, [voiceMode, speak, userName]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
      setMode("camera");
    } catch { alert("Camera not available."); }
  }

  async function capture() {
    const video  = videoRef.current!;
    const canvas = canvasRef.current!;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    await analyzeImage(dataUrl, "image/jpeg");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const mime = file.type || "image/jpeg";
      await analyzeImage(dataUrl, mime);
    };
    reader.readAsDataURL(file);
  }

  async function analyzeImage(dataUrl: string, mime: string) {
    setPhoto(dataUrl);
    setMode("preview");
    setAnalyzing(true);
    try {
      const base64 = dataUrl.split(",")[1];
      const result = await apiVision(base64, mime);
      setComment(result);
      if (voiceMode) apiTts(result);
    } catch {
      setComment("I see you. Welcome, Commander.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <canvas ref={canvasRef} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      <div className="w-full max-w-xl space-y-6 animate-[ob-fade-in_0.5s_ease_both]">
        {mode === "choose" && (
          <>
            <ObPanel speaking={speaking}>
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-mono text-xs text-primary/30 tracking-widest uppercase">
                  {aiName} {speaking && <SpeakingWave />}
                </div>
                <div className="font-mono text-primary/80 text-sm leading-relaxed min-h-[24px]">
                  {out}
                  {!done && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
                </div>
              </div>
            </ObPanel>
            {done && (
              <div className="space-y-4 animate-[ob-fade-in_0.4s_ease_both]">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={startCamera}
                    className="group border border-primary/20 p-5 flex flex-col items-center gap-3
                      hover:border-primary/60 hover:bg-primary/5 transition-all duration-300"
                  >
                    <svg className="w-7 h-7 text-primary/60 group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <div className="font-mono text-xs text-primary/60 group-hover:text-primary tracking-widest">CAMERA</div>
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="group border border-primary/20 p-5 flex flex-col items-center gap-3
                      hover:border-primary/60 hover:bg-primary/5 transition-all duration-300"
                  >
                    <svg className="w-7 h-7 text-primary/60 group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <div className="font-mono text-xs text-primary/60 group-hover:text-primary tracking-widest">UPLOAD</div>
                  </button>
                </div>
                <div className="text-center">
                  <ObButton variant="ghost" onClick={() => onNext(null, null)}>
                    Skip for now
                  </ObButton>
                </div>
              </div>
            )}
          </>
        )}

        {mode === "camera" && (
          <div className="space-y-4 animate-[ob-fade-in_0.3s_ease_both]">
            <div className="font-mono text-xs text-primary/40 tracking-widest text-center">CAMERA FEED ACTIVE</div>
            <div className="relative border border-primary/30 overflow-hidden">
              <video ref={videoRef} className="w-full" playsInline muted />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/80">
                  <div className="font-mono text-primary/50 text-xs tracking-widest animate-pulse">INITIALIZING CAMERA...</div>
                </div>
              )}
            </div>
            <div className="flex justify-center gap-4">
              <ObButton onClick={capture} disabled={!cameraReady}>Capture →</ObButton>
              <ObButton variant="ghost" onClick={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); setMode("choose"); }}>
                Cancel
              </ObButton>
            </div>
          </div>
        )}

        {mode === "preview" && (
          <div className="space-y-6 animate-[ob-fade-in_0.4s_ease_both]">
            <div className="flex gap-6 items-start">
              {photoDataUrl && (
                <div className="relative flex-shrink-0">
                  <img
                    src={photoDataUrl}
                    alt="Your photo"
                    className="w-32 h-32 object-cover border border-primary/30"
                  />
                  <div className="absolute inset-0 border border-primary/20 pointer-events-none" />
                </div>
              )}
              <ObPanel className="flex-1">
                {analyzing ? (
                  <div className="flex items-center gap-3 font-mono text-primary/60 text-sm">
                    <svg className="animate-spin w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="60" strokeDashoffset="15" />
                    </svg>
                    ANALYZING...
                  </div>
                ) : (
                  <TypewriterText text={comment ?? ""} aiName={aiName} />
                )}
              </ObPanel>
            </div>
            {!analyzing && (
              <div className="flex gap-4 animate-[ob-fade-in_0.3s_ease_both]">
                <ObButton onClick={() => onNext(photoDataUrl, comment)}>
                  Continue →
                </ObButton>
                <ObButton variant="ghost" onClick={() => { setPhoto(null); setComment(null); setMode("choose"); }}>
                  Retake
                </ObButton>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TypewriterText({ text, aiName }: { text: string; aiName: string }) {
  const { out, done } = useTypewriter(text, 18, 200);
  return (
    <div className="font-mono text-primary/80 text-sm leading-relaxed min-h-[48px]">
      <span className="text-primary/40">{aiName}: </span>
      {out}
      {!done && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 6: Questions
// ─────────────────────────────────────────────
const QUESTIONS = [
  "What are you working on right now? Tell me what has your attention.",
  "How do you prefer to work — do you need structure and plans, or do you flow freely?",
  "What's one thing you'd want me to always remember about you?",
];

function QuestionsPhase({
  voiceMode, aiName, userName, onNext,
}: {
  voiceMode: boolean; aiName: string; userName: string;
  onNext: (answers: { q: string; a: string }[]) => void;
}) {
  const [idx, setIdx]       = useState(0);
  const [answers, setAnswers] = useState<{ q: string; a: string }[]>([]);
  const [current, setCurrent] = useState("");
  const { recording, start, stop } = useVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const q = QUESTIONS[idx];
  const { out, done } = useTypewriter(q ?? "", 24, 300);
  const { speak, speaking } = useTts();

  useEffect(() => { setCurrent(""); }, [idx]);

  useEffect(() => {
    if (!voiceMode) return;
    const t = setTimeout(() => speak(q ?? ""), 350);
    return () => clearTimeout(t);
  }, [idx, voiceMode, speak, q]);

  async function handleVoice() {
    if (recording) {
      setTranscribing(true);
      const t = await stop();
      setTranscribing(false);
      if (t) setCurrent(t.trim());
    } else {
      await start();
    }
  }

  function advance() {
    if (!current.trim()) return;
    const updated = [...answers, { q: q!, a: current.trim() }];
    setAnswers(updated);
    if (idx + 1 < QUESTIONS.length) {
      setIdx((i) => i + 1);
    } else {
      onNext(updated);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className="w-full max-w-xl space-y-6 animate-[ob-fade-in_0.5s_ease_both]">
        <div className="flex gap-1">
          {QUESTIONS.map((_, i) => (
            <div key={i} className={`flex-1 h-0.5 transition-colors duration-500
              ${i <= idx ? "bg-primary" : "bg-primary/15"}`} />
          ))}
        </div>
        <div className="font-mono text-xs text-primary/30 tracking-widest">
          {userName}, {idx + 1} / {QUESTIONS.length}
        </div>

        <ObPanel speaking={speaking}>
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono text-xs text-primary/30 tracking-widest uppercase">
              {aiName} {speaking && <SpeakingWave />}
            </div>
            <div className="font-mono text-primary/80 text-sm leading-relaxed min-h-[48px]">
              {out}
              {!done && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />}
            </div>
          </div>
        </ObPanel>

        {done && (
          <div className="space-y-4 animate-[ob-fade-in_0.4s_ease_both]">
            <div className="flex items-end gap-4">
              <textarea
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="Your answer..."
                rows={3}
                autoFocus={!voiceMode}
                className="flex-1 bg-transparent border border-primary/30 focus:border-primary/70
                  text-primary font-mono text-sm p-3 outline-none resize-none
                  placeholder:text-primary/20 transition-colors duration-300"
              />
              {voiceMode && (
                <MicButton
                  recording={recording}
                  onStart={handleVoice}
                  onStop={handleVoice}
                  transcribing={transcribing}
                />
              )}
            </div>
            <ObButton onClick={advance} disabled={!current.trim()}>
              {idx + 1 < QUESTIONS.length ? "Next →" : "Done →"}
            </ObButton>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 7: Visual Mode
// ─────────────────────────────────────────────
const VISUAL_MODES: { id: VisualMode; label: string; desc: string; features: string[] }[] = [
  { id: "minimal",   label: "MINIMAL",   desc: "Clean signal",   features: ["No grid", "No scanline", "Pure interface"] },
  { id: "standard",  label: "STANDARD",  desc: "Balanced",       features: ["Subtle grid", "Light glow", "Recommended"] },
  { id: "cinematic", label: "CINEMATIC", desc: "Full immersion",  features: ["Dense grid", "Scanline", "Ambient glow"] },
];

function VisualModePhase({ onNext }: { onNext: (m: VisualMode) => void }) {
  const [selected, setSelected] = useState<VisualMode>("standard");
  const [visible, setVisible]   = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 300); }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className={`w-full max-w-xl space-y-8 transition-all duration-500
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
        <div className="text-center space-y-2">
          <div className="text-primary/40 font-mono text-xs tracking-[0.4em] uppercase">Display Protocol</div>
          <div className="text-primary font-mono text-xl tracking-widest">Choose your visual mode</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {VISUAL_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelected(m.id)}
              className={`relative border p-4 text-left flex flex-col gap-3 transition-all duration-300
                ${selected === m.id
                  ? "border-primary shadow-[0_0_20px_rgba(var(--primary-rgb),0.2)] bg-primary/5"
                  : "border-primary/20 hover:border-primary/40"
                }`}
            >
              {selected === m.id && (
                <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_rgba(var(--primary-rgb),0.8)]" />
              )}
              <div className="font-mono text-xs font-bold tracking-widest text-primary">{m.label}</div>
              <div className="font-mono text-[10px] text-primary/40">{m.desc}</div>
              <div className="space-y-1">
                {m.features.map((f) => (
                  <div key={f} className="font-mono text-[10px] text-primary/50 flex items-center gap-1">
                    <span className="text-primary/30">–</span> {f}
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
        <ObButton onClick={() => onNext(selected)}>Confirm →</ObButton>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 8: Mobile Setup
// ─────────────────────────────────────────────
function MobileSetupPhase({ aiName, onNext }: { aiName: string; onNext: () => void }) {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [mobileUrl, setMobileUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 300);
    fetch(`${window.location.origin}/api/pairing/code`)
      .then((r) => r.json())
      .then(({ code, mobileUrl: url }: { code: string; mobileUrl: string }) => {
        setPairingCode(code);
        setMobileUrl(url);
      })
      .catch(() => {});
    return () => clearTimeout(t);
  }, []);

  function copyCode() {
    if (!pairingCode) return;
    void navigator.clipboard.writeText(pairingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className={`w-full max-w-xl space-y-8 transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
        <div className="text-center space-y-2">
          <div className="text-primary/40 font-mono text-xs tracking-[0.4em] uppercase">Optional — Mobile Companion</div>
          <div className="text-primary font-mono text-xl tracking-widest">Connect Your Phone</div>
        </div>

        <ObPanel>
          <div className="space-y-5">
            <div className="font-mono text-primary/70 text-sm leading-relaxed">
              {aiName} runs on your phone too. Open the mobile URL on your device and enter the pairing code — your phone will stay linked to this desktop instance.
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="font-mono text-[10px] text-primary/30 uppercase tracking-widest mb-2">Pairing Code</div>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-mono font-bold text-primary tracking-[0.25em]">
                    {pairingCode ?? "• • • •"}
                  </span>
                  {pairingCode && (
                    <button
                      onClick={copyCode}
                      className="font-mono text-[10px] border border-primary/30 px-2 py-1 text-primary/50 hover:text-primary hover:border-primary/60 transition-colors"
                    >
                      {copied ? "COPIED" : "COPY"}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="font-mono text-[10px] text-primary/30 uppercase tracking-widest mb-2">How to Connect</div>
                <ol className="font-mono text-[10px] text-primary/50 space-y-1 leading-relaxed list-none">
                  <li><span className="text-primary/30">1.</span> Open the mobile URL on your phone</li>
                  <li><span className="text-primary/30">2.</span> Enter the pairing code above</li>
                  <li><span className="text-primary/30">3.</span> That's it — you're linked</li>
                </ol>
              </div>
            </div>

            {mobileUrl && (
              <div>
                <div className="font-mono text-[10px] text-primary/30 uppercase tracking-widest mb-1">Mobile URL</div>
                <div className="font-mono text-xs text-primary/50 break-all border border-primary/10 px-3 py-2 bg-primary/5">
                  {mobileUrl}
                </div>
              </div>
            )}

            <div className="font-mono text-[10px] text-primary/25 leading-relaxed">
              You can also find the pairing code later in Settings → Mobile Access. The code is unique to this machine.
            </div>
          </div>
        </ObPanel>

        <div className="flex gap-4">
          <ObButton onClick={onNext}>Continue →</ObButton>
          <ObButton onClick={onNext} variant="ghost">Skip for now</ObButton>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Phase 9: Activation ceremony
// ─────────────────────────────────────────────
function ActivationPhase({
  config, onComplete,
}: { config: Partial<AccumulatedConfig>; onComplete: () => void }) {
  const [lines, setLines]     = useState<string[]>([]);
  const [ready, setReady]     = useState(false);
  const [activating, setAct]  = useState(false);

  const ceremony = [
    `COMMANDER .............. ${config.userName?.toUpperCase()}`,
    `AI DESIGNATION ......... ${config.aiName?.toUpperCase()}`,
    `SYSTEM COLOR ........... ${COLOR_LABEL[config.color ?? "blue"]}`,
    `INTERACTION MODE ....... ${config.voiceMode ? "VOICE" : "TEXT"}`,
    `DISPLAY MODE ........... ${config.visualMode?.toUpperCase()}`,
    `COGNITIVE STACK ........ ACTIVE`,
    `INITIATIVE SYSTEM ...... ACTIVE`,
    `NARRATIVE ENGINE ....... ACTIVE`,
    config.photoComment ? `VISUAL PROFILE ......... CAPTURED` : null,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `ALL SYSTEMS NOMINAL.`,
    `WELCOME, ${config.userName?.toUpperCase()}.`,
  ].filter(Boolean) as string[];

  useEffect(() => {
    ceremony.forEach((l, i) => {
      setTimeout(() => setLines((prev) => [...prev, l]), i * 200);
    });
    setTimeout(() => setReady(true), ceremony.length * 200 + 400);
    if (config.voiceMode) {
      setTimeout(() => {
        apiTts(`Welcome, ${config.userName}. I am ${config.aiName}, and I am ready. Let's build something remarkable together.`);
      }, ceremony.length * 200);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function initialize() {
    setAct(true);
    const cfg: UserConfig = {
      color:        config.color       ?? "blue",
      aiName:       config.aiName      ?? "JARVIS",
      systemName:   config.aiName      ?? "JARVIS",
      voiceMode:    config.voiceMode   ?? false,
      userName:     config.userName    ?? "Commander",
      photoDataUrl: config.photoDataUrl ?? null,
      photoComment: config.photoComment ?? null,
      answers:      config.answers     ?? [],
      visualMode:   config.visualMode  ?? "standard",
      ollamaUrl:    "",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    localStorage.setItem(INIT_KEY, "true");
    localStorage.setItem("deckos_visual_mode", cfg.visualMode);
    document.documentElement.setAttribute("data-visual-mode", cfg.visualMode);

    // Sync identity to server so every channel knows the user's name, AI name, and goals
    fetch(`${window.location.origin}/api/ucm/identity`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          aiName:       cfg.aiName,
          userName:     cfg.userName,
          answers:      cfg.answers,
          photoComment: cfg.photoComment ?? null,
        },
        merge: false,
      }),
    }).catch(() => {});

    setTimeout(onComplete, 800);
  }

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background z-50 p-6">
      <HudCorners />
      <Scanline />
      <div className="w-full max-w-xl space-y-6 animate-[ob-fade-in_0.5s_ease_both]">
        <div className="text-center">
          <div className="text-primary font-mono text-xs tracking-[0.4em] uppercase mb-1">System Activation</div>
        </div>
        <ObPanel>
          <div className="font-mono text-xs leading-relaxed space-y-1 min-h-[180px]">
            {lines.map((l, i) => (
              <div
                key={i}
                className={`animate-[ob-slide-in_0.2s_ease_both] transition-colors
                  ${l.startsWith("WELCOME") ? "text-primary font-bold text-sm mt-2" :
                    l.startsWith("━") ? "text-primary/20 my-1" :
                    l.startsWith("ALL") ? "text-primary mt-1" : "text-primary/60"
                  }`}
              >
                {l}
              </div>
            ))}
            {!ready && lines.length > 0 && (
              <span className="inline-block w-2 h-3 bg-primary animate-pulse" />
            )}
          </div>
        </ObPanel>
        {ready && (
          <div className="flex flex-col items-center gap-3 animate-[ob-fade-in_0.5s_ease_both]">
            <button
              onClick={initialize}
              disabled={activating}
              className="border border-primary text-primary font-mono text-sm tracking-widest
                uppercase px-8 py-4 hover:bg-primary/10 transition-all duration-300
                disabled:opacity-50 animate-[ob-btn-pulse_2s_ease-in-out_infinite]
                shadow-[0_0_24px_rgba(var(--primary-rgb),0.2)] hover:shadow-[0_0_40px_rgba(var(--primary-rgb),0.4)]"
            >
              {activating ? "INITIALIZING..." : "INITIALIZE COMMAND CENTER"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Accumulated config type
// ─────────────────────────────────────────────
interface AccumulatedConfig {
  color:        ColorScheme;
  aiName:       string;
  voiceMode:    boolean;
  userName:     string;
  photoDataUrl: string | null;
  photoComment: string | null;
  answers:      { q: string; a: string }[];
  visualMode:   VisualMode;
}

// ─────────────────────────────────────────────
// Main Onboarding orchestrator
// ─────────────────────────────────────────────
export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase]   = useState<Phase>("color");
  const [flashing, setFlash] = useState(false);
  const [cfg, setCfg]       = useState<Partial<AccumulatedConfig>>({
    color: getStoredColor(),
    aiName: "JARVIS",
    voiceMode: false,
    userName: "",
    photoDataUrl: null,
    photoComment: null,
    answers: [],
    visualMode: "standard",
  });

  function advance(next: Phase, patch?: Partial<AccumulatedConfig>) {
    setFlash(true);
    if (patch) setCfg((prev) => ({ ...prev, ...patch }));
    setTimeout(() => { setPhase(next); setFlash(false); }, 350);
  }

  const overlay = (
    <div
      className={`fixed inset-0 bg-background z-[200] pointer-events-none transition-opacity duration-300
        ${flashing ? "opacity-100" : "opacity-0"}`}
    />
  );

  return (
    <>
      {overlay}
      {phase === "color" && (
        <ColorPickPhase onNext={(c) => { applyColor(c); advance("boot", { color: c }); }} />
      )}
      {phase === "boot" && (
        <BootPhase aiName={cfg.aiName ?? "JARVIS"} onNext={() => advance("ai_name")} />
      )}
      {phase === "ai_name" && (
        <AiNamePhase voiceMode={cfg.voiceMode ?? false} onNext={(n) => advance("api_keys", { aiName: n })} />
      )}
      {phase === "api_keys" && (
        <ApiKeysPhase aiName={cfg.aiName ?? "JARVIS"} onNext={() => advance("voice_mode")} />
      )}
      {phase === "voice_mode" && (
        <VoiceModePhase aiName={cfg.aiName ?? "JARVIS"} onNext={(v) => advance("user_name", { voiceMode: v })} />
      )}
      {phase === "user_name" && (
        <UserNamePhase
          voiceMode={cfg.voiceMode ?? false}
          aiName={cfg.aiName ?? "JARVIS"}
          onNext={(n) => advance("photo", { userName: n })}
        />
      )}
      {phase === "photo" && (
        <PhotoPhase
          voiceMode={cfg.voiceMode ?? false}
          aiName={cfg.aiName ?? "JARVIS"}
          userName={cfg.userName ?? "Commander"}
          onNext={(p, c) => advance("questions", { photoDataUrl: p, photoComment: c })}
        />
      )}
      {phase === "questions" && (
        <QuestionsPhase
          voiceMode={cfg.voiceMode ?? false}
          aiName={cfg.aiName ?? "JARVIS"}
          userName={cfg.userName ?? "Commander"}
          onNext={(a) => advance("visual_mode", { answers: a })}
        />
      )}
      {phase === "visual_mode" && (
        <VisualModePhase onNext={(m) => advance("mobile_setup", { visualMode: m })} />
      )}
      {phase === "mobile_setup" && (
        <MobileSetupPhase aiName={cfg.aiName ?? "JARVIS"} onNext={() => advance("activation")} />
      )}
      {phase === "activation" && (
        <ActivationPhase config={cfg} onComplete={onComplete} />
      )}
    </>
  );
}
