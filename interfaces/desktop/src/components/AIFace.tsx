import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { attachAmplitudeAnalyser, readAmplitude } from "@/lib/audioAnalyser";

export type FaceStyle = "vocoder" | "oscilloscope" | "iris" | "spectrum";
export { attachAmplitudeAnalyser };

interface Props {
  style: FaceStyle;
  speaking?: boolean;
  size?: number;
  color?: string;
  className?: string;
}

const TAU = Math.PI * 2;
const AMPLITUDE_THRESHOLD = 0.015;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// ─── Canvas color utilities ───────────────────────────────────────────────────
// Canvas 2D cannot parse CSS variables — we must resolve them first.

function readPrimaryRgb(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary-rgb")
      .trim() || "63, 132, 243"
  );
}

function resolveCanvasColor(color: string): string {
  if (!color.includes("var(")) return color;
  const rgb = readPrimaryRgb();
  // Preserve alpha from patterns like rgba(var(--primary-rgb), 0.3)
  const alphaMatch = color.match(/rgba\s*\(\s*var\([^)]+\)\s*,\s*([\d.]+)\s*\)/);
  if (alphaMatch) return `rgba(${rgb},${alphaMatch[1]})`;
  return `rgb(${rgb})`;
}

function dimCanvasColor(color: string, alpha: number): string {
  const c = resolveCanvasColor(color);
  if (c.startsWith("rgb(")) {
    return c.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }
  if (c.startsWith("#") && c.length === 7) {
    const a = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return c + a;
  }
  return c;
}

/**
 * Returns the current accent colour as a stable hex string and updates
 * whenever the user changes the colour scheme.
 */
export function useAccentHex(): string {
  const rgbToHex = () => {
    const rgb = readPrimaryRgb();
    const parts = rgb.split(",").map((s) => parseInt(s.trim(), 10));
    const [r = 63, g = 132, b = 243] = parts;
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  };

  const [hex, setHex] = useState<string>(rgbToHex);

  useEffect(() => {
    const obs = new MutationObserver(() => setHex(rgbToHex()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-color"],
    });
    return () => obs.disconnect();
  }, []);

  return hex;
}

function useAnimLoop(cb: (t: number) => void, active = true) {
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (!active) return;
    function loop(ts: number) {
      if (!startRef.current) startRef.current = ts;
      cbRef.current(ts - startRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);
}

function VocoderFace({ speaking, size, color }: { speaking: boolean; size: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>(Array.from({ length: 12 }, () => 0.1));
  const targetRef = useRef<number[]>(Array.from({ length: 12 }, () => 0.1));

  const tick = useCallback((t: number) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const W = size;
    const H = Math.round(size * 0.45);
    ctx.clearRect(0, 0, W, H);

    const now = t / 1000;
    const bars = barsRef.current;
    const targets = targetRef.current;
    const amplitude = readAmplitude();
    const isActive = speaking || amplitude > AMPLITUDE_THRESHOLD;

    if (amplitude > AMPLITUDE_THRESHOLD) {
      const scale = Math.min(amplitude * 2.2, 1);
      for (let i = 0; i < bars.length; i++) {
        const wave = scale * 0.9 * Math.abs(
          Math.sin(now * (2 + i * 0.4) + i * 0.7) *
          Math.sin(now * (1.3 + i * 0.2)),
        );
        targets[i] = 0.05 + wave;
      }
    } else if (speaking) {
      for (let i = 0; i < bars.length; i++) {
        const wave = 0.3 + 0.5 * Math.abs(
          Math.sin(now * (2 + i * 0.4) + i * 0.7) *
          Math.sin(now * (1.3 + i * 0.2)),
        );
        targets[i] = wave;
      }
    } else {
      for (let i = 0; i < bars.length; i++) {
        targets[i] = 0.08 + 0.06 * Math.abs(Math.sin(now * 0.7 + i * 0.5));
      }
    }

    for (let i = 0; i < bars.length; i++) {
      bars[i] = lerp(bars[i]!, targets[i]!, isActive ? 0.22 : 0.08);
    }

    const barW = Math.floor((W - 8) / bars.length) - 2;
    const gap = 2;
    const startX = (W - bars.length * (barW + gap)) / 2;

    ctx.fillStyle = color;
    ctx.shadowBlur = isActive ? 8 : 2;
    ctx.shadowColor = color;

    for (let i = 0; i < bars.length; i++) {
      const barH = Math.round(bars[i]! * H * 0.9);
      const x = startX + i * (barW + gap);
      const y = (H - barH) / 2;
      const cornerR = Math.min(2, barW / 2);
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, cornerR);
      ctx.fill();
    }
  }, [speaking, size, color]);

  useAnimLoop(tick);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={Math.round(size * 0.45)}
      style={{ display: "block", margin: "0 auto" }}
    />
  );
}

function OscilloscopeFace({ speaking, size, color }: { speaking: boolean; size: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const tick = useCallback((t: number) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const W = size;
    const H = Math.round(size * 0.45);
    ctx.clearRect(0, 0, W, H);

    const now = t / 1000;
    const cy = H / 2;
    const amplitude = readAmplitude();
    const isActive = speaking || amplitude > AMPLITUDE_THRESHOLD;

    const waveAmp = amplitude > AMPLITUDE_THRESHOLD
      ? H * 0.42 * Math.min(amplitude * 2.5, 1)
      : speaking
        ? H * 0.38 * Math.abs(0.5 + 0.5 * Math.sin(now * 3.1))
        : H * 0.06;
    const freq = isActive ? 3 + 2 * Math.sin(now * 0.8) : 1.5;

    ctx.shadowBlur = isActive ? 12 : 3;
    ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let px = 0; px <= W; px++) {
      const x = px / W;
      const y = cy + waveAmp * Math.sin(x * TAU * freq + now * 8);
      if (px === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();

    if (isActive) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let px = 0; px <= W; px++) {
        const x = px / W;
        const y = cy + waveAmp * 0.6 * Math.sin(x * TAU * (freq * 1.5) + now * 10 + 1.2);
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [speaking, size, color]);

  useAnimLoop(tick);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={Math.round(size * 0.45)}
      style={{ display: "block", margin: "0 auto" }}
    />
  );
}

function IrisFace({ speaking, size, color }: { speaking: boolean; size: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const openRef = useRef(0.4);
  const targetOpenRef = useRef(0.4);

  const tick = useCallback((t: number) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const W = size;
    const H = size;
    ctx.clearRect(0, 0, W, H);

    const now = t / 1000;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) * 0.42;
    const amplitude = readAmplitude();
    const isActive = speaking || amplitude > AMPLITUDE_THRESHOLD;

    if (amplitude > AMPLITUDE_THRESHOLD) {
      targetOpenRef.current = 0.28 + Math.min(amplitude * 2.5, 0.68);
    } else if (speaking) {
      targetOpenRef.current = 0.45 + 0.35 * Math.abs(Math.sin(now * 4.5));
    } else {
      targetOpenRef.current = 0.25 + 0.08 * Math.abs(Math.sin(now * 0.5));
    }
    openRef.current = lerp(openRef.current, targetOpenRef.current, 0.15);

    const aperture = openRef.current;
    const BLADES = 8;

    ctx.shadowBlur = isActive ? 14 : 4;
    ctx.shadowColor = color;

    for (let i = 0; i < BLADES; i++) {
      const angle = (i / BLADES) * TAU + now * (isActive ? 0.4 : 0.12);
      const innerAngle = aperture * TAU / BLADES;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      const outerR = r;
      const innerR = r * (1 - aperture * 1.1);

      ctx.beginPath();
      ctx.moveTo(0, -innerR);
      ctx.arc(0, 0, outerR, -Math.PI / 2 - innerAngle, -Math.PI / 2 + innerAngle);
      ctx.closePath();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r * aperture * 0.9, 0, TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [speaking, size, color]);

  useAnimLoop(tick);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ display: "block", margin: "0 auto" }}
    />
  );
}

function SpectrumFace({ speaking, size, color }: { speaking: boolean; size: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>(Array.from({ length: 24 }, () => 0.05));

  const tick = useCallback((t: number) => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const W = size;
    const H = Math.round(size * 0.55);
    ctx.clearRect(0, 0, W, H);

    const now = t / 1000;
    const bars = barsRef.current;
    const N = bars.length;
    const amplitude = readAmplitude();
    const isActive = speaking || amplitude > AMPLITUDE_THRESHOLD;

    for (let i = 0; i < N; i++) {
      let target: number;
      if (amplitude > AMPLITUDE_THRESHOLD) {
        const scale = Math.min(amplitude * 2.2, 1);
        const f1 = Math.sin(now * (1.5 + i * 0.15) + i * 0.4);
        const f2 = Math.sin(now * (3.2 + i * 0.08) + i * 0.9);
        const shape = Math.pow(1 - Math.abs(2 * i / N - 1), 0.4);
        target = 0.05 + scale * 0.85 * Math.abs(f1 * f2) * shape;
      } else if (speaking) {
        const f1 = Math.sin(now * (1.5 + i * 0.15) + i * 0.4);
        const f2 = Math.sin(now * (3.2 + i * 0.08) + i * 0.9);
        target = 0.08 + 0.75 * Math.abs(f1 * f2) * Math.pow(1 - Math.abs(2 * i / N - 1), 0.4);
      } else {
        target = 0.04 + 0.04 * Math.abs(Math.sin(now * 0.5 + i * 0.3));
      }
      bars[i] = lerp(bars[i]!, target, isActive ? 0.25 : 0.06);
    }

    const barW = (W - (N - 1) * 2) / N;
    const startX = (W - N * barW - (N - 1) * 2) / 2;

    for (let i = 0; i < N; i++) {
      const barH = Math.max(2, Math.round(bars[i]! * H * 0.92));
      const x = startX + i * (barW + 2);
      const y = H - barH;

      ctx.globalAlpha = isActive ? 0.4 + 0.6 * bars[i]! : 0.3 + 0.3 * bars[i]!;
      ctx.shadowBlur = isActive ? 6 : 0;
      ctx.shadowColor = color;

      const grad = ctx.createLinearGradient(x, y, x, H);
      grad.addColorStop(0, color);
      grad.addColorStop(1, dimCanvasColor(color, 0.267));
      ctx.fillStyle = grad;
      ctx.fillRect(Math.round(x), y, Math.max(1, Math.round(barW)), barH);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }, [speaking, size, color]);

  useAnimLoop(tick);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={Math.round(size * 0.55)}
      style={{ display: "block", margin: "0 auto" }}
    />
  );
}

export function AIFace({ style, speaking = false, size = 120, color = "#3f84f3", className = "" }: Props) {
  const isSquare = style === "iris";
  const resolvedColor = useMemo(() => resolveCanvasColor(color), [color]);

  return (
    <div className={className} style={{ width: size, height: isSquare ? size : Math.round(size * 0.55) }}>
      {style === "vocoder" && <VocoderFace speaking={speaking} size={size} color={resolvedColor} />}
      {style === "oscilloscope" && <OscilloscopeFace speaking={speaking} size={size} color={resolvedColor} />}
      {style === "iris" && <IrisFace speaking={speaking} size={size} color={resolvedColor} />}
      {style === "spectrum" && <SpectrumFace speaking={speaking} size={size} color={resolvedColor} />}
    </div>
  );
}

const VALID_FACE_STYLES: FaceStyle[] = ["vocoder", "oscilloscope", "iris", "spectrum"];

function readFaceStyle(): FaceStyle {
  const raw = localStorage.getItem("deckos_face_style");
  return (VALID_FACE_STYLES.includes(raw as FaceStyle) ? raw : "vocoder") as FaceStyle;
}

export function saveFaceStyle(style: FaceStyle) {
  localStorage.setItem("deckos_face_style", style);
  window.dispatchEvent(new CustomEvent("deckos:faceChanged", { detail: style }));
}

export function useFaceStyle(): FaceStyle {
  const [style, setStyle] = useState<FaceStyle>(readFaceStyle);

  useEffect(() => {
    function onFaceChanged(e: Event) {
      setStyle((e as CustomEvent<FaceStyle>).detail ?? readFaceStyle());
    }
    window.addEventListener("deckos:faceChanged", onFaceChanged);
    return () => window.removeEventListener("deckos:faceChanged", onFaceChanged);
  }, []);

  return style;
}
