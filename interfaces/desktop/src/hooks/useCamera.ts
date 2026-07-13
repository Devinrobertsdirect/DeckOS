import { useState, useEffect, useRef, useCallback } from "react";

const CAMERA_KEY    = "deckos_camera_enabled";
const INTERVAL_MS   = 30_000;
const CAPTURE_W     = 320;
const CAPTURE_H     = 240;
const API_BASE      = "/api";

export type CameraStatus = "idle" | "requesting" | "active" | "denied" | "unsupported";

export interface CameraState {
  status:          CameraStatus;
  enabled:         boolean;
  supported:       boolean;
  lastDescription: string | null;
  lastSeen:        Date   | null;
  isCapturing:     boolean;
  toggle:          () => void;
}

export function useCamera(): CameraState {
  const [enabled, setEnabled] = useState<boolean>(() => {
    const v = localStorage.getItem(CAMERA_KEY);
    return v !== "false";
  });
  const [status,      setStatus]      = useState<CameraStatus>("idle");
  const [lastDescription, setLastDescription] = useState<string | null>(null);
  const [lastSeen,    setLastSeen]    = useState<Date | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const streamRef  = useRef<MediaStream | null>(null);
  const videoEl    = useRef<HTMLVideoElement | null>(null);
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);
  const supported  = !!(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    if (!supported) { setStatus("unsupported"); return; }
    if (!enabled)   { setStatus("idle"); return; }

    setStatus("requesting");
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: CAPTURE_W, height: CAPTURE_H }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted      = true;
        video.playsInline = true;
        video.style.cssText = "position:fixed;opacity:0;width:1px;height:1px;pointer-events:none;top:-9999px;left:-9999px;";
        document.body.appendChild(video);
        videoEl.current = video;
        void video.play().catch(() => {});
        setStatus("active");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("denied");
        setEnabled(false);
        localStorage.setItem(CAMERA_KEY, "false");
      });

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoEl.current) {
        videoEl.current.pause();
        videoEl.current.srcObject = null;
        try { document.body.removeChild(videoEl.current); } catch {}
        videoEl.current = null;
      }
      setStatus("idle");
    };
  }, [enabled, supported]);

  const capture = useCallback(async () => {
    const video = videoEl.current;
    if (!video || !streamRef.current) return;
    setIsCapturing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width  = CAPTURE_W;
      canvas.height = CAPTURE_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
      const base64  = dataUrl.split(",")[1];
      if (!base64) return;

      const res = await fetch(`${API_BASE}/vision/ambient`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: base64, mimeType: "image/jpeg" }),
      });
      if (res.ok) {
        const data = await res.json() as { description: string };
        setLastDescription(data.description);
        setLastSeen(new Date());
      }
    } catch {
    } finally {
      setIsCapturing(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "active") return;
    void capture();
    intervalId.current = setInterval(() => void capture(), INTERVAL_MS);
    return () => {
      if (intervalId.current) clearInterval(intervalId.current);
    };
  }, [status, capture]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(CAMERA_KEY, String(next));
      return next;
    });
  }, []);

  return { status, enabled, supported, lastDescription, lastSeen, isCapturing, toggle };
}
