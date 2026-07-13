import { useState, useEffect } from "react";
import { Settings, Power, ChevronRight, CheckCircle2, XCircle, AlertTriangle, Circle, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWebSocket, useLatestPayload, useWsEvents } from "@/contexts/WebSocketContext";
import { useSearch, Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  active: "text-[#22ff44]",
  inactive: "text-muted-foreground",
  error: "text-[#ff3333]",
  loading: "text-[#ffaa00]",
};

const CATEGORY_COLORS: Record<string, string> = {
  monitoring: "text-[#00d4ff]",
  system: "text-[#22ff44]",
  ai: "text-[#cc44ff]",
  iot: "text-[#ffaa00]",
  automation: "text-muted-foreground",
};

type Plugin = {
  id: string;
  name: string;
  version?: string;
  enabled?: boolean;
  status?: string;
  category?: string;
  description?: string;
  commands?: string[];
};

type PluginListPayload = {
  plugins?: Plugin[];
  count?: number;
};

type PluginExecutedPayload = {
  pluginId?: string;
  command?: string;
  success?: boolean;
  output?: string;
  executionTimeMs?: number;
};

export default function PluginManager() {
  const { sendEvent } = useWebSocket();
  const search = useSearch();
  const preSelected = new URLSearchParams(search).get("selected");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(preSelected);

  const pluginList = useLatestPayload<PluginListPayload>("plugin.list.response");
  const pluginEvents = useWsEvents((e) =>
    e.type === "plugin.executed" ||
    e.type === "plugin.status_changed" ||
    e.type === "plugin.loaded" ||
    e.type === "plugin.error"
  );

  useEffect(() => {
    sendEvent({ type: "plugin.list.request", payload: {} });
  }, [sendEvent]);

  const plugins = pluginList?.plugins ?? [];
  const selected = plugins.find((p) => p.id === selectedPlugin);

  const pluginEventFeed = pluginEvents
    .filter((e) => !selectedPlugin || (e.payload as Record<string, unknown>)?.["pluginId"] === selectedPlugin)
    .slice(-20)
    .reverse();

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-primary/60 uppercase tracking-widest">
          <Settings className="w-4 h-4 text-primary" />
          <span>PLUGIN.MANAGER // SKILLS SYSTEM</span>
        </div>
        <Link href="/plugins/store">
          <a className="flex items-center gap-1 font-mono text-xs text-primary/40 hover:text-primary border border-primary/20 hover:border-primary/40 px-3 py-1.5 transition-all">
            <Package className="w-3 h-3" />
            PLUGIN STORE
          </a>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 content-start overflow-y-auto">
          {plugins.length === 0 && (
            <div className="col-span-2 font-mono text-xs text-primary/30 p-4 border border-primary/10 text-center">
              // Waiting for plugin.list.response from EventBus...
            </div>
          )}
          {plugins.map((plugin) => {
            const isSelected = selectedPlugin === plugin.id;
            const statusColor = STATUS_COLORS[plugin.status ?? "inactive"] ?? "text-muted-foreground";
            const catColor = CATEGORY_COLORS[plugin.category ?? ""] ?? "text-muted-foreground";

            const pluginEventCount = pluginEvents.filter(
              (e) => (e.payload as Record<string, unknown>)?.["pluginId"] === plugin.id
            ).length;

            const lastEvent = pluginEvents
              .filter((e) => (e.payload as Record<string, unknown>)?.["pluginId"] === plugin.id)
              .at(-1);

            return (
              <Card
                key={plugin.id}
                data-testid={`plugin-card-${plugin.id}`}
                onClick={() => setSelectedPlugin(isSelected ? null : plugin.id)}
                className={`bg-card/40 rounded-none cursor-pointer transition-all
                  ${isSelected ? "border-primary shadow-[0_0_15px_rgba(0,212,255,0.2)]" : "border-primary/20 hover:border-primary/50"}`}
              >
                <CardHeader className="p-4 border-b border-primary/10">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-mono text-sm text-primary font-bold">{plugin.name}</div>
                      <div className={`font-mono text-xs ${catColor}`}>
                        [{(plugin.category ?? "system").toUpperCase()}] v{plugin.version ?? "1.0.0"}
                      </div>
                    </div>
                    <button
                      data-testid={`toggle-${plugin.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        sendEvent({
                          type: "plugin.toggle.request",
                          payload: { pluginId: plugin.id, enabled: !plugin.enabled },
                        });
                      }}
                      className={`p-1.5 border transition-all ${plugin.enabled ? "border-primary/40 text-primary hover:bg-primary/10" : "border-primary/20 text-primary/30 hover:text-primary/60"}`}
                    >
                      <Power className="w-3 h-3" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <p className="font-mono text-xs text-muted-foreground">{plugin.description ?? "No description"}</p>
                  <div className="flex items-center justify-between">
                    <div className={`font-mono text-xs flex items-center gap-1 ${statusColor}`}>
                      {plugin.status === "active" ? <CheckCircle2 className="w-3 h-3" /> : plugin.status === "error" ? <AlertTriangle className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                      {(plugin.status ?? "inactive").toUpperCase()}
                    </div>
                    {isSelected && <ChevronRight className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="flex items-center gap-3 font-mono text-xs text-primary/30">
                    <span>{pluginEventCount} events</span>
                    {lastEvent && (
                      <span>{new Date(lastEvent.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="bg-card/40 border-primary/20 rounded-none flex flex-col min-h-0">
          <CardHeader className="border-b border-primary/20 p-4">
            <CardTitle className="font-mono text-sm text-primary">
              {selected ? `EVENTS // ${selected.id.toUpperCase()}` : "PLUGIN.EVENT.FEED"}
            </CardTitle>
          </CardHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs min-h-0">
            {pluginEventFeed.length === 0 && (
              <div className="text-primary/30">
                {selected ? "// No events for this plugin yet" : "// Select a plugin to filter events"}
              </div>
            )}
            {pluginEventFeed.map((evt, i) => {
              const p = evt.payload as PluginExecutedPayload;
              return (
                <div key={i} className={`border p-2 ${p.success === false ? "border-[#ff3333]/30" : "border-primary/20"}`}>
                  <div className="flex justify-between text-primary/40 mb-1">
                    <span className="truncate">{evt.type}</span>
                    <span>{new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </div>
                  {p.output && <div className="text-primary/80">{p.output}</div>}
                  {p.command && <div className="text-primary/50">cmd: {p.command}</div>}
                  <div className="flex items-center gap-2 mt-1">
                    {p.success === true && <CheckCircle2 className="w-3 h-3 text-[#22ff44]" />}
                    {p.success === false && <XCircle className="w-3 h-3 text-[#ff3333]" />}
                    {p.executionTimeMs !== undefined && <span className="text-primary/30">{p.executionTimeMs}ms</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-primary/10 p-3 font-mono text-xs text-primary/30">
            <Circle className="w-1.5 h-1.5 fill-[#00ff88] text-[#00ff88] inline mr-1.5" />
            Watching EventBus for plugin events
          </div>
        </Card>
      </div>
    </div>
  );
}
