import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  X, Brain, BookMarked, Workflow, Sparkles, Cpu, MessageSquare,
  Activity, Plug, ArrowUpRight, CornerDownLeft, type LucideIcon,
} from "lucide-react";
import {
  useDeckCapabilities,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type CapabilityCategory,
  type DeckCapability,
} from "@/lib/deckCapabilities";
import { openDeckOsFeature, getBotName } from "@/lib/uiMode";

const CATEGORY_ICON: Record<CapabilityCategory, LucideIcon> = {
  brain: Brain,
  memory: BookMarked,
  automation: Workflow,
  insight: Sparkles,
  devices: Cpu,
  comms: MessageSquare,
  system: Activity,
  setup: Plug,
};

/**
 * The "what can I do?" launcher — Atlas is the face of DeckOS, so this is where
 * the buddy shows everything the OS can do and lets you jump straight into any
 * tool (openDeckOsFeature) or hand a phrase back to Atlas to act on (onAsk).
 */
export function CapabilitiesPanel({
  onClose,
  onAsk,
}: {
  onClose: () => void;
  onAsk: (text: string) => void;
}) {
  const { capabilities, loading } = useDeckCapabilities();
  const bot = getBotName();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const grouped = CATEGORY_ORDER
    .map((cat) => ({ cat, items: capabilities.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={`What ${bot} can do`}
      className="fixed inset-0 z-[120] overflow-y-auto bg-background/95 backdrop-blur-sm"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-primary/15 bg-background/85 px-5 py-4 backdrop-blur-md sm:px-8">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-primary/35">
            DeckOS // Everything {bot} can do
          </div>
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {bot} is the face — DeckOS is everything under the hood
          </h1>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/25 text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="mx-auto max-w-4xl space-y-9 px-5 py-8 sm:px-8">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Just talk to {bot} for any of these — it knows how DeckOS works and can do it or
          take you there. Tap <span className="text-primary">Open</span> to jump straight into a tool,
          or tap a suggestion to have {bot} handle it.
        </p>

        {loading && (
          <div className="py-10 text-center font-mono text-xs text-muted-foreground/60">
            Loading {bot}&apos;s abilities…
          </div>
        )}

        {grouped.map(({ cat, items }) => {
          const Icon = CATEGORY_ICON[cat];
          return (
            <section key={cat} className="space-y-3">
              <div className="flex items-center gap-2 border-b border-primary/10 pb-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/25 bg-primary/[0.06] text-primary">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/70">
                  {CATEGORY_LABEL[cat]}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((c) => (
                  <CapabilityCard key={c.id} cap={c} onAsk={onAsk} onClose={onClose} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </motion.div>
  );
}

function CapabilityCard({
  cap,
  onAsk,
  onClose,
}: {
  cap: DeckCapability;
  onAsk: (text: string) => void;
  onClose: () => void;
}) {
  const suggestion = cap.userPhrasings[0];
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-primary/12 bg-primary/[0.03] p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{cap.title}</h3>
        {cap.uiRoute && (
          <button
            type="button"
            onClick={() => openDeckOsFeature(cap.uiRoute)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-primary/30 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{cap.summary}</p>
      {suggestion && (
        <button
          type="button"
          onClick={() => { onClose(); onAsk(suggestion); }}
          className="group mt-0.5 flex items-center gap-1.5 self-start rounded-md bg-primary/[0.06] px-2 py-1 text-left text-[11px] text-primary/80 transition-colors hover:bg-primary/12 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Ask Neura this"
        >
          <CornerDownLeft className="h-3 w-3 opacity-60 group-hover:opacity-100" />
          “{suggestion}”
        </button>
      )}
    </div>
  );
}
