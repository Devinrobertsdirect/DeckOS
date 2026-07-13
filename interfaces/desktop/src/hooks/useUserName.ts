import { useState, useEffect } from "react";
import { getStoredConfig } from "@/components/Onboarding";

export const USER_NAME_UPDATED_EVENT = "deckos:user_name_updated";

function readUserName(): string | null {
  try {
    const c = getStoredConfig();
    return c?.userName ?? null;
  } catch {
    return null;
  }
}

export function useUserName(): string | null {
  const [name, setName] = useState(readUserName);
  useEffect(() => {
    function onUpdate() { setName(readUserName()); }
    window.addEventListener(USER_NAME_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(USER_NAME_UPDATED_EVENT, onUpdate);
  }, []);
  return name;
}
