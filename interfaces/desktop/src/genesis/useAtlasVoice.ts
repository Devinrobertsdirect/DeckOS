import { useCallback, useEffect, useRef, useState } from "react";
import { attachAmplitudeAnalyser } from "@/lib/audioAnalyser";

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
        const u = new SpeechSynthesisUtterance(text);
        u.rate = opts.rate ?? 1;
        u.pitch = opts.pitch ?? 1;
        // Prefer a natural English voice if one is installed.
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) => /en[-_]?(US|GB)/i.test(v.lang) && /natural|google|zira|aria|jenny/i.test(v.name)) ??
          voices.find((v) => /en[-_]?(US|GB)/i.test(v.lang));
        if (preferred) u.voice = preferred;
        if (opts.onWord) {
          u.onboundary = (e) => {
            if (e.name === "word" || e.name === undefined) opts.onWord!(e.charIndex);
          };
        }
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
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
      if (!text.trim()) return;
      stoppedRef.current = false;
      setSpeaking(true);
      const engine = opts.engine ?? getVoiceEngine();
      try {
        if (engine === "server") await speakServer(text, opts);
        else await speakBrowser(text, opts);
      } finally {
        if (!stoppedRef.current) setSpeaking(false);
      }
    },
    [speakServer, speakBrowser],
  );

  return { speaking, speak, stop, supported };
}
