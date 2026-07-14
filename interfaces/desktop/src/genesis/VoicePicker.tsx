import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Play, Loader2, Check, Volume2, Sparkles } from "lucide-react";
import {
  type VoiceEngine,
  type BrowserVoiceOption,
  type SpeakOptions,
  listBrowserVoices,
  setBrowserVoiceURI,
  getBrowserVoiceURI,
  setServerVoiceId,
  getServerVoiceId,
  setVoiceEngine,
  getVoiceEngine,
} from "@/genesis/useAtlasVoice";
import { randomSaying, defaultVoiceIntro } from "@/genesis/robotSayings";

interface ElevenVoice { id: string; name: string; category?: string; descriptor?: string }

interface AtlasVoiceLike {
  speaking: boolean;
  speak: (text: string, opts?: SpeakOptions) => Promise<void>;
  stop: () => void;
}

/**
 * The voice-picker step. If ElevenLabs is connected we list the user's actual
 * ElevenLabs voices to audition; otherwise we offer the three best built-in
 * browser voices. Either way they hear the DEFAULT first, then pick a favourite
 * — and every preview says something different so it's fun, not repetitive.
 */
export function VoicePicker({
  voice,
  botName,
  elevenUnlocked,
  onPicked,
}: {
  voice: AtlasVoiceLike;
  botName: string;
  elevenUnlocked: boolean;
  /** Fired when the user actively chooses a voice, so the wizard marks it touched. */
  onPicked: (engine: VoiceEngine) => void;
}) {
  const [elevenVoices, setElevenVoices] = useState<ElevenVoice[] | null>(null);
  const [loadingEleven, setLoadingEleven] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<BrowserVoiceOption[]>([]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => initialSelectedKey());

  // Browser voices populate asynchronously — listen for them.
  useEffect(() => {
    const load = () => setBrowserVoices(listBrowserVoices(3));
    load();
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    synth?.addEventListener?.("voiceschanged", load);
    return () => synth?.removeEventListener?.("voiceschanged", load);
  }, []);

  // Pull the user's real ElevenLabs voices when connected.
  useEffect(() => {
    if (!elevenUnlocked) { setElevenVoices(null); return; }
    let alive = true;
    setLoadingEleven(true);
    fetch("/api/vision/elevenlabs/voices")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { voices?: ElevenVoice[] } | null) => {
        if (!alive) return;
        setElevenVoices(d?.voices ?? []);
      })
      .catch(() => { if (alive) setElevenVoices([]); })
      .finally(() => { if (alive) setLoadingEleven(false); });
    return () => { alive = false; };
  }, [elevenUnlocked]);

  async function preview(key: string, text: string, opts: SpeakOptions) {
    voice.stop();
    setPreviewing(key);
    try {
      await voice.speak(text, opts);
    } finally {
      setPreviewing((p) => (p === key ? null : p));
    }
  }

  function pickBrowser(uri: string) {
    setBrowserVoiceURI(uri);
    setVoiceEngine("browser");
    setSelectedKey(`browser:${uri}`);
    onPicked("browser");
  }
  function pickEleven(id: string) {
    setServerVoiceId(id);
    setVoiceEngine("server");
    setSelectedKey(`eleven:${id}`);
    onPicked("server");
  }

  const hasEleven = elevenUnlocked;
  const elevenList = elevenVoices ?? [];
  const showBrowserAsDefault = hasEleven; // when eleven is present, browser is the "default" card

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col gap-5 pb-2">
      {/* Framing line */}
      <p className="text-center text-sm text-white/50">
        {hasEleven
          ? "Hear the default first, then audition your ElevenLabs voices and pick a favourite."
          : "Give each a listen and pick the one that sounds most like your buddy."}
      </p>

      {/* DEFAULT (browser) — shown as the lead card when ElevenLabs is connected */}
      {showBrowserAsDefault && (
        <section className="space-y-2">
          <SectionLabel>Default voice</SectionLabel>
          <VoiceRow
            title="Built-in voice"
            subtitle="Always available, zero setup."
            icon={<Volume2 className="h-4 w-4" />}
            selected={Boolean(selectedKey?.startsWith("browser:"))}
            previewing={previewing === "browser:default"}
            onPreview={() => preview("browser:default", defaultVoiceIntro(botName), { engine: "browser" })}
            onSelect={() => pickBrowser(getBrowserVoiceURI() ?? browserVoices[0]?.uri ?? "")}
          />
        </section>
      )}

      {/* ELEVENLABS list, OR the 3 browser defaults */}
      {hasEleven ? (
        <section className="flex min-h-0 flex-1 flex-col gap-2">
          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" /> Your ElevenLabs voices
            </span>
          </SectionLabel>
          {loadingEleven ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your voices…
            </div>
          ) : elevenList.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-white/45">
              No ElevenLabs voices found on your account — the built-in voice above works great in
              the meantime.
            </p>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {elevenList.map((v, i) => {
                const key = `eleven:${v.id}`;
                return (
                  <motion.div
                    key={v.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.22 }}
                  >
                    <VoiceRow
                      title={v.name}
                      subtitle={v.descriptor || (v.category ? prettyCategory(v.category) : "ElevenLabs voice")}
                      selected={selectedKey === key}
                      previewing={previewing === key}
                      onPreview={() =>
                        preview(key, randomSaying(botName), { engine: "server", voiceId: v.id })
                      }
                      onSelect={() => pickEleven(v.id)}
                    />
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          <SectionLabel>Choose a voice</SectionLabel>
          {browserVoices.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-white/45">
              Loading the built-in voices your device offers…
            </p>
          ) : (
            <div className="space-y-2">
              {browserVoices.map((bv, i) => {
                const key = `browser:${bv.uri}`;
                return (
                  <motion.div
                    key={bv.uri}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.24 }}
                  >
                    <VoiceRow
                      title={bv.name}
                      subtitle={`Built-in · ${bv.lang}`}
                      icon={<Volume2 className="h-4 w-4" />}
                      selected={selectedKey === key}
                      previewing={previewing === key}
                      onPreview={() =>
                        preview(key, randomSaying(botName), { engine: "browser", browserVoiceURI: bv.uri })
                      }
                      onSelect={() => pickBrowser(bv.uri)}
                    />
                  </motion.div>
                );
              })}
            </div>
          )}
          <p className="pt-1 text-center text-[11px] text-white/30">
            Want a more natural voice? Add an ElevenLabs key in the first step to unlock studio voices.
          </p>
        </section>
      )}
    </div>
  );
}

function initialSelectedKey(): string | null {
  const engine = getVoiceEngine();
  if (engine === "server") {
    const id = getServerVoiceId();
    return id ? `eleven:${id}` : null;
  }
  const uri = getBrowserVoiceURI();
  return uri ? `browser:${uri}` : null;
}

function prettyCategory(c: string): string {
  const map: Record<string, string> = {
    premade: "Premade voice",
    cloned: "Your cloned voice",
    professional: "Professional voice",
    generated: "Generated voice",
  };
  return map[c] ?? `${c.charAt(0).toUpperCase()}${c.slice(1)} voice`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-white/35">{children}</h3>
  );
}

function VoiceRow({
  title,
  subtitle,
  icon,
  selected,
  previewing,
  onPreview,
  onSelect,
}: {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  selected: boolean;
  previewing: boolean;
  onPreview: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      className={
        "flex items-center gap-3 rounded-xl border p-3 transition-all " +
        (selected
          ? "border-[#4A7FB5] bg-[#4A7FB5]/10 ring-1 ring-[#4A7FB5]"
          : "border-white/10 bg-white/[0.03] hover:border-white/25")
      }
    >
      {/* Preview button */}
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Hear ${title}`}
        title={`Hear ${title}`}
        className={
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7FB5] " +
          (previewing
            ? "bg-[#4A7FB5] text-white"
            : "bg-white/5 text-[#C9DCF0] hover:bg-white/10")
        }
      >
        {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : icon ?? <Play className="h-4 w-4" />}
      </button>

      {/* Selectable label */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left focus:outline-none"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-[#F7F5F0]">{title}</span>
          <span className="block truncate text-[11px] text-white/40">{subtitle}</span>
        </span>
        <span
          className={
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors " +
            (selected ? "border-[#4A7FB5] bg-[#4A7FB5] text-white" : "border-white/20 text-transparent")
          }
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      </button>
    </div>
  );
}
