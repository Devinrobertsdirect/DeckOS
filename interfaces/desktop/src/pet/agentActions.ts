import { addFact, forgetByText, clearFacts } from "@/lib/atlasMemory";
import { setUserName, setBotName, setUiMode, setExperienceMode, openDeckOsFeature } from "@/lib/uiMode";
import { setPersona, nudgeTrait, type PersonaTraits } from "@/genesis/personality";
import { saveFaceTheme, saveEmojiPack } from "@/components/faces/AtlasFace";
import { applyColor, applyHexColor, type ColorScheme } from "@/components/Onboarding";
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
  | { type: "demoFace"; state: string; ms: number; color?: string }
  | { type: "setUiMode"; mode: "developer" | "pet" }
  | { type: "setExperienceMode"; mode: "robot" | "computer" }
  | { type: "openVideo"; query: string }
  | { type: "videoControl"; action: "pause" | "resume" | "close" }
  | { type: "survivor"; variant: "torches" | "snuff"; banner?: string }
  | { type: "showImage"; url: string; prompt?: string }
  | { type: "openTutorial" }
  | { type: "showLink"; title: string; url: string; code?: string; hint?: string }
  | { type: "closeOverlay" }
  | { type: "show"; kind: "demo" | "pitch" }
  | { type: "meet"; name?: string; relation?: string }
  | { type: "replayLast" };

export interface ActionHelpers {
  /** Show a face state (optionally tinting the eyes) for ms, then settle back. */
  showMood: (state: string, ms: number, color?: string) => void;
  /** Open the YouTube overlay and play the first result for a spoken query. */
  openVideo?: (query: string) => void;
  /** Control the open video: pause / resume / close (back to the face). */
  controlVideo?: (action: "pause" | "resume" | "close") => void;
  /** Play the visual-only Survivor billboard (torches + fire-text banner), then fire-colored eyes. */
  playSurvivor?: (variant: "torches" | "snuff", banner?: string) => void;
  /** Show a generated image full-screen over the face. */
  showImage?: (url: string, prompt?: string) => void;
  /** Open the animated tutorial walkthrough over the face. */
  openTutorial?: () => void;
  /** Show a QR card for a URL (phone pairing, the shop). */
  showLink?: (title: string, url: string, code?: string, hint?: string) => void;
  /** Close any full-screen overlay (image / tutorial) — back to the face. */
  closeOverlay?: () => void;
  /** Run a built-in show: the ~2min "quick demo" or the ~90s "tell them about you" pitch. */
  playShow?: (kind: "demo" | "pitch") => void;
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
      // A hex (from the big spoken-color dictionary → any color glows on the eyes)
      // goes through the full-spectrum path; a named scheme uses its tuned preset.
      if (/^#[0-9a-fA-F]{6}$/.test(ui.color)) {
        applyHexColor(ui.color);
      } else {
        applyColor(ui.color as ColorScheme);
        try { localStorage.setItem("deckos_color", ui.color); } catch { /* ignore */ }
      }
      return null;
    case "setVoiceEngine": setVoiceEngine(ui.engine); return null;
    case "voiceRate": nudgeVoiceRate(ui.delta); return null;
    // ── deferred (run after Atlas speaks) ───────────────────────────────────
    case "demoFace": return () => helpers.showMood(ui.state, ui.ms, ui.color);
    case "open": return () => openDeckOsFeature(ui.route);
    case "setUiMode": return () => setUiMode(ui.mode);
    case "setExperienceMode": return () => setExperienceMode(ui.mode);
    case "openVideo": return () => helpers.openVideo?.(ui.query);
    case "videoControl": return () => helpers.controlVideo?.(ui.action);
    case "survivor": return () => helpers.playSurvivor?.(ui.variant, ui.banner);
    case "showImage": return () => helpers.showImage?.(ui.url, ui.prompt);
    case "openTutorial": return () => helpers.openTutorial?.();
    case "showLink": return () => helpers.showLink?.(ui.title, ui.url, ui.code, ui.hint);
    case "closeOverlay": return () => helpers.closeOverlay?.();
    case "show": return () => helpers.playShow?.(ui.kind);
    // handled by the caller (needs chat history / the chat path) / no-op
    case "meet":
    case "replayLast":
    case "none":
      return null;
  }
}
