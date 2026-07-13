import { useState, useEffect, useRef, useCallback } from "react";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import {
  Clock, ChevronRight, Filter, X,
  Loader2, AlertTriangle, Wifi, WifiOff, RefreshCw, ChevronDown,
} from "lucide-react";
import { HudCorners } from "@/components/HudCorners";
import { useWebSocket } from "@/contexts/WebSocketContext";
import type { WsEvent } from "@/contexts/WebSocketContext";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");
const PAGE_SIZE = 50;
const ROW_HEIGHT = 58;

interface TimelineEvent {
  id: string;
  type: string;
  source: string;
  level: string;
  payload: unknown;
  timestamp: string;
}

type Category = "system" | "device" | "ai" | "memory" | "autonomy";

const CATEGORY_PREFIXES: Record<Category, string[]> = {
  system:   ["system.", "health.", "ws.", "connection."],
  device:   ["device.", "sensor.", "iot.", "mqtt."],
  ai:       ["ai.", "llm.", "chat.", "initiative.", "insight.", "briefing."],
  memory:   ["memory.", "goal.", "feedback."],
  autonomy: ["autonomy.", "routine.", "action."],
};

const CATEGORY_COLORS: Record<Category, string> = {
  system:   "text-[#3f84f3] border-[#3f84f3]/50 bg-[#3f84f3]/15",
  device:   "text-[#11d97a] border-[#11d97a]/50 bg-[#11d97a]/15",
  ai:       "text-[#c084fc] border-[#c084fc]/50 bg-[#c084fc]/15",
  memory:   "text-[#ffc820] border-[#ffc820]/50 bg-[#ffc820]/15",
  autonomy: "text-[#f03248] border-[#f03248]/50 bg-[#f03248]/15",
};

const CATEGORY_INACTIVE = "text-primary/30 border-primary/15 bg-transparent hover:border-primary/35 hover:text-primary/60";

const LEVEL_DOT: Record<string, string> = {
  error: "bg-[#f03248] animate-pulse",
  warn:  "bg-[#ffc820]",
  info:  "bg-primary/60",
  debug: "bg-primary/25",
};

const ALL_CATEGORIES: Category[] = ["system", "device", "ai", "memory", "autonomy"];

function getCategory(type: string): Category {
  for (const [cat, prefixes] of Object.entries(CATEGORY_PREFIXES)) {
    if (prefixes.some((p) => type.startsWith(p))) {
      return cat as Category;
    }
  }
  return "system";
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function payloadSummary(payload: unknown): string {
  if (!payload) return "—";
  if (typeof payload === "string") return payload.slice(0, 100);
  try {
    const str = JSON.stringify(payload);
    return str.length > 100 ? str.slice(0, 97) + "…" : str;
  } catch {
    return "—";
  }
}

function ListContainer({ events, itemData }: { events: TimelineEvent[]; itemData: RowData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex-1 min-h-0">
      {size.height > 0 && size.width > 0 && (
        <FixedSizeList
          height={size.height}
          width={size.width}
          itemCount={events.length}
          itemSize={ROW_HEIGHT}
          itemData={itemData}
          overscanCount={5}
        >
          {EventRow}
        </FixedSizeList>
      )}
    </div>
  );
}

function EventDetailDrawer({
  event,
  onClose,
}: {
  event: TimelineEvent | null;
  onClose: () => void;
}) {
  const visible = event !== null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (visible) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  const category = event ? getCategory(event.type) : "system";
  const colorClass = event ? CATEGORY_COLORS[category] : "";

  return (
    <>
      {visible && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed top-0 right-0 h-full z-50 flex flex-col transition-all duration-300 ease-in-out border-l border-primary/30 bg-card/95 backdrop-blur-sm shadow-2xl ${
          visible ? "w-[460px] translate-x-0" : "w-[460px] translate-x-full"
        }`}
        aria-label="Event detail"
      >
        {event && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-primary/20 shrink-0">
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 border ${colorClass}`}>
                  {category}
                </span>
                <span className="font-mono text-xs text-primary/80">{event.type}</span>
              </div>
              <button
                onClick={onClose}
                className="text-primary/40 hover:text-primary transition-colors p-1"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-primary/10 shrink-0">
              <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div>
                  <span className="text-primary/35 uppercase tracking-wider text-[10px]">Timestamp</span>
                  <div className="text-primary/80 mt-0.5">{formatTimestamp(event.timestamp)}</div>
                </div>
                <div>
                  <span className="text-primary/35 uppercase tracking-wider text-[10px]">Source</span>
                  <div className="text-primary/80 mt-0.5">{event.source}</div>
                </div>
                <div>
                  <span className="text-primary/35 uppercase tracking-wider text-[10px]">Level</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full inline-block ${LEVEL_DOT[event.level] ?? LEVEL_DOT.info}`} />
                    <span className="text-primary/80 uppercase">{event.level}</span>
                  </div>
                </div>
                <div>
                  <span className="text-primary/35 uppercase tracking-wider text-[10px]">ID</span>
                  <div className="text-primary/40 mt-0.5">#{event.id}</div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col px-5 py-3 min-h-0">
              <div className="text-primary/35 uppercase tracking-wider text-[10px] font-mono mb-2">Payload</div>
              <pre className="flex-1 overflow-auto font-mono text-[11px] text-primary/75 bg-background/60 border border-primary/15 p-3 whitespace-pre-wrap break-all leading-relaxed">
                {event.payload !== null && event.payload !== undefined
                  ? JSON.stringify(event.payload, null, 2)
                  : "null"}
              </pre>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

interface RowData {
  events: TimelineEvent[];
  selectedId: string | null;
  onSelect: (ev: TimelineEvent) => void;
}

function EventRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const { events, selectedId, onSelect } = data;
  const event = events[index];
  if (!event) return null;

  const category = getCategory(event.type);
  const colorClass = CATEGORY_COLORS[category];
  const dotColor = LEVEL_DOT[event.level] ?? LEVEL_DOT.info;
  const isSelected = selectedId === event.id;

  return (
    <div style={style}>
      <button
        onClick={() => onSelect(event)}
        className={`w-full h-full text-left px-4 flex items-center gap-3 border-b border-primary/8 transition-colors group ${
          isSelected ? "bg-primary/8 border-l-2 border-l-primary/60 pl-[14px]" : "border-l-2 border-l-transparent hover:bg-primary/5 hover:border-l-primary/25"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />

        <span className={`font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 border shrink-0 ${colorClass}`}>
          {category}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-foreground/80 truncate">{event.type}</span>
          </div>
          <div className="font-mono text-[10px] text-primary/30 truncate mt-0.5">
            <span className="text-primary/40">{event.source}</span>
            <span className="mx-1.5 text-primary/20">·</span>
            <span>{payloadSummary(event.payload)}</span>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5 font-mono text-[10px] text-primary/30">
          <span>{formatTimestamp(event.timestamp)}</span>
          <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
        </div>
      </button>
    </div>
  );
}

export default function TimelinePage() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategories, setSelectedCategories] = useState<Set<Category>>(new Set());
  const [sourceFilter, setSourceFilter] = useState("");
  const [afterDate, setAfterDate] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [liveMode, setLiveMode] = useState(false);

  const { events: wsEvents, status: wsStatus } = useWebSocket();
  const lastWsCount = useRef(wsEvents.length);
  const filtersRef = useRef({ selectedCategories, sourceFilter, afterDate, beforeDate });
  filtersRef.current = { selectedCategories, sourceFilter, afterDate, beforeDate };

  function buildUrl(currentOffset: number, overrideCategories?: Set<Category>, overrideSource?: string, overrideAfter?: string, overrideBefore?: string) {
    const cats = overrideCategories ?? filtersRef.current.selectedCategories;
    const src = overrideSource ?? filtersRef.current.sourceFilter;
    const af = overrideAfter ?? filtersRef.current.afterDate;
    const bf = overrideBefore ?? filtersRef.current.beforeDate;

    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(currentOffset));
    if (cats.size > 0) params.set("category", [...cats].join(","));
    if (src.trim()) params.set("source", src.trim());
    if (af) params.set("after", new Date(af).toISOString());
    if (bf) {
      const d = new Date(bf);
      d.setHours(23, 59, 59, 999);
      params.set("before", d.toISOString());
    }
    return `${API}/api/events/history?${params.toString()}`;
  }

  const fetchPage = useCallback(async (reset: boolean, currentOffset?: number) => {
    setLoading(true);
    setError(null);
    const ofs = reset ? 0 : (currentOffset ?? offset);
    try {
      const res = await fetch(buildUrl(ofs));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: TimelineEvent[] };
      const fetched = data.events ?? [];

      if (reset) {
        setEvents(fetched);
        setOffset(fetched.length);
      } else {
        setEvents((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          return [...prev, ...fetched.filter((e) => !ids.has(e.id))];
        });
        setOffset((prev) => prev + fetched.length);
      }
      setHasMore(fetched.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    setSelectedEvent(null);
    fetchPage(true);
  }, [selectedCategories, sourceFilter, afterDate, beforeDate]);

  useEffect(() => {
    if (!liveMode) return;
    const newWsEvents = wsEvents.slice(lastWsCount.current);
    lastWsCount.current = wsEvents.length;
    if (newWsEvents.length === 0) return;

    const { selectedCategories: cats, sourceFilter: src } = filtersRef.current;

    const filtered: TimelineEvent[] = newWsEvents
      .map((e: WsEvent, i: number): TimelineEvent => ({
        id: e.id ?? `ws-${Date.now()}-${i}`,
        type: e.type,
        source: e.source ?? "websocket",
        level: "info",
        payload: e.payload,
        timestamp: e.timestamp,
      }))
      .filter((ev) => {
        if (cats.size > 0 && !cats.has(getCategory(ev.type))) return false;
        if (src.trim() && !ev.source.toLowerCase().includes(src.trim().toLowerCase())) return false;
        return true;
      });

    if (filtered.length > 0) {
      setEvents((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        return [...filtered.filter((e) => !ids.has(e.id)), ...prev];
      });
    }
  }, [wsEvents, liveMode]);

  function toggleCategory(cat: Category) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function clearFilters() {
    setSelectedCategories(new Set());
    setSourceFilter("");
    setAfterDate("");
    setBeforeDate("");
  }

  const hasFilters = selectedCategories.size > 0 || sourceFilter || afterDate || beforeDate;

  const itemData: RowData = {
    events,
    selectedId: selectedEvent?.id ?? null,
    onSelect: setSelectedEvent,
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="border border-primary/30 p-1.5 bg-primary/5">
            <Clock className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="font-mono text-lg font-bold text-primary tracking-widest uppercase">
              SESSION.TIMELINE
            </h1>
            <p className="font-mono text-xs text-primary/40">
              Black-box event recorder — scroll back through everything JARVIS observed and did
            </p>
          </div>
        </div>

        <button
          onClick={() => setLiveMode((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1.5 border font-mono text-xs transition-all ${
            liveMode
              ? "border-[#00ff88]/50 bg-[#00ff88]/10 text-[#00ff88]"
              : "border-primary/25 text-primary/40 hover:border-primary/50 hover:text-primary/70"
          }`}
          title={liveMode ? "Live mode active — new events prepend automatically" : "Enable live mode"}
          aria-pressed={liveMode}
        >
          {liveMode ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88] animate-pulse" />
              <Wifi className="w-3 h-3" />
              LIVE
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3" />
              LIVE
            </>
          )}
        </button>
      </div>

      {/* Filter bar */}
      <div className="border border-primary/20 bg-card/50 p-3 flex flex-wrap gap-3 items-end relative shrink-0">
        <HudCorners />
        <div className="flex items-center gap-1.5 shrink-0">
          <Filter className="w-3 h-3 text-primary/40" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-primary/40">Category</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {ALL_CATEGORIES.map((cat) => {
            const active = selectedCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                aria-pressed={active}
                className={`font-mono text-[10px] uppercase tracking-wider px-2 py-1 border transition-all ${
                  active ? CATEGORY_COLORS[cat] : CATEGORY_INACTIVE
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-primary/40 shrink-0">Source</label>
          <input
            type="text"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            placeholder="filter by source…"
            className="bg-background/60 border border-primary/20 text-primary/80 font-mono text-xs px-2 py-1 w-36 focus:outline-none focus:border-primary/50 placeholder:text-primary/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-primary/40 shrink-0">After</label>
          <input
            type="date"
            value={afterDate}
            onChange={(e) => setAfterDate(e.target.value)}
            className="bg-background/60 border border-primary/20 text-primary/80 font-mono text-xs px-2 py-1 focus:outline-none focus:border-primary/50 [color-scheme:dark]"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[10px] uppercase tracking-wider text-primary/40 shrink-0">Before</label>
          <input
            type="date"
            value={beforeDate}
            onChange={(e) => setBeforeDate(e.target.value)}
            className="bg-background/60 border border-primary/20 text-primary/80 font-mono text-xs px-2 py-1 focus:outline-none focus:border-primary/50 [color-scheme:dark]"
          />
        </div>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="ml-auto flex items-center gap-1 font-mono text-[10px] uppercase text-primary/35 hover:text-primary/70 transition-colors px-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-primary/35 shrink-0">
        <span>{events.length} event{events.length !== 1 ? "s" : ""} loaded</span>
        {selectedCategories.size > 0 && (
          <span className="text-primary/25">
            — filtered by: {[...selectedCategories].join(", ")}
          </span>
        )}
        {liveMode && (
          <span className={`flex items-center gap-1 ${wsStatus === "connected" ? "text-[#00ff88]/70" : "text-[#ffaa00]/70"}`}>
            <span className={`w-1 h-1 rounded-full inline-block ${wsStatus === "connected" ? "bg-[#00ff88] animate-pulse" : "bg-[#ffaa00] animate-pulse"}`} />
            WS {wsStatus.toUpperCase()}
          </span>
        )}
        <button
          onClick={() => { setOffset(0); fetchPage(true); }}
          disabled={loading}
          className="ml-auto flex items-center gap-1 text-primary/35 hover:text-primary/60 transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2 border border-[#f03248]/30 bg-[#f03248]/5 font-mono text-xs text-[#f03248] shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Virtualized list */}
      <div className="flex-1 min-h-0 border border-primary/15 bg-card/30 relative flex flex-col">
        <HudCorners />

        {events.length === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-48 text-primary/30 font-mono text-sm">
            <Clock className="w-8 h-8 mb-3 opacity-30" />
            <p>No events match your filters.</p>
            {hasFilters && (
              <button onClick={clearFilters} className="mt-2 text-xs text-primary/40 hover:text-primary/70 underline">
                Clear filters
              </button>
            )}
          </div>
        )}

        {events.length > 0 && (
          <ListContainer events={events} itemData={itemData} />
        )}

        {loading && (
          <div className="flex items-center justify-center py-4 font-mono text-xs text-primary/40 shrink-0">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading events…
          </div>
        )}

        {hasMore && !loading && events.length > 0 && (
          <div className="flex justify-center py-3 border-t border-primary/10 shrink-0">
            <button
              onClick={() => fetchPage(false, offset)}
              className="font-mono text-xs text-primary/40 border border-primary/20 px-4 py-1.5 hover:border-primary/50 hover:text-primary/70 transition-all flex items-center gap-2"
            >
              <ChevronDown className="w-3 h-3" />
              Load more events
            </button>
          </div>
        )}

        {!hasMore && events.length > 0 && !loading && (
          <div className="text-center py-2 font-mono text-[10px] text-primary/20 uppercase tracking-wider border-t border-primary/8 shrink-0">
            — End of timeline —
          </div>
        )}
      </div>

      {/* Event detail drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
