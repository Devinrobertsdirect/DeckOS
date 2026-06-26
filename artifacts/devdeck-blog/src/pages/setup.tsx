import { useEffect, useState, type CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, Circle, ChevronLeft, Zap, Check } from "lucide-react";
import {
  type Provider,
  type AiConfig,
  loadConfigLocal,
  saveConfig,
} from "@/lib/ai-config";

// ── Live clock ────────────────────────────────────────────────────────────────
function useClockTime() {
  const fmt = () =>
    new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ── Provider metadata ─────────────────────────────────────────────────────────
interface ProviderMeta {
  id: Provider;
  name: string;
  tagline: string;
  letter: string;
  accentColor: string; // inline CSS color
  keyPrefix?: string;
  keyHint?: string;
  keyUrl?: string;
  keyUrlLabel?: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    tagline: "Claude",
    letter: "A",
    accentColor: "hsl(var(--accent))",
    keyPrefix: "sk-ant-",
    keyHint: "Starts with sk-ant-",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyUrlLabel: "console.anthropic.com",
  },
  {
    id: "openai",
    name: "OpenAI",
    tagline: "GPT-4o",
    letter: "O",
    accentColor: "hsl(var(--primary))",
    keyPrefix: "sk-",
    keyHint: "Starts with sk-",
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "platform.openai.com",
  },
  {
    id: "google",
    name: "Google",
    tagline: "Gemini",
    letter: "G",
    accentColor: "#4285f4",
    keyHint: "Google AI Studio key",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyUrlLabel: "aistudio.google.com",
  },
  {
    id: "ollama",
    name: "Ollama",
    tagline: "Local / Offline",
    letter: "∅",
    accentColor: "#8b5cf6",
    keyHint: "No API key needed",
  },
];

const MODELS: Record<Exclude<Provider, "ollama">, { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (recommended)" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8 (most capable)" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest)" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o (recommended)" },
    { value: "gpt-4o-mini", label: "GPT-4o mini (fastest)" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  google: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (recommended)" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash (fastest)" },
  ],
};

const DEFAULT_MODELS: Record<Exclude<Provider, "ollama">, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.0-flash",
};

// ── Provider card ─────────────────────────────────────────────────────────────
function ProviderCard({
  meta,
  selected,
  onClick,
}: {
  meta: ProviderMeta;
  selected: boolean;
  onClick: () => void;
}) {
  const selectedStyle: CSSProperties = {
    borderColor: meta.accentColor,
    boxShadow: `0 0 14px ${meta.accentColor}22`,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative border border-border bg-card p-4 flex flex-col gap-2 text-left transition-all duration-150 cursor-pointer w-full"
      style={selected ? selectedStyle : undefined}
    >
      {/* corner accent when selected */}
      {selected && (
        <div
          className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2"
          style={{ borderColor: meta.accentColor }}
        />
      )}

      <div
        className="text-xl font-bold font-mono w-8 h-8 flex items-center justify-center border"
        style={
          selected
            ? { color: meta.accentColor, borderColor: `${meta.accentColor}60` }
            : { color: "hsl(var(--muted-foreground))", borderColor: "transparent" }
        }
      >
        {meta.letter}
      </div>

      <div>
        <div className="text-sm font-bold font-mono text-foreground">{meta.name}</div>
        <div className="text-xs text-muted-foreground font-sans">{meta.tagline}</div>
      </div>

      {selected && (
        <div className="absolute top-2 right-2">
          <Check className="w-3 h-3" style={{ color: meta.accentColor }} />
        </div>
      )}
    </button>
  );
}

// ── Setup page ────────────────────────────────────────────────────────────────
export default function Setup() {
  const [, navigate] = useLocation();
  const clockTime = useClockTime();

  const [provider, setProvider] = useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<string>(DEFAULT_MODELS.anthropic);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("phi3:mini");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExisting, setHasExisting] = useState(false);

  // Pre-populate from existing config
  useEffect(() => {
    const existing = loadConfigLocal();
    if (!existing) return;
    setHasExisting(true);
    setProvider(existing.provider);
    if (existing.apiKey) setApiKey(existing.apiKey);
    if (existing.provider === "ollama") {
      if (existing.ollamaUrl) setOllamaUrl(existing.ollamaUrl);
      if (existing.model) setOllamaModel(existing.model);
    } else {
      if (existing.model) setModel(existing.model);
    }
  }, []);

  // Reset model + key when provider changes
  useEffect(() => {
    if (provider !== "ollama") {
      setModel(DEFAULT_MODELS[provider as Exclude<Provider, "ollama">]);
    }
    setApiKey("");
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const currentMeta = PROVIDERS.find((p) => p.id === provider)!;

  function validate(): string | null {
    if (provider !== "ollama") {
      if (!apiKey.trim()) return "API key is required.";
      if (currentMeta.keyPrefix && !apiKey.trim().startsWith(currentMeta.keyPrefix)) {
        return `Key should start with "${currentMeta.keyPrefix}". Double-check you copied it correctly.`;
      }
    } else {
      if (!ollamaUrl.trim()) return "Ollama URL is required.";
      if (!ollamaUrl.startsWith("http")) return "Ollama URL must start with http:// or https://";
    }
    return null;
  }

  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);

    const cfg: AiConfig = {
      provider,
      model: provider === "ollama" ? ollamaModel.trim() || "phi3:mini" : model,
      apiKey: provider === "ollama" ? "" : apiKey.trim(),
      ollamaUrl: provider === "ollama" ? ollamaUrl.trim() : "",
      savedAt: new Date().toISOString(),
    };

    try {
      await saveConfig(cfg);
      setSaved(true);
      setTimeout(() => navigate("/"), 800);
    } catch {
      setError("Failed to save config. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-mono">
      {/* Status bar */}
      <div className="fixed top-0 left-0 right-0 h-8 border-b border-border bg-card/80 backdrop-blur-md z-40 flex items-center px-4 text-xs font-mono text-muted-foreground justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-primary font-bold hover:opacity-80 transition-opacity"
          >
            <ChevronLeft className="w-3 h-3" />
            [DECKOS]
          </Link>
          <span className="text-muted-foreground/60">SETUP</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-[hsl(158_100%_50%)]">
            <Circle className="w-1.5 h-1.5 fill-current" /> ONLINE
          </span>
          <span>{clockTime}</span>
        </div>
      </div>

      <div className="scanline" />

      <main className="flex-1 pt-16 flex flex-col items-center">
        <div className="w-full max-w-2xl px-6 py-12">

          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-2 text-primary text-xs font-bold tracking-widest mb-3">
              <Zap className="w-3.5 h-3.5" />
              {hasExisting ? "UPDATE AI PROVIDER" : "CONNECT YOUR AI BRAIN"}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">
              Choose your LLM provider.
            </h1>
            <p className="text-muted-foreground font-sans text-sm leading-relaxed">
              DeckOS uses a large language model to power JARVIS and all AI features.
              Pick a provider, add your key, and your deck comes alive.
            </p>
          </div>

          {/* Provider selector */}
          <div className="mb-8">
            <div className="text-xs text-muted-foreground/60 tracking-widest mb-3">
              PROVIDER
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PROVIDERS.map((p) => (
                <ProviderCard
                  key={p.id}
                  meta={p}
                  selected={provider === p.id}
                  onClick={() => setProvider(p.id)}
                />
              ))}
            </div>
          </div>

          {/* Config section */}
          <div className="border border-border bg-card/50 p-6 mb-6">
            {provider !== "ollama" ? (
              <>
                {/* Cloud provider — API key + model */}
                <div className="mb-5">
                  <label className="text-xs text-muted-foreground/60 tracking-widest block mb-2">
                    API KEY
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showKey ? "text" : "password"}
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setError(null);
                      }}
                      placeholder={currentMeta.keyHint ?? "Paste your API key"}
                      className="flex-1 bg-background border border-border text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="border border-border bg-background px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
                      title={showKey ? "Hide key" : "Show key"}
                    >
                      {showKey ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  {currentMeta.keyUrl && (
                    <p className="text-xs text-muted-foreground/50 mt-2 font-sans">
                      Get a key →{" "}
                      <a
                        href={currentMeta.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary/70 hover:text-primary transition-colors underline-offset-2 hover:underline"
                      >
                        {currentMeta.keyUrlLabel}
                      </a>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-muted-foreground/60 tracking-widest block mb-2">
                    MODEL
                  </label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                  >
                    {MODELS[provider as Exclude<Provider, "ollama">].map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                {/* Ollama — local URL + model name */}
                <div className="mb-3 text-xs text-muted-foreground font-sans leading-relaxed">
                  Ollama runs locally — no API key needed. Make sure{" "}
                  <a
                    href="https://ollama.com"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary/70 hover:text-primary transition-colors"
                  >
                    Ollama
                  </a>{" "}
                  is installed and running before saving.
                </div>

                <div className="mb-5">
                  <label className="text-xs text-muted-foreground/60 tracking-widest block mb-2">
                    OLLAMA URL
                  </label>
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => {
                      setOllamaUrl(e.target.value);
                      setError(null);
                    }}
                    placeholder="http://localhost:11434"
                    className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/30"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground/60 tracking-widest block mb-2">
                    MODEL NAME
                  </label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    placeholder="phi3:mini"
                    className="w-full bg-background border border-border text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/50 placeholder:text-muted-foreground/30"
                  />
                  <p className="text-xs text-muted-foreground/50 mt-2 font-sans">
                    Popular: phi3:mini, llama3.2, mistral, gemma2
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive font-sans mb-5">
              {error}
            </div>
          )}

          {/* Save button */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full border border-primary bg-primary/10 text-primary font-mono font-bold text-sm py-3 px-6 hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                Saved — launching dashboard…
              </>
            ) : saving ? (
              "Saving…"
            ) : hasExisting ? (
              "Update & continue →"
            ) : (
              "Save & launch JARVIS →"
            )}
          </button>

          {/* Back link */}
          {hasExisting && !saved && (
            <div className="mt-4 text-center">
              <Link
                href="/"
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                ← back to dashboard without changing
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
