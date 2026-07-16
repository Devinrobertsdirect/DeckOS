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

/**
 * Atlas is the FACE of DeckOS — from the buddy it can take you straight into any
 * DeckOS tool. Point the router at the feature's route, then switch to the full
 * command center (developer mode) so it renders there. `route` is a leading-slash
 * path from the capability manifest (e.g. "/devices", "/briefings").
 */
export function openDeckOsFeature(route: string) {
  const clean = route && route.startsWith("/") ? route : `/${route || ""}`;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  try {
    window.history.pushState({}, "", `${base}${clean}`);
  } catch { /* ignore — mode switch still lands them in the command center */ }
  setUiMode("developer");
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

/**
 * The higher-level experience mode — how much of the machine Atlas exposes:
 *  - "computer" → the face is HOME (95% of everything happens there), but you
 *    can dip into the full command center and get back to the face in one tap.
 *  - "robot"    → face-LOCKED. Atlas only ever shows its face; everything else
 *    runs in the background. For an actual robot / kiosk. Default: computer.
 */
export type ExperienceMode = "robot" | "computer";
const EXPERIENCE_KEY = "atlas_experience_mode";

export function getExperienceMode(): ExperienceMode {
  return (localStorage.getItem(EXPERIENCE_KEY) as ExperienceMode) || "computer";
}
export function setExperienceMode(mode: ExperienceMode) {
  localStorage.setItem(EXPERIENCE_KEY, mode);
  window.dispatchEvent(new CustomEvent("atlas:experienceModeChanged", { detail: mode }));
  // Robot mode is face-locked — snap straight back to the face.
  if (mode === "robot") setUiMode("pet");
}
export function useExperienceMode(): [ExperienceMode, (m: ExperienceMode) => void] {
  const [mode, setMode] = useState<ExperienceMode>(getExperienceMode);
  useEffect(() => {
    const on = (e: Event) => setMode((e as CustomEvent<ExperienceMode>).detail ?? getExperienceMode());
    window.addEventListener("atlas:experienceModeChanged", on);
    return () => window.removeEventListener("atlas:experienceModeChanged", on);
  }, []);
  return [mode, setExperienceMode];
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

// Every companion is a "Neura" (its species/classification — it always answers
// to Neura); the user layers a personal nickname on top. Until named, the
// nickname IS the species name.
export const SPECIES = "Neura";
const BOT_NAME_KEY = "atlas_bot_name";
export function getBotName(): string {
  return (localStorage.getItem(BOT_NAME_KEY) || "").trim() || SPECIES;
}
/** True while the companion still goes by the species name (unnamed). */
export function isBotUnnamed(): boolean {
  return getBotName() === SPECIES;
}
export function setBotName(name: string) {
  const clean = (name || "").trim();
  localStorage.setItem(BOT_NAME_KEY, clean);
  syncBotNameToServer(clean || SPECIES);
  window.dispatchEvent(new CustomEvent("atlas:botNameChanged", { detail: clean }));
}

/**
 * Mirror the chosen name to the server (ATLAS_BOT_NAME) so it's a universal
 * truth — every server-generated message (chat fallback, briefings,
 * notifications, the rule engine) then refers to the bot by this name.
 * Fire-and-forget; the local name is authoritative for the UI regardless.
 */
export function syncBotNameToServer(name: string) {
  try {
    void fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ATLAS_BOT_NAME: name }),
    }).catch(() => { /* offline — UI still uses the local name */ });
  } catch { /* ignore */ }
}

/** Reset the whole first-run experience (used by a "replay intro" control). */
export function resetGenesis() {
  localStorage.removeItem(SETUP_KEY);
  localStorage.removeItem(INTRO_KEY);
  localStorage.removeItem("atlas_input_mode"); // re-ask talk/type
  try { sessionStorage.removeItem("atlas_intro_beats"); } catch { /* ignore */ }
}
