import { useEffect, useState } from "react";

/**
 * Atlas ships two faces to the world:
 *  - "pet"       → the virtual-pet experience: one big face, one input, almost
 *                  no chrome. For a kid, a grandparent, anyone who wants a
 *                  super-computer R2-D2 they can just talk to. This is default.
 *  - "developer" → the full command center (the existing dashboard). Every
 *                  panel, plugin, route, and knob.
 */
export type UiMode = "pet" | "developer";

const MODE_KEY = "atlas_ui_mode";

export function getUiMode(): UiMode {
  return (localStorage.getItem(MODE_KEY) as UiMode) || "pet";
}

export function setUiMode(mode: UiMode) {
  localStorage.setItem(MODE_KEY, mode);
  window.dispatchEvent(new CustomEvent("atlas:uiModeChanged", { detail: mode }));
}

export function useUiMode(): [UiMode, (m: UiMode) => void] {
  const [mode, setMode] = useState<UiMode>(getUiMode);
  useEffect(() => {
    const onChange = (e: Event) => setMode((e as CustomEvent<UiMode>).detail ?? getUiMode());
    window.addEventListener("atlas:uiModeChanged", onChange);
    return () => window.removeEventListener("atlas:uiModeChanged", onChange);
  }, []);
  return [mode, setUiMode];
}

// ── Genesis gates ────────────────────────────────────────────────────────────
// The onboarding sequence: setup (keys/voice/name) → intro (talking face) → app.

const SETUP_KEY = "atlas_genesis_setup_done";
const INTRO_KEY = "atlas_genesis_intro_done";
const NAME_KEY = "atlas_user_name";

export function isSetupDone(): boolean {
  return localStorage.getItem(SETUP_KEY) === "true";
}
export function markSetupDone() {
  localStorage.setItem(SETUP_KEY, "true");
}
export function isIntroDone(): boolean {
  return localStorage.getItem(INTRO_KEY) === "true";
}
export function markIntroDone() {
  localStorage.setItem(INTRO_KEY, "true");
}
export function getUserName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}
export function setUserName(name: string) {
  localStorage.setItem(NAME_KEY, name);
}

// What the user named their AI (defaults to "Atlas").
const BOT_NAME_KEY = "atlas_bot_name";
export function getBotName(): string {
  return (localStorage.getItem(BOT_NAME_KEY) || "").trim() || "Atlas";
}
export function setBotName(name: string) {
  localStorage.setItem(BOT_NAME_KEY, (name || "").trim());
}

/** Reset the whole first-run experience (used by a "replay intro" control). */
export function resetGenesis() {
  localStorage.removeItem(SETUP_KEY);
  localStorage.removeItem(INTRO_KEY);
  localStorage.removeItem("atlas_input_mode"); // re-ask talk/type
  try { sessionStorage.removeItem("atlas_intro_beats"); } catch { /* ignore */ }
}
