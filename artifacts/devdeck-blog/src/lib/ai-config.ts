export type Provider = "anthropic" | "openai" | "google" | "ollama";

export interface AiConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  ollamaUrl: string;
  savedAt: string;
}

const STORAGE_KEY = "deckos_ai_config";
const API_BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined) ??
  "http://localhost:8080";

export function loadConfigLocal(): AiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AiConfig) : null;
  } catch {
    return null;
  }
}

export function saveConfigLocal(cfg: AiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearConfigLocal(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function saveConfig(cfg: AiConfig): Promise<void> {
  saveConfigLocal(cfg);
  try {
    await fetch(`${API_BASE}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Backend not running — localStorage is sufficient
  }
}
