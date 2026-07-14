import { useCallback, useEffect, useRef, useState } from "react";
import { attachAmplitudeAnalyser } from "@/lib/audioAnalyser";
import { stripEmoji } from "@/lib/stripText";

/**
 * Unified voice for Atlas. Two engines, one interface:
 *
 *  - "elevenlabs" / server voice → POST /api/vision/tts returns base64 audio,
 *    played through an <audio> element with an amplitude analyser attached, so
 *    the face's talking motion tracks the real waveform.
 *  - "browser" (default, zero-config) → window.speechSynthesis. No waveform, so
 *    the face falls back to its cadence bounce (atlasFaceEngine "talking").
 *
 * The user picks the engine in setup; ElevenLabs unlocks once a key is saved.
 * speak() resolves when the utterance finishes (or is stopped).
 */

export type VoiceEngine = "browser" | "server";

const VOICE_ENGINE_KEY = "atlas_voice_engine";
const VOICE_ID_KEY = "deckos_voice"; // shared with the existing voice picker
const BROWSER_VOICE_KEY = "atlas_browser_voice"; // chosen browser voice (voiceURI)
const VOICE_RATE_KEY = "atlas_voice_rate"; // speaking speed (browser voice)

const DEFAULT_RATE = 1.15;
/** Global speaking rate for the browser voice (0.6–1.8). */
export function getVoiceRate(): number {
  const n = Number(localStorage.getItem(VOICE_RATE_KEY));
  return Number.isFinite(n) && n >= 0.6 && n <= 1.8 ? n : DEFAULT_RATE;
}
export function setVoiceRate(rate: number): number {
  const clamped = Math.max(0.6, Math.min(1.8, rate));
  localStorage.setItem(VOICE_RATE_KEY, String(clamped));
  return clamped;
}
/** Nudge the speaking rate up/down (for "talk faster" / "slow down"). Returns the new rate. */
export function nudgeVoiceRate(delta: number): number {
  return setVoiceRate(getVoiceRate() + delta);
}

export function getVoiceEngine(): VoiceEngine {
  return (localStorage.getItem(VOICE_ENGINE_KEY) as VoiceEngine) || "browser";
}

/** The chosen ElevenLabs voice id, if the user picked one. */
export function getServerVoiceId(): string | null {
  return localStorage.getItem(VOICE_ID_KEY);
}
export function setServerVoiceId(id: string) {
  localStorage.setItem(VOICE_ID_KEY, id);
}

/** The chosen browser voice (voiceURI), if the user picked one of the defaults. */
export function getBrowserVoiceURI(): string | null {
  return localStorage.getItem(BROWSER_VOICE_KEY);
}
export function setBrowserVoiceURI(uri: string) {
  localStorage.setItem(BROWSER_VOICE_KEY, uri);
}

export interface BrowserVoiceOption {
  uri: string;
  name: string;
  lang: string;
}

/** The top-ranked English browser voices — the "3 default options" to choose from. */
export function listBrowserVoices(limit = 3): BrowserVoiceOption[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return [];
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  const ranked = [...pool].sort((a, b) => voiceScore(b) - voiceScore(a));
  // De-dupe by name (some engines list the same voice twice).
  const seen = new Set<string>();
  const out: BrowserVoiceOption[] = [];
  for (const v of ranked) {
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    out.push({ uri: v.voiceURI, name: cleanVoiceName(v.name), lang: v.lang });
    if (out.length >= limit) break;
  }
  return out;
}

function cleanVoiceName(n: string): string {
  // Trim the noisy "Microsoft X Online (Natural) - English (US)" style names.
  return n.replace(/^Microsoft\s+/i, "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+-\s+.*$/, "").trim() || n;
}

/**
 * getVoices() is populated asynchronously — kick it once so a voice is ready by
 * the time we first speak (call this on app mount / the setup screen).
 */
export function warmUpVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  } catch { /* ignore */ }
}

// Higher score = clearer/more natural, based on common OS/browser voices.
function voiceScore(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (/natural|neural|premium|enhanced/.test(n)) s += 50;
  if (/google/.test(n)) s += 30;
  if (/(aria|jenny|guy|libby|sonia|ryan)/.test(n)) s += 25; // MS online neural
  if (/(zira|david|mark|hazel)/.test(n)) s += 12;           // MS local
  if (/(samantha|alex|daniel|karen|moira)/.test(n)) s += 20; // Apple
  if (/en[-_]?us/i.test(v.lang)) s += 6;
  if (v.localService) s += 2; // lower latency, no network hiccup
  return s;
}

/**
 * Resolve which browser voice to speak with: an explicit preview URI wins, then
 * the user's saved choice, then the best-ranked English voice.
 */
function resolveBrowserVoice(synth: SpeechSynthesis, preferURI?: string): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const wantURI = preferURI ?? getBrowserVoiceURI() ?? undefined;
  if (wantURI) {
    const match = voices.find((v) => v.voiceURI === wantURI);
    if (match) return match;
  }
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  return [...pool].sort((a, b) => voiceScore(b) - voiceScore(a))[0] ?? null;
}

export function setVoiceEngine(engine: VoiceEngine) {
  localStorage.setItem(VOICE_ENGINE_KEY, engine);
}

export interface SpeakOptions {
  /** Override the configured engine for this utterance. */
  engine?: VoiceEngine;
  /** ElevenLabs / server voice id. Defaults to the stored pick. */
  voiceId?: string;
  /** Rate for the browser voice (0.1–10, default 1). */
  rate?: number;
  /** Pitch for the browser voice (0–2, default 1). */
  pitch?: number;
  /** Preview a specific browser voice (voiceURI) without saving it as the choice. */
  browserVoiceURI?: string;
  /** Fires ~per word for the browser engine (used to pulse the face). */
  onWord?: (charIndex: number) => void;
}

interface AtlasVoice {
  speaking: boolean;
  /** Speak text; resolves when finished. Empty text resolves immediately. */
  speak: (text: string, opts?: SpeakOptions) => Promise<void>;
  stop: () => void;
  /** True if the browser exposes speechSynthesis at all. */
  supported: boolean;
}

export function useAtlasVoice(): AtlasVoice {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stoppedRef = useRef(false);

  const supported =
    typeof window !== "undefined" &&
    ("speechSynthesis" in window || true); // server voice always available

  const stop = useCallback(() => {
    stoppedRef.current = true;
    try {
      window.speechSynthesis?.cancel();
    } catch { /* ignore */ }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const speakBrowser = useCallback(
    (text: string, opts: SpeakOptions) =>
      new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) return resolve();
        const synth = window.speechSynthesis;
        const u = new SpeechSynthesisUtterance(text);
        // A touch faster than default reads as confident and clear, not rushed.
        // Honors the user's saved rate ("talk faster / slow down").
        u.rate = opts.rate ?? getVoiceRate();
        u.pitch = opts.pitch ?? 1.0;
        u.volume = 1;
        u.voice = resolveBrowserVoice(synth, opts.browserVoiceURI);
        if (u.voice) u.lang = u.voice.lang;
        if (opts.onWord) {
          u.onboundary = (e) => {
            if (e.name === "word" || e.name === undefined) opts.onWord!(e.charIndex);
          };
        }
        // Safety net: some engines never fire onend — resolve on a length-based
        // estimate so the intro never hangs on a beat.
        const estMs = Math.min(20000, 900 + text.length * 55);
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        const timer = window.setTimeout(finish, estMs + 1500);
        u.onend = () => { window.clearTimeout(timer); finish(); };
        u.onerror = () => { window.clearTimeout(timer); finish(); };
        // Chrome occasionally pauses the queue; nudge it.
        try { synth.resume(); } catch { /* ignore */ }
        synth.speak(u);
      }),
    [],
  );

  const speakServer = useCallback(
    async (text: string, opts: SpeakOptions) => {
      const voiceId = opts.voiceId ?? localStorage.getItem(VOICE_ID_KEY) ?? undefined;
      const res = await fetch("/api/vision/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: voiceId }),
      });
      if (!res.ok) {
        // Fall back to the browser voice so we never go silent.
        return speakBrowser(text, opts);
      }
      const { audio, format } = (await res.json()) as { audio?: string; format?: string };
      if (!audio) return speakBrowser(text, opts);

      return new Promise<void>((resolve) => {
        const el = new Audio(`data:audio/${format ?? "mp3"};base64,${audio}`);
        audioRef.current = el;
        attachAmplitudeAnalyser(el);
        el.onended = () => {
          if (audioRef.current === el) audioRef.current = null;
          resolve();
        };
        el.onerror = () => resolve();
        void el.play().catch(() => resolve());
      });
    },
    [speakBrowser],
  );

  const speak = useCallback(
    async (text: string, opts: SpeakOptions = {}) => {
      // Emoji are a FACE animation, never speech — strip them so the TTS never
      // reads "grinning face". (The server /tts route strips too, so the
      // ElevenLabs path is covered even if a caller bypasses this hook.)
      const spoken = stripEmoji(text);
      if (!spoken.trim()) return;
      stoppedRef.current = false;
      setSpeaking(true);
      const engine = opts.engine ?? getVoiceEngine();
      try {
        if (engine === "server") await speakServer(spoken, opts);
        else await speakBrowser(spoken, opts);
      } finally {
        if (!stoppedRef.current) setSpeaking(false);
      }
    },
    [speakServer, speakBrowser],
  );

  return { speaking, speak, stop, supported };
}
