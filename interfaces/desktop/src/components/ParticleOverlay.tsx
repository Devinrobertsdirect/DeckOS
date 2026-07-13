import { useEffect, useRef } from "react";
import { useVisualMode } from "@/contexts/VisualMode";
import { useActivityLevel } from "@/contexts/WebSocketContext";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  opacity: number;
  char: string;
  size: number;
  trail: number;
  tier: "bg" | "mid" | "accent";
  charTimer: number;
}

interface Streak {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  life: number;
  maxLife: number;
}

const DATA_CHARS  = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>[]{}|/\\+-=_~·";
const COORD_CHARS = "0123456789ABCDEF.,";

function randomChar(tier: Particle["tier"]) {
  const pool = tier === "accent" ? COORD_CHARS : DATA_CHARS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function readPrimaryRgb(): string {
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary-rgb")
    .trim();
  return val || "63, 132, 243";
}

export function ParticleOverlay() {
  const { mode, particlePrefs } = useVisualMode();
  const activity = useActivityLevel();

  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const rafRef         = useRef<number>(0);
  const particlesRef   = useRef<Particle[]>([]);
  const streaksRef     = useRef<Streak[]>([]);
  const activityRef    = useRef<number>(0);
  const multiplierRef  = useRef<number>(1);
  const densityRef     = useRef<number>(particlePrefs.density);
  const speedRef       = useRef<number>(particlePrefs.speed);
  const pulseRef          = useRef<number>(0);
  const prevActivityRef   = useRef<number>(0);
  const pulseCooldownRef  = useRef<number>(0);

  useEffect(() => { activityRef.current = activity; }, [activity]);

  useEffect(() => { densityRef.current = particlePrefs.density; }, [particlePrefs.density]);
  useEffect(() => { speedRef.current   = particlePrefs.speed;   }, [particlePrefs.speed]);

  useEffect(() => {
    const isCinematic = mode === "cinematic";
    if (mode === "minimal" || (!isCinematic && !particlePrefs.particlesEnabled)) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cachedRgb = readPrimaryRgb();

    const colorObs = new MutationObserver(() => { cachedRgb = readPrimaryRgb(); });
    colorObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color"] });

    function getTargetCount(w: number, h: number): number {
      const base      = Math.max(Math.floor((w * h) / 9000), 32);
      const modeFactor = isCinematic ? 1.0 : 0.35;
      return Math.max(4, Math.round(base * (densityRef.current / 100) * modeFactor));
    }

    function spawnParticle(w: number, h: number, randomY = false): Particle {
      const r = Math.random();
      const tier: Particle["tier"] = r < 0.60 ? "bg" : r < 0.90 ? "mid" : "accent";

      const tiers = {
        bg:     { opacity: [0.04, 0.12], speed: [0.25, 0.7 ], size: [7,  10], trail: [2, 5] },
        mid:    { opacity: [0.10, 0.24], speed: [0.5,  1.4 ], size: [9,  13], trail: [3, 7] },
        accent: { opacity: [0.30, 0.55], speed: [0.8,  1.8 ], size: [10, 14], trail: [4, 9] },
      };
      const t = tiers[tier];

      return {
        x: Math.random() * w,
        y: randomY ? Math.random() * h : -20,
        vx: (Math.random() - 0.5) * 0.15,
        vy: t.speed[0] + Math.random() * (t.speed[1] - t.speed[0]),
        opacity: t.opacity[0] + Math.random() * (t.opacity[1] - t.opacity[0]),
        char: randomChar(tier),
        size: t.size[0] + Math.random() * (t.size[1] - t.size[0]),
        trail: Math.floor(t.trail[0] + Math.random() * (t.trail[1] - t.trail[0])),
        tier,
        charTimer: Math.floor(Math.random() * 40),
      };
    }

    function spawnStreak(w: number, h: number): Streak {
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        length: 60 + Math.random() * 140,
        speed: 4 + Math.random() * 8,
        opacity: 0.08 + Math.random() * 0.12,
        life: 0,
        maxLife: 30 + Math.random() * 20,
      };
    }

    function initParticles() {
      if (!canvas) return;
      particlesRef.current = Array.from(
        { length: getTargetCount(canvas.width, canvas.height) },
        () => spawnParticle(canvas.width, canvas.height, true)
      );
    }

    function resize() {
      if (!canvas) return;
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      initParticles();
    }

    let frameCount = 0;

    function draw() {
      if (!canvas || !ctx) return;
      frameCount++;

      // ── Activity multiplier ───────────────────────────────────────────
      const targetMultiplier = 1 + activityRef.current * 2.5;
      multiplierRef.current += (targetMultiplier - multiplierRef.current) * 0.04;
      const mult = multiplierRef.current;

      // ── Accent pulse on activity surge (rising-edge only) ─────────────
      const prevActivity = prevActivityRef.current;
      const curActivity  = activityRef.current;
      if (pulseCooldownRef.current > 0) {
        pulseCooldownRef.current--;
      }
      if (prevActivity <= 0.5 && curActivity > 0.5 && pulseCooldownRef.current === 0) {
        pulseRef.current        = 1;
        pulseCooldownRef.current = 18;
      }
      prevActivityRef.current = curActivity;
      if (pulseRef.current > 0) {
        pulseRef.current = Math.max(0, pulseRef.current - 1 / 60);
      }
      const pulse = pulseRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const w = canvas.width;
      const h = canvas.height;
      const rgb = cachedRgb;

      // ── Adjust particle count when density preference changes ─────────
      const target = getTargetCount(w, h);
      const particles = particlesRef.current;
      if (particles.length < target) {
        const toAdd = target - particles.length;
        for (let i = 0; i < toAdd; i++) {
          particles.push(spawnParticle(w, h, true));
        }
      } else if (particles.length > target) {
        particles.splice(target);
      }

      // ── Horizontal streaks (cinematic only) ──────────────────────────
      const streakInterval = Math.max(60, Math.round(180 - activityRef.current * 120));
      if (isCinematic && frameCount % streakInterval === 0 && Math.random() < 0.7) {
        streaksRef.current.push(spawnStreak(w, h));
      }

      streaksRef.current = streaksRef.current.filter((s) => {
        s.x += s.speed * mult;
        s.life++;
        const progress = s.life / s.maxLife;
        const fadeOut  = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
        const alpha    = s.opacity * fadeOut;

        const grad = ctx.createLinearGradient(s.x - s.length, s.y, s.x, s.y);
        grad.addColorStop(0, `rgba(${rgb}, 0)`);
        grad.addColorStop(0.6, `rgba(${rgb}, ${alpha})`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - s.length, s.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();

        return s.x - s.length < w && s.life < s.maxLife;
      });

      // ── Falling character particles ───────────────────────────────────
      const speedMult = speedRef.current / 100;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.charTimer--;
        if (p.charTimer <= 0) {
          p.char = randomChar(p.tier);
          p.charTimer = p.tier === "accent"
            ? Math.floor(20 + Math.random() * 40)
            : Math.floor(5  + Math.random() * 25);
        }

        ctx.font = `${p.size}px 'JetBrains Mono', monospace`;

        for (let t = 0; t < p.trail; t++) {
          const trailY = p.y - t * (p.size * 1.35);
          const trailOpacity = p.opacity * Math.pow(1 - t / p.trail, 1.8);
          ctx.fillStyle = `rgba(${rgb}, ${trailOpacity})`;
          ctx.fillText(p.char, p.x, trailY);
        }

        if (p.tier === "accent") {
          const baseOpacity   = Math.min(p.opacity * 1.8, 0.9);
          const pulsedOpacity = baseOpacity + pulse * (0.95 - baseOpacity);
          ctx.fillStyle = `rgba(${rgb}, ${pulsedOpacity})`;
          ctx.fillText(p.char, p.x, p.y);
        }

        p.x += p.vx;
        p.y += p.vy * mult * speedMult;

        if (p.y - p.trail * p.size * 1.35 > h || p.x < -20 || p.x > w + 20) {
          particles[i] = spawnParticle(w, h, false);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    resize();
    rafRef.current = requestAnimationFrame(draw);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      colorObs.disconnect();
    };
  }, [mode, particlePrefs.particlesEnabled]);

  if (mode === "minimal" || (mode !== "cinematic" && !particlePrefs.particlesEnabled)) return null;

  return (
    <canvas
      ref={canvasRef}
      className="particle-overlay"
      aria-hidden="true"
    />
  );
}
