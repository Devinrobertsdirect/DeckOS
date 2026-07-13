import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWsEvents } from "@/contexts/WebSocketContext";
import {
  Bot, Mic2, Palette, Brain, MessageSquare, User2,
  ChevronRight, Check, Volume2, RefreshCw, Sparkles, SlidersHorizontal,
  Play, Square, Wand2, MonitorPlay, Loader2,
} from "lucide-react";
import { HudCorners } from "@/components/HudCorners";
import { AIFace, saveFaceStyle, useFaceStyle } from "@/components/AIFace";
import {
  FACE_OPTIONS, QUIZ_QUESTIONS, VOICE_OPTIONS, VOICE_KEY, AI_NAME_KEY,
} from "@/components/CinematicOnboarding";
import { getStoredConfig, applyColor, applyHexColor, type ColorScheme } from "@/components/Onboarding";
import { AI_NAME_UPDATED_EVENT } from "@/hooks/useAiName";
import { USER_NAME_UPDATED_EVENT } from "@/hooks/useUserName";
import type { FaceStyle } from "@/components/AIFace";

// ── Types ──────────────────────────────────────────────────────────────────

interface AiPersona {
  id:                   number;
  aiName:               string;
  gender:               string;
  voice:                string;
  attitude:             string;
  thinkingDepth:        string;
  responseLength:       string;
  textColor:            string;
  gravityLevel:         number;
  snarkinessLevel:      number;
  flirtatiousnessLevel: number;
  updatedAt:            string;
}

// ── Shared event name for cross-tab voice sync ────────────────────────────

export const VOICE_CHANGED_EVENT = "deckos:voiceChanged";

// ── Constants ──────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { label: "COBALT",   value: "#3f84f3" },
  { label: "CYAN",     value: "#00d4ff" },
  { label: "EMERALD",  value: "#11d97a" },
  { label: "AMBER",    value: "#ffc820" },
  { label: "CRIMSON",  value: "#f03248" },
  { label: "VIOLET",   value: "#a855f7" },
  { label: "ROSE",     value: "#f472b6" },
  { label: "WHITE",    value: "#e2e8f0" },
];

const HEX_TO_SCHEME: Record<string, ColorScheme> = {
  "#3f84f3": "blue",
  "#11d97a": "green",
  "#ffc820": "yellow",
  "#f03248": "red",
};

const GENDERS = [
  { value: "neutral",   label: "Neutral",     desc: "No gender pronoun preference" },
  { value: "male",      label: "Male",        desc: "Uses he/him pronouns" },
  { value: "female",    label: "Female",      desc: "Uses she/her pronouns" },
  { value: "nonbinary", label: "Non-binary",  desc: "Uses they/them pronouns" },
];

const VOICES = [
  { value: "alloy",   label: "ALLOY",   desc: "Neutral, balanced",        sample: "Clear and composed" },
  { value: "echo",    label: "ECHO",    desc: "Male, smooth",              sample: "Resonant and steady" },
  { value: "fable",   label: "FABLE",   desc: "Neutral, storytelling",    sample: "Expressive and warm" },
  { value: "onyx",    label: "ONYX",    desc: "Deep male, authoritative", sample: "Rich and commanding" },
  { value: "nova",    label: "NOVA",    desc: "Female, energetic",         sample: "Bright and confident" },
  { value: "shimmer", label: "SHIMMER", desc: "Soft female, gentle",       sample: "Smooth and calming" },
];

const PERSONA_VALID_VOICES = new Set(VOICES.map((v) => v.value));

const ATTITUDES = [
  { value: "professional", label: "PROFESSIONAL", desc: "Calm, precise, authoritative",    emoji: "🎯" },
  { value: "casual",       label: "CASUAL",        desc: "Relaxed, friendly companion",     emoji: "😊" },
  { value: "witty",        label: "WITTY",         desc: "Clever, sarcastic, quick",        emoji: "⚡" },
  { value: "serious",      label: "SERIOUS",       desc: "Direct, no-nonsense, focused",    emoji: "🔒" },
  { value: "empathetic",   label: "EMPATHETIC",    desc: "Warm, supportive, in tune",       emoji: "💙" },
  { value: "commanding",   label: "COMMANDING",    desc: "Bold, takes charge, decisive",    emoji: "⚔️" },
  { value: "gentle",       label: "GENTLE",        desc: "Patient, kind, encouraging",      emoji: "🌿" },
  { value: "playful",      label: "PLAYFUL",       desc: "Fun, enthusiastic, light",        emoji: "🎮" },
];

const THINKING_DEPTHS = [
  { value: "quick",    label: "QUICK",    desc: "Fires immediately, no preamble" },
  { value: "standard", label: "STANDARD", desc: "Thinks before answering" },
  { value: "detailed", label: "DETAILED", desc: "Shows step-by-step reasoning" },
];

const RESPONSE_LENGTHS = [
  { value: "brief",         label: "BRIEF",         desc: "1–2 sentences, punchy" },
  { value: "balanced",      label: "BALANCED",       desc: "2–4 sentences, clear" },
  { value: "thorough",      label: "THOROUGH",       desc: "Full explanation with context" },
  { value: "comprehensive", label: "COMPREHENSIVE",  desc: "Deep breakdown, all details" },
];

// ── Dial descriptions ──────────────────────────────────────────────────────

function gravityLabel(v: number): string {
  if (v <= 15) return "Delightfully Unserious";
  if (v <= 35) return "Fun & Light";
  if (v <= 65) return "Balanced";
  if (v <= 85) return "Focused & Serious";
  return "Gravely Serious";
}

function snarkinessLabel(v: number): string {
  if (v <= 15) return "Completely Sincere";
  if (v <= 35) return "Lightly Dry";
  if (v <= 60) return "Sharp Wit";
  if (v <= 80) return "Notably Snarky";
  return "Maximum Snark";
}

function flirtLabel(v: number): string {
  if (v <= 15) return "Clinical / Neutral";
  if (v <= 35) return "Warm & Personable";
  if (v <= 60) return "Playfully Charming";
  if (v <= 80) return "Openly Flirtatious";
  return "Unapologetically Flirty";
}

// ── Reusable section header ────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-primary/50" />
      <div>
        <div className="text-primary/60 font-mono text-[10px] uppercase tracking-widest">{title}</div>
        {sub && <div className="text-primary/30 font-mono text-[9px]">{sub}</div>}
      </div>
    </div>
  );
}

// ── Personality dial (slider) ──────────────────────────────────────────────

interface DialProps {
  label: string;
  lowLabel: string;
  highLabel: string;
  value: number;
  onChange: (v: number) => void;
  displayLabel: (v: number) => string;
  color?: string;
}

function PersonalityDial({ label, lowLabel, highLabel, value, onChange, displayLabel, color = "#3f84f3" }: DialProps) {
  const pct = value / 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] text-primary/60 uppercase tracking-widest">{label}</div>
        <div className="font-mono text-[10px] font-bold" style={{ color }}>{displayLabel(value)}</div>
      </div>
      <div className="relative h-2 bg-primary/10 rounded-full">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{ width: `${pct * 100}%`, background: `linear-gradient(90deg, ${color}55, ${color})` }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 transition-all pointer-events-none"
          style={{ left: `calc(${pct * 100}% - 6px)`, borderColor: color, backgroundColor: "hsl(var(--card))" }}
        />
      </div>
      <div className="flex justify-between">
        <span className="font-mono text-[9px] text-primary/25">{lowLabel}</span>
        <span className="font-mono text-[9px] text-primary/25">{highLabel}</span>
      </div>
    </div>
  );
}

// ── Preview panel ──────────────────────────────────────────────────────────

function PersonaPreview({ persona }: { persona: Partial<AiPersona> }) {
  const attitude = ATTITUDES.find(a => a.value === persona.attitude)?.desc ?? "…";
  const depth    = THINKING_DEPTHS.find(d => d.value === persona.thinkingDepth)?.desc ?? "…";
  const length   = RESPONSE_LENGTHS.find(l => l.value === persona.responseLength)?.desc ?? "…";
  const openAiVoice = VOICES.find(v => v.value === persona.voice);
  const voice = openAiVoice
    ? openAiVoice.desc
    : persona.voice?.startsWith("local-")
      ? "Local offline voice"
      : persona.voice
        ? `ElevenLabs: ${persona.voice.slice(0, 16)}…`
        : "…";
  const name     = persona.aiName || "JARVIS";
  const color    = persona.textColor || "#00d4ff";

  const gravity    = persona.gravityLevel        ?? 50;
  const snark      = persona.snarkinessLevel      ?? 20;
  const flirt      = persona.flirtatiousnessLevel ?? 0;

  return (
    <div className="relative border border-primary/20 bg-card/30 p-4 font-mono text-xs">
      <HudCorners />
      <div className="text-primary/30 text-[9px] uppercase tracking-widest mb-2">LIVE PREVIEW</div>
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-primary/30 shrink-0">NAME</span>
          <span style={{ color }} className="font-bold">{name}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-primary/30 shrink-0">VIBE</span>
          <span className="text-primary/60">{attitude}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-primary/30 shrink-0">VOICE</span>
          <span className="text-primary/60">{voice}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-primary/30 shrink-0">THINK</span>
          <span className="text-primary/60">{depth}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-primary/30 shrink-0">LENGTH</span>
          <span className="text-primary/60">{length}</span>
        </div>
        <div className="border-t border-primary/10 pt-2 space-y-1">
          <div className="flex justify-between text-[9px]">
            <span className="text-primary/25">GRAVITY</span>
            <span className="text-primary/50">{gravityLabel(gravity)}</span>
          </div>
          <div className="flex justify-between text-[9px]">
            <span className="text-primary/25">SNARK</span>
            <span className="text-primary/50">{snarkinessLabel(snark)}</span>
          </div>
          <div className="flex justify-between text-[9px]">
            <span className="text-primary/25">WARMTH</span>
            <span className="text-primary/50">{flirtLabel(flirt)}</span>
          </div>
        </div>
        <div className="pt-1 border-t border-primary/10 text-primary/25 italic text-[9px]">
          "Ready when you are, {persona.aiName || "Commander"}."
        </div>
      </div>
    </div>
  );
}

// ── Local Voice Preview ───────────────────────────────────────────────────

const API_BASE = `${import.meta.env.BASE_URL}api`;

const LOCAL_VOICE_MAP: Record<string, { label: string; name: string; desc: string }> = {
  male:      { label: "MALE",      name: "ARGUS",  desc: "Deep, authoritative — en-us pitch 28" },
  neutral:   { label: "NEUTRAL",   name: "ARGUS",  desc: "Deep, authoritative — en-us pitch 28" },
  female:    { label: "FEMALE",    name: "ARIA",   desc: "Clear, energetic — en-us+f3 pitch 48" },
  nonbinary: { label: "NON-BINARY", name: "AXIOM", desc: "Mid-range — en-us pitch 42" },
};

function LocalVoicePreview({ gender }: { gender: string }) {
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying]     = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/features`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.tts?.local) setAvailable(true); })
      .catch(() => {});
  }, []);

  useEffect(() => { return () => { audioRef.current?.pause(); }; }, []);

  const info = LOCAL_VOICE_MAP[gender] ?? LOCAL_VOICE_MAP["neutral"]!;
  const voiceId = `local-${gender === "neutral" ? "male" : gender}`;

  async function previewLocal() {
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    setPlaying(true);
    try {
      const res = await fetch(`${API_BASE}/vision/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Systems online. Local voice synthesis active and ready for your command.", voice: voiceId }),
      });
      if (!res.ok) { setPlaying(false); return; }
      const data = await res.json() as { audio?: string; format?: string };
      if (!data.audio) { setPlaying(false); return; }
      const url = `data:audio/${data.format ?? "wav"};base64,${data.audio}`;
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      await audio.play();
    } catch { setPlaying(false); }
  }

  if (!available) return null;

  return (
    <div
      className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 border"
      style={{ borderColor: "rgba(17,217,122,0.2)", background: "rgba(17,217,122,0.03)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[8px] tracking-widest px-1.5 py-0.5 border"
            style={{ borderColor: "rgba(17,217,122,0.4)", color: "#11d97a" }}
          >
            OFFLINE
          </span>
          <span className="font-mono text-xs font-bold" style={{ color: "#11d97a" }}>
            {info.name} — {info.label}
          </span>
        </div>
        <div className="font-mono text-[9px] text-primary/30 mt-0.5">{info.desc}</div>
      </div>
      <button
        onClick={previewLocal}
        className="shrink-0 font-mono text-[10px] tracking-widest px-3 py-1.5 border transition-all"
        style={{
          borderColor: playing ? "#11d97a" : "rgba(17,217,122,0.3)",
          color:       playing ? "#11d97a" : "rgba(17,217,122,0.5)",
          background:  playing ? "rgba(17,217,122,0.08)" : "transparent",
        }}
      >
        {playing ? "■ STOP" : "▶ TEST"}
      </button>
    </div>
  );
}

// ── Recalibrate Tab ───────────────────────────────────────────────────────

function RecalibrateTab() {
  const currentFace  = useFaceStyle();
  const [face, setFaceLocal]    = useState<FaceStyle>(currentFace);
  const [voice, setVoiceLocal]  = useState<string>(() => localStorage.getItem(VOICE_KEY) ?? "onyx");
  const [playing, setPlaying]   = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [aiNameVal,    setAiNameVal]    = useState(() => localStorage.getItem(AI_NAME_KEY) ?? getStoredConfig()?.aiName ?? "JARVIS");
  const [nameSaving,   setNameSaving]   = useState(false);
  const [nameSaved,    setNameSaved]    = useState(false);

  const [userNameVal,  setUserNameVal]  = useState(() => getStoredConfig()?.userName ?? "Commander");
  const [uNameSaving,  setUNameSaving]  = useState(false);
  const [uNameSaved,   setUNameSaved]   = useState(false);

  const [quizQ, setQuizQ]       = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizSelected, setQuizSelected] = useState<number | null>(null);
  const [quizTransition, setQuizTransition] = useState(false);
  const [quizDone, setQuizDone] = useState(false);
  const [quizSaved, setQuizSaved] = useState(false);
  const [quizSaveError, setQuizSaveError] = useState(false);

  const [faceSaved, setFaceSaved]   = useState(false);
  const [voiceSaved, setVoiceSaved] = useState(false);

  const [elVoices, setElVoices] = useState<{ id: string; name: string; category: string }[]>([]);

  const q = QUIZ_QUESTIONS[quizQ]!;

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  useEffect(() => {
    function onVoiceChanged(e: Event) {
      const detail = (e as CustomEvent<{ voice: string }>).detail;
      if (detail?.voice && detail.voice !== voice) {
        setVoiceLocal(detail.voice);
        localStorage.setItem(VOICE_KEY, detail.voice);
      }
    }
    window.addEventListener(VOICE_CHANGED_EVENT, onVoiceChanged);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, onVoiceChanged);
  }, [voice]);

  // ── Sync voice from server on mount so changes made on other devices
  //    (e.g. from mobile or a different browser) are reflected here too.
  useEffect(() => {
    fetch(`${API_BASE}/ai/persona`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { voice?: string } | null) => {
        const serverVoice = p?.voice?.trim();
        if (serverVoice && serverVoice !== localStorage.getItem(VOICE_KEY)) {
          localStorage.setItem(VOICE_KEY, serverVoice);
          setVoiceLocal(serverVoice);
          window.dispatchEvent(new CustomEvent(VOICE_CHANGED_EVENT, { detail: { voice: serverVoice } }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/vision/elevenlabs/voices`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.voices) setElVoices(d.voices); })
      .catch(() => {});
  }, []);

  function applyFace(f: FaceStyle) {
    setFaceLocal(f);
    saveFaceStyle(f);
    fetch(`${API_BASE}/ucm/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { faceStyle: f }, merge: true }),
    }).catch(() => {});
    setFaceSaved(true);
    setTimeout(() => setFaceSaved(false), 2000);
  }

  function applyVoice(v: string) {
    setVoiceLocal(v);
    localStorage.setItem(VOICE_KEY, v);
    fetch(`${API_BASE}/ucm/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { voice: v }, merge: true }),
    }).catch(() => {});
    // Always persist the selected voice to the persona table — the backend
    // now accepts any non-empty string (OpenAI IDs, ElevenLabs IDs, etc.)
    fetch(`${API_BASE}/ai/persona`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: v }),
    }).catch(() => {});
    if (PERSONA_VALID_VOICES.has(v) || v.startsWith("local-")) {
      // OpenAI or local voice — clear any stale ElevenLabs voice ID so the
      // server-side TTS default doesn't keep using the old ElevenLabs voice.
      fetch(`${API_BASE}/config/ELEVENLABS_VOICE_ID`, { method: "DELETE" }).catch(() => {});
    } else {
      // ElevenLabs voice — persist ID to backend config so all TTS paths use it
      fetch(`${API_BASE}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ELEVENLABS_VOICE_ID: v }),
      }).catch(() => {});
    }
    window.dispatchEvent(new CustomEvent(VOICE_CHANGED_EVENT, { detail: { voice: v } }));
    setVoiceSaved(true);
    setTimeout(() => setVoiceSaved(false), 2000);
  }

  async function playSample(voiceId: string, sample: string) {
    if (playing === voiceId) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    setPlaying(voiceId);
    setTtsError(null);
    try {
      const res = await fetch(`${API_BASE}/vision/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sample, voice: voiceId }),
      });
      if (!res.ok) throw new Error("TTS unavailable");
      const data = await res.json() as { audio?: string; format?: string };
      if (!data.audio) throw new Error("No audio in response");
      const url = `data:audio/${data.format ?? "mp3"};base64,${data.audio}`;
      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      const { attachAmplitudeAnalyser } = await import("@/lib/audioAnalyser");
      attachAmplitudeAnalyser(audio);
      audio.onended = () => setPlaying(null);
      audio.onerror = () => setPlaying(null);
      await audio.play();
    } catch {
      setPlaying(null);
      setTtsError("TTS not configured — select any voice to continue");
    }
  }

  function handleQuizSelect(idx: number) {
    if (quizTransition) return;
    setQuizSelected(idx);
    setTimeout(() => {
      setQuizTransition(true);
      const newAnswers = { ...quizAnswers, [q.id]: q.options[idx]!.value };
      setQuizAnswers(newAnswers);
      setTimeout(() => {
        if (quizQ + 1 < QUIZ_QUESTIONS.length) {
          setQuizQ((c) => c + 1);
          setQuizSelected(null);
          setQuizTransition(false);
        } else {
          setQuizDone(true);
          saveQuizToUCM(newAnswers);
        }
      }, 350);
    }, 250);
  }

  async function saveAiName() {
    const trimmed = aiNameVal.trim();
    if (!trimmed) return;
    setNameSaving(true);
    localStorage.setItem(AI_NAME_KEY, trimmed);
    const currentCfg = getStoredConfig();
    if (currentCfg) {
      localStorage.setItem("jarvis.user", JSON.stringify({ ...currentCfg, aiName: trimmed, systemName: trimmed }));
    }
    window.dispatchEvent(new Event(AI_NAME_UPDATED_EVENT));
    try {
      const res = await fetch(`${API_BASE}/ucm/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { aiName: trimmed }, merge: true }),
      });
      if (!res.ok) console.warn("[deckos] UCM identity PATCH failed:", res.status);
    } catch (e) {
      console.warn("[deckos] UCM identity PATCH error:", e);
    } finally {
      setNameSaving(false);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    }
  }

  async function saveUserName() {
    const trimmed = userNameVal.trim();
    if (!trimmed) return;
    setUNameSaving(true);
    const currentCfg = getStoredConfig();
    if (currentCfg) {
      localStorage.setItem("jarvis.user", JSON.stringify({ ...currentCfg, userName: trimmed }));
    }
    window.dispatchEvent(new Event(USER_NAME_UPDATED_EVENT));
    try {
      const res = await fetch(`${API_BASE}/ucm/identity`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: { userName: trimmed }, merge: true }),
      });
      if (!res.ok) console.warn("[deckos] UCM identity PATCH failed:", res.status);
    } catch (e) {
      console.warn("[deckos] UCM identity PATCH error:", e);
    } finally {
      setUNameSaving(false);
      setUNameSaved(true);
      setTimeout(() => setUNameSaved(false), 2000);
    }
  }

  function resetQuiz() {
    setQuizQ(0);
    setQuizAnswers({});
    setQuizSelected(null);
    setQuizTransition(false);
    setQuizDone(false);
    setQuizSaved(false);
    setQuizSaveError(false);
  }

  async function saveQuizToUCM(answers?: Record<string, number>) {
    const a = answers ?? quizAnswers;
    try {
      localStorage.setItem("deckos_quiz_answers", JSON.stringify(a));
      const res = await fetch(`${API_BASE}/ucm/preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            verbosityLevel:   a["verbosity"]       ?? 0.5,
            humorLevel:       a["humor"]           ?? 0.4,
            proactivityLevel: a["proactivity"]     ?? 0.5,
            toneFormality:    a["formality"]       ?? 0.5,
            analyticalDepth:  a["analyticalDepth"] ?? 0.5,
          },
          merge: true,
        }),
      });
      if (!res.ok) throw new Error(`UCM PATCH failed: ${res.status}`);
      setQuizSaved(true);
    } catch {
      setQuizSaved(false);
      setQuizSaveError(true);
    }
  }

  return (
    <div className="space-y-8">

      {/* ── AI Name ─────────────────────────────────────────────────────── */}
      <div className="relative border border-primary/30 bg-card/40 p-5">
        <HudCorners />
        <div className="flex items-center justify-between mb-4">
          <SectionHeader icon={Bot} title="AI DESIGNATION" sub="The name your AI identifies itself by across the interface" />
          {nameSaved && (
            <span className="font-mono text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> APPLIED
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-background/50 border border-primary/20 px-3 py-2 font-mono text-sm text-primary focus:outline-none focus:border-primary/60 transition-colors uppercase tracking-widest placeholder:text-primary/20 placeholder:normal-case placeholder:tracking-normal"
            value={aiNameVal}
            onChange={e => setAiNameVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void saveAiName(); }}
            maxLength={32}
            placeholder="e.g. JARVIS"
            spellCheck={false}
          />
          <button
            onClick={() => void saveAiName()}
            disabled={nameSaving || !aiNameVal.trim()}
            className="border border-primary/40 px-4 py-2 font-mono text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0"
          >
            {nameSaving
              ? <><Loader2 className="w-3 h-3 animate-spin" /> SAVING</>
              : "APPLY"
            }
          </button>
        </div>
        <div className="mt-2 font-mono text-[10px] text-primary/25">
          Updates the sidebar, command console, and AI chat headers immediately.
        </div>
      </div>

      {/* ── User Name ─────────────────────────────────────────────────────── */}
      <div className="relative border border-primary/30 bg-card/40 p-5">
        <HudCorners />
        <div className="flex items-center justify-between mb-4">
          <SectionHeader icon={User2} title="YOUR NAME" sub="How the AI addresses you in greetings and conversations" />
          {uNameSaved && (
            <span className="font-mono text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> APPLIED
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 bg-background/50 border border-primary/20 px-3 py-2 font-mono text-sm text-primary focus:outline-none focus:border-primary/60 transition-colors uppercase tracking-widest placeholder:text-primary/20 placeholder:normal-case placeholder:tracking-normal"
            value={userNameVal}
            onChange={e => setUserNameVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void saveUserName(); }}
            maxLength={32}
            placeholder="e.g. COMMANDER"
            spellCheck={false}
          />
          <button
            onClick={() => void saveUserName()}
            disabled={uNameSaving || !userNameVal.trim()}
            className="border border-primary/40 px-4 py-2 font-mono text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-all disabled:opacity-40 flex items-center gap-1.5 shrink-0"
          >
            {uNameSaving
              ? <><Loader2 className="w-3 h-3 animate-spin" /> SAVING</>
              : "APPLY"
            }
          </button>
        </div>
        <div className="mt-2 font-mono text-[10px] text-primary/25">
          Updates the sidebar profile and how the AI addresses you.
        </div>
      </div>

      {/* ── Face picker ─────────────────────────────────────────────────── */}
      <div className="relative border border-primary/30 bg-card/40 p-5">
        <HudCorners />
        <div className="flex items-center justify-between mb-4">
          <SectionHeader icon={MonitorPlay} title="AI FACE STYLE" sub="Live preview — changes apply instantly to the sidebar" />
          {faceSaved && (
            <span className="font-mono text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> APPLIED
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {FACE_OPTIONS.map((f) => {
            const active = face === f.id;
            return (
              <button
                key={f.id}
                onClick={() => applyFace(f.id)}
                className="flex flex-col items-center p-4 border transition-all text-left"
                style={{
                  borderColor: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.15)",
                  background:  active ? "rgba(var(--primary-rgb),0.08)" : "rgba(var(--primary-rgb),0.02)",
                  boxShadow:   active ? "0 0 20px rgba(var(--primary-rgb),0.12)" : "none",
                  transform:   active ? "scale(1.02)" : "scale(1)",
                  transition:  "all 0.2s ease",
                }}
              >
                <div className="mb-3 flex items-center justify-center h-14">
                  <AIFace
                    style={f.id}
                    speaking={active}
                    size={f.id === "iris" ? 52 : 90}
                    color={active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.35)"}
                  />
                </div>
                <div className={`font-mono font-bold text-[10px] tracking-widest mb-0.5 ${active ? "text-primary" : "text-primary/50"}`}>
                  {f.label}
                </div>
                <div className="font-mono text-center text-primary/30" style={{ fontSize: "0.62rem" }}>
                  {f.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Voice picker ────────────────────────────────────────────────── */}
      <div className="relative border border-primary/30 bg-card/40 p-5">
        <HudCorners />
        <div className="flex items-center justify-between mb-4">
          <SectionHeader icon={Volume2} title="VOICE SYNTHESIS" sub="Click play to hear a sample — select to apply" />
          {voiceSaved && (
            <span className="font-mono text-[10px] text-emerald-400 flex items-center gap-1">
              <Check className="w-3 h-3" /> APPLIED
            </span>
          )}
        </div>
        {ttsError && (
          <div className="mb-4 px-3 py-2 font-mono text-[10px] border"
               style={{ borderColor: "#ffc82050", color: "#ffc820", background: "rgba(255,200,32,0.05)" }}>
            {ttsError}
          </div>
        )}
        {elVoices.length > 0 && (
          <div className="mb-3">
            <div className="font-mono text-[9px] tracking-widest uppercase mb-2 flex items-center gap-2" style={{ color: "rgba(var(--primary-rgb),0.4)" }}>
              <span className="px-1.5 py-0.5 border text-[8px]" style={{ borderColor: "rgba(var(--primary-rgb),0.3)", color: "rgba(var(--primary-rgb),0.6)" }}>ELEVENLABS</span>
              Your connected voices
            </div>
            <div className="space-y-2">
              {elVoices.map((v) => {
                const active = voice === v.id;
                const isPlaying = playing === v.id;
                const sampleTxt = "Systems online. Voice synthesis module calibrated and ready for command.";
                return (
                  <div
                    key={v.id}
                    onClick={() => applyVoice(v.id)}
                    className="flex items-center gap-3 p-3 border cursor-pointer transition-all"
                    style={{
                      borderColor: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.15)",
                      background: active ? "rgba(var(--primary-rgb),0.07)" : "transparent",
                    }}
                  >
                    <button
                      onClick={(e) => { e.stopPropagation(); playSample(v.id, sampleTxt); }}
                      className="shrink-0 w-7 h-7 border flex items-center justify-center transition-all hover:bg-primary/10"
                      style={{ borderColor: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.3)" }}
                      title={isPlaying ? "Stop" : "Play sample"}
                    >
                      {isPlaying
                        ? <Square className="w-2.5 h-2.5 text-primary" />
                        : <Play className="w-2.5 h-2.5" style={{ color: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.5)" }} />
                      }
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={`font-mono font-bold text-[10px] tracking-widest ${active ? "text-primary" : "text-primary/50"}`}>
                        {v.name.toUpperCase()}
                      </div>
                      <div className="font-mono text-[9px] text-primary/30 truncate">
                        {v.category === "premade" ? "ElevenLabs premade" : v.category === "cloned" ? "Voice clone" : v.category}
                      </div>
                    </div>
                    {active && <Check className="w-3 h-3 text-primary shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {elVoices.length > 0 && (
          <div className="font-mono text-[9px] tracking-widest uppercase mb-2 flex items-center gap-2" style={{ color: "rgba(var(--primary-rgb),0.4)" }}>
            <span className="px-1.5 py-0.5 border text-[8px]" style={{ borderColor: "rgba(var(--primary-rgb),0.2)", color: "rgba(var(--primary-rgb),0.4)" }}>OPENAI</span>
            Standard voices
          </div>
        )}
        <div className="space-y-2">
          {VOICE_OPTIONS.map((v) => {
            const active   = voice === v.id;
            const isPlaying = playing === v.id;
            return (
              <div
                key={v.id}
                onClick={() => applyVoice(v.id)}
                className="flex items-center gap-3 p-3 border cursor-pointer transition-all"
                style={{
                  borderColor: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.15)",
                  background:  active ? "rgba(var(--primary-rgb),0.07)" : "transparent",
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); playSample(v.id, v.sample); }}
                  className="shrink-0 w-7 h-7 border flex items-center justify-center transition-all hover:bg-primary/10"
                  style={{ borderColor: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.3)" }}
                  title={isPlaying ? "Stop" : "Play sample"}
                >
                  {isPlaying
                    ? <Square className="w-2.5 h-2.5 text-primary" />
                    : <Play  className="w-2.5 h-2.5" style={{ color: active ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.5)" }} />
                  }
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`font-mono font-bold text-[10px] tracking-widest ${active ? "text-primary" : "text-primary/50"}`}>
                    {v.label}
                  </div>
                  <div className="font-mono text-[9px] text-primary/30 truncate">{v.description}</div>
                </div>
                {active && <Check className="w-3 h-3 text-primary shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Personality calibration quiz ─────────────────────────────────── */}
      <div className="relative border border-primary/30 bg-card/40 p-5">
        <HudCorners />
        <div className="flex items-center justify-between mb-4">
          <SectionHeader icon={Brain} title="PERSONALITY CALIBRATION" sub="Retake the diagnostic quiz to update AI behaviour" />
          {!quizDone && quizQ > 0 && (
            <button
              onClick={resetQuiz}
              className="flex items-center gap-1 font-mono text-[9px] text-primary/40 hover:text-primary/70 transition-all"
            >
              <RefreshCw className="w-3 h-3" /> RESTART
            </button>
          )}
        </div>

        {quizDone ? (
          <div className="text-center py-6">
            <div className="text-emerald-400 font-mono text-xs tracking-widest mb-2">
              ✓ CALIBRATION COMPLETE
            </div>
            <div className="text-primary/40 font-mono text-[10px] mb-6">
              {QUIZ_QUESTIONS.length} diagnostics recorded
            </div>
            {quizSaved ? (
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center justify-center gap-2 text-emerald-400 font-mono text-xs">
                  <Check className="w-4 h-4" /> SAVED TO AI PROFILE
                </div>
                <button
                  onClick={resetQuiz}
                  className="flex items-center gap-2 px-4 py-2 border border-primary/20 font-mono text-[10px] text-primary/40 hover:text-primary/70 transition-all"
                >
                  <RefreshCw className="w-3 h-3" /> RECALIBRATE AGAIN
                </button>
              </div>
            ) : quizSaveError ? (
              <div className="flex flex-col items-center gap-4">
                <div className="text-red-400 font-mono text-xs flex items-center gap-2">
                  ✗ SAVE FAILED — check API connection
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => saveQuizToUCM()}
                    className="flex items-center gap-2 px-4 py-2 border border-primary/40 font-mono text-[10px] text-primary hover:bg-primary/10 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" /> RETRY
                  </button>
                  <button
                    onClick={resetQuiz}
                    className="flex items-center gap-2 px-4 py-2 border border-primary/20 font-mono text-[10px] text-primary/40 hover:text-primary/70 transition-all"
                  >
                    <RefreshCw className="w-3 h-3" /> REDO
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="flex items-center justify-center gap-2 text-primary/50 font-mono text-xs">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> SAVING TO AI PROFILE...
                </div>
                <button
                  onClick={resetQuiz}
                  className="flex items-center gap-2 px-4 py-2.5 border border-primary/20 font-mono text-[10px] text-primary/40 hover:text-primary/70 transition-all"
                >
                  <RefreshCw className="w-3 h-3" /> REDO
                </button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-3">
              <div className="font-mono text-[9px] text-primary/40 tracking-widest">
                DIAGNOSTIC {quizQ + 1} / {QUIZ_QUESTIONS.length}
              </div>
              <div className="font-mono text-[9px] text-primary/40">
                {Math.round((quizQ / QUIZ_QUESTIONS.length) * 100)}%
              </div>
            </div>
            <div className="h-0.5 mb-5 rounded-full bg-primary/10">
              <div
                className="h-0.5 rounded-full transition-all"
                style={{ width: `${(quizQ / QUIZ_QUESTIONS.length) * 100}%`, background: "hsl(var(--primary))" }}
              />
            </div>
            <div
              style={{
                opacity:    quizTransition ? 0 : 1,
                transform:  quizTransition ? "translateX(12px)" : "translateX(0)",
                transition: "all 0.25s ease",
              }}
            >
              <div className="font-mono text-[9px] text-amber-400 tracking-widest uppercase mb-1">{q.prompt}</div>
              <div className="font-mono font-bold text-sm mb-4 text-foreground">{q.question}</div>
              <div className="space-y-2">
                {q.options.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuizSelect(i)}
                    className="w-full text-left p-3 border font-mono text-[10px] transition-all flex items-center gap-3"
                    style={{
                      borderColor: quizSelected === i ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.15)",
                      background:  quizSelected === i ? "rgba(var(--primary-rgb),0.10)" : "transparent",
                      color:       quizSelected === i ? "hsl(var(--primary))" : undefined,
                      transform:   quizSelected === i ? "translateX(4px)" : "translateX(0)",
                      transition:  "all 0.15s ease",
                    }}
                  >
                    <span
                      className="shrink-0 w-4 h-4 border flex items-center justify-center text-[8px]"
                      style={{ borderColor: quizSelected === i ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.3)" }}
                    >
                      {quizSelected === i ? "✓" : ""}
                    </span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function AiPersonality() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"persona" | "recalibrate">("persona");

  const configChanged       = useWsEvents((e) => e.type === "system.config_changed");
  const processedCfgRef     = useRef(new Set<string>());

  useEffect(() => {
    configChanged.forEach((evt) => {
      const p = evt.payload as { origin?: string };
      if (p.origin !== "self_upgrade") return;
      const key = `${evt.timestamp}:${evt.id ?? ""}`;
      if (processedCfgRef.current.has(key)) return;
      processedCfgRef.current.add(key);
      void qc.invalidateQueries({ queryKey: ["ai-persona"] });
    });
  }, [configChanged, qc]);

  const { data: saved, isLoading } = useQuery<AiPersona>({
    queryKey: ["ai-persona"],
    queryFn:  () => fetch(`${import.meta.env.BASE_URL}api/ai/persona`).then(r => r.json()),
  });

  const [form, setForm] = useState<Partial<AiPersona>>({
    aiName:               "JARVIS",
    gender:               "neutral",
    voice:                "onyx",
    attitude:             "professional",
    thinkingDepth:        "standard",
    responseLength:       "balanced",
    textColor:            "#00d4ff",
    gravityLevel:         50,
    snarkinessLevel:      20,
    flirtatiousnessLevel: 0,
  });

  const [saved_ok, setSavedOk] = useState(false);

  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  useEffect(() => {
    function onVoiceChanged(e: Event) {
      const detail = (e as CustomEvent<{ voice: string }>).detail;
      if (detail?.voice) {
        setForm(prev => ({ ...prev, voice: detail.voice as AiPersona["voice"] }));
      }
    }
    window.addEventListener(VOICE_CHANGED_EVENT, onVoiceChanged);
    return () => window.removeEventListener(VOICE_CHANGED_EVENT, onVoiceChanged);
  }, []);

  const currentFaceStyle = useFaceStyle();

  const set = useCallback((key: keyof AiPersona, value: string | number) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const save = useMutation({
    mutationFn: () => fetch(`${import.meta.env.BASE_URL}api/ai/persona`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(form),
    }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-persona"] });
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
      if (form.voice) {
        localStorage.setItem(VOICE_KEY, form.voice);
        window.dispatchEvent(new CustomEvent(VOICE_CHANGED_EVENT, { detail: { voice: form.voice } }));
      }
      if (form.textColor) {
        const scheme = HEX_TO_SCHEME[form.textColor.toLowerCase()];
        if (scheme) {
          applyColor(scheme);
        } else {
          applyHexColor(form.textColor);
        }
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 font-mono text-xs text-primary/30">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> LOADING PERSONA...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
          <Bot className="w-4 h-4 text-primary" />
          <span>AI.PERSONALITY // {tab === "recalibrate" ? "RECALIBRATE" : "PERSONA CONFIGURATION"}</span>
        </div>
        {tab === "persona" && (
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="flex items-center gap-2 border border-primary/40 px-4 py-2 font-mono text-xs
                       text-primary hover:bg-primary/10 transition-all disabled:opacity-40"
          >
            {save.isPending ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : saved_ok ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            {saved_ok ? "SAVED" : "SAVE CHANGES"}
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-primary/15 pb-0">
        {(["persona", "recalibrate"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex items-center gap-1.5 px-4 py-2 font-mono text-[10px] tracking-widest uppercase transition-all border-b-2 -mb-px"
            style={{
              borderBottomColor: tab === t ? "hsl(var(--primary))" : "transparent",
              color: tab === t ? "hsl(var(--primary))" : "rgba(var(--primary-rgb),0.35)",
            }}
          >
            {t === "persona" ? <Brain className="w-3 h-3" /> : <Wand2 className="w-3 h-3" />}
            {t === "persona" ? "PERSONA" : "RECALIBRATE"}
          </button>
        ))}
      </div>

      {tab === "recalibrate" ? (
        <RecalibrateTab />
      ) : (

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: identity + dials ─────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── PERSONALITY DIALS ─────────────────────────────────────────── */}
          <div className="relative border border-primary/30 bg-card/40 p-5">
            <HudCorners />
            <SectionHeader
              icon={SlidersHorizontal}
              title="PERSONALITY DIALS"
              sub="Fine-tune JARVIS's tone — adjustable mid-conversation by voice or text"
            />
            <div className="space-y-6 mt-4">
              <PersonalityDial
                label="GRAVITY — HOW SERIOUS?"
                lowLabel="Silly / Unserious"
                highLabel="Gravely Serious"
                value={form.gravityLevel ?? 50}
                onChange={v => set("gravityLevel", v)}
                displayLabel={gravityLabel}
                color="#3f84f3"
              />
              <PersonalityDial
                label="SNARK — HOW CUTTING?"
                lowLabel="Sincere / Earnest"
                highLabel="Maximum Snark"
                value={form.snarkinessLevel ?? 20}
                onChange={v => set("snarkinessLevel", v)}
                displayLabel={snarkinessLabel}
                color="#ffc820"
              />
              <PersonalityDial
                label="WARMTH — HOW CHARMING?"
                lowLabel="Clinical / Neutral"
                highLabel="Openly Flirty"
                value={form.flirtatiousnessLevel ?? 0}
                onChange={v => set("flirtatiousnessLevel", v)}
                displayLabel={flirtLabel}
                color="#f472b6"
              />
            </div>
            <div className="mt-4 pt-3 border-t border-primary/10 text-primary/25 font-mono text-[9px]">
              JARVIS can also update these dials itself when you tell it to change its behavior mid-conversation.
            </div>
          </div>

          {/* AI Name */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={Bot} title="AI NAME" sub="What should this AI be called?" />
            <input
              type="text"
              value={form.aiName ?? ""}
              onChange={e => set("aiName", e.target.value)}
              maxLength={32}
              placeholder="e.g. JARVIS, SALLY, GUS…"
              className="w-full bg-card/40 border border-primary/20 rounded px-3 py-2 font-mono text-sm
                         text-primary placeholder:text-primary/20 outline-none focus:border-primary/60
                         focus:bg-primary/5 transition-all"
            />
            <div className="mt-1.5 text-primary/25 font-mono text-[9px]">
              This name appears in all conversations and is injected into the AI system prompt.
            </div>
          </div>

          {/* Gender */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={User2} title="GENDER / PRONOUNS" sub="How should the AI refer to itself?" />
            <div className="grid grid-cols-2 gap-2">
              {GENDERS.map(g => {
                const active = form.gender === g.value;
                return (
                  <button
                    key={g.value}
                    onClick={() => set("gender", g.value)}
                    className={`flex items-start gap-3 p-3 border text-left transition-all
                      ${active ? "border-primary bg-primary/10" : "border-primary/15 hover:border-primary/40"}`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${active ? "bg-primary" : "bg-primary/20"}`} />
                    <div>
                      <div className={`font-mono text-xs font-bold ${active ? "text-primary" : "text-primary/50"}`}>
                        {g.label}
                      </div>
                      <div className="text-primary/30 font-mono text-[9px] mt-0.5">{g.desc}</div>
                    </div>
                    {active && <ChevronRight className="w-3 h-3 text-primary ml-auto mt-0.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voice */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={Mic2} title="VOICE" sub="Voice used for all spoken output" />
            {/* ElevenLabs active indicator */}
            {form.voice && !PERSONA_VALID_VOICES.has(form.voice) && !form.voice.startsWith("local-") && (
              <div
                className="mb-3 flex items-center gap-2 px-3 py-2 border font-mono text-[10px]"
                style={{ borderColor: "rgba(var(--primary-rgb),0.3)", background: "rgba(var(--primary-rgb),0.06)" }}
              >
                <span
                  className="px-1.5 py-0.5 border text-[8px] tracking-widest"
                  style={{ borderColor: "rgba(var(--primary-rgb),0.4)", color: "hsl(var(--primary))" }}
                >
                  ELEVENLABS
                </span>
                <span className="text-primary/60 truncate">Active voice ID: {form.voice}</span>
                <span className="text-primary/30 ml-auto shrink-0">Change in Recalibrate tab</span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VOICES.map(v => {
                const active = form.voice === v.value;
                return (
                  <button
                    key={v.value}
                    onClick={() => set("voice", v.value)}
                    className={`flex flex-col items-start p-3 border text-left transition-all
                      ${active ? "border-primary bg-primary/10" : "border-primary/15 hover:border-primary/40"}`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <Volume2 className={`w-3 h-3 shrink-0 ${active ? "text-primary" : "text-primary/30"}`} />
                      <span className={`font-mono text-xs font-bold flex-1 ${active ? "text-primary" : "text-primary/50"}`}>
                        {v.label}
                      </span>
                      {active && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                    </div>
                    <div className="text-primary/30 font-mono text-[9px] mt-1.5">{v.desc}</div>
                    <div className="text-primary/20 font-mono text-[9px] italic">{v.sample}</div>
                  </button>
                );
              })}
            </div>
            <LocalVoicePreview gender={form.gender ?? "neutral"} />
          </div>

          {/* Attitude */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={Sparkles} title="BASE STYLE PRESET" sub="Sets the AI's overall communication style — layered under your dials above" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ATTITUDES.map(a => {
                const active = form.attitude === a.value;
                return (
                  <button
                    key={a.value}
                    onClick={() => set("attitude", a.value)}
                    className={`flex flex-col items-start p-3 border text-left transition-all
                      ${active ? "border-primary bg-primary/10" : "border-primary/15 hover:border-primary/40"}`}
                  >
                    <div className="text-base mb-1">{a.emoji}</div>
                    <div className={`font-mono text-[10px] font-bold ${active ? "text-primary" : "text-primary/50"}`}>
                      {a.label}
                    </div>
                    <div className="text-primary/25 font-mono text-[9px] mt-0.5 leading-snug">{a.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thinking depth */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={Brain} title="THINKING DEPTH" sub="Controls how much reasoning the AI shows" />
            <div className="grid grid-cols-3 gap-2">
              {THINKING_DEPTHS.map(d => {
                const active = form.thinkingDepth === d.value;
                return (
                  <button
                    key={d.value}
                    onClick={() => set("thinkingDepth", d.value)}
                    className={`flex flex-col p-3 border text-left transition-all
                      ${active ? "border-primary bg-primary/10" : "border-primary/15 hover:border-primary/40"}`}
                  >
                    <div className={`font-mono text-xs font-bold mb-1 ${active ? "text-primary" : "text-primary/50"}`}>
                      {d.label}
                    </div>
                    <div className="text-primary/30 font-mono text-[9px]">{d.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Response length */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={MessageSquare} title="RESPONSE LENGTH" sub="How verbose should the AI be by default?" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {RESPONSE_LENGTHS.map(l => {
                const active = form.responseLength === l.value;
                return (
                  <button
                    key={l.value}
                    onClick={() => set("responseLength", l.value)}
                    className={`flex flex-col p-3 border text-left transition-all
                      ${active ? "border-primary bg-primary/10" : "border-primary/15 hover:border-primary/40"}`}
                  >
                    <div className={`font-mono text-[10px] font-bold mb-1 ${active ? "text-primary" : "text-primary/50"}`}>
                      {l.label}
                    </div>
                    <div className="text-primary/30 font-mono text-[9px]">{l.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* ── Right column: color + preview ─────────────────────────────── */}
        <div className="space-y-6">

          {/* Text color */}
          <div className="border border-primary/20 bg-card/40 p-5">
            <SectionHeader icon={Palette} title="ACCENT COLOR" sub="AI text/UI highlight color" />
            <div className="grid grid-cols-4 gap-2 mb-3">
              {PRESET_COLORS.map(c => {
                const active = form.textColor?.toLowerCase() === c.value.toLowerCase();
                return (
                  <button
                    key={c.value}
                    onClick={() => set("textColor", c.value)}
                    title={c.label}
                    style={{ backgroundColor: c.value }}
                    className={`h-9 rounded transition-all ${active ? "ring-2 ring-white ring-offset-1 ring-offset-card scale-110" : "opacity-70 hover:opacity-100"}`}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded border border-primary/20 shrink-0"
                style={{ backgroundColor: form.textColor ?? "#00d4ff" }}
              />
              <input
                type="text"
                value={form.textColor ?? "#00d4ff"}
                onChange={e => {
                  const v = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(v)) set("textColor", v);
                }}
                maxLength={7}
                placeholder="#00d4ff"
                className="flex-1 bg-card/40 border border-primary/20 rounded px-2 py-1.5 font-mono text-xs
                           text-primary placeholder:text-primary/20 outline-none focus:border-primary/50 transition-all"
              />
            </div>
            <div className="mt-3 flex items-center justify-center">
              <div
                className="flex items-center justify-center border transition-all"
                style={{
                  width: 120,
                  height: currentFaceStyle === "iris" ? 120 : 68,
                  borderColor: `${form.textColor ?? "#00d4ff"}40`,
                  background: `${form.textColor ?? "#00d4ff"}08`,
                  boxShadow: `0 0 18px ${form.textColor ?? "#00d4ff"}22`,
                  transition: "border-color 0.25s, box-shadow 0.25s",
                }}
              >
                <AIFace
                  style={currentFaceStyle}
                  speaking={true}
                  size={currentFaceStyle === "iris" ? 100 : 110}
                  color={form.textColor ?? "#00d4ff"}
                />
              </div>
            </div>
            <div className="mt-2 text-primary/20 font-mono text-[9px] text-center">
              Live preview — applied instantly on save
            </div>
          </div>

          {/* Live preview */}
          <PersonaPreview persona={form} />

          {/* Save */}
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="w-full flex items-center justify-center gap-2 border border-primary/40 py-3
                       font-mono text-xs text-primary hover:bg-primary/10 transition-all disabled:opacity-40"
          >
            {save.isPending ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : saved_ok ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{saved_ok ? "PERSONA SAVED" : "SAVE PERSONA"}</span>
          </button>

          {save.isError && (
            <div className="text-red-400 font-mono text-[10px] text-center">Failed to save — check API connection</div>
          )}

          {/* Self-upgrade note */}
          <div className="border border-primary/10 bg-card/20 p-4 font-mono">
            <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-2">SELF-UPGRADE ACTIVE</div>
            <div className="text-primary/30 text-[9px] leading-relaxed">
              JARVIS can update its own personality dials mid-conversation. Try telling it:
            </div>
            <div className="mt-2 space-y-1">
              {[
                '"Be more snarky"',
                '"Stop joking around"',
                '"Turn the flirt up"',
                '"Be completely serious"',
              ].map(ex => (
                <div key={ex} className="text-primary/50 text-[9px] italic">{ex}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      )}
    </div>
  );
}
