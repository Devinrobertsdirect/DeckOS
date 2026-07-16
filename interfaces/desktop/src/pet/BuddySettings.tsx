import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, User, KeyRound, Sparkles, Volume2, Eye, Smile, Palette, Cpu, Brain, Check, Trash2 } from "lucide-react";
import { AtlasFace, FACE_THEMES, EMOJI_PACKS, useFaceTheme, saveFaceTheme, useEmojiPack } from "@/components/faces/AtlasFace";
import { applyColor, getStoredColor, type ColorScheme } from "@/components/Onboarding";
import { PERSONAS, setPersona, usePersonaId } from "@/genesis/personality";
import { VoicePicker } from "@/genesis/VoicePicker";
import { useAtlasVoice, getVoiceRate, setVoiceRate } from "@/genesis/useAtlasVoice";
import { PROVIDERS } from "@/genesis/providers";
import { getUserName, setUserName, getBotName, setBotName, getExperienceMode, setExperienceMode } from "@/lib/uiMode";
import { useAtlasMemory, addFact, removeFact } from "@/lib/atlasMemory";
import { Input } from "@/components/ui/input";

/**
 * BuddySettings — the friendly, full customization page.
 *
 * Everything a non-dev needs to make the bot theirs, opened right from the face:
 * names, AI keys, personality, voice, eyes, emoji, colour, context, and device
 * mode. It writes to the SAME stores the developer Settings page and onboarding
 * use (localStorage + server config), so every change persists and mirrors both
 * ways automatically — this is just a nicer door to the same settings.
 */

const COLORS: { scheme: ColorScheme; hex: string; label: string }[] = [
  { scheme: "steel", hex: "#4A7FB5", label: "Steel" },
  { scheme: "ice", hex: "#C9DCF0", label: "Ice" },
  { scheme: "blue", hex: "#3f84f3", label: "Cobalt" },
  { scheme: "green", hex: "#11d97a", label: "Emerald" },
  { scheme: "yellow", hex: "#ffc820", label: "Amber" },
  { scheme: "red", hex: "#f03248", label: "Crimson" },
];

function Section({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5 border-b border-primary/12 pb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/25 bg-primary/[0.06] text-primary">{icon}</div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-primary/80">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function chip(active: boolean) {
  return "rounded-xl border p-3 text-left transition-all " +
    (active ? "border-primary/70 bg-primary/10 ring-1 ring-primary" : "border-primary/12 bg-primary/[0.03] hover:border-primary/40");
}

export function BuddySettings({ onClose }: { onClose: () => void }) {
  const voice = useAtlasVoice();
  const mem = useAtlasMemory();
  const theme = useFaceTheme();
  const [emojiPack, setEmojiPack] = useEmojiPack();
  const personaId = usePersonaId();
  const [accent, setAccent] = useState<ColorScheme>(getStoredColor);
  const [userName, setUserNameL] = useState(getUserName);
  const [botName, setBotNameL] = useState(getBotName);
  const [rate, setRate] = useState(getVoiceRate);
  const [newFact, setNewFact] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [configured, setConfigured] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // What's already connected (masked) — mirrors the dev page's config store.
  useEffect(() => {
    fetch("/api/config").then((r) => (r.ok ? r.json() : null)).then((d: { config?: Record<string, string> } | null) => {
      if (d?.config) setConfigured(d.config);
    }).catch(() => { /* offline */ });
  }, [savedKey]);

  const elevenUnlocked = useMemo(
    () => !!configured["ELEVENLABS_API_KEY"] || !!(keys["ELEVENLABS_API_KEY"] || "").trim(),
    [configured, keys],
  );

  function saveKey(keyName: string) {
    const v = (keys[keyName] || "").trim();
    if (!v) return;
    void fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [keyName]: v }) })
      .then(() => { setSavedKey(keyName); setKeys((k) => ({ ...k, [keyName]: "" })); })
      .catch(() => { /* offline */ });
  }
  function commitNames() {
    setUserName(userName.trim());
    setBotName(botName.trim());
  }
  function pickColor(c: ColorScheme) {
    applyColor(c);
    try { localStorage.setItem("deckos_color", c); } catch { /* ignore */ }
    setAccent(c);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}
      role="dialog" aria-modal="true" aria-label={`${botName} settings`}
      className="fixed inset-0 z-[125] overflow-y-auto bg-background/97 backdrop-blur-sm"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-primary/15 bg-background/85 px-5 py-4 backdrop-blur-md sm:px-8">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-primary/35">DeckOS // Make {botName} yours</div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Settings</h1>
        </div>
        <button onClick={() => { commitNames(); onClose(); }} aria-label="Done"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/25 text-muted-foreground hover:border-primary/60 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="mx-auto max-w-3xl space-y-10 px-5 py-8 sm:px-8">
        {/* ── Names ─────────────────────────────────────────────────────── */}
        <Section icon={<User className="h-4 w-4" />} title="You & your bot" subtitle="Names carry through everywhere the bot speaks.">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">Your name</span>
              <Input value={userName} onChange={(e) => setUserNameL(e.target.value)} onBlur={commitNames} placeholder="e.g. Devin" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-muted-foreground">Your bot's name</span>
              <Input value={botName} onChange={(e) => setBotNameL(e.target.value)} onBlur={commitNames} placeholder="Neura" />
            </label>
          </div>
        </Section>

        {/* ── AI keys ───────────────────────────────────────────────────── */}
        <Section icon={<KeyRound className="h-4 w-4" />} title="AI brains & keys" subtitle="Connect cloud AIs for smarter, faster replies — all optional.">
          <div className="space-y-2.5">
            {PROVIDERS.filter((p) => p.status !== "stub").map((p) => {
              const set = !!configured[p.keyName];
              return (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border border-primary/12 bg-primary/[0.03] p-2.5">
                  <span className="w-24 shrink-0 text-sm font-medium text-foreground">{p.name}</span>
                  <Input type="password" value={keys[p.keyName] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [p.keyName]: e.target.value }))}
                    placeholder={set ? "•••• connected — replace" : `${p.name} API key`} className="flex-1" />
                  <button type="button" onClick={() => saveKey(p.keyName)} disabled={!(keys[p.keyName] || "").trim()}
                    className="shrink-0 rounded-md border border-primary/30 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-40">
                    {savedKey === p.keyName ? <Check className="h-3.5 w-3.5" /> : "Save"}
                  </button>
                  {set && <span className="shrink-0 text-[10px] uppercase tracking-wider text-emerald-400">on</span>}
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Personality ───────────────────────────────────────────────── */}
        <Section icon={<Sparkles className="h-4 w-4" />} title="Personality" subtitle="How the bot talks — and its matching look.">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {PERSONAS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPersona(p.id)} aria-pressed={personaId === p.id} className={chip(personaId === p.id)}>
                <span className="block text-sm font-medium text-foreground">{p.name}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{p.blurb}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Voice ─────────────────────────────────────────────────────── */}
        <Section icon={<Volume2 className="h-4 w-4" />} title="Voice" subtitle="Hear the default, then pick a favourite. Set the speed below.">
          <VoicePicker voice={voice} botName={botName} elevenUnlocked={elevenUnlocked} onPicked={() => { /* persisted by the picker */ }} />
          <label className="mt-3 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Speaking speed</span>
            <input type="range" min={0.7} max={1.6} step={0.05} value={rate}
              onChange={(e) => { const r = setVoiceRate(Number(e.target.value)); setRate(r); }} className="flex-1 accent-[rgb(var(--primary-rgb))]" />
            <span className="w-10 text-right font-mono text-xs text-primary/70">{rate.toFixed(2)}x</span>
          </label>
        </Section>

        {/* ── Eyes ──────────────────────────────────────────────────────── */}
        <Section icon={<Eye className="h-4 w-4" />} title="Eyes" subtitle="The eyes always match the seam.">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {FACE_THEMES.map((t) => (
              <button key={t.id} type="button" onClick={() => saveFaceTheme(t.id)} aria-pressed={theme.id === t.id} className={chip(theme.id === t.id) + " flex flex-col items-center gap-1.5"}>
                <AtlasFace mode="atlas" state="happy" size={56} eyeColorOverride={t.eyeRgb} />
                <span className="text-[11px] text-muted-foreground">{t.name}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Emoji pack ────────────────────────────────────────────────── */}
        <Section icon={<Smile className="h-4 w-4" />} title="Emoji pack" subtitle="The little reactions the face flashes.">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {Object.entries(EMOJI_PACKS).map(([id, pack]) => (
              <button key={id} type="button" onClick={() => setEmojiPack(id)} aria-pressed={emojiPack === id} className={chip(emojiPack === id) + " flex flex-col items-center gap-1"}>
                <span className="text-base leading-none">{pack.glyphs.love} {pack.glyphs.sparkle}</span>
                <span className="text-[11px] text-muted-foreground">{pack.name}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Accent colour ─────────────────────────────────────────────── */}
        <Section icon={<Palette className="h-4 w-4" />} title="Accent colour" subtitle="Themes the whole app to your pick.">
          <div className="flex flex-wrap gap-3">
            {COLORS.map((c) => (
              <button key={c.scheme} type="button" onClick={() => pickColor(c.scheme)} aria-label={c.label} title={c.label}
                className={"h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 " + (accent === c.scheme ? "border-white ring-2 ring-white/40" : "border-white/20")}
                style={{ background: c.hex }} />
            ))}
          </div>
        </Section>

        {/* ── Context / memory ──────────────────────────────────────────── */}
        <Section icon={<Brain className="h-4 w-4" />} title="What it knows about you" subtitle="Context the bot keeps and uses in every reply.">
          <div className="space-y-2">
            {mem.facts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing yet — tell it something, or add a note below.</p>
            ) : mem.facts.map((f) => (
              <div key={f.id} className="group flex items-center justify-between gap-2 rounded-lg border border-primary/10 bg-primary/[0.03] px-3 py-2">
                <span className="text-sm text-foreground">{f.text}</span>
                <button onClick={() => removeFact(f.id)} aria-label="Forget this" className="text-muted-foreground/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <form className="flex gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); if (newFact.trim()) { addFact(newFact.trim(), "user"); setNewFact(""); } }}>
              <Input value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Remember that…" className="flex-1" />
              <button type="submit" disabled={!newFact.trim()} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-40">Add</button>
            </form>
          </div>
        </Section>

        {/* ── Device mode ───────────────────────────────────────────────── */}
        <Section icon={<Cpu className="h-4 w-4" />} title="Device mode" subtitle="How much of the machine to show.">
          <div className="flex flex-wrap gap-2.5">
            {(["computer", "robot"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setExperienceMode(m)} aria-pressed={getExperienceMode() === m} className={chip(getExperienceMode() === m) + " flex-1"}>
                <span className="block text-sm font-medium capitalize text-foreground">{m}</span>
                <span className="block text-[11px] text-muted-foreground">{m === "computer" ? "Face is home; the full command center is a tap away." : "Face-locked kiosk — the only screen."}</span>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </motion.div>
  );
}
