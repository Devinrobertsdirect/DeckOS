import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

import {
  AtlasFace,
  FACE_THEMES,
  useFaceTheme,
  saveFaceTheme,
  type FaceState,
} from "@/components/faces/AtlasFace";
import {
  PROVIDERS,
  providersByCategory,
  type ProviderCategory,
  type ProviderDef,
} from "@/genesis/providers";
import {
  useAtlasVoice,
  getVoiceEngine,
  setVoiceEngine,
  warmUpVoices,
  type VoiceEngine,
} from "@/genesis/useAtlasVoice";
import {
  setUserName,
  getUserName,
  getBotName,
  setBotName,
  markSetupDone,
} from "@/lib/uiMode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Genesis Setup — the very first screen a new Atlas user meets, before any
 * dashboard exists. Fullscreen, calm, dark navy. iPhone-style: the user
 * configures everything before the AI's intro. Four steps:
 *   0. Keys        → connect provider API keys (all optional)
 *   1. Names       → the user's name and the AI's name
 *   2. Voice       → pick the default browser voice or the ElevenLabs voice
 *   3. Appearance  → choose the AI's eyes (face theme)
 * Finishes by marking setup done and handing control back to the app.
 *
 * Nothing is persisted except through the provided helpers (setUserName,
 * setBotName, setVoiceEngine, saveFaceTheme, markSetupDone) and the server
 * config API. Every network call is guarded so the wizard still works
 * end-to-end with the server offline.
 */

const NAVY = "#0d1420";
const PAPER = "#F7F5F0";

const INPUT_CLASS =
  "border-white/15 bg-white/[0.04] text-[#F7F5F0] placeholder:text-white/30 focus-visible:ring-[#4A7FB5]";

const CATEGORY_ORDER: { cat: ProviderCategory; label: string }[] = [
  { cat: "chat", label: "Chat & reasoning" },
  { cat: "voice", label: "Voice" },
  { cat: "image", label: "Image" },
  { cat: "video", label: "Video" },
];

type Step = 0 | 1 | 2 | 3;

interface TestState {
  status: "idle" | "loading" | "ok" | "fail";
  detail?: string;
}

export function GenesisSetup({ onComplete }: { onComplete: () => void }) {
  const voice = useAtlasVoice();

  const [step, setStep] = useState<Step>(0);
  const [direction, setDirection] = useState<number>(1);

  const [name, setName] = useState<string>(() => getUserName());
  // Local bot-name input state. Setter is suffixed so it doesn't shadow the
  // imported setBotName persistence helper.
  const [botName, setBotName_] = useState<string>(() => getBotName());
  const [nameFocused, setNameFocused] = useState(false);

  // Whether the user explicitly picked a voice in step 2. If they didn't, finish()
  // auto-picks (premium ElevenLabs when its key is present, else browser).
  const [voiceTouched, setVoiceTouched] = useState(false);

  // Provider key inputs, keyed by ProviderDef.keyName. Held only in memory
  // until Next, then PUT to the server config store.
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [testResults, setTestResults] = useState<Record<string, TestState>>({});

  const [configHasEleven, setConfigHasEleven] = useState(false);
  const [selectedEngine, setSelectedEngine] = useState<VoiceEngine>(() => getVoiceEngine());

  // ── ElevenLabs availability ────────────────────────────────────────────────
  // Unlocked if the user typed a key this session OR the server already has one.
  const elevenUnlocked = useMemo(
    () => configHasEleven || !!(keys["ELEVENLABS_API_KEY"] || "").trim(),
    [configHasEleven, keys],
  );

  // Ask the server (once) whether an ElevenLabs key is already configured.
  useEffect(() => {
    let alive = true;
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: Record<string, string> } | null) => {
        if (!alive || !d) return;
        if ((d.config || {})["ELEVENLABS_API_KEY"]) setConfigHasEleven(true);
      })
      .catch(() => {
        /* server offline — the wizard still works, just no pre-fill */
      });
    return () => {
      alive = false;
    };
  }, []);

  // If ElevenLabs isn't available, never leave the server engine selected.
  useEffect(() => {
    if (!elevenUnlocked && selectedEngine === "server") {
      setSelectedEngine("browser");
      setVoiceEngine("browser");
    }
  }, [elevenUnlocked, selectedEngine]);

  // Warm up the speech engine for the intro that follows.
  useEffect(() => { warmUpVoices(); }, []);
  useEffect(() => () => voice.stop(), [voice]);

  // ── Face expression, timed to the step + what's happening ───────────────────
  // Flow (keys first, per the design): 0 connect · 1 names · 2 voice · 3 eyes
  const anyTesting = Object.values(testResults).some((t) => t.status === "loading");
  const faceState: FaceState =
    step === 0
      ? anyTesting ? "excited" : "thinking"
      : step === 1
        ? nameFocused ? "listening" : "happy"
        : step === 2
          ? voice.speaking ? "talking" : "happy"
          : "happy";

  // ── Navigation ──────────────────────────────────────────────────────────────
  function go(next: Step) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function saveProviders() {
    const payload: Record<string, string> = {};
    const connectedNames: string[] = [];
    for (const p of PROVIDERS) {
      const v = (keys[p.keyName] || "").trim();
      if (v) { payload[p.keyName] = v; connectedNames.push(p.name); }
    }
    // Remember which minds are connected so the intro can name them even if the
    // AI-generated script falls back to the static one.
    try { sessionStorage.setItem("atlas_connected_providers", JSON.stringify(connectedNames)); } catch { /* ignore */ }
    if (Object.keys(payload).length === 0) return;
    // Fire-and-forget: never block the wizard on the network.
    fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      /* offline — keys stay in memory; user can re-enter later in Settings */
    });
  }

  function finish() {
    voice.stop();
    // Respect the user's explicit choice from step 2. If they never touched it,
    // auto-pick — premium ElevenLabs if its key is present, so Atlas "defaults to
    // loading and using these APIs" for its intro — else the browser voice.
    if (!voiceTouched) {
      const hasEleven = configHasEleven || !!(keys["ELEVENLABS_API_KEY"] || "").trim();
      setVoiceEngine(hasEleven ? "server" : "browser");
    }
    markSetupDone();
    onComplete();
  }

  function handleNext() {
    if (step === 0) {
      saveProviders(); // keys → names
      go(1);
    } else if (step === 1) {
      setUserName(name.trim()); // names → voice
      setBotName(botName.trim());
      go(2);
    } else if (step === 2) {
      go(3); // voice → eyes
    } else {
      finish(); // eyes → done
    }
  }

  function handleBack() {
    if (step > 0) go((step - 1) as Step);
  }

  function onRootKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    const tag = t.tagName;
    // Let buttons / links / multiline fields handle their own Enter.
    if (tag === "BUTTON" || tag === "A" || tag === "TEXTAREA") return;
    e.preventDefault();
    handleNext();
  }

  // ── Provider key testing ────────────────────────────────────────────────────
  async function runTest(p: ProviderDef) {
    const key = (keys[p.keyName] || "").trim();
    if (!key) {
      setTestResults((r) => ({ ...r, [p.id]: { status: "fail", detail: "Enter a key first." } }));
      return;
    }
    setTestResults((r) => ({ ...r, [p.id]: { status: "loading" } }));
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, key }),
      });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        /* non-JSON response */
      }
      const okFlag = data["ok"] !== false;
      const ok = res.ok && okFlag;
      const detail =
        (data["detail"] as string | undefined) ??
        (data["error"] as string | undefined) ??
        (data["message"] as string | undefined) ??
        (ok ? "Connected." : `Server responded ${res.status}.`);
      setTestResults((r) => ({ ...r, [p.id]: { status: ok ? "ok" : "fail", detail } }));
    } catch {
      setTestResults((r) => ({
        ...r,
        [p.id]: { status: "fail", detail: "Couldn't reach the server." },
      }));
    }
  }

  function selectEngine(engine: VoiceEngine) {
    if (engine === "server" && !elevenUnlocked) return;
    setVoiceTouched(true);
    setSelectedEngine(engine);
    setVoiceEngine(engine);
  }

  function hearMe() {
    const who = name.trim() || "there";
    const bot = botName.trim() || "Atlas";
    void voice.speak(`Hi ${who}, this is how ${bot} sounds.`, { engine: selectedEngine });
  }

  // ── Step content ────────────────────────────────────────────────────────────
  const stepTitle = [
    "Do you have any AI keys to plug in?",
    "Let's get acquainted",
    "Give your AI a voice",
    "Give your AI its eyes",
  ][step];
  const stepSubtitle = [
    "Connect the AI services you already use — or skip and add them later. Atlas will use them for its own introduction.",
    "A name for you, and a name for your AI — so it can speak to you like a partner, not a product.",
    "Choose how your AI sounds. Press “Hear me” to preview before you decide.",
    "Pick the eyes your AI wears. Tap a look to try it on — everything updates live.",
  ][step];


  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center overflow-hidden"
      style={{ background: NAVY, color: PAPER }}
      onKeyDown={onRootKeyDown}
    >
      <div className="flex h-full w-full max-w-2xl flex-col px-6 py-8 sm:py-10">
        {/* Presiding face + progress */}
        <header className="flex shrink-0 flex-col items-center gap-4">
          <AtlasFace mode="atlas" state={faceState} size={96} />
          <Progress step={step} />
          <div className="mt-1 text-center">
            {/* Keyed remount = the new step mounts immediately; no exit callback
                to stall (AnimatePresence mode="wait" can hang under React 19). */}
            <motion.div
              key={`title-${step}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{stepTitle}</h1>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-white/50">{stepSubtitle}</p>
            </motion.div>
          </div>
        </header>

        {/* Sliding step body */}
        <div className="relative mt-6 min-h-0 flex-1 overflow-y-auto">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: direction > 0 ? 44 : -44 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="h-full"
          >
            {step === 0 && (
                <ProvidersStep
                  keys={keys}
                  setKey={(keyName, value) =>
                    setKeys((k) => ({ ...k, [keyName]: value }))
                  }
                  testResults={testResults}
                  onTest={runTest}
                />
              )}

              {step === 1 && (
                <NamesStep
                  userName={name}
                  onUserName={setName}
                  botName={botName}
                  onBotName={setBotName_}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                />
              )}

              {step === 2 && (
                <VoiceStep
                  selected={selectedEngine}
                  elevenUnlocked={elevenUnlocked}
                  speaking={voice.speaking}
                  onSelect={selectEngine}
                  onHear={hearMe}
                />
              )}

              {step === 3 && <AppearanceStep />}
          </motion.div>
        </div>

        {/* Footer nav */}
        <footer className="mt-6 flex shrink-0 items-center justify-between gap-3">
          <div>
            {step > 0 ? (
              <Button
                variant="ghost"
                className="text-white/55 hover:text-white"
                onClick={handleBack}
              >
                ← Back
              </Button>
            ) : (
              <span className="text-xs text-white/25">Press Enter to continue</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step === 0 && (
              <Button
                variant="ghost"
                className="text-white/45 hover:text-white/80"
                onClick={() => {
                  saveProviders();
                  go(1);
                }}
              >
                Skip for now →
              </Button>
            )}
            <Button
              variant="ghost"
              className="border-transparent bg-[#4A7FB5] px-6 text-white hover:bg-[#3f6f9f]"
              onClick={handleNext}
            >
              {step === 3 ? `Meet ${botName.trim() || "Atlas"} →` : "Next →"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Progress dots ─────────────────────────────────────────────────────────────
function Progress({ step }: { step: number }) {
  const steps = [0, 1, 2, 3];
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${steps.length}`}>
      {steps.map((i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={
              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors " +
              (i === step
                ? "bg-[#4A7FB5] text-white"
                : i < step
                  ? "bg-[#4A7FB5]/30 text-[#C9DCF0]"
                  : "border border-white/15 text-white/35")
            }
            aria-current={i === step ? "step" : undefined}
          >
            {i + 1}
          </div>
          {i < steps.length - 1 && <span className="text-white/20">·</span>}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Names — the user's name and the AI's name ─────────────────────────
function NamesStep({
  userName,
  onUserName,
  botName,
  onBotName,
  onFocus,
  onBlur,
}: {
  userName: string;
  onUserName: (v: string) => void;
  botName: string;
  onBotName: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="w-full max-w-sm space-y-5">
        <NameStep
          name={userName}
          onChange={onUserName}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        <div className="w-full">
          <label htmlFor="atlas-bot-name" className="mb-2 block text-sm text-white/60">
            Name your AI
          </label>
          <Input
            id="atlas-bot-name"
            value={botName}
            onChange={(e) => onBotName(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder="Atlas"
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLASS + " h-11 text-base"}
          />
        </div>
        <p className="text-center text-xs text-white/30">
          These are just for us. You can change them any time.
        </p>
      </div>
    </div>
  );
}

// The single "your name" field, reused inside NamesStep.
function NameStep({
  name,
  onChange,
  onFocus,
  onBlur,
}: {
  name: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <div className="w-full">
      <label htmlFor="atlas-name" className="mb-2 block text-sm text-white/60">
        Your name
      </label>
      <Input
        id="atlas-name"
        autoFocus
        value={name}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="e.g. Devin"
        autoComplete="off"
        spellCheck={false}
        className={INPUT_CLASS + " h-11 text-base"}
      />
    </div>
  );
}

// ── Step 2: Explainer — what "connecting minds" actually means ────────────────
function ExplainerStep() {
  const points: { icon: string; title: string; body: string }[] = [
    {
      icon: "🔌",
      title: "Atlas is the hub — the AIs are the power",
      body: "On its own, Atlas organizes your day. Plugged into services like Claude or Gemini, it gets dramatically smarter — you choose which ones.",
    },
    {
      icon: "🔑",
      title: "A key is just a private password",
      body: "Each service gives you a key — a long password that lets Atlas use your account. You paste it once. Atlas does the talking from then on.",
    },
    {
      icon: "🏠",
      title: "Your keys stay on your machine",
      body: "Keys are stored locally, never shared, never sent anywhere but the service they belong to. You can remove them any time in Settings.",
    },
    {
      icon: "⏭️",
      title: "Totally optional — skip and add later",
      body: "Atlas already works with the free brain running on your computer. Connect nothing now if you like; everything on the next screen can wait.",
    },
  ];
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3">
      <p className="mb-1 text-center text-sm text-white/55">
        Think of the next screen like giving Atlas a phone book of brilliant
        friends it can call for you.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {points.map((p) => (
          <div
            key={p.title}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-4"
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-lg" aria-hidden>{p.icon}</span>
              <h3 className="text-sm font-semibold text-[#C9DCF0]">{p.title}</h3>
            </div>
            <p className="text-xs leading-relaxed text-white/55">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 3: Providers ─────────────────────────────────────────────────────────
function ProvidersStep({
  keys,
  setKey,
  testResults,
  onTest,
}: {
  keys: Record<string, string>;
  setKey: (keyName: string, value: string) => void;
  testResults: Record<string, TestState>;
  onTest: (p: ProviderDef) => void;
}) {
  return (
    <div className="space-y-5 pb-2">
      {/* Plain-language primer, folded into the keys screen. */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3.5 text-xs leading-relaxed text-white/60">
        <span className="text-[#C9DCF0]">New to this?</span> A “key” is just a
        private password an AI service gives you. Paste it once and Atlas does the
        talking — keys stay on your machine and can be removed any time. Everything
        here is optional; Atlas already works with the free brain on your computer.
      </div>
      {CATEGORY_ORDER.map(({ cat, label }) => {
        const items = providersByCategory(cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/35">
              {label}
            </h2>
            <div className="space-y-3">
              {items.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  value={keys[p.keyName] || ""}
                  onChange={(v) => setKey(p.keyName, v)}
                  test={testResults[p.id]}
                  onTest={() => onTest(p)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProviderCard({
  provider,
  value,
  onChange,
  test,
  onTest,
}: {
  provider: ProviderDef;
  value: string;
  onChange: (v: string) => void;
  test: TestState | undefined;
  onTest: () => void;
}) {
  const p = provider;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#F7F5F0]">{p.name}</span>
            {p.primary && (
              <span className="rounded bg-[#4A7FB5]/25 px-1.5 py-0.5 text-[10px] font-medium text-[#C9DCF0]">
                Recommended
              </span>
            )}
            {p.status === "stub" && (
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">
                connector — no official API yet
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-white/45">{p.blurb}</p>
        </div>
        <a
          href={p.keysUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-[#C9DCF0] underline-offset-2 hover:underline"
        >
          Get a key ↗
        </a>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${p.name} API key`}
          autoComplete="off"
          spellCheck={false}
          className={INPUT_CLASS}
        />
        {p.testable && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 border border-white/15 text-[#C9DCF0] hover:bg-white/5"
            disabled={test?.status === "loading"}
            onClick={onTest}
          >
            {test?.status === "loading" ? "Testing…" : "Test"}
          </Button>
        )}
      </div>

      {test && test.status !== "idle" && test.status !== "loading" && (
        <p
          className={
            "mt-2 text-xs " + (test.status === "ok" ? "text-emerald-300" : "text-rose-300")
          }
        >
          {test.status === "ok" ? "✓ " : "✗ "}
          {test.detail}
        </p>
      )}
    </div>
  );
}

// ── Step 3: Voice ─────────────────────────────────────────────────────────────
function VoiceStep({
  selected,
  elevenUnlocked,
  speaking,
  onSelect,
  onHear,
}: {
  selected: VoiceEngine;
  elevenUnlocked: boolean;
  speaking: boolean;
  onSelect: (e: VoiceEngine) => void;
  onHear: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <VoiceCard
          title="Default voice"
          subtitle="Built-in browser voice. Always available, zero setup."
          selected={selected === "browser"}
          onClick={() => onSelect("browser")}
        />
        <VoiceCard
          title="ElevenLabs voice"
          subtitle={
            elevenUnlocked
              ? "A real, natural voice. Uses your ElevenLabs key."
              : "Add an ElevenLabs key in the previous step to unlock this."
          }
          selected={selected === "server"}
          disabled={!elevenUnlocked}
          onClick={() => onSelect("server")}
        />
      </div>

      <Button
        variant="ghost"
        className="mt-5 border border-white/15 text-[#C9DCF0] hover:bg-white/5"
        onClick={onHear}
      >
        {speaking ? "Speaking…" : "🔊 Hear me"}
      </Button>
    </div>
  );
}

function VoiceCard({
  title,
  subtitle,
  selected,
  disabled,
  onClick,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={
        "rounded-xl border p-4 text-left transition-all " +
        (disabled
          ? "cursor-not-allowed border-white/5 bg-white/[0.01] opacity-50"
          : selected
            ? "border-[#4A7FB5] bg-[#4A7FB5]/10 ring-1 ring-[#4A7FB5]"
            : "border-white/10 bg-white/[0.03] hover:border-white/25")
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-[#F7F5F0]">{title}</span>
        {selected && <span className="text-xs text-[#C9DCF0]">Selected</span>}
      </div>
      <p className="mt-1 text-xs text-white/45">{subtitle}</p>
    </button>
  );
}

// ── Step 4: Appearance — give your AI its eyes ────────────────────────────────
function AppearanceStep() {
  // Every AtlasFace reads the active theme from localStorage via useFaceTheme,
  // so saving one updates the big preview and all card previews at once.
  const theme = useFaceTheme();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6">
      {/* Large central preview reflecting the currently-selected theme. */}
      <AtlasFace mode="atlas" state="happy" size={120} />
      <div className="grid w-full max-w-md grid-cols-3 gap-3">
        {FACE_THEMES.map((t) => {
          const selected = t.id === theme.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => saveFaceTheme(t.id)}
              aria-pressed={selected}
              className={
                "flex flex-col items-center gap-2 rounded-xl border p-3 transition-all " +
                (selected
                  ? "border-[#4A7FB5] bg-[#4A7FB5]/10 ring-1 ring-[#4A7FB5]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25")
              }
            >
              <AtlasFace mode="atlas" state="happy" size={72} />
              <span className="text-center text-xs text-white/70">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
