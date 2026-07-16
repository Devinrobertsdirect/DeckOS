import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

import {
  AtlasFace,
  FACE_THEMES,
  EMOJI_PACKS,
  useFaceTheme,
  saveFaceTheme,
  useEmojiPack,
  type FaceState,
} from "@/components/faces/AtlasFace";
import { applyColor, type ColorScheme } from "@/components/Onboarding";
import { PERSONAS, setPersona, usePersonaId } from "@/genesis/personality";
import { VoicePicker } from "@/genesis/VoicePicker";
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
 * adopts and customizes their companion before its intro. Five steps:
 *   0. Keys        → connect provider API keys (all optional)
 *   1. Names       → the user's name and the AI's name
 *   2. Voice       → pick the default browser voice or the ElevenLabs voice
 *   3. Appearance  → eyes (face theme), emoji pack, and accent colour
 *   4. Meet        → celebratory reveal of the Atlas they just made
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

type Step = 0 | 1 | 2 | 3 | 4;

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
      go(3); // voice → look
    } else if (step === 3) {
      go(4); // look → meet
    } else {
      finish(); // meet → done
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

  // ── Step content ────────────────────────────────────────────────────────────
  // Warm, adoption-flavoured copy — you're not filling a form, you're bringing
  // a new companion home. Titles interpolate the name once it's chosen.
  const botLabel = botName.trim() || "Neura";
  const stepTitle = [
    "Bring your AIs along",
    "Let's get acquainted",
    `Give ${botLabel} a voice`,
    `Dress up ${botLabel}`,
    `Meet ${botLabel}`,
  ][step];
  const stepSubtitle = [
    `Plug in the AI services you already use — or skip and add them later. ${botLabel} taps them for its very first hello.`,
    "A name for you, and a name for your companion — so it can talk to you like a partner, not a product.",
    `Hear the default, then audition a voice until one sounds like ${botLabel}.`,
    "Pick a personality, then its eyes, emoji, and colour — everything updates live. Make it yours.",
    `${botLabel} is all yours. Say hello — you can change anything later in Settings.`,
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
          {/* The face floats gently and sits in a soft glow — kept mounted across
              steps so its canvas animation never restarts. */}
          <div className="relative flex items-center justify-center">
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ width: 220, height: 220, background: "radial-gradient(circle, rgba(74,127,181,0.28) 0%, transparent 65%)", filter: "blur(6px)" }}
            />
            <motion.div
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
              className="relative"
            >
              <AtlasFace mode="atlas" state={faceState} size={96} />
            </motion.div>
          </div>
          <Progress step={step} />
          <div className="mt-1 text-center">
            {/* Keyed remount = the new step mounts immediately; no exit callback
                to stall (AnimatePresence mode="wait" can hang under React 19). */}
            <motion.div
              key={`title-${step}`}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
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
            initial={{ opacity: 0, x: direction > 0 ? 34 : -34, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
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
                <VoicePicker
                  voice={voice}
                  botName={botLabel}
                  elevenUnlocked={elevenUnlocked}
                  onPicked={(engine) => { setVoiceTouched(true); setSelectedEngine(engine); }}
                />
              )}

              {step === 3 && <AppearanceStep />}

              {step === 4 && (
                <MeetStep botName={botName} voiceEngine={selectedEngine} />
              )}
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
              className="border-transparent bg-[#4A7FB5] px-6 text-white shadow-[0_0_20px_rgba(74,127,181,0.35)] transition-transform hover:bg-[#3f6f9f] active:scale-[0.97]"
              onClick={handleNext}
            >
              {step === 4 ? "Let's begin →" : "Next →"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Progress dots — spring-popped dots joined by a track that fills as you go ──
function Progress({ step }: { step: number }) {
  const total = 5;
  return (
    <div className="flex items-center" aria-label={`Step ${step + 1} of ${total}`}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={i} className="flex items-center">
            <motion.div
              initial={false}
              animate={{
                scale: active ? 1 : 0.82,
                backgroundColor: done || active ? "#4A7FB5" : "rgba(255,255,255,0.07)",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
              aria-current={active ? "step" : undefined}
            >
              {done ? (
                <Check className="h-3.5 w-3.5 text-white" aria-hidden />
              ) : (
                <span className={active ? "text-white" : "text-white/40"}>{i + 1}</span>
              )}
            </motion.div>
            {i < total - 1 && (
              <div className="mx-1.5 h-[2px] w-5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={false}
                  animate={{ width: i < step ? "100%" : "0%" }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="h-full bg-[#4A7FB5]"
                />
              </div>
            )}
          </div>
        );
      })}
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
            Name your Neura
          </label>
          <Input
            id="atlas-bot-name"
            value={botName}
            onChange={(e) => onBotName(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder="Neura"
            autoComplete="off"
            spellCheck={false}
            className={INPUT_CLASS + " h-11 text-base"}
          />
        </div>
        <p className="text-center text-xs text-white/30">
          A nickname for your Neura — it always answers to "Neura" too. You can change it any time.
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
      title: "Neura is the hub — the AIs are the power",
      body: "On its own, Neura organizes your day. Plugged into services like Claude or Gemini, it gets dramatically smarter — you choose which ones.",
    },
    {
      icon: "🔑",
      title: "A key is just a private password",
      body: "Each service gives you a key — a long password that lets Neura use your account. You paste it once. Neura does the talking from then on.",
    },
    {
      icon: "🏠",
      title: "Your keys stay on your machine",
      body: "Keys are stored locally, never shared, never sent anywhere but the service they belong to. You can remove them any time in Settings.",
    },
    {
      icon: "⏭️",
      title: "Totally optional — skip and add later",
      body: "Neura already works with the free brain running on your computer. Connect nothing now if you like; everything on the next screen can wait.",
    },
  ];
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-3">
      <p className="mb-1 text-center text-sm text-white/55">
        Think of the next screen like giving Neura a phone book of brilliant
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
        private password an AI service gives you. Paste it once and Neura does the
        talking — keys stay on your machine and can be removed any time. Everything
        here is optional; Neura already works with the free brain on your computer.
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

// ── Step 4: Appearance — give your buddy its look & personality ───────────────
// An expressive sequence the central face cycles through so the user *sees* the
// emotional range Atlas can wear — the wow moment of the whole wizard.
const EMOTION_SHOWCASE: FaceState[] = [
  "happy",
  "love",
  "wink",
  "excited",
  "starstruck",
  "idle",
];

// The six accent schemes as swatches. Hexes mirror the app's ColorScheme map so
// clicking one recolours the eyes (which follow the accent) live.
const ACCENT_SWATCHES: { scheme: ColorScheme; hex: string; label: string }[] = [
  { scheme: "steel", hex: "#4A7FB5", label: "Neura Steel" },
  { scheme: "ice", hex: "#C9DCF0", label: "Neura Ice" },
  { scheme: "blue", hex: "#3f84f3", label: "Cobalt" },
  { scheme: "green", hex: "#11d97a", label: "Emerald" },
  { scheme: "yellow", hex: "#ffc820", label: "Amber" },
  { scheme: "red", hex: "#f03248", label: "Crimson" },
];

function AppearanceStep() {
  // Every AtlasFace reads the active theme from localStorage via useFaceTheme,
  // so saving one updates the big preview and all card previews at once.
  const theme = useFaceTheme();
  const [emojiPack, setEmojiPack] = useEmojiPack();
  const personaId = usePersonaId();
  const [accent, setAccent] = useState<ColorScheme>(
    () => (localStorage.getItem("deckos_color") as ColorScheme) || "steel",
  );

  // Cycle the central face through the showcase so its range is on display.
  const [showIdx, setShowIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setShowIdx((i) => (i + 1) % EMOTION_SHOWCASE.length),
      1400,
    );
    return () => clearInterval(id);
  }, []);
  const showcaseState = EMOTION_SHOWCASE[showIdx] ?? "happy";

  function pickAccent(scheme: ColorScheme) {
    applyColor(scheme);
    localStorage.setItem("deckos_color", scheme);
    setAccent(scheme);
  }

  return (
    <div className="flex flex-col items-center gap-7 py-2">
      {/* Emotion showcase — the star. Auto-cycles so you see Atlas *feel*. */}
      <div className="flex flex-col items-center gap-2">
        <AtlasFace mode="atlas" state={showcaseState} size={120} />
        <span className="text-xs italic text-white/40">Watch me feel.</span>
      </div>

      {/* Personality — the lead choice: sets how it TALKS + a matching look. */}
      <section className="w-full max-w-md">
        <h3 className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/35">
          Personality
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          {PERSONAS.map((p) => {
            const selected = p.id === personaId;
            return (
              <button
                key={p.id}
                type="button"
                // Applies the whole vibe: response traits (once an AI is attached),
                // plus its matching eyes + emoji pack. Fine-tune the look below.
                onClick={() => setPersona(p.id)}
                aria-pressed={selected}
                className={
                  "flex flex-col gap-1 rounded-xl border p-3 text-left transition-all " +
                  (selected
                    ? "border-[#4A7FB5] bg-[#4A7FB5]/10 ring-1 ring-[#4A7FB5]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25")
                }
              >
                <span className="text-sm font-medium text-[#F7F5F0]">{p.name}</span>
                <span className="text-[11px] leading-snug text-white/45">{p.blurb}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Eyes — the face-theme grid. */}
      <section className="w-full max-w-md">
        <h3 className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/35">
          Eyes
        </h3>
        <div className="grid grid-cols-3 gap-3">
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
                <AtlasFace mode="atlas" state="happy" size={64} />
                <span className="text-center text-xs text-white/70">{t.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Emoji pack — how Atlas flashes its little reactions. */}
      <section className="w-full max-w-md">
        <h3 className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/35">
          Emoji pack
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(EMOJI_PACKS).map(([id, pack]) => {
            const selected = id === emojiPack;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setEmojiPack(id)}
                aria-pressed={selected}
                className={
                  "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 transition-all " +
                  (selected
                    ? "border-[#4A7FB5] bg-[#4A7FB5]/10 ring-1 ring-[#4A7FB5]"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25")
                }
              >
                <span className="text-base leading-none" aria-hidden>
                  {pack.glyphs.love} {pack.glyphs.sparkle}
                </span>
                <span className="text-[11px] text-white/70">{pack.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Accent colour — the eyes follow it unless an eye theme overrides. */}
      <section className="w-full max-w-md">
        <h3 className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/35">
          Accent
        </h3>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {ACCENT_SWATCHES.map((c) => {
            const selected = c.scheme === accent;
            return (
              <button
                key={c.scheme}
                type="button"
                onClick={() => pickAccent(c.scheme)}
                aria-pressed={selected}
                aria-label={c.label}
                title={c.label}
                className={
                  "h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 " +
                  (selected ? "border-white ring-2 ring-white/40" : "border-white/20")
                }
                style={{ background: c.hex }}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── Step 5: Meet — the celebratory reveal of the Atlas they just made ─────────
function MeetStep({
  botName,
  voiceEngine,
}: {
  botName: string;
  voiceEngine: VoiceEngine;
}) {
  const theme = useFaceTheme();
  const bot = botName.trim() || "Neura";
  const voiceLabel = voiceEngine === "server" ? "ElevenLabs" : "Default";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      {/* Reflects every choice: eyes, emoji pack, accent colour. */}
      <AtlasFace mode="atlas" state="happy" size={140} />
      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-[#F7F5F0]">
          Say hi to {bot}
        </h2>
        <p className="text-sm text-white/60">
          {theme.name} eyes · {voiceLabel} voice
        </p>
      </div>
      <p className="mx-auto max-w-xs text-xs leading-relaxed text-white/40">
        This is {bot} — your very own. You can change any of this later in Settings.
      </p>
    </div>
  );
}
