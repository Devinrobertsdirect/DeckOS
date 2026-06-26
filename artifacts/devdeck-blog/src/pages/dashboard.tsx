import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  Bot,
  Activity,
  Terminal,
  Wifi,
  Radio,
  FolderOpen,
  ChevronRight,
  Circle,
} from "lucide-react";

// ── Live clock hook ──────────────────────────────────────────────────────────
function useClockTime() {
  const fmt = () =>
    new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ── Module card ──────────────────────────────────────────────────────────────
interface Module {
  id: string;
  name: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  status: "online" | "offline" | "standby";
  accentVar: string;
}

const MODULES: Module[] = [
  {
    id: "jarvis",
    name: "JARVIS",
    label: "AI Assistant",
    icon: <Bot className="w-7 h-7" />,
    description: "Local AI — remembers you across sessions.",
    status: "online",
    accentVar: "--primary",
  },
  {
    id: "monitor",
    name: "MONITOR",
    label: "System Stats",
    icon: <Activity className="w-7 h-7" />,
    description: "Live CPU, RAM, temperature, and disk.",
    status: "online",
    accentVar: "--secondary",
  },
  {
    id: "terminal",
    name: "TERMINAL",
    label: "Shell Interface",
    icon: <Terminal className="w-7 h-7" />,
    description: "Full bash shell with log streaming.",
    status: "online",
    accentVar: "--accent",
  },
  {
    id: "network",
    name: "NETWORK",
    label: "Scanner",
    icon: <Wifi className="w-7 h-7" />,
    description: "Subnet sweep — hosts, ports, MAC addresses.",
    status: "online",
    accentVar: "--secondary",
  },
  {
    id: "iot",
    name: "IOT HUB",
    label: "Physical Devices",
    icon: <Radio className="w-7 h-7" />,
    description: "9 devices live — sensors, cameras, GPIO.",
    status: "online",
    accentVar: "--primary",
  },
  {
    id: "files",
    name: "FILES",
    label: "File Explorer",
    icon: <FolderOpen className="w-7 h-7" />,
    description: "Browse and manage the local filesystem.",
    status: "online",
    accentVar: "--accent",
  },
];

const STATUS_COLORS: Record<Module["status"], string> = {
  online: "text-[hsl(158_100%_50%)]",
  standby: "text-[hsl(38_100%_50%)]",
  offline: "text-destructive",
};

function ModuleCard({ mod }: { mod: Module }) {
  const [hovered, setHovered] = useState(false);

  const hoverStyle: CSSProperties = {
    borderColor: `hsl(var(${mod.accentVar}) / 0.6)`,
    boxShadow: `0 0 18px hsl(var(${mod.accentVar}) / 0.08)`,
  };

  return (
    <div
      className="relative border border-border bg-card p-6 flex flex-col gap-4 cursor-pointer transition-all duration-200 group"
      style={hovered ? hoverStyle : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* corner accent */}
      <div
        className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 transition-colors duration-200"
        style={{
          borderColor: hovered ? `hsl(var(${mod.accentVar}))` : "transparent",
        }}
      />

      <div
        className="transition-colors duration-200"
        style={{ color: hovered ? `hsl(var(${mod.accentVar}))` : "hsl(var(--muted-foreground))" }}
      >
        {mod.icon}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-bold text-base text-foreground tracking-wider">
            {mod.name}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            /{mod.label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground font-sans leading-relaxed">
          {mod.description}
        </p>
      </div>

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/50">
        <div className={`flex items-center gap-1.5 text-xs font-mono font-bold ${STATUS_COLORS[mod.status]}`}>
          <Circle className="w-1.5 h-1.5 fill-current" />
          {mod.status.toUpperCase()}
        </div>
        <ChevronRight
          className="w-4 h-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const clockTime = useClockTime();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-mono">
      {/* Status bar — identical aesthetic to blog */}
      <div className="fixed top-0 left-0 right-0 h-8 border-b border-border bg-card/80 backdrop-blur-md z-40 flex items-center px-4 text-xs font-mono text-muted-foreground justify-between">
        <div className="flex items-center gap-4">
          <span className="text-primary font-bold">[DECKOS]</span>
          <span className="hidden sm:inline">CPU: 12%</span>
          <span className="hidden sm:inline">RAM: 1.4 GB</span>
          <span className="hidden sm:inline">TEMP: 42°C</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-[hsl(158_100%_50%)]">
            <Circle className="w-1.5 h-1.5 fill-current" /> ONLINE
          </span>
          <span>{clockTime}</span>
        </div>
      </div>

      <div className="scanline" />

      <main className="flex-1 pt-16 flex flex-col">
        {/* ── Header ── */}
        <section className="px-6 md:px-12 lg:px-24 pt-14 pb-10 max-w-5xl mx-auto w-full">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tighter text-foreground mb-3">
            DeckOS<span className="text-primary animate-pulse">_</span>
          </h1>
          <p className="text-muted-foreground text-base font-sans">
            Your AI. Your hardware. Your rules.
          </p>
          <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground/60">
            <Terminal className="w-3 h-3" />
            <code>npx deckos start</code>
            <span className="ml-1">— or browse modules below</span>
          </div>
        </section>

        {/* ── Module grid ── */}
        <section className="px-6 md:px-12 lg:px-24 pb-16 max-w-5xl mx-auto w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MODULES.map((mod) => (
              <ModuleCard key={mod.id} mod={mod} />
            ))}
          </div>
        </section>

        {/* ── Quick install ── */}
        <section className="px-6 md:px-12 lg:px-24 pb-16 max-w-5xl mx-auto w-full">
          <div className="border border-border bg-card/50 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="text-xs text-primary font-bold tracking-widest mb-1">QUICK INSTALL</div>
              <code className="text-sm text-foreground/90">npx deckos start</code>
              <p className="text-xs text-muted-foreground mt-1 font-sans">
                Installs and launches DeckOS in under 60 seconds. Node.js 20+ required.
              </p>
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground font-mono shrink-0">
              <div><span className="text-primary/60 mr-2">$</span>npx deckos status</div>
              <div><span className="text-primary/60 mr-2">$</span>npx deckos update</div>
              <div><span className="text-primary/60 mr-2">$</span>npx deckos stop</div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-card py-5 px-6 md:px-12 lg:px-24">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-xs text-muted-foreground/50 font-mono">
            DeckOS v0.1 · devinrobertsdirect@gmail.com
          </span>
          <Link
            href="/dev"
            className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-primary transition-colors"
          >
            Developer View
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </footer>
    </div>
  );
}
