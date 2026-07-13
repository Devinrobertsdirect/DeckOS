import { useState, useRef, useCallback } from "react";

export type PlaybackState = "idle" | "speaking";

const MIME_FOR_FORMAT: Record<string, string> = {
  mp3:  "audio/mpeg",
  wav:  "audio/wav",
  ogg:  "audio/ogg",
  aac:  "audio/aac",
  webm: "audio/webm",
};

export function useAudioPlayback() {
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async (base64Audio: string, format = "mp3"): Promise<void> => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    const mime = MIME_FOR_FORMAT[format] ?? "audio/mpeg";

    return new Promise((resolve) => {
      const audio = new Audio(`data:${mime};base64,${base64Audio}`);
      audioRef.current = audio;
      setPlaybackState("speaking");

      const done = () => { setPlaybackState("idle"); resolve(); };
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlaybackState("idle");
  }, []);

  return { playbackState, speak, stop };
}
