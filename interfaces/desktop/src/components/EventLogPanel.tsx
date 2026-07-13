import { useState, useEffect, useRef, useMemo } from "react";
import { X, Search, Circle, Filter, Radio } from "lucide-react";
import { useWebSocket, type WsEvent } from "@/contexts/WebSocketContext";
import { Input } from "@/components/ui/input";

const EVENT_COLORS: Record<string, string> = {
  system: "text-[#00d4ff]",
  ai: "text-[#cc44ff]",
  memory: "text-[#ffaa00]",
  device: "text-[#22ff44]",
  plugin: "text-[#ff8800]",
  client: "text-[#aaaaaa]",
  ws: "text-[#555555]",
};

const EVENT_DOT_COLORS: Record<string, string> = {
  system: "bg-[#00d4ff]",
  ai: "bg-[#cc44ff]",
  memory: "bg-[#ffaa00]",
  device: "bg-[#22ff44]",
  plugin: "bg-[#ff8800]",
  client: "bg-[#aaaaaa]",
  ws: "bg-[#555555]",
};

function getCategory(type: string): string {
  return type.split(".")[0] ?? "unknown";
}

function getEventColor(type: string): string {
  const cat = getCategory(type);
  return EVENT_COLORS[cat] ?? "text-primary/60";
}

function getEventDotColor(type: string): string {
  const cat = getCategory(type);
  return EVENT_DOT_COLORS[cat] ?? "bg-primary/60";
}

const ALL_CATEGORIES = ["system", "ai", "memory", "device", "plugin", "client", "ws"];

interface EventLogPanelProps {
  open: boolean;
  onClose: () => void;
}

export function EventLogPanel({ open, onClose }: EventLogPanelProps) {
  const { events } = useWebSocket();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set(ALL_CATEGORIES));
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const toggleCategory = (cat: string) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const src = sourceFilter.toLowerCase();
    return events.filter((e) => {
      const cat = getCategory(e.type);
      if (!activeCategories.has(cat)) return false;
      if (q && !e.type.toLowerCase().includes(q)) return false;
      if (src && !e.source?.toLowerCase().includes(src)) return false;
      return true;
    });
  }, [events, activeCategories, search, sourceFilter]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [filtered, autoScroll]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] max-w-full flex flex-col bg-[hsl(220,50%,4%)] border-l border-primary/30 z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20 bg-card/80 shrink-0">
        <div className="flex items-center gap-2 font-mono text-xs text-primary">
          <Radio className="w-3.5 h-3.5" />
          <span className="tracking-widest uppercase">EVENT.LOG</span>
          <span className="text-primary/30">({filtered.length})</span>
        </div>
        <button
          onClick={onClose}
          className="text-primary/40 hover:text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-primary/10 shrink-0 space-y-2">
        <div className="flex gap-2">
          <div className="flex flex-1 items-center gap-2 border border-primary/20 bg-background/50 px-2">
            <Search className="w-3 h-3 text-primary/30 shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-none bg-transparent focus-visible:ring-0 font-mono text-xs text-primary px-0 h-7"
              placeholder="Filter by type..."
            />
          </div>
          <div className="flex flex-1 items-center gap-2 border border-primary/20 bg-background/50 px-2">
            <span className="font-mono text-xs text-primary/30 shrink-0">SRC:</span>
            <Input
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="border-none bg-transparent focus-visible:ring-0 font-mono text-xs text-primary px-0 h-7"
              placeholder="Filter by source..."
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {ALL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`flex items-center gap-1 font-mono text-xs px-2 py-0.5 border transition-all ${
                activeCategories.has(cat)
                  ? "border-primary/40 bg-primary/5 " + (EVENT_COLORS[cat] ?? "text-primary")
                  : "border-primary/10 text-primary/20"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${getEventDotColor(cat)}`} />
              {cat}
            </button>
          ))}
          <button
            onClick={() => setAutoScroll((a) => !a)}
            className={`ml-auto flex items-center gap-1 font-mono text-xs px-2 py-0.5 border transition-all ${
              autoScroll ? "border-[#22ff44]/40 text-[#22ff44]" : "border-primary/10 text-primary/20"
            }`}
          >
            <Filter className="w-3 h-3" />
            AUTO
          </button>
        </div>
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {filtered.length === 0 && (
          <div className="p-4 text-primary/30 text-center">// No events match current filters</div>
        )}
        {filtered.map((evt, i) => (
          <EventRow key={`${evt.id ?? ""}-${i}`} event={evt} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function EventRow({ event }: { event: WsEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color = getEventColor(event.type);
  const dotColor = getEventDotColor(event.type);
  const ts = new Date(event.timestamp).toLocaleTimeString("en-US", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div
      className="border-b border-primary/5 px-3 py-1.5 hover:bg-primary/5 cursor-pointer transition-colors"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-2">
        <Circle className={`w-1.5 h-1.5 fill-current shrink-0 ${dotColor}`} />
        <span className={`flex-1 min-w-0 truncate ${color}`}>{event.type}</span>
        <span className="text-primary/25 shrink-0">{ts}</span>
      </div>
      {event.source && (
        <div className="pl-3.5 text-primary/25 text-xs truncate">src: {event.source}</div>
      )}
      {expanded && (
        <div className="pl-3.5 mt-1 text-primary/50 whitespace-pre-wrap break-all border border-primary/10 bg-background/50 p-2">
          {JSON.stringify(event.payload, null, 2)}
        </div>
      )}
    </div>
  );
}
