import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Eye, Palette, Sparkles, Smile, UserRound, Check } from "lucide-react";
import {
  AtlasFace,
  FACE_THEMES,
  EMOJI_PACKS,
  useFaceTheme,
  saveFaceTheme,
  useEmojiPack,
  type FaceState,
} from "@/components/faces/AtlasFace";
import { applyColor, getStoredColor, type ColorScheme } from "@/components/Onboarding";
import { getBotName } from "@/lib/uiMode";
import { setPersona } from "@/genesis/personality";

// ─────────────────────────────────────────────────────────────────────────────
// Static catalogue metadata (colour hexes/labels aren't exported from Onboarding,
// so they live here — the single source is documented in MEMORY.md).
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_ORDER: ColorScheme[] = ["steel", "ice", "blue", "green", "yellow", "red"];
const COLOR_META: Record<ColorScheme, { label: string; hex: string; desc: string }> = {
  steel:  { label: "NEURA STEEL", hex: "#4A7FB5", desc: "the Neura signature" },
  ice:    { label: "NEURA ICE",   hex: "#C9DCF0", desc: "calm precision" },
  blue:   { label: "COBALT",      hex: "#3f84f3", desc: "deep focus" },
  green:  { label: "EMERALD",     hex: "#11d97a", desc: "growth & clarity" },
  yellow: { label: "AMBER",       hex: "#ffc820", desc: "energy & focus" },
  red:    { label: "CRIMSON",     hex: "#f03248", desc: "decisive authority" },
};

// The emotional-range showcase (not pickable). `tint` reddens the disc for anger.
interface Mood {
  state: FaceState;
  label: string;
  emoji?: string;
  tint?: string;
}
const MOODS: Mood[] = [
  { state: "idle",       label: "Idle" },
  { state: "happy",      label: "Happy" },
  { state: "love",       label: "Love" },
  { state: "wink",       label: "Wink" },
  { state: "excited",    label: "Excited" },
  { state: "starstruck", label: "Starstruck" },
  { state: "thinking",   label: "Curious" },
  { state: "angry",      label: "Angry", tint: "240,50,72" },
  { state: "sad",        label: "Sad" },
  { state: "idle",       label: "Cool", emoji: "😎" },
];

// The Mark personas — clicking applies the matching eye-theme "look".
interface Persona {
  themeId: string;
  code: string;
  name: string;
  tag: string;
  blurb: string;
}
const PERSONAS: Persona[] = [
  { themeId: "workshop", code: "MK-01", name: "Workshop", tag: "warm & witty",
    blurb: "Your everyday build partner — quick, friendly, a little playful." },
  { themeId: "stealth",  code: "MK-02", name: "Stealth",  tag: "calm & precise",
    blurb: "Low-glow, measured, and to the point. Signal over noise." },
  { themeId: "forge",    code: "MK-03", name: "Forge",    tag: "bold, sarcasm high",
    blurb: "Confident and gold-hot, with an edge. Not afraid to push back." },
  { themeId: "codex",    code: "MK-04", name: "Codex",    tag: "gentle & thoughtful",
    blurb: "Slow-blinking and considered — the patient, reflective one." },
];

// Sample glyph keys pulled from each emoji pack for the preview row.
const SAMPLE_GLYPH_KEYS = ["love", "star", "sparkle", "cool", "wink"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Shared card chrome
// ─────────────────────────────────────────────────────────────────────────────
const CARD_BASE =
  "group relative flex w-full flex-col items-center gap-3 rounded-lg border p-4 text-center " +
  "transition-all duration-200 hover:-translate-y-1 focus:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-[rgba(var(--primary-rgb),0.9)] " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function cardCls(active: boolean): string {
  return active
    ? `${CARD_BASE} border-[rgba(var(--primary-rgb),0.9)] bg-[rgba(var(--primary-rgb),0.09)] ` +
      "shadow-[0_0_30px_rgba(var(--primary-rgb),0.4)]"
    : `${CARD_BASE} border-[rgba(var(--primary-rgb),0.15)] bg-[rgba(var(--primary-rgb),0.03)] ` +
      "hover:border-[rgba(var(--primary-rgb),0.45)] hover:shadow-[0_0_22px_rgba(var(--primary-rgb),0.2)]";
}

function ActiveBadge() {
  return (
    <span
      className="absolute right-2 top-2 flex items-center gap-1 rounded-full border
        border-[rgba(var(--primary-rgb),0.6)] bg-[rgba(var(--primary-rgb),0.15)] px-1.5 py-0.5
        font-mono text-[8px] uppercase tracking-widest text-primary"
    >
      <Check className="h-2.5 w-2.5" aria-hidden />
      Active
    </span>
  );
}

function Section({
  icon,
  index,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  index: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3 border-b border-[rgba(var(--primary-rgb),0.15)] pb-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border
            border-[rgba(var(--primary-rgb),0.3)] bg-[rgba(var(--primary-rgb),0.08)] text-primary"
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] tracking-[0.3em] text-primary/35">{index}</span>
            <h2 className="font-sans text-lg font-bold uppercase tracking-[0.18em] text-primary">
              {title}
            </h2>
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-primary/40">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The gallery
// ─────────────────────────────────────────────────────────────────────────────
export function FacesGallery({ onClose }: { onClose: () => void }) {
  const activeTheme = useFaceTheme();
  const [emojiPack, setEmojiPack] = useEmojiPack();
  const [activeColor, setActiveColor] = useState<ColorScheme>(getStoredColor);
  const [activePersona, setActivePersona] = useState<string>(
    () => localStorage.getItem("atlas_persona") || "workshop",
  );
  const botName = getBotName();

  // Escape closes; lock the body scroll while the overlay owns the viewport.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  function pickColor(c: ColorScheme) {
    applyColor(c);
    localStorage.setItem("deckos_color", c);
    setActiveColor(c);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${botName} collection`}
      className="fixed inset-0 z-[120] overflow-y-auto bg-background font-mono
        bg-[image:linear-gradient(rgba(var(--primary-rgb),0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(var(--primary-rgb),0.035)_1px,transparent_1px)]
        bg-[size:32px_32px]"
    >
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b
          border-[rgba(var(--primary-rgb),0.2)] bg-background/80 px-5 py-4 backdrop-blur-md sm:px-8"
      >
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-primary/35">
            DeckOS // Collection Wall
          </div>
          <h1 className="truncate font-sans text-xl font-bold uppercase tracking-[0.22em] text-primary sm:text-2xl">
            Your {botName} — Collection
          </h1>
        </div>
        <button
          onClick={onClose}
          aria-label="Close collection"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border
            border-[rgba(var(--primary-rgb),0.3)] text-primary/70 transition-all
            hover:border-[rgba(var(--primary-rgb),0.7)] hover:bg-[rgba(var(--primary-rgb),0.1)] hover:text-primary
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--primary-rgb),0.9)]
            focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-5xl space-y-14 px-5 py-10 sm:px-8">
        <p className="max-w-2xl font-mono text-xs leading-relaxed text-primary/45">
          Everything that makes {botName} yours, in one place — the eyes, the accent, the emoji
          voice, the moods, and the Mark personas. Pick any card to try it on instantly; every
          preview updates live.
        </p>

        {/* 1 — EYE STYLES */}
        <Section
          icon={<Eye className="h-4 w-4" aria-hidden />}
          index="01"
          title="Eye Styles"
          subtitle="The eyes always match the seam. Choose the pack that feels like home."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {FACE_THEMES.map((t) => {
              const active = activeTheme.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => saveFaceTheme(t.id)}
                  aria-pressed={active}
                  className={cardCls(active)}
                >
                  {active && <ActiveBadge />}
                  <AtlasFace
                    mode="atlas"
                    state="happy"
                    size={90}
                    eyeColorOverride={t.eyeRgb}
                  />
                  <div className="font-mono text-xs font-bold uppercase tracking-widest text-primary/80 group-hover:text-primary">
                    {t.name}
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* 2 — ACCENT COLOURS */}
        <Section
          icon={<Palette className="h-4 w-4" aria-hidden />}
          index="02"
          title="Accent Colours"
          subtitle="The system tint. Everything themes to your pick — including this gallery."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {COLOR_ORDER.map((c) => {
              const meta = COLOR_META[c];
              const active = activeColor === c;
              return (
                <button
                  key={c}
                  onClick={() => pickColor(c)}
                  aria-pressed={active}
                  className={cardCls(active)}
                >
                  {active && <ActiveBadge />}
                  <span
                    className="h-14 w-14 rounded-full border-2 border-white/10 transition-transform
                      duration-200 group-hover:scale-105"
                    style={{
                      backgroundColor: meta.hex,
                      boxShadow: `0 0 22px 2px ${meta.hex}80`,
                    }}
                    aria-hidden
                  />
                  <div className="space-y-0.5">
                    <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-primary/80 group-hover:text-primary">
                      {meta.label}
                    </div>
                    <div className="font-mono text-[9px] tracking-wider text-primary/35">{meta.hex}</div>
                    <div className="font-mono text-[9px] tracking-wide text-primary/30">{meta.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* 3 — EMOJI PACKS */}
        <Section
          icon={<Sparkles className="h-4 w-4" aria-hidden />}
          index="03"
          title="Emoji Packs"
          subtitle="The momentary accents flashed above the eyes. Same feelings, different dialect."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(EMOJI_PACKS).map(([id, pack]) => {
              const active = emojiPack === id;
              return (
                <button
                  key={id}
                  onClick={() => setEmojiPack(id)}
                  aria-pressed={active}
                  className={cardCls(active)}
                >
                  {active && <ActiveBadge />}
                  <div className="font-mono text-xs font-bold uppercase tracking-widest text-primary/80 group-hover:text-primary">
                    {pack.name}
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {SAMPLE_GLYPH_KEYS.map((k) => (
                      <span
                        key={k}
                        title={k}
                        className="flex h-9 min-w-9 items-center justify-center rounded-md border
                          border-[rgba(var(--primary-rgb),0.15)] bg-[rgba(var(--primary-rgb),0.05)]
                          px-1.5 text-base leading-none text-primary/85"
                      >
                        {pack.glyphs[k] ?? "·"}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </Section>

        {/* 4 — MOODS PREVIEW (showcase, not pickable) */}
        <Section
          icon={<Smile className="h-4 w-4" aria-hidden />}
          index="04"
          title="Moods"
          subtitle="The emotional range, live in your current eye style. A showcase — not a picker."
        >
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {MOODS.map((m, i) => (
              <div
                key={`${m.state}-${m.label}-${i}`}
                className="flex flex-col items-center gap-2 rounded-lg border
                  border-[rgba(var(--primary-rgb),0.12)] bg-[rgba(var(--primary-rgb),0.03)] p-3"
              >
                <AtlasFace
                  mode="atlas"
                  state={m.state}
                  size={56}
                  emoji={m.emoji ?? null}
                  discTint={m.tint ?? null}
                />
                <div className="font-mono text-[10px] uppercase tracking-widest text-primary/55">
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 5 — PERSONALITIES (Mark editions) */}
        <Section
          icon={<UserRound className="h-4 w-4" aria-hidden />}
          index="05"
          title="Personalities"
          subtitle="The Mark editions. Tap one to wear its look — fuller personality tuning lives in Settings."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PERSONAS.map((p) => {
              const active = activePersona === p.themeId;
              const theme = FACE_THEMES.find((t) => t.id === p.themeId);
              return (
                <button
                  key={p.themeId}
                  onClick={() => {
                    // Apply the FULL persona: response traits (LLM), eyes, and emoji pack.
                    setPersona(p.themeId);
                    setActivePersona(p.themeId);
                  }}
                  aria-pressed={active}
                  className={`${cardCls(active)} !items-start !text-left`}
                >
                  {active && <ActiveBadge />}
                  <div className="flex w-full items-center gap-3">
                    <AtlasFace
                      mode="atlas"
                      state="idle"
                      size={54}
                      eyeColorOverride={theme?.eyeRgb ?? null}
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] tracking-[0.25em] text-primary/40">{p.code}</div>
                      <div className="font-mono text-sm font-bold uppercase tracking-widest text-primary/85 group-hover:text-primary">
                        {p.name}
                      </div>
                      <div className="font-mono text-[10px] tracking-wide text-primary/45">{p.tag}</div>
                    </div>
                  </div>
                  <p className="font-mono text-[11px] leading-relaxed text-primary/40">{p.blurb}</p>
                </button>
              );
            })}
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-primary/30">
            Note — picking a personality tunes how {botName} <em>talks</em> (humour, warmth, energy)
            and applies its matching eyes + emoji pack. Fine-tune individual traits in Settings.
          </p>
        </Section>
      </div>
    </motion.div>
  );
}
