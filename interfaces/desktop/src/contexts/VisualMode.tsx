import { createContext, useContext, useState, useEffect } from "react";

export type VisualMode = "minimal" | "standard" | "cinematic";

export interface ParticlePrefs {
  density: number;
  speed: number;
  particlesEnabled: boolean;
}

const DEFAULT_PREFS: ParticlePrefs = { density: 100, speed: 100, particlesEnabled: false };

type VisualModeCtx = {
  mode: VisualMode;
  setMode: (m: VisualMode) => void;
  particlePrefs: ParticlePrefs;
  setParticlePrefs: (prefs: Partial<ParticlePrefs>) => void;
};

const VisualModeContext = createContext<VisualModeCtx>({
  mode: "standard",
  setMode: () => {},
  particlePrefs: DEFAULT_PREFS,
  setParticlePrefs: () => {},
});

function clampPref(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.max(10, Math.min(300, n));
}

function loadPrefs(): ParticlePrefs {
  try {
    const raw = localStorage.getItem("deckos_particle_prefs");
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        density:         clampPref(parsed.density ?? DEFAULT_PREFS.density),
        speed:           clampPref(parsed.speed   ?? DEFAULT_PREFS.speed),
        particlesEnabled: parsed.particlesEnabled === true,
      };
    }
  } catch {}
  return DEFAULT_PREFS;
}

export function VisualModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<VisualMode>(() => {
    try {
      return (localStorage.getItem("deckos_visual_mode") as VisualMode) ?? "standard";
    } catch {
      return "standard";
    }
  });

  const [particlePrefs, setParticlePrefsState] = useState<ParticlePrefs>(loadPrefs);

  const setMode = (m: VisualMode) => {
    setModeState(m);
    try { localStorage.setItem("deckos_visual_mode", m); } catch {}
    document.documentElement.setAttribute("data-visual-mode", m);
  };

  const setParticlePrefs = (prefs: Partial<ParticlePrefs>) => {
    setParticlePrefsState((prev) => {
      const next = { ...prev, ...prefs };
      try { localStorage.setItem("deckos_particle_prefs", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-visual-mode", mode);
  }, []);

  return (
    <VisualModeContext.Provider value={{ mode, setMode, particlePrefs, setParticlePrefs }}>
      {children}
    </VisualModeContext.Provider>
  );
}

export function useVisualMode() {
  return useContext(VisualModeContext);
}
