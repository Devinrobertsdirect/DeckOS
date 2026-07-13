/**
 * useAceraConnect — ACERA (Advanced Computer Enhanced Reality Awareness) hook
 *
 * Manages the full MediaPipe tracking lifecycle:
 *  1. Camera access
 *  2. HandLandmarker initialization (WASM from CDN)
 *  3. requestAnimationFrame detection loop
 *  4. Gesture classification via aceraGestures
 *  5. WebSocket scene update broadcast (500ms cadence)
 *  6. Stable gesture latch (gesture must hold 400ms before firing)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  detectGesture,
  inferActivity,
  buildSceneSummary,
  gestureToDashboardAction,
  type Gesture,
  type GestureResult,
  type DashboardAction,
  type SceneActivity,
} from "@/lib/aceraGestures";
import { useWebSocket } from "@/contexts/WebSocketContext";

export const ACERA_KEY = "deckos_acera_enabled";

// How long (ms) a gesture must be held before it fires a dashboard action
const GESTURE_HOLD_MS = 400;
// How often (ms) we send scene context to the AI
const SCENE_EMIT_INTERVAL_MS = 500;

export type AceraStatus = "idle" | "loading" | "active" | "denied" | "error" | "unsupported";

export interface AceraHand {
  result: GestureResult;
  landmarks: Array<{ x: number; y: number; z: number }>;
}

export interface AceraState {
  enabled: boolean;
  status: AceraStatus;
  statusMessage: string;
  hands: AceraHand[];
  faceCount: number;
  dominantGesture: Gesture | null;
  activity: SceneActivity;
  pendingAction: DashboardAction;
  fps: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  toggle: () => void;
  clearAction: () => void;
}

export function useAceraConnect(): AceraState {
  const [enabled, setEnabled] = useState<boolean>(() => localStorage.getItem(ACERA_KEY) === "true");
  const [status, setStatus] = useState<AceraStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Initializing…");
  const [hands, setHands] = useState<AceraHand[]>([]);
  const [faceCount] = useState(0);
  const [dominantGesture, setDominantGesture] = useState<Gesture | null>(null);
  const [activity, setActivity] = useState<SceneActivity>("idle");
  const [pendingAction, setPendingAction] = useState<DashboardAction>(null);
  const [fps, setFps] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<import("@mediapipe/tasks-vision").HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const frameCountRef = useRef(0);
  const fpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fpsCountRef = useRef(0);

  // Gesture latch
  const gestureHoldRef = useRef<{ gesture: Gesture; startMs: number } | null>(null);
  const firedGesturesRef = useRef(new Set<Gesture>());

  // Velocity tracking for swipe detection
  const prevPalmXRef = useRef<number | null>(null);
  const prevPalmYRef = useRef<number | null>(null);

  const { sendEvent } = useWebSocket();

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(ACERA_KEY, String(next));
      return next;
    });
  }, []);

  const clearAction = useCallback(() => {
    setPendingAction(null);
    firedGesturesRef.current.clear();
  }, []);

  // ── Init / teardown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setStatusMessage("ACERA Connect disabled");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      setStatusMessage("Camera not supported in this browser");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setStatusMessage("Requesting camera access…");

    async function init() {
      // 1. Camera
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
      } catch {
        if (cancelled) return;
        setStatus("denied");
        setStatusMessage("Camera access denied — check browser permissions");
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      streamRef.current = stream;

      // Attach stream to hidden video element
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(video);
      videoRef.current = video;
      await video.play().catch(() => {});

      // 2. MediaPipe HandLandmarker
      setStatusMessage("Loading gesture engine (MediaPipe WASM)…");
      try {
        const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm",
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 2,
        });
        if (cancelled) { landmarker.close(); return; }
        landmarkerRef.current = landmarker;
      } catch (err) {
        if (cancelled) return;
        console.error("[ACERA] MediaPipe load failed:", err);
        setStatus("error");
        setStatusMessage("Gesture engine failed to load — check network");
        return;
      }

      if (cancelled) return;
      setStatus("active");
      setStatusMessage("ACERA tracking active");

      // 3. FPS counter
      fpsTimerRef.current = setInterval(() => {
        setFps(fpsCountRef.current * 2); // 500ms interval → ×2
        fpsCountRef.current = 0;
      }, 500);

      // 4. Detection loop
      let lastTs = -1;
      function detect() {
        if (cancelled || !landmarkerRef.current || !videoRef.current) return;
        const video = videoRef.current;
        if (video.readyState < 2) { rafRef.current = requestAnimationFrame(detect); return; }

        const nowMs = performance.now();
        if (lastTs === nowMs) { rafRef.current = requestAnimationFrame(detect); return; }
        lastTs = nowMs;

        const result = landmarkerRef.current.detectForVideo(video, nowMs);
        fpsCountRef.current++;
        frameCountRef.current++;

        // Map results to AceraHands
        const aceraHands: AceraHand[] = result.landmarks.map((lm, i) => {
          const side = (result.handedness[i]?.[0]?.categoryName ?? "Right") as "Left" | "Right";
          const prevX = prevPalmXRef.current;
          const prevY = prevPalmYRef.current;
          const palmX = lm[0]!.x;
          const palmY = lm[0]!.y;
          const velX = prevX !== null ? palmX - prevX : 0;
          const velY = prevY !== null ? palmY - prevY : 0;
          prevPalmXRef.current = palmX;
          prevPalmYRef.current = palmY;
          return {
            result: detectGesture(lm, side, velX, velY),
            landmarks: lm,
          };
        });

        setHands(aceraHands);

        // Dominant hand = first detected
        const dom = aceraHands[0]?.result ?? null;
        const domGesture = dom?.gesture ?? null;
        setDominantGesture(domGesture);

        const act = inferActivity(aceraHands.length, domGesture, fps);
        setActivity(act);

        // ── Gesture latch + action fire ───────────────────────────────────
        if (domGesture && domGesture !== "UNKNOWN") {
          const held = gestureHoldRef.current;
          if (held && held.gesture === domGesture) {
            if (
              nowMs - held.startMs >= GESTURE_HOLD_MS &&
              !firedGesturesRef.current.has(domGesture)
            ) {
              const action = gestureToDashboardAction(domGesture);
              if (action) {
                setPendingAction(action);
                firedGesturesRef.current.add(domGesture);
              }
            }
          } else {
            gestureHoldRef.current = { gesture: domGesture, startMs: nowMs };
            // When gesture changes, allow it to fire again
            if (held && firedGesturesRef.current.has(held.gesture)) {
              firedGesturesRef.current.delete(held.gesture);
            }
          }
        } else {
          gestureHoldRef.current = null;
        }

        // ── Draw overlay on canvas ────────────────────────────────────────
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) drawOverlay(ctx, canvas, aceraHands, video);
        }

        // ── AI scene emit (rate-limited) ──────────────────────────────────
        if (nowMs - lastEmitRef.current >= SCENE_EMIT_INTERVAL_MS) {
          lastEmitRef.current = nowMs;
          const summary = buildSceneSummary(aceraHands.length, aceraHands.map((h) => h.result), 0, act, frameCountRef.current);
          sendEvent({
            type: "acera.scene.update",
            payload: {
              handCount: aceraHands.length,
              hands: aceraHands.map((h) => ({
                handedness: h.result.handedness,
                gesture: h.result.gesture,
                confidence: h.result.confidence,
                palmX: h.result.palmPosition.x,
                palmY: h.result.palmPosition.y,
                fingers: h.result.fingers,
              })),
              faceCount: 0,
              activity: act,
              dominantGesture: domGesture,
              summary,
              frameCount: frameCountRef.current,
            },
          });
        }

        rafRef.current = requestAnimationFrame(detect);
      }

      rafRef.current = requestAnimationFrame(detect);
    }

    void init();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        try { document.body.removeChild(videoRef.current); } catch {}
        videoRef.current = null;
      }
      setHands([]);
      setDominantGesture(null);
      setActivity("idle");
      setFps(0);
      frameCountRef.current = 0;
      fpsCountRef.current = 0;
    };
  }, [enabled, sendEvent]);

  return {
    enabled, status, statusMessage,
    hands, faceCount, dominantGesture, activity,
    pendingAction, fps,
    videoRef, canvasRef,
    toggle, clearAction,
  };
}

// ── Canvas overlay renderer ───────────────────────────────────────────────────

const CONNECTIONS = [
  // Thumb
  [0,1],[1,2],[2,3],[3,4],
  // Index
  [0,5],[5,6],[6,7],[7,8],
  // Middle
  [0,9],[9,10],[10,11],[11,12],
  // Ring
  [0,13],[13,14],[14,15],[15,16],
  // Pinky
  [0,17],[17,18],[18,19],[19,20],
  // Palm
  [5,9],[9,13],[13,17],
] as const;

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  aceraHands: AceraHand[],
  video: HTMLVideoElement,
) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // Mirror video onto canvas
  ctx.save();
  ctx.scale(-1, 1);
  ctx.translate(-w, 0);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  for (const hand of aceraHands) {
    const lm = hand.landmarks;
    const isRight = hand.result.handedness === "Right";
    const lineColor = isRight ? "#00d4ff" : "#ff6a00";
    const dotColor  = isRight ? "#ffffff" : "#ffcc00";

    // Connections
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.75;
    for (const [a, b] of CONNECTIONS) {
      const pa = lm[a]!;
      const pb = lm[b]!;
      ctx.beginPath();
      // Mirror x
      ctx.moveTo((1 - pa.x) * w, pa.y * h);
      ctx.lineTo((1 - pb.x) * w, pb.y * h);
      ctx.stroke();
    }

    // Dots
    ctx.globalAlpha = 0.95;
    for (const pt of lm) {
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc((1 - pt.x) * w, pt.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gesture label near wrist
    const wrist = lm[0]!;
    ctx.globalAlpha = 1;
    ctx.fillStyle = lineColor;
    ctx.font = "bold 11px monospace";
    ctx.fillText(hand.result.gesture, (1 - wrist.x) * w - 20, wrist.y * h + 20);
  }

  ctx.globalAlpha = 1;
}
