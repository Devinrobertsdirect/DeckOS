import { useEffect, useRef, useState } from "react";
import { readAmplitude } from "@/lib/audioAnalyser";
import {
  AtlasFaceEngine,
  FACE_THEMES,
  type FaceMode,
  type FaceState,
  type FaceTheme,
} from "./atlasFaceEngine";

export { FACE_THEMES };
export type { FaceMode, FaceState, FaceTheme };

const THEME_KEY = "atlas_face_theme";

function readAccentRgb(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary-rgb")
      .trim() || "74,127,181" // Atlas steel-blue fallback
  );
}

export function readFaceTheme(): FaceTheme {
  const id = localStorage.getItem(THEME_KEY);
  return FACE_THEMES.find((t) => t.id === id) ?? FACE_THEMES[0]!;
}

export function saveFaceTheme(id: string) {
  localStorage.setItem(THEME_KEY, id);
  window.dispatchEvent(new CustomEvent("atlas:faceThemeChanged", { detail: id }));
}

export function useFaceTheme(): FaceTheme {
  const [theme, setTheme] = useState<FaceTheme>(readFaceTheme);
  useEffect(() => {
    const onChange = () => setTheme(readFaceTheme());
    window.addEventListener("atlas:faceThemeChanged", onChange);
    return () => window.removeEventListener("atlas:faceThemeChanged", onChange);
  }, []);
  return theme;
}

/**
 * Derive the face state from app-level flags. Priority mirrors the robot's
 * interaction loop: listening beats talking beats thinking.
 */
export function deriveFaceState(flags: {
  listening?: boolean;
  speaking?: boolean;
  thinking?: boolean;
  mood?: "happy" | "confused" | "excited" | null;
  charging?: boolean;
  sleeping?: boolean;
}): FaceState {
  if (flags.sleeping) return "sleeping";
  if (flags.charging) return "charging";
  if (flags.listening) return "listening";
  if (flags.mood) return flags.mood;
  if (flags.speaking) return "talking";
  if (flags.thinking) return "thinking";
  return "idle";
}

interface AtlasFaceProps {
  /** "atlas" = companion eyes; "neural" = node cluster; "auto" = morph on load. */
  mode?: FaceMode;
  state?: FaceState;
  size?: number;
  /** 0..1 hint of how hard the brain is working (drives the cluster). */
  activity?: number;
  /** Momentary eye-colour override "r,g,b" (mood shifts — red anger, etc.). */
  eyeColorOverride?: string | null;
  /** Momentary disc tint "r,g,b" — the face literally reddens when angry. */
  discTint?: string | null;
  className?: string;
}

/**
 * The Atlas face — the default "cute" companion face and the pulsating
 * neural-cluster face, per docs/FACE-SPEC.md. Square canvas, circular face.
 */
export function AtlasFace({
  mode = "auto",
  state = "idle",
  size = 120,
  activity = 0,
  eyeColorOverride = null,
  discTint = null,
  className = "",
}: AtlasFaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AtlasFaceEngine | null>(null);
  const theme = useFaceTheme();

  // Keep latest props in refs so the RAF loop never restarts.
  const propsRef = useRef({ mode, state, activity, theme, eyeColorOverride, discTint });
  propsRef.current = { mode, state, activity, theme, eyeColorOverride, discTint };

  useEffect(() => {
    if (!engineRef.current) engineRef.current = new AtlasFaceEngine();
    const engine = engineRef.current;
    let raf = 0;
    let accent = readAccentRgb();
    const accentObs = new MutationObserver(() => {
      accent = readAccentRgb();
    });
    accentObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color", "style"],
    });

    const loop = (now: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        const { mode: m, state: s, activity: a, theme: th, eyeColorOverride: eco, discTint: dt } = propsRef.current;
        engine.setMode(m);
        engine.setState(s, now);
        engine.draw(ctx, now, {
          size: canvas.width,
          amplitude: readAmplitude(),
          activity: a,
          eyeRgb: eco ?? th.eyeRgb ?? accent,
          tintRgb: dt ?? undefined,
          tintStrength: dt ? 0.4 : undefined,
          theme: th,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      accentObs.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{ display: "block", margin: "0 auto", width: size, height: size }}
      aria-label={`Atlas face — ${state}`}
      role="img"
    />
  );
}
