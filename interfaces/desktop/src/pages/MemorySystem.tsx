import { useState, useEffect, useRef } from "react";
import { HardDrive, Search, Clock, Database } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWebSocket, useWsEvents } from "@/contexts/WebSocketContext";

type MemoryEntry = {
  id?: string;
  content?: string;
  keywords?: string[];
  source?: string;
  type?: string;
  createdAt?: string;
  expiresAt?: string | null;
};

type MemoryPayload = {
  results?: MemoryEntry[];
  count?: number;
  query?: string;
  entry?: MemoryEntry;
  id?: string;
  content?: string;
  keywords?: string[];
  source?: string;
  type?: string;
};

export default function MemorySystem() {
  const { sendEvent } = useWebSocket();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"recent" | "search">("recent");
  const [searchResults, setSearchResults] = useState<MemoryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const lastSearchQueryRef = useRef<string | null>(null);

  const memoryEvents = useWsEvents((e) =>
    e.type === "memory.stored" ||
    e.type === "memory.retrieved" ||
    e.type === "memory.recent.response" ||
    e.type === "memory.search.response"
  );

  const searchResponseEvents = useWsEvents((e) => e.type === "memory.search.response");
  const recentResponseEvents = useWsEvents((e) => e.type === "memory.recent.response");

  useEffect(() => {
    sendEvent({ type: "memory.recent.request", payload: { limit: 30 } });
  }, [sendEvent]);

  useEffect(() => {
    if (!searching || searchResponseEvents.length === 0) return;
    const matched = [...searchResponseEvents].reverse().find(
      (e) => (e.payload as MemoryPayload)?.query === lastSearchQueryRef.current
    );
    if (matched) {
      setSearchResults((matched.payload as MemoryPayload).results ?? []);
      setSearching(false);
    }
  }, [searchResponseEvents, searching]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    const query = searchQuery.trim();
    lastSearchQueryRef.current = query;
    setSearching(true);
    setSearchResults([]);
    sendEvent({ type: "memory.search.request", payload: { query } });
    setActiveTab("search");
  };

  const recentFromResponse: MemoryEntry[] = (() => {
    const latest = recentResponseEvents.at(-1);
    if (!latest) return [];
    const p = latest.payload as MemoryPayload & { entries?: MemoryEntry[] };
    return p.entries ?? p.results ?? [];
  })();

  const recentFromStream: MemoryEntry[] = memoryEvents
    .filter((e) => e.type === "memory.stored")
    .slice(-30)
    .reverse()
    .map((e) => {
      const p = e.payload as MemoryPayload;
      return {
        id: p.id ?? String(Math.random()),
        content: p.content ?? p.entry?.content ?? "",
        keywords: p.keywords ?? p.entry?.keywords ?? [],
        source: p.source ?? p.entry?.source ?? "system",
        type: p.type ?? p.entry?.type ?? "short_term",
        createdAt: e.timestamp,
        expiresAt: p.entry?.expiresAt ?? null,
      } as MemoryEntry;
    });

  const recentEntries: MemoryEntry[] = recentFromResponse.length > 0 ? recentFromResponse : recentFromStream;

  const displayEntries = activeTab === "search" ? searchResults : recentEntries;

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
        <HardDrive className="w-4 h-4 text-primary" />
        <span>MEMORY.BANK // SESSION + PERSISTENT STORAGE</span>
      </div>

      <div className="flex gap-4 items-center">
        <div className="flex border border-primary/20">
          <button
            data-testid="tab-recent"
            onClick={() => setActiveTab("recent")}
            className={`font-mono text-xs px-4 py-2 flex items-center gap-2 transition-all
              ${activeTab === "recent" ? "bg-primary/10 text-primary border-r border-primary/20" : "text-primary/50 border-r border-primary/20 hover:text-primary/80"}`}
          >
            <Clock className="w-3 h-3" /> RECENT
          </button>
          <button
            data-testid="tab-search"
            onClick={() => setActiveTab("search")}
            className={`font-mono text-xs px-4 py-2 flex items-center gap-2 transition-all
              ${activeTab === "search" ? "bg-primary/10 text-primary" : "text-primary/50 hover:text-primary/80"}`}
          >
            <Database className="w-3 h-3" /> SEARCH
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex-1 flex items-center border border-primary/20 bg-card/40 px-3">
          <Search className="w-3 h-3 text-primary/40 mr-2" />
          <Input
            data-testid="memory-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-none bg-transparent focus-visible:ring-0 font-mono text-sm text-primary px-0 h-8"
            placeholder="Search memory (press Enter)..."
          />
          <button
            type="submit"
            className="font-mono text-xs text-primary/50 hover:text-primary transition-colors px-2 py-1 border border-primary/20 hover:border-primary/40"
          >
            SEARCH
          </button>
        </form>

        <div className="font-mono text-xs text-muted-foreground shrink-0">
          {displayEntries.length} ENTRIES
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="col-span-2 overflow-y-auto space-y-2">
          {searching && (
            <div className="font-mono text-xs text-primary/40 p-4 border border-primary/10 text-center animate-pulse">
              // Searching memory via EventBus...
            </div>
          )}
          {!searching && displayEntries.length === 0 && (
            <div className="font-mono text-xs text-primary/40 p-4 border border-primary/10 text-center">
              {activeTab === "search" ? "// Submit a search query to find memory entries" : "// Waiting for memory events from EventBus..."}
            </div>
          )}
          {displayEntries.map((entry, i) => (
            <div key={entry.id ?? i} data-testid={`memory-entry-${entry.id}`} className="border border-primary/20 bg-card/40 p-4 font-mono text-xs">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  {entry.type === "short_term" ? <Clock className="w-3 h-3 text-[#ffaa00]" /> : <Database className="w-3 h-3 text-[#00d4ff]" />}
                  <span className="text-primary/40">SRC: {entry.source ?? "system"}</span>
                </div>
                <span className={entry.type === "short_term" ? "text-[#ffaa00]" : "text-[#00d4ff]"}>
                  {entry.type === "short_term" ? "SESSION" : "PERSISTENT"}
                </span>
              </div>
              <div className="text-primary/90 mb-2">{entry.content}</div>
              {entry.keywords && entry.keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.keywords.map((kw) => (
                    <span key={kw} className="border border-primary/20 px-1.5 py-0.5 text-primary/50">{kw}</span>
                  ))}
                </div>
              )}
              {entry.createdAt && (
                <div className="text-primary/30 mt-2">{new Date(entry.createdAt).toLocaleString()}</div>
              )}
            </div>
          ))}
        </div>

        <Card className="bg-card/40 border-primary/20 rounded-none flex flex-col">
          <CardHeader className="border-b border-primary/20 p-4">
            <CardTitle className="font-mono text-sm text-primary">MEMORY.STREAM</CardTitle>
          </CardHeader>
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="font-mono text-xs space-y-2">
              <div className="flex justify-between text-primary/60">
                <span>TOTAL.EVENTS</span>
                <span>{memoryEvents.length}</span>
              </div>
              <div className="flex justify-between text-primary/60">
                <span>STORED</span>
                <span>{memoryEvents.filter((e) => e.type === "memory.stored").length}</span>
              </div>
              <div className="flex justify-between text-primary/60">
                <span>RETRIEVED</span>
                <span>{memoryEvents.filter((e) => e.type === "memory.search.response" || e.type === "memory.recent.response" || e.type === "memory.retrieved").length}</span>
              </div>
            </div>
            <div className="border-t border-primary/10 pt-3">
              <div className="font-mono text-xs text-primary/30 mb-2">RECENT EVENTS</div>
              <div className="space-y-1">
                {memoryEvents.slice(-8).reverse().map((e, i) => (
                  <div key={i} className="font-mono text-xs flex justify-between">
                    <span className={e.type === "memory.stored" ? "text-[#ffaa00]/70" : "text-[#00d4ff]/70"}>
                      {e.type.replace("memory.", "")}
                    </span>
                    <span className="text-primary/30">
                      {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                ))}
                {memoryEvents.length === 0 && (
                  <div className="text-primary/20 text-xs">No memory events yet</div>
                )}
              </div>
            </div>
            <div className="border-t border-primary/10 pt-3 font-mono text-xs text-primary/40 space-y-1">
              <div>To search: type a query above and press Enter</div>
              <div>Sends: memory.search.request event</div>
              <div>Receives: memory.search.response event</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
