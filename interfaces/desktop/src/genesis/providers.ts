/**
 * The minds Atlas can talk to. This manifest drives the setup wizard and the
 * narration ("you already use …"). Keys are stored server-side via
 * PUT /api/config under `keyName`, then mirrored to process.env so the gateway
 * and connectors pick them up live.
 */
export type ProviderCategory = "chat" | "voice" | "image" | "video";

export interface ProviderDef {
  id: string;
  name: string;
  category: ProviderCategory;
  /** Config key the API key is stored under. */
  keyName: string;
  /** One-line description shown in setup. */
  blurb: string;
  /** Where to get a key. */
  keysUrl: string;
  /** Whether Atlas can live-test the key in setup. */
  testable: boolean;
  /** Honest status: real API wired vs. connector stub pending an official API. */
  status: "wired" | "stub";
  /** A recommended tool to connect first (shown highlighted in setup). */
  primary?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "claude",
    name: "Claude",
    category: "chat",
    keyName: "ANTHROPIC_API_KEY",
    blurb: "Deep reasoning, coding, long-form thinking — Neura's APEX tier.",
    keysUrl: "https://console.anthropic.com/settings/keys",
    testable: true,
    status: "wired",
    primary: true,
  },
  {
    id: "gemini",
    name: "Gemini",
    category: "chat",
    keyName: "GEMINI_API_KEY",
    blurb: "Google's multimodal model — fast, huge context, strong at vision.",
    keysUrl: "https://aistudio.google.com/apikey",
    testable: true,
    status: "wired",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    category: "chat",
    keyName: "PERPLEXITY_API_KEY",
    blurb: "Answers grounded in live web search with citations.",
    keysUrl: "https://www.perplexity.ai/settings/api",
    testable: true,
    status: "wired",
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "chat",
    keyName: "OPENAI_API_KEY",
    blurb: "GPT models — a familiar general-purpose mind.",
    keysUrl: "https://platform.openai.com/api-keys",
    testable: true,
    status: "wired",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "voice",
    keyName: "ELEVENLABS_API_KEY",
    blurb: "A real, natural voice for Neura — upgrades the default browser voice.",
    keysUrl: "https://elevenlabs.io/app/settings/api-keys",
    testable: true,
    status: "wired",
    primary: true,
  },
  {
    id: "midjourney",
    name: "Midjourney",
    category: "image",
    keyName: "MIDJOURNEY_API_KEY",
    blurb: "Image generation. No official API yet — connect via a bridge token.",
    keysUrl: "https://docs.midjourney.com",
    testable: false,
    status: "stub",
  },
  {
    id: "higgsfield",
    name: "Higgsfield",
    category: "video",
    keyName: "HIGGSFIELD_API_KEY",
    blurb: "Cinematic video generation from stills and prompts.",
    keysUrl: "https://higgsfield.ai",
    testable: false,
    status: "stub",
  },
];

export function providersByCategory(cat: ProviderCategory): ProviderDef[] {
  return PROVIDERS.filter((p) => p.category === cat);
}
