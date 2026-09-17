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

// Every companion is a "Nobi" (its species/classification — it always answers
// to Nobi); the user layers a personal nickname on top. Until named, the
// nickname IS the species name.
export const SPECIES = "Nobi";
const BOT_NAME_KEY = "atlas_bot_name";
// Retired names, never spoken: "Atlas" (internal codename) and "Neura" (the
// pre-2026-09 brand, dropped for trademark reasons). A stale stored value
// holding either means "unnamed" so the bot never calls itself an old name.
const RETIRED_NAMES = new Set(["atlas", "neura"]);
export function getBotName(): string {
  const raw = (localStorage.getItem(BOT_NAME_KEY) || "").trim();
  if (!raw || RETIRED_NAMES.has(raw.toLowerCase())) return SPECIES;
  return raw;
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
  void neuraSnark("rename");
}

/**
 * Fire a reactive Stark-snark quip when the user does something TO Nobi
 * (rename, mute, recolor, reset…). The server gates each trigger on a cooldown
 * (say-it-once, then hush ~20 min) and returns { line: null } when suppressed, so
 * this never gets annoying. Shows a transient toast + emits `neura:snark`.
 */
export async function neuraSnark(trigger: string): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/snark?trigger=${encodeURIComponent(trigger)}`);
    const d = (await r.json()) as { line?: string | null };
    if (!d?.line) return; // on cooldown or nothing → stay quiet
    window.dispatchEvent(new CustomEvent("neura:snark", { detail: d.line }));
    showSnarkToast(d.line);
  } catch {
    /* offline — no quip, no harm */
  }
}

function showSnarkToast(line: string): void {
  try {
    const el = document.createElement("div");
    el.textContent = `“${line}”`;
    el.setAttribute("role", "status");
    Object.assign(el.style, {
      position: "fixed",
      bottom: "22px",
      left: "50%",
      transform: "translateX(-50%) translateY(10px)",
      maxWidth: "440px",
      padding: "12px 18px",
      zIndex: "99999",
      font: "italic 13px/1.5 ui-monospace, SFMono-Regular, monospace",
      color: "rgba(201,220,240,0.92)",
      background: "rgba(7,13,31,0.92)",
      border: "1px solid rgba(125,160,230,0.28)",
      borderRadius: "12px",
      boxShadow: "0 10px 34px rgba(0,0,0,0.45)",
      backdropFilter: "blur(8px)",
      textAlign: "center",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity .3s ease, transform .3s ease",
    } as Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateX(-50%) translateY(0)";
    });
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-50%) translateY(10px)";
      setTimeout(() => el.remove(), 400);
    }, 4200);
  } catch {
    /* DOM unavailable — ignore */
  }
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
  void neuraSnark("wipe_memory");
  localStorage.removeItem(SETUP_KEY);
  localStorage.removeItem(INTRO_KEY);
  localStorage.removeItem("atlas_input_mode"); // re-ask talk/type
  try { sessionStorage.removeItem("atlas_intro_beats"); } catch { /* ignore */ }
}
