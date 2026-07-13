import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hands-free listening with low-latency semantic endpointing.
 *
 * The hard problem in voice UX is knowing when a person is ACTUALLY finished vs.
 * just thinking mid-sentence. Silence timers alone cut people off. We combine:
 *   1. Web Speech continuous recognition (interim + final results, ~instant).
 *   2. A semantic check on every pause: if the utterance so far trails off on a
 *      conjunction / filler / preposition ("I want to…", "and…", "because…"),
 *      we keep listening; if it reads as a complete thought, we send after a
 *      short grace window.
 *
 * While Atlas is speaking we go deaf (paused) so it never hears itself.
 * Falls back cleanly to unsupported when there's no SpeechRecognition (the
 * caller then keeps text input; the robot build uses its own Whisper+VAD stack).
 */

// ── Minimal Web Speech typings (not in the standard DOM lib) ──────────────────
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { readonly length: number; isFinal: boolean;[i: number]: SRAlternative }
interface SRResultList { readonly length: number;[i: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getSRCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Words that, when a sentence ends on them, signal "I'm not done thinking yet."
const CONTINUATION_WORDS = new Set([
  "and", "or", "but", "so", "because", "cause", "if", "when", "while", "as",
  "that", "which", "who", "whom", "whose", "than",
  "to", "for", "of", "with", "at", "in", "on", "by", "from", "into", "about",
  "my", "your", "our", "their", "his", "her", "its", "the", "a", "an",
  "is", "are", "was", "were", "am", "be", "been", "being", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "i", "we", "you", "he", "she", "they", "it",
  "then", "also", "plus", "like", "well", "actually", "basically", "literally",
  "um", "uh", "uhh", "er", "erm", "hmm", "mm", "eh",
  "gonna", "wanna", "gotta", "need", "want", "let", "lets", "let's",
  "im", "i'm", "ill", "i'll", "ive", "i've", "id", "i'd",
]);

// Two-word trailing phrases that also signal more is coming.
const CONTINUATION_PHRASES = [
  "i mean", "you know", "sort of", "kind of", "such as", "and then",
  "as well", "so that", "which is", "i think", "i guess", "or maybe",
];

/** Does this text read like a person is mid-thought (keep listening)? */
export function looksIncomplete(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.,!?;:]+$/, "");
  if (!t) return true;
  // A clear question or exclamation is complete.
  if (/[?!]$/.test(text.trim())) return false;
  const words = t.split(/\s+/);
  const last = words[words.length - 1] ?? "";
  const lastTwo = words.slice(-2).join(" ");
  if (CONTINUATION_PHRASES.includes(lastTwo)) return true;
  if (CONTINUATION_WORDS.has(last)) return true;
  // A single stray word is usually a false start — give it a moment.
  if (words.length < 2) return true;
  return false;
}

export interface AtlasListeningOptions {
  /** Master switch — true only in "talk" mode. */
  enabled: boolean;
  /** Temporarily deaf (e.g. while Atlas is speaking). */
  paused: boolean;
  /** Fires once per completed, semantically-ended utterance. */
  onUtterance: (text: string) => void;
  /** Live partial transcript for a caption (optional). */
  onInterim?: (text: string) => void;
  /** Grace after a complete-looking thought before sending (ms). Default 450. */
  completeGraceMs?: number;
  /** Max wait after a trailing-off pause before sending anyway (ms). Default 2200. */
  incompleteGraceMs?: number;
}

export function useAtlasListening(opts: AtlasListeningOptions) {
  const { enabled, paused, onUtterance, onInterim } = opts;
  const completeGraceMs = opts.completeGraceMs ?? 450;
  const incompleteGraceMs = opts.incompleteGraceMs ?? 2200;

  const supported = getSRCtor() !== null;
  const [listening, setListening] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const bufferRef = useRef("");           // finalized text not yet sent
  const sendTimerRef = useRef<number | null>(null);
  const runningRef = useRef(false);       // is a recognition instance active
  const wantRef = useRef(false);          // do we want to be listening right now

  // Keep the latest callbacks without restarting recognition.
  const onUtteranceRef = useRef(onUtterance);
  const onInterimRef = useRef(onInterim);
  onUtteranceRef.current = onUtterance;
  onInterimRef.current = onInterim;

  const clearSendTimer = () => {
    if (sendTimerRef.current !== null) {
      window.clearTimeout(sendTimerRef.current);
      sendTimerRef.current = null;
    }
  };

  const flush = useCallback(() => {
    clearSendTimer();
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    if (text) onUtteranceRef.current(text);
  }, []);

  const scheduleSend = useCallback(() => {
    clearSendTimer();
    const text = bufferRef.current.trim();
    if (!text) return;
    const delay = looksIncomplete(text) ? incompleteGraceMs : completeGraceMs;
    sendTimerRef.current = window.setTimeout(() => {
      sendTimerRef.current = null;
      flush();
    }, delay);
  }, [flush, completeGraceMs, incompleteGraceMs]);

  const stopRecognition = useCallback(() => {
    wantRef.current = false;
    clearSendTimer();
    const rec = recRef.current;
    recRef.current = null;
    runningRef.current = false;
    if (rec) {
      rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
      try { rec.abort(); } catch { /* ignore */ }
    }
    setListening(false);
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getSRCtor();
    if (!Ctor || runningRef.current) return;
    const rec = new Ctor();
    recRef.current = rec;
    wantRef.current = true;
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => { runningRef.current = true; setListening(true); };

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        const alt = r[0];
        if (!alt) continue;
        if (r.isFinal) {
          bufferRef.current = (bufferRef.current + " " + alt.transcript).trim();
        } else {
          interim += alt.transcript;
        }
      }
      if (interim && onInterimRef.current) {
        onInterimRef.current((bufferRef.current + " " + interim).trim());
      }
      // Any fresh speech means they're still going — cancel a pending send.
      if (interim) clearSendTimer();
      // A finalized chunk arrived → decide whether the thought is complete.
      if (bufferRef.current) scheduleSend();
    };

    rec.onerror = (ev) => {
      // "no-speech" / "aborted" are normal; just let onend restart us.
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed") {
        wantRef.current = false; // permission denied — stop trying
      }
    };

    rec.onend = () => {
      runningRef.current = false;
      setListening(false);
      // Continuous mode still ends periodically; restart if we still want to listen.
      if (wantRef.current) {
        window.setTimeout(() => { if (wantRef.current && !runningRef.current) safeStart(rec); }, 250);
      }
    };

    safeStart(rec);
  }, [scheduleSend]);

  // Reconcile desired state (enabled && !paused) with the recognition instance.
  useEffect(() => {
    if (!supported) return;
    if (enabled && !paused) {
      startRecognition();
    } else {
      // Going deaf: flush anything already captured so we don't lose a question.
      if (paused && bufferRef.current.trim()) flush();
      stopRecognition();
    }
    return () => { /* handled by the branch above on next run */ };
  }, [enabled, paused, supported, startRecognition, stopRecognition, flush]);

  useEffect(() => () => stopRecognition(), [stopRecognition]);

  return { supported, listening };
}

/** start() can throw "already started" during rapid restarts — swallow it. */
function safeStart(rec: SpeechRecognitionLike) {
  try { rec.start(); } catch { /* already running */ }
}
