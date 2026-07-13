import { useState, useEffect } from "react";
import { getStoredConfig } from "@/components/Onboarding";
import { AI_NAME_KEY } from "@/components/CinematicOnboarding";

export const AI_NAME_UPDATED_EVENT = "deckos:ai_name_updated";

function readAiName(): string {
  try {
    const direct = localStorage.getItem(AI_NAME_KEY);
    if (direct) return direct;
    const c = getStoredConfig();
    return c?.aiName ?? c?.systemName ?? "JARVIS";
  } catch {
    return "JARVIS";
  }
}

export function useAiName(): string {
  const [name, setName] = useState(readAiName);
  useEffect(() => {
    function onUpdate() { setName(readAiName()); }
    window.addEventListener(AI_NAME_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(AI_NAME_UPDATED_EVENT, onUpdate);
  }, []);
  return name;
}
