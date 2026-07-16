import {
  createContext, useContext, useState, useEffect, useCallback,
  useRef, useMemo,
} from "react";
import { useLocation } from "wouter";
import { useWebSocket } from "@/contexts/WebSocketContext";

// ── Step definitions ──────────────────────────────────────────────────────────

export interface TutorialStep {
  id: string;
  title: string;
  desc: string;
  targetRoute?: string;
  actionHint?: string;
  completedBy: "auto" | "route" | "ws_event";
  wsEventType?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "System Online",
    desc: "You're at mission control — the SYS.HUD dashboard.",
    completedBy: "auto",
  },
  {
    id: "ai_chat",
    title: "Open AI Chat",
    desc: "Navigate to AI.ROUTER and have a conversation with your AI.",
    targetRoute: "/ai",
    actionHint: "Click AI.ROUTER in the sidebar",
    completedBy: "route",
  },
  {
    id: "send_message",
    title: "First Transmission",
    desc: "Send a message to your AI and receive a response.",
    targetRoute: "/ai",
    actionHint: "Type anything in the chat input and press Send",
    completedBy: "ws_event",
    wsEventType: "ai.chat.response",
  },
  {
    id: "customize_ai",
    title: "Shape Your AI",
    desc: "Visit AI.PERSONA to give your AI a name and personality.",
    targetRoute: "/ai/personality",
    actionHint: "Click AI.PERSONA in the sidebar",
    completedBy: "route",
  },
  {
    id: "explore_memory",
    title: "Check Memory",
    desc: "See what your AI remembers about you in MEMORY.BANK.",
    targetRoute: "/memory",
    actionHint: "Click MEMORY.BANK in the sidebar",
    completedBy: "route",
  },
  {
    id: "browse_plugins",
    title: "Browse Skills",
    desc: "Open the Plugin Store and see what you can add to DeckOS.",
    targetRoute: "/plugins/store",
    actionHint: "Click PLUGIN.STORE in the sidebar",
    completedBy: "route",
  },
  {
    id: "open_settings",
    title: "Configure Base",
    desc: "Visit Settings to connect an AI model and fine-tune DeckOS.",
    targetRoute: "/settings",
    actionHint: "Click SETTINGS in the sidebar",
    completedBy: "route",
  },
];

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "deckos_tutorial";

export type TutorialPhase = "prompt" | "active" | "dismissed";

interface TutorialData {
  phase: TutorialPhase;
  completedSteps: string[];
}

function loadData(): TutorialData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TutorialData;
  } catch {}
  // First time: suppress the old slideshow guide so we own the first-run UX
  try { localStorage.setItem("deckos_setup_guide_seen", "1"); } catch {}
  return { phase: "prompt", completedSteps: [] };
}

function saveData(d: TutorialData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch {}
}

// ── Context ───────────────────────────────────────────────────────────────────

interface TutorialContextValue {
  phase: TutorialPhase;
  steps: TutorialStep[];
  completedSteps: Set<string>;
  currentStep: TutorialStep | null;
  allDone: boolean;
  startTutorial: () => void;
  dismissTutorial: () => void;
  completeStep: (id: string) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error("useTutorial must be used inside TutorialProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<TutorialData>(loadData);
  const [location] = useLocation();
  const { events } = useWebSocket();
  const lastEventCountRef = useRef(0);

  const completedSteps = useMemo(() => new Set(data.completedSteps), [data.completedSteps]);

  const currentStep = useMemo(() => {
    if (data.phase !== "active") return null;
    return TUTORIAL_STEPS.find((s) => !completedSteps.has(s.id)) ?? null;
  }, [data.phase, completedSteps]);

  const allDone = data.phase === "active" && currentStep === null;

  // Stable completeStep — uses functional update to avoid stale closures
  const completeStep = useCallback((id: string) => {
    setData((prev) => {
      if (prev.completedSteps.includes(id)) return prev;
      const next: TutorialData = { ...prev, completedSteps: [...prev.completedSteps, id] };
      saveData(next);
      return next;
    });
  }, []);

  // Auto-complete "welcome" step on mount when active
  useEffect(() => {
    if (data.phase !== "active") return;
    const timer = setTimeout(() => completeStep("welcome"), 600);
    return () => clearTimeout(timer);
  }, [data.phase, completeStep]);

  // Route-based step completion
  useEffect(() => {
    if (data.phase !== "active" || !currentStep) return;
    if (currentStep.completedBy === "route" && currentStep.targetRoute === location) {
      const timer = setTimeout(() => completeStep(currentStep.id), 500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [location, currentStep, data.phase, completeStep]);

  // WS-event-based step completion
  useEffect(() => {
    if (data.phase !== "active") return;
    if (events.length <= lastEventCountRef.current) return;
    const newEvents = events.slice(lastEventCountRef.current);
    lastEventCountRef.current = events.length;

    setData((prev) => {
      const step = TUTORIAL_STEPS.find((s) => !prev.completedSteps.includes(s.id)) ?? null;
      if (!step || step.completedBy !== "ws_event") return prev;
      const matched = newEvents.some((e) => e.type === step.wsEventType);
      if (!matched) return prev;
      const next: TutorialData = { ...prev, completedSteps: [...prev.completedSteps, step.id] };
      saveData(next);
      return next;
    });
  }, [events, data.phase]);

  const startTutorial = useCallback(() => {
    setData((prev) => {
      const next: TutorialData = { ...prev, phase: "active" };
      saveData(next);
      return next;
    });
  }, []);

  const dismissTutorial = useCallback(() => {
    setData((prev) => {
      const next: TutorialData = { ...prev, phase: "dismissed" };
      saveData(next);
      return next;
    });
  }, []);

  return (
    <TutorialContext.Provider value={{
      phase: data.phase,
      steps: TUTORIAL_STEPS,
      completedSteps,
      currentStep,
      allDone,
      startTutorial,
      dismissTutorial,
      completeStep,
    }}>
      {children}
    </TutorialContext.Provider>
  );
}
