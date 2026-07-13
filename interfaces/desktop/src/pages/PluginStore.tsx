import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Store, Download, Trash2, Power, Search, Filter,
  CheckCircle2, Shield, Tag, User, Globe, Loader2, RefreshCw,
  X, BookOpen, Calendar, Info, ChevronRight, Star, MessageSquare, Pencil,
  Terminal, Package,
} from "lucide-react";

const API_BASE = "/api";

interface RegistryPlugin {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  category: string;
  permissions: string[];
  tags: string[];
  iconUrl: string | null;
  entrypointUrl: string | null;
  installCount: number;
  readme: string;
  installed: boolean;
  enabled: boolean;
  installedAt: string | null;
}

interface ReviewEntry {
  rating: number;
  avgRating: number;
  reviewCount: number;
  review: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
type ReviewsMap = Record<string, ReviewEntry>;

type StoreTab = "store" | "installed" | "clawhub";

interface ClawSkill {
  slug: string;
  name: string;
  author: string;
  category: string;
  description: string;
  installCount: number;
  tags: string[];
}

const CATEGORY_COLORS: Record<string, string> = {
  monitoring:    "text-[#00d4ff]",
  ai:            "text-[#cc44ff]",
  iot:           "text-[#ffaa00]",
  productivity:  "text-[#22ff44]",
  community:     "text-primary/60",
  communication: "text-[#38bdf8]",
  devops:        "text-[#00e5cc]",
  data:          "text-[#facc15]",
  research:      "text-[#a78bfa]",
  system:        "text-[#94a3b8]",
  media:         "text-[#f472b6]",
  homelab:       "text-[#fb923c]",
  security:      "text-[#f87171]",
  automation:    "text-[#a3e635]",
};

const PERMISSION_LABELS: Record<string, { label: string; desc: string; risk: "low" | "medium" | "high" }> = {
  network: { label: "Network access", desc: "Can make outbound HTTP requests to external services.", risk: "medium" },
  ai_inference: { label: "AI inference", desc: "Can invoke the local AI model for inference.", risk: "low" },
  memory_read: { label: "Read memory", desc: "Can read entries from the JARVIS memory store.", risk: "low" },
  memory_write: { label: "Write memory", desc: "Can create and update entries in the JARVIS memory store.", risk: "medium" },
  device_control: { label: "Device control", desc: "Can send commands to connected IoT devices.", risk: "high" },
  device_read: { label: "Read devices", desc: "Can read state and sensor data from connected devices.", risk: "low" },
  system_stats: { label: "System stats", desc: "Can read CPU, memory, disk and network usage.", risk: "low" },
  process_list: { label: "Process list", desc: "Can enumerate running system processes.", risk: "low" },
  tts: { label: "Voice output (TTS)", desc: "Can speak through the JARVIS TTS system.", risk: "low" },
  notifications: { label: "Send notifications", desc: "Can push notifications to the JARVIS inbox.", risk: "low" },
};

const PERM_RISK_COLORS: Record<string, string> = {
  low: "border-[#22ff44]/30 text-[#22ff44]/70",
  medium: "border-[#ffaa00]/30 text-[#ffaa00]/70",
  high: "border-[#ff3333]/40 text-[#ff3333]/70",
};

const PERM_RISK_BG: Record<string, string> = {
  low: "bg-[#22ff44]/5",
  medium: "bg-[#ffaa00]/5",
  high: "bg-[#ff3333]/5",
};

async function fetchRegistry() {
  const res = await fetch(`${API_BASE}/plugins/store/registry`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<{ plugins: RegistryPlugin[]; version: string; updatedAt: string }>;
}

function StarRating({
  value,
  onChange,
  size = "sm",
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: "sm" | "md";
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const display = hovered ?? value;
  const cls = size === "md" ? "w-5 h-5" : "w-3.5 h-3.5";

  return (
    <div className="flex gap-0.5" onMouseLeave={() => setHovered(null)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange?.(star)}
          onMouseEnter={() => onChange && setHovered(star)}
          disabled={!onChange}
          className={`transition-all leading-none ${onChange ? "cursor-pointer hover:scale-110 active:scale-95" : "cursor-default"}`}
        >
          <Star
            className={`${cls} transition-colors ${
              star <= display
                ? "text-[#ffaa00] fill-[#ffaa00]"
                : "text-primary/20 fill-transparent"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function renderReadme(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");

  const paragraphs = html.split(/\n\n+/);
  html = paragraphs
    .map((p) => {
      p = p.trim();
      if (!p) return "";
      if (/^<(h[1-3]|ul)/.test(p)) return p;
      if (p.startsWith("<li>")) return `<ul>${p}</ul>`;
      return `<p>${p.replace(/\n/g, "<br />")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return html;
}

interface DetailPanelProps {
  plugin: RegistryPlugin;
  existingReview: ReviewEntry | null;
  onClose: () => void;
  onInstall: (pluginId: string, force?: boolean) => void;
  onUninstall: (pluginId: string) => void;
  onToggle: (pluginId: string, enabled: boolean) => void;
  onRate: (pluginId: string, rating: number, review?: string) => void;
  onDeleteReview: (pluginId: string) => void;
  installing: boolean;
  uninstalling: boolean;
  toggling: boolean;
  rating: boolean;
  replaceMode: boolean;
  confirmUninstall: string | null;
  setConfirmUninstall: (id: string | null) => void;
}

function PluginDetailPanel({
  plugin,
  existingReview,
  onClose,
  onInstall,
  onUninstall,
  onToggle,
  onRate,
  onDeleteReview,
  installing,
  uninstalling,
  toggling,
  rating,
  replaceMode,
  confirmUninstall,
  setConfirmUninstall,
}: DetailPanelProps) {
  const [draftRating, setDraftRating] = useState<number>(existingReview?.rating ?? 0);
  const [draftText, setDraftText] = useState<string>(existingReview?.review ?? "");
  const [reviewEditing, setReviewEditing] = useState(!existingReview);

  useEffect(() => {
    if (existingReview) {
      setDraftRating(existingReview.rating);
      setDraftText(existingReview.review ?? "");
      setReviewEditing(false);
    } else {
      setDraftRating(0);
      setDraftText("");
      setReviewEditing(true);
    }
  }, [existingReview]);

  const isOfficial = plugin.author.startsWith("deck-os/official");
  const catColor = CATEGORY_COLORS[plugin.category] ?? "text-primary/60";
  const highRiskPerms = plugin.permissions.filter(
    (p) => (PERMISSION_LABELS[p]?.risk ?? "low") === "high"
  );

  return (
    <div className="fixed inset-0 z-50 flex">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="relative ml-auto w-full max-w-xl h-full bg-background border-l border-primary/30 shadow-[−20px_0_40px_rgba(0,212,255,0.08)] flex flex-col overflow-hidden"
      >
        {/* Corner accent */}
        <div className="absolute top-0 left-0 w-12 h-0.5 bg-primary/40" />
        <div className="absolute top-0 left-0 w-0.5 h-12 bg-primary/40" />

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-primary/15 flex-shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base text-primary font-bold truncate">{plugin.name}</span>
              {isOfficial && (
                <span className="font-mono text-[9px] text-[#00d4ff] border border-[#00d4ff]/30 px-1 flex-shrink-0">
                  OFFICIAL
                </span>
              )}
              {plugin.installed && (
                <span className="flex items-center gap-0.5 font-mono text-[9px] text-[#22ff44] border border-[#22ff44]/30 px-1 flex-shrink-0">
                  <CheckCircle2 className="w-2 h-2" />
                  INSTALLED
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`font-mono text-[10px] ${catColor}`}>
                [{plugin.category.toUpperCase()}]
              </span>
              <span className="font-mono text-[10px] text-primary/40">v{plugin.version}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-primary/40 hover:text-primary transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Author & Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-primary/15 p-3 space-y-0.5">
              <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest">
                <User className="w-2.5 h-2.5" />
                Author
              </div>
              <div className="font-mono text-xs text-primary/70">{plugin.author}</div>
            </div>
            <div className="border border-primary/15 p-3 space-y-0.5">
              <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest">
                <Download className="w-2.5 h-2.5" />
                Installs
              </div>
              <div className="font-mono text-xs text-primary/70">{plugin.installCount.toLocaleString()}</div>
            </div>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-2">
              <Info className="w-2.5 h-2.5" />
              Description
            </div>
            <p className="font-mono text-xs text-muted-foreground leading-relaxed">{plugin.description}</p>
          </div>

          {/* Tags */}
          {plugin.tags.filter((t) => t !== "official").length > 0 && (
            <div>
              <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-2">
                <Tag className="w-2.5 h-2.5" />
                Tags
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {plugin.tags.filter((t) => t !== "official").map((tag) => (
                  <span
                    key={tag}
                    className="font-mono text-[9px] text-primary/40 border border-primary/15 px-1.5 py-0.5"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* README */}
          <div>
            <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-3">
              <BookOpen className="w-2.5 h-2.5" />
              README
            </div>
            <div
              className="font-mono text-xs text-primary/60 leading-relaxed readme-content border border-primary/10 p-3 bg-primary/[0.02]
                [&_h1]:text-primary [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-3
                [&_h2]:text-primary/80 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mb-1.5 [&_h2]:mt-2
                [&_h3]:text-primary/70 [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2
                [&_p]:mb-2 [&_p:last-child]:mb-0
                [&_ul]:mb-2 [&_ul]:pl-3
                [&_li]:list-disc [&_li]:mb-0.5
                [&_strong]:text-primary/80 [&_strong]:font-semibold
                [&_em]:italic [&_em]:text-primary/50
                [&_code]:bg-primary/10 [&_code]:text-primary/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[10px]"
              dangerouslySetInnerHTML={{ __html: renderReadme(plugin.readme) }}
            />
          </div>

          {/* Permissions */}
          {plugin.permissions.length > 0 && (
            <div>
              <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-2">
                <Shield className="w-2.5 h-2.5" />
                Permissions
                {highRiskPerms.length > 0 && (
                  <span className="text-[#ff3333]/60 ml-1">• {highRiskPerms.length} high-risk</span>
                )}
              </div>
              <div className="space-y-1.5">
                {plugin.permissions.map((perm) => {
                  const info = PERMISSION_LABELS[perm];
                  const risk = info?.risk ?? "low";
                  return (
                    <div
                      key={perm}
                      className={`border px-3 py-2 ${PERM_RISK_COLORS[risk]} ${PERM_RISK_BG[risk]}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-semibold">
                          {info?.label ?? perm}
                        </span>
                        <span className={`font-mono text-[9px] uppercase tracking-wider ${PERM_RISK_COLORS[risk]}`}>
                          {risk} risk
                        </span>
                      </div>
                      {info?.desc && (
                        <p className="font-mono text-[9px] text-primary/40 mt-0.5 leading-relaxed">
                          {info.desc}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Release info */}
          <div>
            <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest mb-2">
              <Calendar className="w-2.5 h-2.5" />
              Release Info
            </div>
            <div className="border border-primary/10 p-3 space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-primary/40">Current version</span>
                <span className="text-primary/70">v{plugin.version}</span>
              </div>
              {plugin.entrypointUrl && (
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-primary/40">Distribution</span>
                  <span className="flex items-center gap-1 text-primary/50">
                    <Globe className="w-2.5 h-2.5" />
                    Remote
                  </span>
                </div>
              )}
              {!plugin.entrypointUrl && (
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-primary/40">Distribution</span>
                  <span className="text-primary/50">Built-in</span>
                </div>
              )}
              {plugin.installed && plugin.installedAt && (
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="text-primary/40">Installed at</span>
                  <span className="text-primary/50">
                    {new Date(plugin.installedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Rating & Review — installed plugins only */}
          {plugin.installed && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 uppercase tracking-widest">
                  <Star className="w-2.5 h-2.5" />
                  Your Rating
                </div>
                {existingReview && !reviewEditing && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setReviewEditing(true)}
                      className="flex items-center gap-0.5 font-mono text-[9px] text-primary/30 hover:text-primary/60 transition-colors"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      EDIT
                    </button>
                    <button
                      onClick={() => onDeleteReview(plugin.id)}
                      className="font-mono text-[9px] text-[#ff3333]/30 hover:text-[#ff3333]/60 transition-colors"
                    >
                      DELETE
                    </button>
                  </div>
                )}
              </div>

              {/* Existing review (read mode) */}
              {existingReview && !reviewEditing ? (
                <div className="border border-primary/15 p-3 space-y-2 bg-primary/[0.02]">
                  <StarRating value={existingReview.rating} size="md" />
                  {existingReview.review && (
                    <p className="font-mono text-xs text-primary/60 leading-relaxed">
                      {existingReview.review}
                    </p>
                  )}
                  {existingReview.updatedAt && (
                    <p className="font-mono text-[9px] text-primary/25">
                      {new Date(existingReview.updatedAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ) : reviewEditing ? (
                /* Rating form */
                <div className="border border-primary/20 p-3 space-y-3">
                  <div>
                    <p className="font-mono text-[9px] text-primary/30 mb-1.5">
                      {existingReview ? "UPDATE RATING" : "SELECT RATING"}
                    </p>
                    <StarRating value={draftRating} onChange={setDraftRating} size="md" />
                  </div>
                  <div>
                    <p className="font-mono text-[9px] text-primary/30 mb-1">
                      <MessageSquare className="w-2.5 h-2.5 inline mr-0.5" />
                      REVIEW (OPTIONAL)
                    </p>
                    <textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder="Share your experience with this plugin..."
                      className="w-full bg-transparent border border-primary/20 text-primary font-mono text-xs placeholder:text-primary/20 p-2 outline-none focus:border-primary/40 resize-none"
                    />
                    <p className="font-mono text-[9px] text-primary/20 text-right">{draftText.length}/1000</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (draftRating > 0) {
                          onRate(plugin.id, draftRating, draftText || undefined);
                        }
                      }}
                      disabled={draftRating === 0 || rating}
                      className="flex items-center gap-1 font-mono text-xs text-primary/60 hover:text-primary border border-primary/30 hover:border-primary/60 px-3 py-1.5 transition-all disabled:opacity-40"
                    >
                      {rating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />}
                      {existingReview ? "UPDATE" : "SUBMIT"}
                    </button>
                    {existingReview && (
                      <button
                        onClick={() => {
                          setDraftRating(existingReview.rating);
                          setDraftText(existingReview.review ?? "");
                          setReviewEditing(false);
                        }}
                        className="font-mono text-xs text-primary/30 hover:text-primary/60 border border-primary/15 hover:border-primary/30 px-3 py-1.5 transition-all"
                      >
                        CANCEL
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* No review yet, prompt */
                <div className="border border-dashed border-primary/15 p-3 flex items-center gap-2">
                  <button
                    onClick={() => setReviewEditing(true)}
                    className="flex items-center gap-1.5 font-mono text-xs text-primary/40 hover:text-primary transition-colors"
                  >
                    <Star className="w-3.5 h-3.5" />
                    Rate this plugin
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex-shrink-0 border-t border-primary/15 p-4 flex items-center gap-2">
          {!plugin.installed ? (
            <button
              onClick={() => {
                onInstall(plugin.id, replaceMode);
                onClose();
              }}
              disabled={installing}
              className="flex items-center gap-1.5 font-mono text-xs text-primary/60 hover:text-primary border border-primary/30 hover:border-primary/60 px-4 py-2 transition-all disabled:opacity-40 flex-1 justify-center"
            >
              {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {installing ? "INSTALLING..." : "INSTALL PLUGIN"}
            </button>
          ) : (
            <>
              {!isOfficial && (
                <button
                  onClick={() => onToggle(plugin.id, !plugin.enabled)}
                  disabled={toggling}
                  className={`flex items-center gap-1.5 font-mono text-xs border px-3 py-2 transition-all disabled:opacity-40 flex-1 justify-center ${
                    plugin.enabled
                      ? "text-primary/60 hover:text-primary border-primary/30 hover:border-primary/60"
                      : "text-primary/30 hover:text-primary/60 border-primary/15 hover:border-primary/30"
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {plugin.enabled ? "DISABLE" : "ENABLE"}
                </button>
              )}

              {!isOfficial && (
                confirmUninstall === plugin.id ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-[#ff3333]/70">Confirm?</span>
                    <button
                      onClick={() => { onUninstall(plugin.id); onClose(); }}
                      disabled={uninstalling}
                      className="font-mono text-[10px] text-[#ff3333] border border-[#ff3333]/40 px-2 py-1.5 hover:bg-[#ff3333]/10 transition-all"
                    >
                      {uninstalling ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "YES, UNINSTALL"}
                    </button>
                    <button
                      onClick={() => setConfirmUninstall(null)}
                      className="font-mono text-[10px] text-primary/40 border border-primary/20 px-2 py-1.5 hover:text-primary transition-all"
                    >
                      NO
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmUninstall(plugin.id)}
                    className="flex items-center gap-1.5 font-mono text-xs text-[#ff3333]/40 hover:text-[#ff3333] border border-[#ff3333]/20 hover:border-[#ff3333]/40 px-3 py-2 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    UNINSTALL
                  </button>
                )
              )}

              {isOfficial && (
                <span className="font-mono text-[10px] text-primary/30">// built-in — cannot be removed</span>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function PluginStore() {
  const [tab, setTab] = useState<StoreTab>("store");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<RegistryPlugin | null>(null);
  const [clawSkills, setClawSkills] = useState<ClawSkill[]>([]);
  const [clawSearch, setClawSearch] = useState("");
  const [clawCategory, setClawCategory] = useState("all");
  const [clawInstalling, setClawInstalling] = useState<string | null>(null);
  const [clawMsg, setClawMsg] = useState<{ slug: string; text: string } | null>(null);
  const [clawLoading, setClawLoading] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["plugin-store-registry"],
    queryFn: fetchRegistry,
    staleTime: 2 * 60 * 1000,
  });

  const installMut = useMutation({
    mutationFn: async ({ pluginId, force }: { pluginId: string; force?: boolean }) => {
      const res = await fetch(`${API_BASE}/plugins/store/install/${pluginId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin-store-registry"] }),
  });

  const uninstallMut = useMutation({
    mutationFn: async (pluginId: string) => {
      const res = await fetch(`${API_BASE}/plugins/store/uninstall/${pluginId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      setConfirmUninstall(null);
      qc.invalidateQueries({ queryKey: ["plugin-store-registry"] });
    },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ pluginId, enabled }: { pluginId: string; enabled: boolean }) => {
      const res = await fetch(`${API_BASE}/plugins/store/${pluginId}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin-store-registry"] }),
  });

  const { data: reviewsData } = useQuery({
    queryKey: ["plugin-reviews"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/plugins/store/reviews`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json() as Promise<{ reviews: ReviewsMap; count: number }>;
    },
    staleTime: 30 * 1000,
  });
  const reviews: ReviewsMap = reviewsData?.reviews ?? {};

  const reviewMut = useMutation({
    mutationFn: async ({ pluginId, rating, review }: { pluginId: string; rating: number; review?: string }) => {
      const res = await fetch(`${API_BASE}/plugins/store/${pluginId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, review }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin-reviews"] }),
  });

  const deleteReviewMut = useMutation({
    mutationFn: async (pluginId: string) => {
      const res = await fetch(`${API_BASE}/plugins/store/${pluginId}/review`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plugin-reviews"] }),
  });

  const allPlugins = data?.plugins ?? [];
  const categories = ["all", ...new Set(allPlugins.map((p) => p.category))];

  const visiblePlugins = allPlugins.filter((p) => {
    const matchesTab = tab === "store" ? true : p.installed;
    const matchesSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesCat = categoryFilter === "all" || p.category === categoryFilter;
    return matchesTab && matchesSearch && matchesCat;
  });

  const installedCount = allPlugins.filter((p) => p.installed).length;

  useEffect(() => {
    if (tab !== "clawhub") return;
    setClawLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (clawSearch) params.set("q", clawSearch);
    if (clawCategory !== "all") params.set("category", clawCategory);
    fetch(`${API_BASE}/openclaw/skills?${params}`)
      .then(r => r.json())
      .then((d: { skills?: ClawSkill[] }) => setClawSkills(d.skills ?? []))
      .catch(() => {})
      .finally(() => setClawLoading(false));
  }, [tab, clawSearch, clawCategory]);

  const handleClawInstall = async (slug: string) => {
    setClawInstalling(slug);
    setClawMsg(null);
    try {
      const r = await fetch(`${API_BASE}/openclaw/skills/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const d = await r.json() as { installCommand?: string };
      setClawMsg({ slug, text: d.installCommand ?? `clawhub install ${slug}` });
      setTimeout(() => setClawMsg(null), 10_000);
    } catch {
      setClawMsg({ slug, text: "Error — check console" });
    } finally {
      setClawInstalling(null);
    }
  };

  const clawCategories = ["all", ...new Set(clawSkills.map(s => s.category))].sort();

  const syncedSelectedPlugin = selectedPlugin
    ? (allPlugins.find((p) => p.id === selectedPlugin.id) ?? selectedPlugin)
    : null;

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
          <Store className="w-4 h-4 text-primary" />
          <span>PLUGIN.STORE // COMMUNITY REGISTRY</span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 font-mono text-xs text-primary/40 hover:text-primary border border-primary/20 hover:border-primary/40 px-2 py-1 transition-all disabled:opacity-40"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          REFRESH
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border border-primary/20 w-fit font-mono text-xs">
        {(["store", "installed", "clawhub"] as StoreTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 transition-all border-r border-primary/10 last:border-r-0 flex items-center gap-1.5 ${
              tab === t
                ? "bg-primary/10 text-primary"
                : "text-primary/40 hover:text-primary/70"
            }`}
          >
            {t === "clawhub" && <Terminal className="w-3 h-3 text-[#cc44ff]" />}
            {t === "store" ? "STORE" : t === "installed" ? `MY PLUGINS (${installedCount})` : "CLAWHUB SKILLS"}
          </button>
        ))}
      </div>

      {/* Filters (hidden on ClawHub tab) */}
      {tab !== "clawhub" && <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 border border-primary/20 px-2 py-1 flex-1 min-w-40">
          <Search className="w-3 h-3 text-primary/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search plugins..."
            className="bg-transparent font-mono text-xs text-primary placeholder:text-primary/30 outline-none flex-1"
          />
        </div>
        <div className="flex items-center gap-1.5 border border-primary/20 px-2 py-1">
          <Filter className="w-3 h-3 text-primary/40" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-transparent font-mono text-xs text-primary outline-none"
          >
            {categories.map((c) => (
              <option key={c} value={c} className="bg-background">
                {c.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        {tab === "store" && (
          <label className="flex items-center gap-1.5 font-mono text-[10px] text-primary/40 cursor-pointer">
            <input
              type="checkbox"
              checked={replaceMode}
              onChange={(e) => setReplaceMode(e.target.checked)}
              className="accent-primary w-3 h-3"
            />
            RE-INSTALL
          </label>
        )}
      </div>}

      {/* Content — hidden when ClawHub tab is shown */}
      {tab !== "clawhub" && isLoading && (
        <div className="flex items-center justify-center flex-1 font-mono text-xs text-primary/30">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading registry...
        </div>
      )}

      {tab !== "clawhub" && error && (
        <div className="border border-[#ff3333]/30 p-4 font-mono text-xs text-[#ff3333]/70">
          // Registry unavailable: {(error as Error).message}
        </div>
      )}

      {tab !== "clawhub" && !isLoading && !error && visiblePlugins.length === 0 && (
        <div className="font-mono text-xs text-primary/30 border border-primary/10 p-4 text-center">
          {tab === "installed" ? "// No plugins installed yet" : "// No plugins match your search"}
        </div>
      )}

      {tab !== "clawhub" && !isLoading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-y-auto flex-1 content-start">
          {visiblePlugins.map((plugin) => {
            const catColor = CATEGORY_COLORS[plugin.category] ?? "text-primary/60";
            const isInstalling = installMut.isPending && installMut.variables?.pluginId === plugin.id;
            const isUninstalling = uninstallMut.isPending && uninstallMut.variables === plugin.id;
            const isOfficial = plugin.author.startsWith("deck-os/official");
            const highRiskPerms = plugin.permissions.filter(
              (p) => (PERMISSION_LABELS[p]?.risk ?? "low") === "high"
            );
            const cardReview = reviews[plugin.id] ?? null;

            return (
              <div
                key={plugin.id}
                onClick={() => setSelectedPlugin(plugin)}
                className={`border ${plugin.installed ? "border-primary/40 shadow-[0_0_10px_rgba(0,212,255,0.1)]" : "border-primary/20"} p-4 flex flex-col gap-3 bg-card/30 relative cursor-pointer hover:border-primary/50 hover:bg-primary/[0.03] transition-all group`}
              >
                {/* Installed badge */}
                {plugin.installed && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 font-mono text-[10px] text-[#22ff44] border border-[#22ff44]/30 px-1.5 py-0.5">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    INSTALLED
                  </div>
                )}

                {/* Plugin header */}
                <div className="pr-20">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-primary font-bold">{plugin.name}</span>
                    {isOfficial && (
                      <span className="font-mono text-[9px] text-[#00d4ff] border border-[#00d4ff]/30 px-1">OFFICIAL</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`font-mono text-[10px] ${catColor}`}>
                      [{plugin.category.toUpperCase()}]
                    </span>
                    <span className="font-mono text-[10px] text-primary/30">v{plugin.version}</span>
                  </div>
                </div>

                {/* Description */}
                <p className="font-mono text-xs text-muted-foreground leading-relaxed line-clamp-2">
                  {plugin.description}
                </p>

                {/* Meta row */}
                <div className="flex items-center gap-3 font-mono text-[10px] text-primary/40 flex-wrap">
                  <span className="flex items-center gap-1">
                    <User className="w-2.5 h-2.5" />
                    {plugin.author}
                  </span>
                  <span className="flex items-center gap-1">
                    <Download className="w-2.5 h-2.5" />
                    {plugin.installCount.toLocaleString()}
                  </span>
                  {plugin.entrypointUrl && (
                    <span className="flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" />
                      remote
                    </span>
                  )}
                  {cardReview && (
                    <span
                      className="flex items-center gap-1 ml-auto cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); setSelectedPlugin(plugin); }}
                      title={`Your rating: ${cardReview.avgRating.toFixed(1)} — click to update`}
                    >
                      <StarRating value={cardReview.avgRating} />
                      <span className="font-mono text-[9px] text-primary/30 ml-0.5">{cardReview.reviewCount}</span>
                    </span>
                  )}
                  {plugin.installed && !cardReview && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedPlugin(plugin); }}
                      className="ml-auto flex items-center gap-0.5 font-mono text-[9px] text-primary/25 hover:text-[#ffaa00]/60 transition-colors"
                    >
                      <Star className="w-2.5 h-2.5" />
                      RATE
                    </button>
                  )}
                </div>

                {/* Tags */}
                {plugin.tags.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tag className="w-2.5 h-2.5 text-primary/30" />
                    {plugin.tags.filter((t) => t !== "official").map((tag) => (
                      <span
                        key={tag}
                        className="font-mono text-[9px] text-primary/40 border border-primary/15 px-1 py-0.5"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Permissions summary */}
                {plugin.permissions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 font-mono text-[9px] text-primary/30 mb-1">
                      <Shield className="w-2.5 h-2.5" />
                      PERMISSIONS
                      {highRiskPerms.length > 0 && (
                        <span className="text-[#ff3333]/60 ml-1">• {highRiskPerms.length} high-risk</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {plugin.permissions.map((perm) => {
                        const info = PERMISSION_LABELS[perm];
                        const risk = info?.risk ?? "low";
                        return (
                          <span
                            key={perm}
                            className={`font-mono text-[9px] border px-1.5 py-0.5 ${PERM_RISK_COLORS[risk]}`}
                            title={`Risk: ${risk}`}
                          >
                            {info?.label ?? perm}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div
                  className="flex items-center gap-2 mt-auto pt-2 border-t border-primary/10"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!plugin.installed ? (
                    <button
                      onClick={() => installMut.mutate({ pluginId: plugin.id, force: replaceMode })}
                      disabled={isInstalling}
                      className="flex items-center gap-1 font-mono text-xs text-primary/60 hover:text-primary border border-primary/30 hover:border-primary/60 px-3 py-1.5 transition-all disabled:opacity-40"
                    >
                      {isInstalling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      {isInstalling ? "INSTALLING..." : "INSTALL"}
                    </button>
                  ) : (
                    <>
                      {!isOfficial && (
                        <button
                          onClick={() => toggleMut.mutate({ pluginId: plugin.id, enabled: !plugin.enabled })}
                          disabled={toggleMut.isPending}
                          className={`flex items-center gap-1 font-mono text-xs border px-3 py-1.5 transition-all disabled:opacity-40 ${
                            plugin.enabled
                              ? "text-primary/60 hover:text-primary border-primary/30 hover:border-primary/60"
                              : "text-primary/30 hover:text-primary/60 border-primary/15 hover:border-primary/30"
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          {plugin.enabled ? "DISABLE" : "ENABLE"}
                        </button>
                      )}

                      {!isOfficial && (
                        confirmUninstall === plugin.id ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[10px] text-[#ff3333]/70">Confirm?</span>
                            <button
                              onClick={() => uninstallMut.mutate(plugin.id)}
                              disabled={isUninstalling}
                              className="font-mono text-[10px] text-[#ff3333] border border-[#ff3333]/40 px-2 py-1 hover:bg-[#ff3333]/10 transition-all"
                            >
                              {isUninstalling ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "YES"}
                            </button>
                            <button
                              onClick={() => setConfirmUninstall(null)}
                              className="font-mono text-[10px] text-primary/40 border border-primary/20 px-2 py-1 hover:text-primary transition-all"
                            >
                              NO
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmUninstall(plugin.id)}
                            className="flex items-center gap-1 font-mono text-xs text-[#ff3333]/40 hover:text-[#ff3333] border border-[#ff3333]/20 hover:border-[#ff3333]/40 px-3 py-1.5 transition-all"
                          >
                            <Trash2 className="w-3 h-3" />
                            UNINSTALL
                          </button>
                        )
                      )}

                      {isOfficial && (
                        <span className="font-mono text-[10px] text-primary/30">// built-in — cannot be removed</span>
                      )}
                    </>
                  )}

                  {/* Details hint */}
                  <span className="ml-auto flex items-center gap-0.5 font-mono text-[9px] text-primary/20 group-hover:text-primary/40 transition-colors">
                    DETAILS
                    <ChevronRight className="w-2.5 h-2.5" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Registry footer */}
      {data && (
        <div className="border-t border-primary/10 pt-2 font-mono text-[10px] text-primary/25 flex items-center justify-between">
          <span>registry v{data.version} · updated {data.updatedAt}</span>
          <span>
            {allPlugins.length} plugins · {installedCount} installed
          </span>
        </div>
      )}

      {/* ClawHub Skills Tab */}
      {tab === "clawhub" && (
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="border border-[#cc44ff]/20 bg-[#cc44ff]/[0.03] p-3 font-mono text-xs">
            <div className="flex items-center gap-2 text-[#cc44ff] mb-1 font-bold">
              <Terminal className="w-3 h-3" />
              CLAWHUB — 5200+ OPENCLAW SKILLS
            </div>
            <div className="text-primary/40 text-[10px] space-y-0.5">
              <div>Install skills in WSL: <span className="text-primary/70">clawhub install &lt;author/skill&gt;</span></div>
              <div>Browse all: <span className="text-primary/70">clawhub.ai</span> · Curated list: <span className="text-primary/70">github.com/VoltAgent/awesome-openclaw-skills</span></div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 border border-primary/20 px-2 py-1 flex-1 min-w-40">
              <Search className="w-3 h-3 text-primary/40" />
              <input
                value={clawSearch}
                onChange={(e) => setClawSearch(e.target.value)}
                placeholder="search clawhub skills..."
                className="bg-transparent font-mono text-xs text-primary placeholder:text-primary/30 outline-none flex-1"
              />
            </div>
            <div className="flex items-center gap-1.5 border border-primary/20 px-2 py-1">
              <Filter className="w-3 h-3 text-primary/40" />
              <select
                value={clawCategory}
                onChange={(e) => setClawCategory(e.target.value)}
                className="bg-transparent font-mono text-xs text-primary outline-none"
              >
                {clawCategories.map((c) => (
                  <option key={c} value={c} className="bg-background">{c.toUpperCase()}</option>
                ))}
              </select>
            </div>
          </div>

          {clawMsg && (
            <div className="border border-[#22ff44]/30 bg-[#22ff44]/[0.04] p-2 font-mono text-[10px] text-[#22ff44] break-all">
              <span className="text-primary/40">Run in WSL: </span>{clawMsg.text}
            </div>
          )}

          {clawLoading && (
            <div className="flex items-center gap-2 font-mono text-xs text-primary/30">
              <Loader2 className="w-3 h-3 animate-spin" />
              LOADING SKILLS...
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto flex-1 content-start">
            {clawSkills.map((skill) => (
              <div key={skill.slug} className="border border-primary/15 bg-card/30 p-4 flex flex-col gap-3 hover:border-[#cc44ff]/40 transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-sm text-primary font-bold">{skill.name}</div>
                    <div className="font-mono text-[10px] text-primary/40">{skill.author}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="font-mono text-[9px] text-[#cc44ff]/60 border border-[#cc44ff]/20 px-1.5 py-0.5 uppercase">
                      {skill.category}
                    </span>
                    <span className="font-mono text-[9px] text-primary/25">
                      {skill.installCount.toLocaleString()} installs
                    </span>
                  </div>
                </div>

                <div className="font-mono text-xs text-primary/50 leading-relaxed line-clamp-2">
                  {skill.description}
                </div>

                <div className="flex flex-wrap gap-1">
                  {skill.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="font-mono text-[9px] text-primary/30 border border-primary/10 px-1">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-auto pt-2 border-t border-primary/10">
                  <a
                    href={`https://clawhub.ai/${skill.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[10px] text-primary/30 hover:text-primary/60 transition-all flex items-center gap-1"
                  >
                    <Globe className="w-2.5 h-2.5" />
                    VIEW ON CLAWHUB
                  </a>
                  <button
                    onClick={() => handleClawInstall(skill.slug)}
                    disabled={clawInstalling === skill.slug}
                    className="flex items-center gap-1.5 border border-[#cc44ff]/30 px-3 py-1 font-mono text-[10px] text-[#cc44ff]/70 hover:text-[#cc44ff] hover:border-[#cc44ff]/60 transition-all disabled:opacity-40"
                  >
                    {clawInstalling === skill.slug ? (
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    ) : (
                      <Package className="w-2.5 h-2.5" />
                    )}
                    INSTALL
                  </button>
                </div>
              </div>
            ))}
            {!clawLoading && clawSkills.length === 0 && (
              <div className="font-mono text-xs text-primary/30 border border-primary/10 p-4 col-span-full text-center">
                // No skills found — try a different search or category
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detail panel overlay */}
      <AnimatePresence>
        {syncedSelectedPlugin && (
          <PluginDetailPanel
            key={syncedSelectedPlugin.id}
            plugin={syncedSelectedPlugin}
            existingReview={reviews[syncedSelectedPlugin.id] ?? null}
            onClose={() => setSelectedPlugin(null)}
            onInstall={(pluginId, force) => installMut.mutate({ pluginId, force })}
            onUninstall={(pluginId) => uninstallMut.mutate(pluginId)}
            onToggle={(pluginId, enabled) => toggleMut.mutate({ pluginId, enabled })}
            onRate={(pluginId, rating, review) => reviewMut.mutate({ pluginId, rating, review })}
            onDeleteReview={(pluginId) => deleteReviewMut.mutate(pluginId)}
            installing={installMut.isPending && installMut.variables?.pluginId === syncedSelectedPlugin.id}
            uninstalling={uninstallMut.isPending && uninstallMut.variables === syncedSelectedPlugin.id}
            toggling={toggleMut.isPending}
            rating={reviewMut.isPending && reviewMut.variables?.pluginId === syncedSelectedPlugin.id}
            replaceMode={replaceMode}
            confirmUninstall={confirmUninstall}
            setConfirmUninstall={setConfirmUninstall}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
