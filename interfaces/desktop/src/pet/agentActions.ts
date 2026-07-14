import { addFact, forgetByText, clearFacts } from "@/lib/atlasMemory";
import { setUserName, setBotName, setUiMode, setExperienceMode, openDeckOsFeature } from "@/lib/uiMode";
import { setPersona, nudgeTrait, type PersonaTraits } from "@/genesis/personality";
import { saveFaceTheme, saveEmojiPack } from "@/components/faces/AtlasFace";
import { applyColor, type ColorScheme } from "@/components/Onboarding";
import { setVoiceEngine, nudgeVoiceRate } from "@/genesis/useAtlasVoice";

/**
 * The client half of Atlas's skills. The server decides WHAT to do and returns a
 * typed UiAction; this runs it against the real client APIs (rename, switch
 * persona, change the look/voice, forget a fact, navigate…). Effects that would
 * unmount the buddy or change the face (navigate, mode switch, mood demo) are
 * returned as a `deferred` closure so the caller can run them AFTER Atlas speaks.
 */
export type UiAction =
  | { type: "none" }
  | { type: "open"; route: string }
  | { type: "remember"; fact: string }
  | { type: "forgetFact"; query: string }
  | { type: "forgetAllFacts" }
  | { type: "searchMemory"; query: string }
  | { type: "setUserName"; name: string }
  | { type: "setBotName"; name: string }
  | { type: "setPersona"; personaId: string }
  | { type: "adjustTrait"; trait: string; delta: number }
  | { type: "setFaceTheme"; themeId: string }
  | { type: "setEmojiPack"; packId: string }
  | { type: "setAccentColor"; color: string }
  | { type: "setVoiceEngine"; engine: "server" | "browser" }
  | { type: "voiceRate"; delta: number }
  | { type: "demoFace"; state: string; ms: number }
  | { type: "setUiMode"; mode: "developer" | "pet" }
  | { type: "setExperienceMode"; mode: "robot" | "computer" }
  | { type: "replayLast" };

export interface ActionHelpers {
  /** Show a face state for ms milliseconds, then settle back to idle. */
  showMood: (state: string, ms: number) => void;
}

/** Run a client action. Returns a deferred effect to run after Atlas speaks, or null. */
export function applyClientAction(ui: UiAction, helpers: ActionHelpers): (() => void) | null {
  switch (ui.type) {
    // ── immediate ──────────────────────────────────────────────────────────
    case "remember": addFact(ui.fact, "user"); return null;
    case "forgetFact": forgetByText(ui.query); return null;
    case "forgetAllFacts": clearFacts(); return null;
    case "searchMemory": return null; // recall already spoke; nothing to persist
    case "setUserName": setUserName(ui.name); return null;
    case "setBotName": setBotName(ui.name); return null;
    case "setPersona": setPersona(ui.personaId); return null;
    case "adjustTrait": nudgeTrait(ui.trait as keyof PersonaTraits, ui.delta); return null;
    case "setFaceTheme": saveFaceTheme(ui.themeId); return null;
    case "setEmojiPack": saveEmojiPack(ui.packId); return null;
    case "setAccentColor":
      applyColor(ui.color as ColorScheme);
      try { localStorage.setItem("deckos_color", ui.color); } catch { /* ignore */ }
      return null;
    case "setVoiceEngine": setVoiceEngine(ui.engine); return null;
    case "voiceRate": nudgeVoiceRate(ui.delta); return null;
    // ── deferred (run after Atlas speaks) ───────────────────────────────────
    case "demoFace": return () => helpers.showMood(ui.state, ui.ms);
    case "open": return () => openDeckOsFeature(ui.route);
    case "setUiMode": return () => setUiMode(ui.mode);
    case "setExperienceMode": return () => setExperienceMode(ui.mode);
    // handled by the caller (needs chat history) / no-op
    case "replayLast":
    case "none":
      return null;
  }
}
