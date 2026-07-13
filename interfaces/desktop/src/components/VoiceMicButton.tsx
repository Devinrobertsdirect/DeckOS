import { useCallback, useRef, useState } from "react";
import { Mic, MicOff, Loader2, Volume2 } from "lucide-react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { VOICE_KEY } from "@/components/CinematicOnboarding";

export type VoicePipelineState =
  | "idle"
  | "listening"
  | "transcribing"
  | "chatting"
  | "speaking"
  | "error";

interface VoiceMicButtonProps {
  onTranscript: (transcript: string) => Promise<string>;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
}

const STATE_LABEL: Record<VoicePipelineState, string> = {
  idle:        "HOLD TO SPEAK",
  listening:   "LISTENING…",
  transcribing:"TRANSCRIBING…",
  chatting:    "THINKING…",
  speaking:    "SPEAKING…",
  error:       "ERROR",
};

export function VoiceMicButton({ onTranscript, disabled = false, className = "", compact = false }: VoiceMicButtonProps) {
  const [pipelineState, setPipelineState] = useState<VoicePipelineState>("idle");
  const [errorMsg, setErrorMsg]           = useState<string | null>(null);
  const { recorderState, micDenied, supported, startRecording, stopRecording, cancelRecording } = useVoiceRecorder();
  const { playbackState, speak } = useAudioPlayback();
  const isBusy = pipelineState !== "idle" && pipelineState !== "error";
  const pressedRef = useRef(false);

  const handleError = useCallback((msg: string) => {
    setPipelineState("error");
    setErrorMsg(msg);
    setTimeout(() => {
      setPipelineState("idle");
      setErrorMsg(null);
    }, 2500);
  }, []);

  const onPressStart = useCallback(async () => {
    if (disabled || isBusy || !supported || micDenied) return;
    pressedRef.current = true;
    setErrorMsg(null);
    try {
      await startRecording();
      setPipelineState("listening");
    } catch (e) {
      handleError(e instanceof Error ? e.message : "Mic error");
    }
  }, [disabled, isBusy, supported, micDenied, startRecording, handleError]);

  const onPressEnd = useCallback(async () => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    if (recorderState !== "listening" && pipelineState !== "listening") return;

    let base64Audio: string;
    try {
      base64Audio = await stopRecording();
    } catch {
      handleError("Recording failed");
      return;
    }

    if (!base64Audio || base64Audio.length < 100) {
      setPipelineState("idle");
      return;
    }

    try {
      setPipelineState("transcribing");
      const sttRes = await fetch("/api/vision/stt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64Audio }),
      });
      if (!sttRes.ok) {
        const d = await sttRes.json().catch(() => ({})) as { reason?: string };
        const msg = d.reason === "no-stt-key" ? "OpenAI key required" : "STT failed";
        handleError(msg);
        return;
      }
      const { transcript } = await sttRes.json() as { transcript: string };

      if (!transcript?.trim()) {
        setPipelineState("idle");
        return;
      }

      setPipelineState("chatting");
      const responseText = await onTranscript(transcript.trim());

      if (!responseText?.trim()) {
        setPipelineState("idle");
        return;
      }

      setPipelineState("speaking");
      const storedVoice = localStorage.getItem(VOICE_KEY) ?? undefined;
      const ttsRes = await fetch("/api/vision/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: responseText, voice: storedVoice }),
      });
      if (!ttsRes.ok) { setPipelineState("idle"); return; }
      const { audio, format } = await ttsRes.json() as { audio: string; format?: string };
      await speak(audio, format);
    } catch (e) {
      handleError(e instanceof Error ? e.message : "Voice pipeline error");
      return;
    }

    setPipelineState("idle");
  }, [recorderState, pipelineState, stopRecording, onTranscript, speak, handleError]);

  const onPressCancel = useCallback(() => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    cancelRecording();
    setPipelineState("idle");
  }, [cancelRecording]);

  if (!supported) return null;

  const isListening    = pipelineState === "listening";
  const isSpeaking     = pipelineState === "speaking" || playbackState === "speaking";
  const isProcessing   = pipelineState === "transcribing" || pipelineState === "chatting";
  const isError        = pipelineState === "error";
  const isDenied       = micDenied;

  const buttonBase = `relative flex items-center justify-center transition-all select-none touch-none ${compact ? "w-7 h-7" : "w-8 h-8"}`;
  const buttonColor = isError   ? "text-[#f03248] border-[#f03248]/40"
    : isDenied  ? "text-primary/20 border-primary/10 cursor-not-allowed"
    : isListening ? "text-[#f03248] border-[#f03248]/60"
    : isSpeaking  ? "text-[#11d97a] border-[#11d97a]/60"
    : isProcessing ? "text-[#ffc820] border-[#ffc820]/40"
    : "text-primary/50 border-primary/20 hover:text-primary hover:border-primary/40";

  const icon = isProcessing
    ? <Loader2 className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} animate-spin`} />
    : isSpeaking
    ? <Volume2 className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} animate-pulse`} />
    : isDenied
    ? <MicOff className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"}`} />
    : <Mic className={`${compact ? "w-3 h-3" : "w-3.5 h-3.5"} ${isListening ? "animate-pulse" : ""}`} />;

  return (
    <div className={`relative flex items-center gap-1.5 ${className}`}>
      {!compact && (pipelineState !== "idle") && (
        <span className={`font-mono text-[9px] uppercase tracking-wider ${isError ? "text-[#f03248]" : isListening ? "text-[#f03248]" : isSpeaking ? "text-[#11d97a]" : "text-[#ffc820]"}`}>
          {STATE_LABEL[pipelineState]}
        </span>
      )}
      {!compact && errorMsg && pipelineState === "error" && (
        <span className="font-mono text-[9px] text-[#f03248]/70 max-w-[80px] truncate">
          {errorMsg}
        </span>
      )}

      <button
        type="button"
        title={isDenied ? "Microphone access denied" : STATE_LABEL[pipelineState]}
        className={`${buttonBase} border ${buttonColor}`}
        aria-label="Voice input"
        disabled={disabled || isDenied || isProcessing || isSpeaking}
        onMouseDown={(e) => { e.preventDefault(); void onPressStart(); }}
        onMouseUp={() => void onPressEnd()}
        onMouseLeave={() => { if (pressedRef.current) onPressCancel(); }}
        onTouchStart={(e) => { e.preventDefault(); void onPressStart(); }}
        onTouchEnd={(e) => { e.preventDefault(); void onPressEnd(); }}
        onTouchCancel={() => onPressCancel()}
      >
        {isListening && (
          <span className="absolute inset-0 rounded-sm border border-[#f03248]/40 animate-ping opacity-40" />
        )}
        {icon}
      </button>
    </div>
  );
}
