import { useEffect, useState } from "react";
import { saveFaceTheme, saveEmojiPack } from "@/components/faces/AtlasFace";
import { getBotName, SPECIES } from "@/lib/uiMode";

/**
 * Atlas's personality. A persona is a cohesive character: response style
 * (traits), a default eye look, and a default emoji pack — so choosing one
 * makes Atlas feel like a specific buddy, not a generic assistant. Traits are
 * turned into a system-prompt fragment (personaPrompt) that flavours every
 * reply once an LLM is attached. Fully customizable + persistent.
 *
 * These map to the Mark editions ("an edition is a config, not a fork").
 */

export interface PersonaTraits {
  humor: number;     // 0..1  dry ↔ very funny
  sarcasm: number;   // 0..1  earnest ↔ cheeky
  energy: number;    // 0..1  mellow ↔ hyped
  warmth: number;    // 0..1  cool ↔ affectionate
  formality: number; // 0..1  casual ↔ formal
}

export interface Persona {
  id: string;
  name: string;
  blurb: string;
  traits: PersonaTraits;
  eyeTheme: string;
  emojiPack: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "workshop", name: "Warm & Witty",
    blurb: "Friendly, a little funny — the classic Neura.",
    traits: { humor: 0.7, sarcasm: 0.2, energy: 0.6, warmth: 0.85, formality: 0.3 },
    eyeTheme: "workshop", emojiPack: "core",
  },
  {
    id: "stealth", name: "Calm & Precise",
    blurb: "Measured, focused, understated. Gets to the point.",
    traits: { humor: 0.3, sarcasm: 0.15, energy: 0.35, warmth: 0.5, formality: 0.6 },
    eyeTheme: "stealth", emojiPack: "core",
  },
  {
    id: "forge", name: "Bold & Playful",
    blurb: "High-energy, cheeky, hot-rod attitude.",
    traits: { humor: 0.85, sarcasm: 0.6, energy: 0.9, warmth: 0.7, formality: 0.15 },
    eyeTheme: "forge", emojiPack: "emoji",
  },
  {
    id: "codex", name: "Gentle & Thoughtful",
    blurb: "Soft-spoken, curious, endlessly kind.",
    traits: { humor: 0.5, sarcasm: 0.1, energy: 0.4, warmth: 0.95, formality: 0.4 },
    eyeTheme: "codex", emojiPack: "kawaii",
  },
];

const PERSONA_KEY = "atlas_persona";
const TRAITS_KEY = "atlas_persona_traits";

export function getPersona(): Persona {
  const id = localStorage.getItem(PERSONA_KEY) || "workshop";
  const base = PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]!;
  // Merge any user-customized traits over the preset.
  try {
    const raw = localStorage.getItem(TRAITS_KEY);
    if (raw) {
      const custom = JSON.parse(raw) as Partial<PersonaTraits>;
      return { ...base, traits: { ...base.traits, ...custom } };
    }
  } catch { /* ignore */ }
  return base;
}

/** Select a persona and apply its cohesive look (eyes + emoji pack). */
export function setPersona(id: string, opts?: { applyLook?: boolean }) {
  const p = PERSONAS.find((x) => x.id === id);
  if (!p) return;
  localStorage.setItem(PERSONA_KEY, id);
  localStorage.removeItem(TRAITS_KEY); // reset custom tweaks to the preset
  if (opts?.applyLook !== false) {
    saveFaceTheme(p.eyeTheme);
    saveEmojiPack(p.emojiPack);
  }
  window.dispatchEvent(new CustomEvent("atlas:personaChanged", { detail: id }));
}

/** Tweak individual traits without changing the base persona. */
export function customizeTraits(patch: Partial<PersonaTraits>) {
  const cur = getPersona().traits;
  const next = { ...cur, ...patch };
  localStorage.setItem(TRAITS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("atlas:personaChanged", { detail: "custom" }));
}

/** Nudge one trait up/down and clamp to [0,1] — for "be more funny / less snarky". */
export function nudgeTrait(trait: keyof PersonaTraits, delta: number): number {
  const cur = getPersona().traits;
  const next = Math.max(0, Math.min(1, (cur[trait] ?? 0.5) + delta));
  customizeTraits({ [trait]: next } as Partial<PersonaTraits>);
  return next;
}

function level(v: number, low: string, mid: string, high: string): string | null {
  if (v >= 0.66) return high;
  if (v >= 0.33) return mid;
  return low || null;
}

/**
 * Turn the persona into a spoken-personality instruction for the LLM system
 * prompt — this is what makes replies feel personal and in-character.
 */
export function personaPrompt(botName = getBotName()): string {
  const t = getPersona().traits;
  const bits: string[] = [];
  const warmth = level(t.warmth, "reserved and professional", "friendly", "warm, affectionate, and genuinely caring");
  if (warmth) bits.push(warmth);
  const humor = level(t.humor, "", "occasionally funny", "quick with a joke and a light touch");
  if (humor) bits.push(humor);
  const sarc = level(t.sarcasm, "", "a little cheeky", "playfully sarcastic (never mean)");
  if (sarc) bits.push(sarc);
  const energy = level(t.energy, "calm and measured", "even-keeled", "high-energy and enthusiastic");
  if (energy) bits.push(energy);
  const formal = t.formality >= 0.6 ? "Keep a polished, articulate tone." : "Talk casually, like a good friend.";
  const species = botName === SPECIES
    ? `You are Neura — a neural companion (that's your kind, and what you answer to). `
    : `You are ${botName}, a Neura (a neural companion — that's your kind): you go by ${botName} but always answer to "Neura" too. `;
  return `${species}You're ${bits.join(", ")}. ${formal} Stay in character; you're their buddy, not a corporate assistant.`;
}

/** Reactive persona id — re-renders when the persona changes anywhere. */
export function usePersonaId(): string {
  const [id, setId] = useState<string>(
    () => localStorage.getItem(PERSONA_KEY) || "workshop",
  );
  useEffect(() => {
    const sync = () => setId(localStorage.getItem(PERSONA_KEY) || "workshop");
    window.addEventListener("atlas:personaChanged", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("atlas:personaChanged", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return id;
}
