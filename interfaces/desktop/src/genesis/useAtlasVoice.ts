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

export function getVoiceEngine(): VoiceEngine {
  return (localStorage.getItem(VOICE_ENGINE_KEY) as VoiceEngine) || "browser";
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

/** Choose the clearest available English voice, ranked by known-good engines. */
function pickClearVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = en.length ? en : voices;
  // Higher score = clearer/more natural, based on common OS/browser voices.
  const score = (v: SpeechSynthesisVoice): number => {
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
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
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
        u.rate = opts.rate ?? 1.15;
        u.pitch = opts.pitch ?? 1.0;
        u.volume = 1;
        u.voice = pickClearVoice(synth);
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
