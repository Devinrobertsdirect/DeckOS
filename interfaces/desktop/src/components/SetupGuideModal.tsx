import { useState, useEffect, useRef } from "react";
import {
  Terminal, Cpu, MemoryStick, Zap, CheckCircle2, BookOpen,
  Activity, Network, Clock, Newspaper, Map, Brain, Heart,
  Smartphone, Scan, TerminalSquare, GitBranch, Bot, Shield,
  Star, Trophy, Lock, Unlock, ChevronRight, ChevronLeft,
  Eye, Radio, Fingerprint, Package, Settings,
} from "lucide-react";

const STORAGE_KEY = "deckos_setup_guide_seen";
const READ_DELAY_MS = 1400;

// ─── Achievement / clearance system ──────────────────────────────────────────
const ACHIEVEMENTS = [
  { id: "orientation",  label: "ORIENTATION",    icon: Eye },
  { id: "command",      label: "CMD CENTER",     icon: Activity },
  { id: "ai_core",      label: "AI CORE",        icon: Brain },
  { id: "tools",        label: "OPS TOOLS",      icon: Zap },
  { id: "advanced",     label: "ADVANCED",       icon: Radio },
  { id: "deployment",   label: "DEPLOYMENT",     icon: Smartphone },
  { id: "mastery",      label: "MASTERY",        icon: Trophy },
];

interface StepDef {
  module: string;
  achievement: string;
  icon: React.ComponentType<{ className?: string }>;
  tag: string;
  title: string;
  tip?: string;
  content: React.ReactNode;
}

const STEPS: StepDef[] = [
  // ══ MODULE 1 — ORIENTATION ══════════════════════════════════════════════
  {
    module: "ORIENTATION",
    achievement: "orientation",
    icon: Terminal,
    tag: "BOOT.SEQUENCE",
    title: "Welcome to Deck OS",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          You are now connected to <span className="text-primary font-bold">Deck OS</span> — a fully local
          AI command center modeled after Tony Stark's JARVIS interface. Think of it as a
          personal AI assistant that lives on your computer, remembers everything you tell it, and
          can be extended with hundreds of capabilities.
        </p>
        <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
          {[
            { icon: Brain,    label: "LOCAL AI",   desc: "Runs on your machine" },
            { icon: MemoryStick, label: "MEMORY",  desc: "Remembers across sessions" },
            { icon: Zap,      label: "EXTENSIBLE", desc: "70+ installable skills" },
          ].map(({ icon: I, label, desc }) => (
            <div key={label} className="border border-primary/20 bg-primary/5 p-3 space-y-1.5">
              <I className="w-5 h-5 text-primary/60 mx-auto" />
              <div className="text-primary/80 font-bold">{label}</div>
              <div className="text-primary/40 text-[9px]">{desc}</div>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-3 font-mono text-xs space-y-1.5">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-2">PRIVACY GUARANTEE</div>
          <div className="flex items-start gap-2 text-primary/60">
            <Shield className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
            Your data never leaves your machine. Deck OS uses local AI models (Ollama) by default.
            No cloud required. No subscriptions.
          </div>
        </div>
      </div>
    ),
    tip: "Deck OS is designed to get smarter about you the more you use it.",
  },
  {
    module: "ORIENTATION",
    achievement: "orientation",
    icon: BookOpen,
    tag: "INTERFACE.PRIMER",
    title: "Reading the Interface",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          Deck OS uses a JARVIS-style HUD (Heads Up Display). Everything uses the same visual language:
        </p>
        <div className="space-y-2 font-mono text-xs">
          {[
            { color: "text-primary",     sample: "●",  label: "Primary color",    desc: "Active, confirmed, online data" },
            { color: "text-[#00ff88]",   sample: "●",  label: "Green",            desc: "Healthy / connected / success" },
            { color: "text-yellow-400",  sample: "●",  label: "Amber",            desc: "Warning / calibrating / idle" },
            { color: "text-red-400",     sample: "●",  label: "Red",              desc: "Alert / error / critical" },
            { color: "text-primary/40",  sample: "●",  label: "Dimmed",           desc: "Inactive / offline / unknown" },
          ].map(({ color, sample, label, desc }) => (
            <div key={label} className="flex items-center gap-3 border-b border-primary/8 pb-2">
              <span className={`${color} text-lg shrink-0`}>{sample}</span>
              <span className="text-primary/70 w-28 shrink-0">{label}</span>
              <span className="text-primary/40">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-3 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-2">KEYBOARD SHORTCUTS</div>
          <div className="grid grid-cols-2 gap-1.5 text-primary/60">
            <span><kbd className="border border-primary/30 px-1 text-primary">E</kbd> — Event log</span>
            <span><kbd className="border border-primary/30 px-1 text-primary">?</kbd> — Reopen this guide</span>
          </div>
        </div>
      </div>
    ),
    tip: "The color of every element tells you its status at a glance — no reading required.",
  },

  // ══ MODULE 2 — COMMAND CENTER ════════════════════════════════════════════
  {
    module: "COMMAND CENTER",
    achievement: "command",
    icon: Activity,
    tag: "SYS.HUD",
    title: "Your Dashboard",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          The <span className="text-primary font-bold">SYS.HUD</span> is your mission control.
          It shows you everything at a glance — CPU, memory, disk, AI status, connected devices,
          your daily briefing, and the live event stream.
        </p>
        <div className="space-y-2 font-mono text-xs">
          {[
            ["METRIC CARDS",   "Top row — CPU, Memory, Disk, AI Mode usage at a glance"],
            ["SYS.SUMMARY",    "Left panel — system vitals, plugin count, inference stats"],
            ["EVENT STREAM",   "Bottom strip — every event happening in real time"],
            ["BRIEFING CARD",  "AI-generated summary of your day, updated each morning"],
            ["COGNITIVE PULSE","Shows your presence, availability, and live sensor data"],
          ].map(([name, desc]) => (
            <div key={name} className="flex items-start gap-3 border-b border-primary/8 pb-2">
              <span className="text-primary shrink-0 w-32 text-[10px]">{name}</span>
              <span className="text-primary/50">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-yellow-500/20 bg-yellow-500/5 p-2.5 text-[10px] font-mono text-yellow-400/80">
          TIP: Hover any card — the text glows. Click any metric card to get details.
        </div>
      </div>
    ),
    tip: "The dashboard updates live — no refresh needed.",
  },
  {
    module: "COMMAND CENTER",
    achievement: "command",
    icon: BookOpen,
    tag: "NAV.GUIDE",
    title: "Navigation — Every Section",
    content: (
      <div className="space-y-3">
        <p className="text-primary/75 text-sm">The left sidebar is your navigation. Here is every section and what it does:</p>
        <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
          {[
            ["SYS.HUD",       "Dashboard overview"],
            ["AI.ROUTER",     "Chat with your AI"],
            ["AI.PERSONA",    "Name + personality"],
            ["PLUGINS",       "Manage installed skills"],
            ["PLUGIN.STORE",  "Browse 70+ skills"],
            ["MEMORY.BANK",   "What AI remembers"],
            ["DEVICES",       "IoT + smart home"],
            ["CONSOLE",       "Run commands"],
            ["ROUTINES",      "Scheduled automations"],
            ["BRIEFINGS",     "Daily AI summaries"],
            ["POLYGRAPH",     "Lie detector (Stark)"],
            ["TIMELINE",      "Event history"],
            ["SETTINGS",      "All configuration"],
            ["SPATIAL.MAP",   "Location tracking"],
          ].map(([label, desc]) => (
            <div key={label} className="border border-primary/10 bg-black/20 px-2 py-1.5">
              <div className="text-primary text-[9px] font-bold">{label}</div>
              <div className="text-primary/40 text-[9px]">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    tip: "Every section is accessible from the sidebar. Nothing is hidden behind menus.",
  },
  {
    module: "COMMAND CENTER",
    achievement: "command",
    icon: TerminalSquare,
    tag: "EVENT.LOG",
    title: "The Live Event Log",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          Deck OS runs on an <span className="text-primary font-bold">event bus</span> — everything
          that happens (AI responses, device updates, plugin actions, sensor readings) fires as a
          live event. Press <kbd className="border border-primary/40 px-1.5 py-0.5 font-mono text-primary text-xs">E</kbd> anywhere
          to open the event log and watch in real time.
        </p>
        <div className="border border-primary/20 bg-black/40 p-3 font-mono text-[10px] space-y-1.5">
          <div className="text-primary/40 uppercase tracking-widest mb-2">EXAMPLE EVENTS</div>
          {[
            { type: "system.monitor.metrics", color: "text-primary/60",    label: "CPU/memory readings every 4 seconds" },
            { type: "ai.chat.response",        color: "text-[#00ff88]/70", label: "AI replied to your message" },
            { type: "device.state.changed",    color: "text-yellow-400/70",label: "A device changed status" },
            { type: "stark.signal.event",      color: "text-red-400/70",   label: "Bioelectric sensor fired" },
            { type: "plugin.installed",        color: "text-primary/60",   label: "A skill was installed" },
          ].map(({ type, color, label }) => (
            <div key={type} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
              <span className={`${color} font-bold`}>{type}</span>
              <span className="text-primary/30 hidden sm:block">— {label}</span>
            </div>
          ))}
        </div>
        <p className="text-primary/50 text-xs font-mono">
          This is useful for debugging, learning what the AI is doing, and monitoring plugins.
        </p>
      </div>
    ),
    tip: "The event log is the best way to understand what Deck OS is doing behind the scenes.",
  },

  // ══ MODULE 3 — AI CORE ══════════════════════════════════════════════════
  {
    module: "AI CORE",
    achievement: "ai_core",
    icon: Cpu,
    tag: "AI.ROUTER",
    title: "Talking to Your AI",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          The <span className="text-primary font-bold">AI.ROUTER</span> is where you talk to your
          AI. Think of it like a private chat interface — but smarter, because JARVIS remembers
          your previous conversations and uses them as context.
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-1">THREE AI MODES</div>
          {[
            { mode: "FAST",  desc: "Quick answers — rule engine or lightweight model" },
            { mode: "DEEP",  desc: "Full reasoning chains — best for complex questions" },
            { mode: "VOICE", desc: "Speak your question, AI speaks the reply" },
          ].map(({ mode, desc }) => (
            <div key={mode} className="border border-primary/15 bg-black/20 px-3 py-2 flex gap-3">
              <span className="text-primary font-bold w-14 shrink-0">{mode}</span>
              <span className="text-primary/50">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-3 font-mono text-[10px]">
          <div className="text-primary/40 uppercase tracking-widest mb-2">HOW TO SET UP OLLAMA (LOCAL AI)</div>
          <div className="space-y-1 text-primary/60">
            <div>1. Download Ollama from <span className="text-primary">ollama.com</span> (free)</div>
            <div>2. Open a terminal and run: <span className="text-primary bg-black/60 px-1">ollama pull gemma4</span></div>
            <div>3. Deck OS auto-detects it — the AI status turns green</div>
          </div>
        </div>
      </div>
    ),
    tip: "You can use AI without Ollama — the built-in rule engine handles simple requests.",
  },
  {
    module: "AI CORE",
    achievement: "ai_core",
    icon: Bot,
    tag: "AI.PERSONA",
    title: "Your AI's Personality",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          In <span className="text-primary font-bold">AI.PERSONA</span>, you can customize your AI:
          give it a name, choose a gender, set a voice, and tune personality traits like verbosity,
          humor, and how proactive it is.
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
          {[
            { trait: "NAME",         example: "JARVIS, FRIDAY, AXIOM…" },
            { trait: "VOICE",        example: "Male / Female / Neutral" },
            { trait: "VERBOSITY",    example: "Brief ←→ Detailed" },
            { trait: "HUMOR",        example: "Formal ←→ Playful" },
            { trait: "PROACTIVITY",  example: "Reactive ←→ Initiative" },
            { trait: "DEPTH",        example: "Surface ←→ Deep analysis" },
          ].map(({ trait, example }) => (
            <div key={trait} className="border border-primary/15 bg-black/20 px-2 py-1.5">
              <div className="text-primary text-[9px] font-bold">{trait}</div>
              <div className="text-primary/40 text-[9px]">{example}</div>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-primary/5 p-2.5 font-mono text-[10px] text-primary/60">
          The persona you set here is injected into every AI conversation as a system prompt.
          It shapes everything — how the AI greets you, how it structures answers, even its jokes.
        </div>
      </div>
    ),
    tip: "You already customized this during first launch. You can always change it in AI.PERSONA.",
  },
  {
    module: "AI CORE",
    achievement: "ai_core",
    icon: MemoryStick,
    tag: "MEMORY.BANK",
    title: "Persistent Memory",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          <span className="text-primary font-bold">MEMORY.BANK</span> is how JARVIS remembers you across sessions.
          You can store facts, goals, preferences — and the AI will reference them in future conversations
          automatically.
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-1">MEMORY LAYERS</div>
          {[
            ["IDENTITY",    "Your name, job, location, background"],
            ["GOALS",       "What you're working toward"],
            ["PREFERENCES", "How you like things done"],
            ["CONTEXT",     "Recent conversations and topics"],
            ["DECISIONS",   "Choices you've made and why"],
          ].map(([layer, desc]) => (
            <div key={layer} className="flex justify-between border-b border-primary/8 pb-1.5">
              <span className="text-primary">{layer}</span>
              <span className="text-primary/40">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-[#00ff88]/20 bg-[#00ff88]/5 p-2.5 font-mono text-[10px] text-[#00ff88]/70">
          Try saying to the AI: "Remember that I prefer dark mode and work in cybersecurity."
          It will store that and use it in future responses.
        </div>
      </div>
    ),
    tip: "The more you tell JARVIS, the more personalized every response becomes.",
  },

  // ══ MODULE 4 — OPERATIONAL TOOLS ════════════════════════════════════════
  {
    module: "OPS TOOLS",
    achievement: "tools",
    icon: Package,
    tag: "PLUGIN.STORE",
    title: "Installing Skills",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          The <span className="text-primary font-bold">Plugin Store</span> gives you access to 70+
          skills across 11 categories. Each skill adds new capabilities to Deck OS — from weather
          monitoring to home automation, security scanning, media control, and more.
        </p>
        <div className="grid grid-cols-3 gap-1 font-mono text-[9px]">
          {["HOMELAB","DEVOPS","AI TOOLS","SECURITY","PRODUCTIVITY","AUTOMATION","MEDIA","RESEARCH","DATA","SYSTEM","COMMS"].map((c) => (
            <div key={c} className="border border-primary/10 bg-primary/5 px-1.5 py-1 text-primary/60 text-center">{c}</div>
          ))}
        </div>
        <div className="font-mono text-xs space-y-2">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest">HOW TO INSTALL A SKILL</div>
          {["Go to PLUGIN.STORE in the sidebar","Browse or search by category","Click a skill card → click INSTALL","The skill activates immediately"].map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-primary/60">
              <span className="text-primary/30 w-4 shrink-0">{i + 1}.</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    tip: "Official plugins (marked OFFICIAL) are built-in and pre-installed — no action needed.",
  },
  {
    module: "OPS TOOLS",
    achievement: "tools",
    icon: Clock,
    tag: "ROUTINES",
    title: "Automated Routines",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          <span className="text-primary font-bold">ROUTINES</span> are scheduled automations —
          tasks that run automatically at set times or on triggers. Set them up once and JARVIS
          handles them without you having to think about it.
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-1">EXAMPLE ROUTINES</div>
          {[
            { time: "06:00",  action: "Generate daily briefing and announce it" },
            { time: "08:00",  action: "Check weather, traffic, and calendar" },
            { time: "22:00",  action: "Save memory snapshot and run system health check" },
            { time: "TRIGGER",action: "When CPU > 90%, send notification" },
          ].map(({ time, action }) => (
            <div key={action} className="border border-primary/10 bg-black/20 px-3 py-2 flex gap-3">
              <span className="text-primary font-bold w-16 shrink-0">{time}</span>
              <span className="text-primary/50">{action}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    tip: "Routines are how you turn Deck OS from a tool into a true assistant.",
  },
  {
    module: "OPS TOOLS",
    achievement: "tools",
    icon: Newspaper,
    tag: "BRIEFINGS",
    title: "Daily Briefings",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          Every morning at 06:00, JARVIS generates a personalized <span className="text-primary font-bold">Daily Briefing</span> —
          a summary combining weather, your goals, system status, and anything else relevant.
          You can also generate one on demand from the Briefings page.
        </p>
        <div className="border border-primary/20 bg-black/40 p-3 font-mono text-xs space-y-1.5 text-primary/60">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-2">BRIEFING CONTAINS</div>
          <div>✦ Weather conditions for your location</div>
          <div>✦ AI-summarized news or updates</div>
          <div>✦ Progress toward your current goals</div>
          <div>✦ System health summary</div>
          <div>✦ Any active alerts or notifications</div>
        </div>
        <p className="text-primary/50 text-xs font-mono">
          To generate one now: go to <span className="text-primary">BRIEFINGS</span> in the sidebar → click GENERATE NOW.
        </p>
      </div>
    ),
    tip: "The briefing improves the more you teach JARVIS about your goals and routine.",
  },
  {
    module: "OPS TOOLS",
    achievement: "tools",
    icon: TerminalSquare,
    tag: "CONSOLE",
    title: "The Command Console",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          The <span className="text-primary font-bold">Console</span> is a direct command interface.
          You can run system commands, query the event bus, trigger plugin actions, and inspect
          Deck OS internals — all from a JARVIS-style terminal.
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-1">EXAMPLE COMMANDS</div>
          {[
            { cmd: "status",        desc: "Print full system status" },
            { cmd: "memory list",   desc: "Show everything JARVIS remembers" },
            { cmd: "plugin list",   desc: "Show all installed plugins" },
            { cmd: "devices",       desc: "List connected devices" },
            { cmd: "clear",         desc: "Clear the console output" },
          ].map(({ cmd, desc }) => (
            <div key={cmd} className="flex gap-3 border-b border-primary/8 pb-1.5">
              <code className="text-primary w-28 shrink-0">{cmd}</code>
              <span className="text-primary/50">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    tip: "The Console is for power users — you don't need it to use Deck OS normally.",
  },

  // ══ MODULE 5 — ADVANCED SYSTEMS ════════════════════════════════════════
  {
    module: "ADVANCED",
    achievement: "advanced",
    icon: Eye,
    tag: "ACERA.PROTOCOL",
    title: "Gesture Control (ACERA)",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          <span className="text-primary font-bold">ACERA</span> (Augmented Command and Environmental
          Response Architecture) lets you control Deck OS with hand gestures using your webcam.
          No touching required.
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-xs">
          {[
            { gesture: "✌ TWO FINGERS",   action: "Navigate forward" },
            { gesture: "☝ ONE FINGER",    action: "Navigate back" },
            { gesture: "✋ OPEN PALM",     action: "Go to dashboard" },
            { gesture: "👊 CLOSED FIST",  action: "Open console" },
            { gesture: "🤟 ROCK SIGN",    action: "Toggle AI chat" },
            { gesture: "👈 POINT LEFT",   action: "Scroll up" },
          ].map(({ gesture, action }) => (
            <div key={gesture} className="border border-primary/15 bg-black/20 px-2 py-1.5">
              <div className="text-primary/80">{gesture}</div>
              <div className="text-primary/40 text-[9px]">{action}</div>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-2.5 font-mono text-[10px] text-primary/60">
          To enable: Click the camera icon in the top header → grant webcam permission →
          ACERA activates. You'll see a live gesture overlay.
        </div>
      </div>
    ),
    tip: "ACERA requires Chrome or Edge — Firefox does not support the MediaPipe hand tracking API.",
  },
  {
    module: "ADVANCED",
    achievement: "advanced",
    icon: Radio,
    tag: "STARK.PROTOCOL",
    title: "Bioelectric Sensors (Stark)",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          <span className="text-primary font-bold">Stark Protocol</span> connects to bioelectric
          sensors (like the Upside Down Labs BioAmp) via USB. It reads your muscle signals (EMG),
          heart rate (EKG), and brainwaves (EEG) — and lets you control Deck OS with your body.
        </p>
        <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
          {[
            { icon: Zap,   label: "EMG", desc: "Muscle tension → navigation" },
            { icon: Heart, label: "EKG", desc: "Heart rate → stress tracking" },
            { icon: Brain, label: "EEG", desc: "Brainwaves → focus/relax" },
          ].map(({ icon: I, label, desc }) => (
            <div key={label} className="border border-primary/15 bg-primary/5 p-2.5 space-y-1">
              <I className="w-4 h-4 text-primary/50 mx-auto" />
              <div className="text-primary/80 font-bold">{label}</div>
              <div className="text-primary/40 text-[9px]">{desc}</div>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-2.5 font-mono text-[10px] text-primary/60">
          To enable: Click the ⚡ Stark icon in the header → connect your sensor.
          If you don't have hardware, Stark still works in simulation mode for demos.
        </div>
      </div>
    ),
    tip: "Stark + ACERA can run at the same time — bioelectric AND gesture control simultaneously.",
  },
  {
    module: "ADVANCED",
    achievement: "advanced",
    icon: Scan,
    tag: "POLYGRAPH.SUITE",
    title: "Lie Detector (Polygraph)",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          The <span className="text-primary font-bold">POLYGRAPH</span> page uses Stark bioelectric
          data to run a real psychophysiological lie detector. JARVIS calibrates your baseline
          vitals, then records stress responses to each question you ask — and delivers an
          AI-interpreted verdict.
        </p>
        <div className="space-y-2 font-mono text-xs">
          {[
            ["1. CALIBRATE", "30 seconds of sitting still → establishes your baseline"],
            ["2. QUESTION",  "Ask any yes/no question → 10 seconds of recording"],
            ["3. SCORE",     "Z-score computed: deviation from baseline in standard deviations"],
            ["4. ANALYZE",   "JARVIS reads back a full polygraph report"],
          ].map(([step, desc]) => (
            <div key={step} className="flex gap-3 border-b border-primary/8 pb-2">
              <span className="text-primary font-bold w-24 shrink-0 text-[10px]">{step}</span>
              <span className="text-primary/50">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-yellow-500/20 bg-yellow-500/5 p-2.5 font-mono text-[10px] text-yellow-400/70">
          Works without Stark hardware — software-only mode uses ambient baselines.
          Connect a BioAmp sensor for accurate physiological measurements.
        </div>
      </div>
    ),
    tip: "Find it under POLYGRAPH in the sidebar. Works best with a Stark biosensor connected.",
  },

  // ══ MODULE 6 — DEPLOYMENT ═══════════════════════════════════════════════
  {
    module: "DEPLOYMENT",
    achievement: "deployment",
    icon: Network,
    tag: "DEVICE.CONTROL",
    title: "Devices & IoT",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          <span className="text-primary font-bold">DEVICES</span> shows all hardware connected to
          Deck OS — smart home devices, sensors, actuators, and simulated devices. You can
          view live readings, send commands, and set up automation rules.
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-1">CONNECTION PROTOCOLS</div>
          {[
            ["MQTT",     "For smart home devices (home automation standard)"],
            ["WEBSOCKET","For the Deck OS mobile app and browser devices"],
            ["SIMULATED","Built-in test devices — always running, no hardware needed"],
          ].map(([proto, desc]) => (
            <div key={proto} className="border border-primary/10 bg-black/20 px-3 py-2 flex gap-3">
              <span className="text-primary font-bold w-24 shrink-0">{proto}</span>
              <span className="text-primary/50">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-2.5 font-mono text-[10px] text-primary/60">
          Three simulated devices are always active: a temperature sensor, relay actuator, and CPU monitor.
          Use these to learn device control without any hardware.
        </div>
      </div>
    ),
    tip: "Connect Home Assistant via the HA Bridge plugin to control your entire smart home.",
  },
  {
    module: "DEPLOYMENT",
    achievement: "deployment",
    icon: Smartphone,
    tag: "MOBILE.APP",
    title: "The Mobile Companion",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          <span className="text-primary font-bold">DeckOS Mobile</span> is a companion app that
          streams your phone's sensors back to Deck OS — GPS location, battery level, network info,
          and more. It also gives you a JARVIS chat interface on your phone.
        </p>
        <div className="space-y-2 font-mono text-xs">
          <div className="text-primary/40 text-[9px] uppercase tracking-widest mb-1">WHAT MOBILE STREAMS</div>
          {[
            ["GPS",        "Your real-time location on the SPATIAL.MAP"],
            ["BATTERY",    "Phone battery level as a device sensor"],
            ["NETWORK",    "WiFi signal and connection quality"],
            ["CAMERA",     "Optional — stream camera feed to dashboard"],
          ].map(([sensor, desc]) => (
            <div key={sensor} className="flex gap-3 border-b border-primary/8 pb-1.5">
              <span className="text-primary w-20 shrink-0">{sensor}</span>
              <span className="text-primary/50">{desc}</span>
            </div>
          ))}
        </div>
        <div className="border border-primary/20 bg-black/40 p-2.5 font-mono text-[10px] text-primary/60">
          To access: open <span className="text-primary">your-local-ip:5174</span> on your phone's browser
          while on the same WiFi network.
        </div>
      </div>
    ),
    tip: "The mobile app works in any mobile browser — no app store download needed.",
  },

  // ══ MODULE 7 — MASTERY ══════════════════════════════════════════════════
  {
    module: "MASTERY",
    achievement: "mastery",
    icon: Trophy,
    tag: "SYS.READY",
    title: "You Are Fully Briefed",
    content: (
      <div className="space-y-4">
        <p className="text-primary/75 leading-relaxed">
          You now have full operational knowledge of Deck OS. Your recommended first mission:
        </p>
        <div className="space-y-2 font-mono text-xs">
          {[
            { step: "01", label: "Install Ollama",     desc: "Run: ollama pull gemma4", done: false },
            { step: "02", label: "Name your AI",       desc: "AI.PERSONA → choose a name", done: false },
            { step: "03", label: "First message",      desc: "AI.ROUTER → introduce yourself", done: false },
            { step: "04", label: "Set a goal",         desc: "Tell AI what you're working toward", done: false },
            { step: "05", label: "Install a skill",    desc: "PLUGIN.STORE → browse and install", done: false },
            { step: "06", label: "Create a routine",   desc: "ROUTINES → schedule your briefing", done: false },
            { step: "07", label: "Try gesture control",desc: "Click 📷 in the header → ACERA", done: false },
          ].map(({ step, label, desc }) => (
            <div key={step} className="flex items-center gap-3 border border-primary/10 bg-black/20 px-3 py-2">
              <span className="text-primary/30 shrink-0 w-6">{step}</span>
              <div className="flex-1">
                <div className="text-primary/80">{label}</div>
                <div className="text-primary/40 text-[9px]">{desc}</div>
              </div>
              <CheckCircle2 className="w-3.5 h-3.5 text-primary/20 shrink-0" />
            </div>
          ))}
        </div>
        <p className="text-[10px] font-mono text-primary/40">
          Reopen this guide anytime: press <kbd className="border border-primary/30 px-1 text-primary">?</kbd> or go to Settings → Help
        </p>
      </div>
    ),
    tip: "You've unlocked OPERATOR CLEARANCE. Welcome aboard.",
  },
];

// Group steps by module for progress display
const MODULE_NAMES = Array.from(new Set(STEPS.map((s) => s.module)));

export function SetupGuideModal() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [canProceed, setCanProceed] = useState(false);
  const [unlockedAchievements, setUnlockedAchievements] = useState<Set<string>>(new Set());
  const [showBadge, setShowBadge] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, []);

  // Lock NEXT for READ_DELAY_MS on every step change
  useEffect(() => {
    setCanProceed(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCanProceed(true), READ_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [step]);

  function advance() {
    if (!canProceed) return;
    const current = STEPS[step]!;

    // Unlock achievement when moving past the last step of a module
    const nextStep = step + 1;
    const nextModule = STEPS[nextStep]?.module;
    if (nextModule !== current.module || nextStep >= STEPS.length) {
      const newSet = new Set(unlockedAchievements);
      if (!newSet.has(current.achievement)) {
        newSet.add(current.achievement);
        setUnlockedAchievements(newSet);
        setShowBadge(true);
        setTimeout(() => setShowBadge(false), 2200);
      }
    }

    if (nextStep >= STEPS.length) {
      dismiss();
    } else {
      setStep(nextStep);
    }
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  const current = STEPS[step]!;
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;
  const pct = Math.round(((step) / (STEPS.length - 1)) * 100);
  const clearanceLevel = Math.min(7, Math.floor((unlockedAchievements.size / ACHIEVEMENTS.length) * 7) + 1);

  // Which achievement is about to unlock?
  const justUnlocked = ACHIEVEMENTS.find((a) => a.id === current.achievement);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop — intentionally NOT dismissable by click */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Badge unlock flash */}
      {showBadge && justUnlocked && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 border border-primary/60 bg-black/95 shadow-[0_0_30px_rgba(var(--primary-rgb),0.4)] px-5 py-3 font-mono text-xs animate-pulse">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="text-primary tracking-widest">MODULE UNLOCKED — {justUnlocked.label}</span>
        </div>
      )}

      {/* Modal */}
      <div className="relative z-10 w-full max-w-xl border border-primary/40 bg-black/97 font-mono shadow-[0_0_80px_rgba(var(--primary-rgb),0.15)] flex flex-col max-h-[92vh]">

        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/20 bg-primary/5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="text-[9px] uppercase tracking-[0.2em] text-primary/50 flex-1 truncate">
            DECK.OS // OPERATOR.TRAINING // {current.tag}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <div className="border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] text-primary tracking-widest">
              LVL {clearanceLevel}
            </div>
            <button
              onClick={dismiss}
              title="Skip training (you can reopen with ?)"
              className="text-[9px] text-primary/25 hover:text-primary/50 transition-colors px-1 border border-primary/10 hover:border-primary/25"
            >
              SKIP
            </button>
          </div>
        </div>

        {/* Overall progress bar */}
        <div className="h-0.5 bg-primary/10 shrink-0">
          <div
            className="h-full bg-primary transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Achievement badges */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-primary/10 shrink-0 overflow-x-auto">
          {ACHIEVEMENTS.map((ach) => {
            const AchIcon = ach.icon;
            const locked = !unlockedAchievements.has(ach.id);
            const isCurrent = ach.id === current.achievement;
            return (
              <div
                key={ach.id}
                title={ach.label}
                className={`flex items-center gap-1 px-2 py-0.5 border text-[8px] shrink-0 transition-all ${
                  locked
                    ? isCurrent
                      ? "border-primary/30 bg-primary/5 text-primary/50"
                      : "border-primary/10 bg-transparent text-primary/20"
                    : "border-primary/60 bg-primary/15 text-primary"
                }`}
              >
                {locked ? <Lock className="w-2.5 h-2.5" /> : <AchIcon className="w-2.5 h-2.5" />}
                <span className="uppercase tracking-wider">{ach.label}</span>
              </div>
            );
          })}
        </div>

        {/* Module header */}
        <div className="px-4 pt-3 pb-1 shrink-0">
          <div className="text-[9px] text-primary/35 uppercase tracking-[0.2em] mb-0.5">
            MODULE — {current.module}
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-primary/30 bg-primary/10 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="text-base font-bold text-primary tracking-wide leading-tight">{current.title}</div>
            </div>
          </div>
        </div>

        {/* Content — scrollable */}
        <div className="px-4 pb-2 flex-1 overflow-y-auto text-sm">
          {current.content}
          {current.tip && (
            <div className="mt-3 flex items-start gap-2 border border-primary/15 bg-primary/5 px-3 py-2">
              <Star className="w-3 h-3 text-primary/60 shrink-0 mt-0.5" />
              <span className="text-[10px] text-primary/55 uppercase tracking-wider">{current.tip}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-primary/15 bg-black/60 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-primary/30">{step + 1} / {STEPS.length}</span>
            <div className="flex gap-0.5">
              {MODULE_NAMES.map((mod) => {
                const moduleSteps = STEPS.filter((s) => s.module === mod);
                const currentModuleStep = STEPS[step]!;
                const isActive = currentModuleStep.module === mod;
                const isDone = unlockedAchievements.has(moduleSteps[0]!.achievement);
                return (
                  <div
                    key={mod}
                    title={mod}
                    className={`w-4 h-1 transition-all ${isDone ? "bg-primary/70" : isActive ? "bg-primary/40" : "bg-primary/10"}`}
                  />
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1 px-3 py-1.5 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 transition-colors text-[9px] uppercase tracking-widest"
              >
                <ChevronLeft className="w-3 h-3" />
                BACK
              </button>
            )}
            <button
              onClick={advance}
              disabled={!canProceed}
              className={`flex items-center gap-1.5 px-4 py-1.5 border text-[10px] uppercase tracking-widest font-bold transition-all ${
                canProceed
                  ? isLast
                    ? "border-primary/70 bg-primary/20 text-primary hover:bg-primary/30"
                    : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/60"
                  : "border-primary/10 bg-transparent text-primary/20 cursor-not-allowed"
              }`}
            >
              {isLast ? (
                <><Trophy className="w-3 h-3" /> CLEARANCE GRANTED</>
              ) : (
                <>ACKNOWLEDGED <ChevronRight className="w-3 h-3" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function reopenSetupGuide() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}
