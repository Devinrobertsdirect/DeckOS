import { useState, useRef, useCallback } from "react";

export type RecorderState = "idle" | "listening";

const PREFERRED_MIME =
  typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.("audio/webm")
    ? "audio/webm"
    : "";

export function useVoiceRecorder() {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [micDenied, setMicDenied] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const streamRef   = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async (): Promise<void> => {
    if (recorderState !== "idle") return;
    setMicDenied(false);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setMicDenied(true);
      throw new Error("Microphone access denied");
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const opts: MediaRecorderOptions = {};
    if (PREFERRED_MIME) opts.mimeType = PREFERRED_MIME;

    const rec = new MediaRecorder(stream, opts);
    recorderRef.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    rec.start(100);
    setRecorderState("listening");
  }, [recorderState]);

  const stopRecording = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === "inactive") {
        cleanupStream();
        setRecorderState("idle");
        reject(new Error("No active recording"));
        return;
      }

      rec.onstop = () => {
        const mimeType = rec.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanupStream();
        setRecorderState("idle");

        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(",")[1] ?? "";
          resolve(base64);
        };
        reader.onerror = () => reject(new Error("Failed to read audio data"));
        reader.readAsDataURL(blob);
      };

      rec.stop();
    });
  }, []);

  function cleanupStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current  = [];
  }

  const cancelRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.stop();
    }
    cleanupStream();
    setRecorderState("idle");
  }, []);

  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  return { recorderState, micDenied, supported, startRecording, stopRecording, cancelRecording };
}
