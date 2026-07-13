/**
 * ConnectParticles — full-screen canvas burst animation
 *
 * Plays a one-shot particle effect when ACERA or Stark Connect goes active.
 * The two variants are visually distinct in theme and motion:
 *
 *  acera — smooth radial burst + expanding sonar rings + horizontal scan line
 *          origin: bottom-right  colors: cyan / teal
 *
 *  stark — energetic bioelectric spike burst + heartbeat ring + EKG line
 *          origin: bottom-left   colors: red / orange / amber
 *
 * Component self-destructs by calling onComplete when animation finishes.
 * pointer-events: none so it never blocks clicks.
 */

import { useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ParticleVariant = "acera" | "stark";

interface ConnectParticlesProps {
  variant: ParticleVariant;
  onComplete: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  /** acera: "orb" floats; stark: "spike" shoots vertical then arcs */
  kind: "orb" | "spike" | "dust";
}

interface Ring {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  strokeWidth: number;
  /** stark rings contract after expanding (heartbeat feel) */
  mode: "expand" | "pulse";
}

// ── Palette ───────────────────────────────────────────────────────────────────

const ACERA_COLORS = ["#00d4ff", "#4dd8e1", "#00b4d8", "#80deea", "#caf0f8", "#ffffff"];
const STARK_COLORS = ["#ff4444", "#ff6a00", "#ffc820", "#ff2d55", "#ffaa00", "#ff8c42"];

const DURATION_MS = 2800;

// ── Component ─────────────────────────────────────────────────────────────────

export function ConnectParticles({ variant, onComplete }: ConnectParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width  = W;
    canvas.height = H;

    // Origin near the respective overlay (inside the viewport)
    const OX = variant === "acera" ? W - 48 : 48;
    const OY = H - 96;

    const colors     = variant === "acera" ? ACERA_COLORS : STARK_COLORS;
    const accentColor = colors[0]!;
    const particles: Particle[] = [];
    const rings: Ring[]         = [];
    let   scanLineY   = -1;    // only used by acera
    let   ekgProgress = 0;     // only used by stark, 0-1

    // ── Build initial particles ───────────────────────────────────────────────

    const PARTICLE_COUNT = variant === "acera" ? 70 : 90;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const c = colors[Math.floor(Math.random() * colors.length)]!;

      if (variant === "acera") {
        // Spread in a 200° arc aimed up-left from bottom-right origin
        const angle = Math.PI * (0.6 + Math.random() * 1.1);
        const speed = 0.8 + Math.random() * 3.5;
        const maxLife = 60 + Math.random() * 100;
        particles.push({
          x: OX + (Math.random() - 0.5) * 24,
          y: OY + (Math.random() - 0.5) * 24,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife,
          maxLife,
          size: 1 + Math.random() * 3,
          color: c,
          kind: Math.random() > 0.4 ? "orb" : "dust",
        });
      } else {
        // Stark: energetic — majority shoot upward, some arc sideways
        const angle = Math.PI * (-0.35 + Math.random() * 1.1); // up-right cone
        const speed = 1.2 + Math.random() * 5;
        const maxLife = 40 + Math.random() * 80;
        particles.push({
          x: OX + (Math.random() - 0.5) * 28,
          y: OY + (Math.random() - 0.5) * 28,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife,
          maxLife,
          size: 0.8 + Math.random() * 3.5,
          color: c,
          kind: Math.random() > 0.6 ? "spike" : "dust",
        });
      }
    }

    // ── Build rings ───────────────────────────────────────────────────────────

    if (variant === "acera") {
      // Three sonar rings, staggered delay handled via reduced initial life
      for (let r = 0; r < 3; r++) {
        rings.push({
          x: OX, y: OY,
          radius:    0,
          maxRadius: 260 + r * 80,
          life:      90 + r * 22,
          maxLife:   90 + r * 22,
          color:     accentColor,
          strokeWidth: 1.5 - r * 0.3,
          mode: "expand",
        });
      }
      scanLineY = H; // will sweep upward
    } else {
      // Two heartbeat-style rings (expand fast, fade)
      for (let r = 0; r < 2; r++) {
        rings.push({
          x: OX, y: OY,
          radius:    0,
          maxRadius: 180 + r * 120,
          life:      70 + r * 20,
          maxLife:   70 + r * 20,
          color:     r === 0 ? "#ff4444" : "#ffc820",
          strokeWidth: 2 - r * 0.5,
          mode: "pulse",
        });
      }
    }

    // ── Animation loop ────────────────────────────────────────────────────────

    const startMs  = performance.now();
    let   rafId    = 0;
    let   spawnBudget = 0;

    const animate = (now: number) => {
      const elapsed  = now - startMs;
      const progress = Math.min(elapsed / DURATION_MS, 1);

      if (progress >= 1) {
        ctx.clearRect(0, 0, W, H);
        onComplete();
        return;
      }

      ctx.clearRect(0, 0, W, H);

      // Global alpha: fade in quickly, linger, fade out
      const globalAlpha =
        progress < 0.08 ? progress / 0.08
        : progress > 0.72 ? 1 - (progress - 0.72) / 0.28
        : 1;

      // ── Rings ───────────────────────────────────────────────────────────────
      for (const ring of rings) {
        if (ring.life <= 0) continue;
        const rp  = 1 - ring.life / ring.maxLife;
        ring.radius = ring.maxRadius * rp;
        ring.life--;

        const ringAlpha = (ring.life / ring.maxLife) * globalAlpha;

        ctx.save();
        ctx.globalAlpha   = ringAlpha * 0.7;
        ctx.strokeStyle   = ring.color;
        ctx.lineWidth     = ring.strokeWidth;
        ctx.shadowColor   = ring.color;
        ctx.shadowBlur    = 8;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, Math.max(1, ring.radius), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ── ACERA scan line ──────────────────────────────────────────────────────
      if (variant === "acera" && progress < 0.45) {
        const speed = H / (DURATION_MS * 0.45 / 16.67); // travel full height in 45% of duration
        scanLineY = Math.max(0, scanLineY - speed);

        const lAlpha = (1 - progress / 0.45) * globalAlpha * 0.35;
        ctx.save();
        ctx.globalAlpha = lAlpha;
        const grad = ctx.createLinearGradient(0, scanLineY - 12, 0, scanLineY + 4);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(1, "#00d4ff");
        ctx.fillStyle = grad;
        ctx.fillRect(0, scanLineY - 12, W, 16);
        ctx.restore();
      }

      // ── STARK EKG line ───────────────────────────────────────────────────────
      if (variant === "stark" && progress < 0.35) {
        ekgProgress = Math.min(progress / 0.35, 1);
        const lineY = OY + 20;
        const lineX = W * ekgProgress;

        ctx.save();
        ctx.globalAlpha = (1 - progress / 0.35) * globalAlpha * 0.6;
        ctx.strokeStyle = "#ffc820";
        ctx.lineWidth   = 1.5;
        ctx.shadowColor = "#ffc820";
        ctx.shadowBlur  = 6;

        // Draw EKG spike pattern up to ekgProgress position
        ctx.beginPath();
        const seg = lineX;
        ctx.moveTo(0, lineY);
        if (seg > W * 0.25) {
          ctx.lineTo(W * 0.25, lineY);
          if (seg > W * 0.30) {
            ctx.lineTo(W * 0.30, lineY - 40);
            if (seg > W * 0.34) {
              ctx.lineTo(W * 0.34, lineY + 18);
              if (seg > W * 0.38) {
                ctx.lineTo(W * 0.38, lineY);
              } else {
                ctx.lineTo(seg, lineY + (seg - W * 0.34) / (W * 0.04) * 18);
              }
            } else {
              ctx.lineTo(seg, lineY - 40 + (seg - W * 0.30) / (W * 0.04) * 58);
            }
          } else {
            ctx.lineTo(seg, lineY - (seg - W * 0.25) / (W * 0.05) * 40);
          }
        } else {
          ctx.lineTo(seg, lineY);
        }
        ctx.stroke();
        ctx.restore();
      }

      // ── Particles ────────────────────────────────────────────────────────────
      for (const p of particles) {
        if (p.life <= 0) continue;

        // Physics
        p.x += p.vx;
        p.y += p.vy;
        if (p.kind === "orb")   { p.vy += 0.04; p.vx *= 0.992; }  // gentle gravity + drag
        if (p.kind === "spike") { p.vy += 0.08; p.vx *= 0.98;  }  // sharper arc
        if (p.kind === "dust")  { p.vy += 0.02; p.vx *= 0.995; }
        p.life--;

        const lifeRatio = p.life / p.maxLife;
        const a = lifeRatio * globalAlpha;
        if (a <= 0) continue;

        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle   = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur  = p.size * (p.kind === "dust" ? 2 : 5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, p.size * lifeRatio), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Spawn continuous particles in first 50% ──────────────────────────────
      if (progress < 0.5) {
        spawnBudget += variant === "acera" ? 1.2 : 1.8;
        while (spawnBudget >= 1) {
          spawnBudget--;
          const c = colors[Math.floor(Math.random() * colors.length)]!;

          if (variant === "acera") {
            const angle = Math.PI * (0.6 + Math.random() * 1.1);
            const speed = 0.4 + Math.random() * 2;
            const maxLife = 40 + Math.random() * 60;
            particles.push({ x: OX, y: OY, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, life: maxLife, maxLife, size: 0.5 + Math.random()*2, color: c, kind: "dust" });
          } else {
            const angle = Math.PI * (-0.35 + Math.random() * 1.1);
            const speed = 0.8 + Math.random() * 3;
            const maxLife = 30 + Math.random() * 50;
            particles.push({ x: OX, y: OY, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, life: maxLife, maxLife, size: 0.5 + Math.random()*2.5, color: c, kind: "dust" });
          }
        }
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, W, H);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9998, width: "100vw", height: "100vh" }}
    />
  );
}
