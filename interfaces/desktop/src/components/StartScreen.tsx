import { useEffect, useMemo, useState } from "react";
import { Settings, ChevronDown, ChevronUp, Wifi, WifiOff, Film, Layers, Minimize2 } from "lucide-react";
import {
  applyColor,
  getStoredColor,
  isInitialized,
  type ColorScheme,
} from "@/components/Onboarding";
import { useVisualMode, type VisualMode } from "@/contexts/VisualMode";

interface Props {
  onStart: () => void;
}

const COLOR_HEX: Record<ColorScheme, string> = {
  blue:   "#3f84f3",
  green:  "#11d97a",
  yellow: "#ffc820",
  red:    "#f03248",
};
const COLOR_NAME: Record<ColorScheme, string> = {
  blue:   "COBALT",
  green:  "EMERALD",
  yellow: "AMBER",
  red:    "CRIMSON",
};

function HudCorners() {
  const SZ = 22;
  const W  = 2;
  const C  = "rgba(var(--primary-rgb),0.55)";
  const corner = (pos: string, rot: number) => (
    <svg
      key={pos}
      className={`absolute ${pos}`}
      width={SZ} height={SZ}
      style={{ transform: `rotate(${rot}deg)` }}
    >
      <path d={`M2,${SZ-2} L2,2 L${SZ-2},2`} fill="none" stroke={C} strokeWidth={W} />
    </svg>
  );
  return (
    <>
      {corner("top-3 left-3",   0)}
      {corner("top-3 right-3",  90)}
      {corner("bottom-3 right-3", 180)}
      {corner("bottom-3 left-3", 270)}
    </>
  );
}

const TITLE = "DECK OS";
const SUBTITLE = "INTELLIGENCE COMMAND SYSTEM";

export function StartScreen({ onStart }: Props) {
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [activeColor, setActiveColor]     = useState<ColorScheme>(getStoredColor());
  const [apiStatus, setApiStatus]         = useState<"checking" | "online" | "offline">("checking");
  const [blink, setBlink]                 = useState(true);
  const [typedTitle, setTypedTitle]       = useState("");
  const [typedSub, setTypedSub]           = useState("");
  const { mode, setMode }                 = useVisualMode();
  const returning                         = isInitialized();

  useEffect(() => {
    if (typedTitle.length < TITLE.length) {
      const id = setTimeout(() => setTypedTitle(TITLE.slice(0, typedTitle.length + 1)), 75);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [typedTitle]);

  useEffect(() => {
    if (typedTitle.length < TITLE.length) return undefined;
    if (typedSub.length < SUBTITLE.length) {
      const id = setTimeout(() => setTypedSub(SUBTITLE.slice(0, typedSub.length + 1)), 28);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [typedTitle, typedSub]);

  useEffect(() => {
    applyColor(getStoredColor());
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch("/api/healthz", { signal: AbortSignal.timeout(4000) });
        setApiStatus(r.ok ? "online" : "offline");
      } catch {
        setApiStatus("offline");
      }
    };
    check();
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setBlink(b => !b), 800);
    return () => clearInterval(iv);
  }, []);

  function changeColor(c: ColorScheme) {
    setActiveColor(c);
    applyColor(c);
    const raw = localStorage.getItem("jarvis.user");
    if (raw) {
      try {
        const cfg = JSON.parse(raw);
        localStorage.setItem("jarvis.user", JSON.stringify({ ...cfg, color: c }));
      } catch {}
    }
  }

  const fireflies = useMemo(() => {
    const seed = (n: number, s: number) => {
      let x = Math.sin(n * s + 1) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x:       seed(i, 3.7)  * 100,
      y:       seed(i, 5.3)  * 100,
      size:    2 + seed(i, 7.1) * 3.5,
      delay:   -(seed(i, 11.3) * 14),
      duration: 7  + seed(i, 13.7) * 9,
      dx1:     (seed(i, 17.1) - 0.5) * 160,
      dy1:     (seed(i, 19.3) - 0.5) * 120,
      dx2:     (seed(i, 23.7) - 0.5) * 200,
      dy2:     (seed(i, 29.1) - 0.5) * 140,
      opacity: 0.35 + seed(i, 31.7) * 0.65,
    }));
  }, []);

  const VISUAL_MODES: { id: VisualMode; label: string; Icon: React.FC<{ className?: string }> }[] = [
    { id: "minimal",   label: "MIN",  Icon: Minimize2 },
    { id: "standard",  label: "STD",  Icon: Layers     },
    { id: "cinematic", label: "CIN",  Icon: Film       },
  ];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background flex flex-col items-center justify-center">

      {/* ── Fireflies ───────────────────────────────── */}
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
        {fireflies.map(f => (
          <div
            key={f.id}
            style={{
              position:   "absolute",
              left:       `${f.x}%`,
              top:        `${f.y}%`,
              width:      `${f.size}px`,
              height:     `${f.size}px`,
              borderRadius: "50%",
              background: `rgba(var(--primary-rgb), ${f.opacity})`,
              boxShadow:  `0 0 ${f.size * 4}px ${f.size * 1.5}px rgba(var(--primary-rgb), ${f.opacity * 0.5})`,
              animation:  `ff-drift ${f.duration}s ${f.delay}s infinite ease-in-out`,
              "--dx1": `${f.dx1}px`,
              "--dy1": `${f.dy1}px`,
              "--dx2": `${f.dx2}px`,
              "--dy2": `${f.dy2}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* ── Scanline ────────────────────────────────── */}
      <div aria-hidden className="scanline pointer-events-none" />

      {/* ── HUD Corners ─────────────────────────────── */}
      <HudCorners />

      {/* ── Main Content ────────────────────────────── */}
      <div
        className="relative z-10 flex flex-col items-center gap-6 px-6 w-full max-w-sm"
        style={{ animation: "ss-fade-in 0.9s ease-out both" }}
      >
        {/* Tag line */}
        <div className="font-mono text-xs text-primary/40 tracking-[0.3em] uppercase">
          // COMMAND LAYER — ONLINE
        </div>

        {/* Identity — minimal typed title replaces large logo */}
        <div className="flex flex-col items-center gap-1 select-none">
          <div
            className="font-mono font-black tracking-[0.3em] uppercase"
            style={{
              fontSize: "clamp(2rem, 9vw, 3.25rem)",
              color: "hsl(var(--primary))",
              textShadow: "0 0 24px rgba(var(--primary-rgb),0.65), 0 0 60px rgba(var(--primary-rgb),0.25)",
              minHeight: "1.2em",
              letterSpacing: "0.3em",
            }}
          >
            {typedTitle}
            {typedTitle.length < TITLE.length && (
              <span style={{ opacity: blink ? 1 : 0 }}>▍</span>
            )}
          </div>
          <div
            className="font-mono tracking-[0.25em] uppercase"
            style={{
              fontSize: "clamp(7px, 1.5vw, 10px)",
              color: "rgba(var(--primary-rgb),0.35)",
              minHeight: "1em",
              letterSpacing: "0.25em",
            }}
          >
            {typedSub}
            {typedTitle.length >= TITLE.length && typedSub.length < SUBTITLE.length && (
              <span style={{ opacity: blink ? 1 : 0 }}>▍</span>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 w-full">
          <div className="flex-1 h-px bg-primary/25" />
          <div className="font-mono text-[10px] text-primary/30 tracking-widest">DEVIN C ROBERTS</div>
          <div className="flex-1 h-px bg-primary/25" />
        </div>

        {/* START button */}
        <button
          onClick={onStart}
          className="w-full font-mono font-bold text-xl tracking-[0.35em] uppercase py-4 border-2 transition-colors bg-transparent"
          style={{
            color: "hsl(var(--primary))",
            borderColor: "rgba(var(--primary-rgb), 0.9)",
            animation: "ss-start-blink 1.6s step-start infinite",
          }}
        >
          {returning ? "▸  RESUME" : "▸  START"}
        </button>

        {/* CONTINUE hint if returning */}
        {returning && (
          <p className="font-mono text-xs text-primary/30 tracking-widest -mt-3">
            COMMANDER PROFILE DETECTED
          </p>
        )}

        {/* Settings toggle */}
        <button
          onClick={() => setSettingsOpen(o => !o)}
          className="flex items-center gap-1.5 font-mono text-xs text-primary/40 hover:text-primary/70 transition-colors tracking-widest uppercase"
        >
          <Settings className="w-3 h-3" />
          SYSTEM SETTINGS
          {settingsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {/* Settings panel */}
        {settingsOpen && (
          <div
            className="w-full border border-primary/20 bg-card/70 p-4 font-mono text-xs flex flex-col gap-4"
            style={{ animation: "ss-fade-in 0.3s ease-out both" }}
          >
            {/* System status */}
            <div className="flex items-center justify-between">
              <span className="text-primary/40 uppercase tracking-widest">API STATUS</span>
              <span className="flex items-center gap-1.5">
                {apiStatus === "checking" && (
                  <span className="text-primary/40">CHECKING…</span>
                )}
                {apiStatus === "online" && (
                  <>
                    <Wifi className="w-3 h-3 text-green-400" />
                    <span className="text-green-400 tracking-wider">ONLINE</span>
                  </>
                )}
                {apiStatus === "offline" && (
                  <>
                    <WifiOff className="w-3 h-3 text-red-400" />
                    <span className="text-red-400 tracking-wider">OFFLINE</span>
                  </>
                )}
              </span>
            </div>

            <div className="h-px bg-primary/10" />

            {/* Color picker */}
            <div className="flex items-center justify-between">
              <span className="text-primary/40 uppercase tracking-widest">SYSTEM COLOR</span>
              <div className="flex gap-2">
                {(["blue", "green", "yellow", "red"] as ColorScheme[]).map(c => (
                  <button
                    key={c}
                    title={COLOR_NAME[c]}
                    onClick={() => changeColor(c)}
                    className="rounded-full transition-all duration-200"
                    style={{
                      width:       "14px",
                      height:      "14px",
                      background:  COLOR_HEX[c],
                      boxShadow:   activeColor === c
                        ? `0 0 8px 3px ${COLOR_HEX[c]}99, 0 0 0 2px ${COLOR_HEX[c]}`
                        : `0 0 4px 1px ${COLOR_HEX[c]}44`,
                      transform:   activeColor === c ? "scale(1.25)" : "scale(1)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="h-px bg-primary/10" />

            {/* Visual mode */}
            <div className="flex items-center justify-between">
              <span className="text-primary/40 uppercase tracking-widest">DISPLAY MODE</span>
              <div className="flex gap-1">
                {VISUAL_MODES.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setMode(id)}
                    className="flex items-center gap-1 px-2 py-1 border transition-colors text-[10px]"
                    style={{
                      borderColor: mode === id
                        ? "rgba(var(--primary-rgb), 0.8)"
                        : "rgba(var(--primary-rgb), 0.2)",
                      color: mode === id
                        ? "hsl(var(--primary))"
                        : "rgba(var(--primary-rgb), 0.4)",
                      background: mode === id
                        ? "rgba(var(--primary-rgb), 0.08)"
                        : "transparent",
                    }}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Footer ──────────────────────────────────── */}
      <div className="absolute bottom-5 inset-x-0 flex flex-col items-center gap-1 pointer-events-none">
        <div className="font-mono text-[9px] text-primary/20 tracking-[0.25em] uppercase">
          a devin c roberts software
        </div>
        <div className="font-mono text-[8px] text-primary/10 tracking-widest">
          v{new Date().getFullYear()}.04 — ALL RIGHTS RESERVED
        </div>
      </div>
    </div>
  );
}
