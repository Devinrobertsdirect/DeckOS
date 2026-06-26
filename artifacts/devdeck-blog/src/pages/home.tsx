import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Terminal, HardDrive, Cpu, Wifi, Activity, Code2, Play, CircleDot, ChevronRight, Layers, ChevronLeft } from "lucide-react";

const STARK_IFRAME_URL = `${import.meta.env.BASE_URL}stark-deck.html`;
const WIREFRAME_IFRAME_URL = `${import.meta.env.BASE_URL}wireframe-3d.html`;
const HERO_IMAGE_URL = `${import.meta.env.BASE_URL}cyberdeck-hero.png`;

function HoverRow({ hoverStyle, children }: { hoverStyle: CSSProperties; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="border border-border p-4 flex flex-col md:flex-row md:items-center gap-4 transition-colors group cursor-default"
      style={hovered ? hoverStyle : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </div>
  );
}

function useClockTime(): string {
  const fmt = () => new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export default function Home() {
  const [bootLog, setBootLog] = useState<string[]>([]);
  const [bootComplete, setBootComplete] = useState(false);
  const clockTime = useClockTime();

  useEffect(() => {
    const logs = [
      "[ OK ] Initializing core kernel...",
      "[ OK ] Module Loader initialized.",
      "[ OK ] Hardware Arbitration Layer online.",
      "[ OK ] Network mesh active.",
      "[ OK ] UI Engine ready.",
      "Launching interface..."
    ];
    
    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < logs.length) {
        setBootLog(prev => [...prev, logs[currentIndex]]);
        currentIndex++;
      } else {
        clearInterval(interval);
        setTimeout(() => setBootComplete(true), 500);
      }
    }, 150);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-mono">
      {/* Persistent Status Bar */}
      <div className="fixed top-0 left-0 right-0 h-8 border-b border-border bg-card/80 backdrop-blur-md z-40 flex items-center px-4 text-xs font-mono text-muted-foreground justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-primary font-bold hover:text-primary/80 transition-colors flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" />[DECKOS]
          </Link>
          <span className="hidden sm:inline text-muted-foreground/50">DEV VIEW</span>
          <span className="hidden sm:inline">CPU: 12%</span>
          <span className="hidden sm:inline">RAM: 1.4GB</span>
          <span className="hidden sm:inline">TEMP: 42°C</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Wifi className="w-3 h-3 text-secondary" /> ONLINE</span>
          <span>{clockTime}</span>
        </div>
      </div>

      <div className="scanline"></div>

      <main className="flex-1 pt-16 pb-24 flex flex-col gap-32">
        {/* Hero Section */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full pt-12 md:pt-24 flex flex-col md:flex-row gap-12 items-center">
          <div className="flex-1 flex flex-col gap-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 text-secondary text-sm font-bold tracking-widest uppercase"
            >
              <Terminal className="w-4 h-4" />
              Devin C. Roberts, CPMAI
            </motion.div>
            
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-7xl font-bold tracking-tighter text-foreground"
            >
              DeckOS<span className="text-primary animate-pulse">_</span>
            </motion.h1>
            
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-lg md:text-xl text-muted-foreground max-w-xl font-sans"
            >
              A lightweight, modular, offline-first cyberdeck OS. Built into a hollowed-out hardcover book. 
            </motion.p>
            
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col gap-2 mt-4 bg-card border border-border p-4 w-full max-w-md font-mono text-sm"
            >
              {!bootComplete ? (
                bootLog.filter(Boolean).map((log, i) => (
                  <div key={i} className={log?.includes("Launching") ? "text-primary mt-2" : "text-muted-foreground"}>
                    {log}
                  </div>
                ))
              ) : (
                <div className="text-primary flex items-center gap-2">
                  <Play className="w-4 h-4" fill="currentColor" /> System ready. Scroll to initialize.
                </div>
              )}
            </motion.div>
          </div>
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="flex-1 w-full relative aspect-square md:aspect-auto md:h-[500px]"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent border border-primary/20 p-2">
              <img 
                src={HERO_IMAGE_URL}
                alt="Cyberdeck hardware" 
                className="w-full h-full object-cover filter grayscale-[20%] contrast-125"
              />
              <div className="absolute top-4 left-4 border border-primary/30 bg-background/80 backdrop-blur px-2 py-1 text-xs text-primary">
                SYS.IMG.01
              </div>
              <div className="absolute bottom-4 right-4 flex gap-1">
                <div className="w-2 h-2 bg-primary animate-pulse"></div>
                <div className="w-2 h-2 bg-secondary animate-pulse" style={{ animationDelay: '200ms' }}></div>
                <div className="w-2 h-2 bg-accent"></div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Problem & Solution */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
          <div className="grid md:grid-cols-2 gap-12">
            <div className="border-l-2 border-destructive pl-6 py-2">
              <h3 className="text-xl font-bold text-destructive mb-4 flex items-center gap-2">
                <CircleDot className="w-5 h-5" /> The Problem
              </h3>
              <p className="text-muted-foreground font-sans leading-relaxed">
                Modern operating systems assume infinite bandwidth, infinite battery, and a 1080p screen. When building a portable cyberdeck with a 7" IPS panel mounted inside a wood chassis, there is no room — physically or computationally — for a modern bloated desktop.
              </p>
            </div>
            <div className="border-l-2 border-primary pl-6 py-2">
              <h3 className="text-xl font-bold text-primary mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5" /> The Solution
              </h3>
              <p className="text-muted-foreground font-sans leading-relaxed">
                DeckOS is a deliberate exercise in subtraction. A custom UI shell layered over Raspberry Pi OS with a module loader, an event bus, and a strict five-tier hardware arbitration model. It is terminal-first, sips power, and works entirely offline.
              </p>
            </div>
          </div>
        </section>

        {/* 3D Hardware Preview */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
          <div className="flex flex-col gap-4 mb-8">
            <h2 className="text-3xl font-bold text-foreground">Tour the deck</h2>
            <div className="flex items-center gap-2 text-sm text-secondary bg-secondary/10 px-4 py-2 w-fit border border-secondary/20">
              <Code2 className="w-4 h-4" /> drag to orbit · scroll to zoom · click components to inspect
            </div>
          </div>
          
          <div className="w-full bg-card border border-border relative group">
            <div className="absolute top-0 left-0 w-full h-8 bg-muted/30 border-b border-border flex items-center px-4 gap-2 z-10">
              <div className="w-3 h-3 rounded-full bg-destructive/80"></div>
              <div className="w-3 h-3 rounded-full bg-accent/80"></div>
              <div className="w-3 h-3 rounded-full bg-primary/80"></div>
              <span className="ml-4 text-xs text-muted-foreground font-mono">stark-deck.exe</span>
            </div>
            <div className="pt-8">
              <iframe 
                src={STARK_IFRAME_URL} 
                className="w-full h-[600px] border-none"
                title="S.T.A.R.K. Deck Interactive Preview"
              />
            </div>
          </div>
        </section>

        {/* 3D UI Wireframe */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
          <div className="flex flex-col gap-4 mb-8">
            <h2 className="text-3xl font-bold text-foreground">UI wireframe (3D)</h2>
            <p className="text-muted-foreground font-sans max-w-2xl">
              The full DeckOS interface laid out in space. Five panes, no overlapping windows, all reachable by keyboard. Click any pane to inspect, toggle the data flow to see how user input routes through the system, or explode the layers to see how the screen is composed.
            </p>
            <div className="flex items-center gap-2 text-sm text-secondary bg-secondary/10 px-4 py-2 w-fit border border-secondary/20">
              <Code2 className="w-4 h-4" /> drag to orbit · scroll to zoom · click panes to inspect
            </div>
          </div>

          <div className="w-full bg-card border border-border relative">
            <div className="absolute top-0 left-0 w-full h-8 bg-muted/30 border-b border-border flex items-center px-4 gap-2 z-10">
              <div className="w-3 h-3 rounded-full bg-destructive/80"></div>
              <div className="w-3 h-3 rounded-full bg-accent/80"></div>
              <div className="w-3 h-3 rounded-full bg-primary/80"></div>
              <span className="ml-4 text-xs text-muted-foreground font-mono">deckos-ui.wireframe</span>
            </div>
            <div className="pt-8">
              <iframe
                src={WIREFRAME_IFRAME_URL}
                className="w-full h-[640px] border-none"
                title="DeckOS UI Wireframe"
              />
            </div>
          </div>

          <div className="grid md:grid-cols-5 gap-3 mt-6 text-xs font-mono">
            <div className="border border-border bg-card p-3"><span className="text-primary">▸ STATUS</span><div className="text-muted-foreground mt-1">CPU / RAM / temp / net</div></div>
            <div className="border border-border bg-card p-3"><span className="text-secondary">▸ NAV</span><div className="text-muted-foreground mt-1">Module switcher (F-keys)</div></div>
            <div className="border border-border bg-card p-3"><span className="text-accent">▸ MAIN</span><div className="text-muted-foreground mt-1">Active module render</div></div>
            <div className="border border-border bg-card p-3"><span style={{color:'#ff44aa'}}>▸ SIDE</span><div className="text-muted-foreground mt-1">Quick actions in context</div></div>
            <div className="border border-border bg-card p-3"><span style={{color:'#9966ff'}}>▸ TERM</span><div className="text-muted-foreground mt-1">Bash + live log stream</div></div>
          </div>
        </section>

        {/* Stack & Architecture */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
          <h2 className="text-3xl font-bold mb-12 flex items-center gap-3">
            <Activity className="w-8 h-8 text-accent" /> Architecture
          </h2>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card border border-border p-6 hover:border-primary/50 transition-colors">
              <HardDrive className="w-6 h-6 text-primary mb-4" />
              <h4 className="text-lg font-bold mb-2">Hardware</h4>
              <ul className="text-sm text-muted-foreground space-y-2 font-sans">
                <li>Raspberry Pi 4/5</li>
                <li>7" IPS Touchscreen</li>
                <li>60% Apple Magic Keyboard</li>
                <li>BioAmp EXG Pill (Neural)</li>
              </ul>
            </div>
            
            <div className="bg-card border border-border p-6 hover:border-secondary/50 transition-colors">
              <Cpu className="w-6 h-6 text-secondary mb-4" />
              <h4 className="text-lg font-bold mb-2">Software Core</h4>
              <ul className="text-sm text-muted-foreground space-y-2 font-sans">
                <li>Raspberry Pi OS (Base)</li>
                <li>Python 3.11+</li>
                <li>rich / psutil / FastAPI</li>
                <li>SQLite Local Store</li>
              </ul>
            </div>
            
            <div className="bg-card border border-border p-6 hover:border-accent/50 transition-colors">
              <Terminal className="w-6 h-6 text-accent mb-4" />
              <h4 className="text-lg font-bold mb-2">Modules</h4>
              <ul className="text-sm text-muted-foreground space-y-2 font-sans">
                <li>Dashboard & Terminal</li>
                <li>Network Scanner</li>
                <li>File Explorer</li>
                <li>AI Assistant (Offline)</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Blog Post: Pre Week — Intro */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Pre Week: Hello, I'm Devin</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>April 3, 2026</span>
                <span>•</span>
                <span>2 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                Hey, my name is Devin C. Roberts and I'm a Computer Science student at Full Sail University, graduating in 2026. This blog is going to follow my Capstone project from week zero all the way to the final build, and since this is the very first post, I figured I'd skip the technical stuff and just introduce myself.
              </p>

              <p>
                I got into computers the way a lot of people do: I broke things, then I had to fix them. Somewhere along the way that turned into actually wanting to understand how the whole stack works, from the metal up. I went deeper into the AI side of things and earned my CPMAI certification because I wanted real, structured experience with how machine learning projects actually get planned and shipped, not just how to call an API. The two interests (low level systems and applied AI) keep colliding in my head, and Capstone is finally my excuse to mash them together into one project.
              </p>

              <p>
                That project is DeckOS, a custom operating system for a portable cyberdeck I'm building by hand. I'll get into the technical details next week. For now I just want to set the goal: I want to graduate with a portfolio piece that proves I can take an idea from "scribble on a notebook" all the way to "running hardware in your hand," and do it well enough that an industry team would trust me on day one. That means clean architecture, real documentation, and weekly public progress (which is exactly what this blog is for).
              </p>

              <p>
                Thanks for reading. If you want to see what I'm actually building, scroll up to the 3D model at the top of the page and click around. New post drops next week with the real problem statement and my plan of attack.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Week 1 — Hardware & Stack Decisions */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Week 1: Picking the Hardware and the Stack</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>April 10, 2026</span>
                <span>•</span>
                <span>3 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                Before I could write a single line of DeckOS, I had to commit to the hardware and the language stack underneath it. That sounds like a small decision, but it locks in everything else for the rest of the project. The wrong board limits what the OS can do, the wrong language stack adds weight where I cannot afford it, and the wrong screen size invalidates every wireframe I would draw next week. So this week was about making those calls and being able to defend them.
              </p>

              <p>
                The first problem was the compute board. I went back and forth between the Raspberry Pi 4, the Pi 5, and a Latte Panda. The Latte Panda is more powerful but it runs hot, eats battery, and is overkill for a terminal-first OS. The Pi 5 is fast but power hungry and harder to source for a student budget. My strategy was to optimize for the actual use case (long battery life, totally silent, runs cool inside a sealed wooden book) rather than raw benchmarks. The Pi 4 won. It is the most documented, the most stable, and the easiest to flash custom images onto. If DeckOS ever needs more horsepower I can swap in a Pi 5 later because the OS is platform agnostic on purpose.
              </p>

              <p>
                The second problem was the screen. A 7 inch IPS panel fits the inside of the book cover almost exactly, draws power straight off the Pi, and is bright enough to read outdoors. I considered a smaller e-ink panel for battery reasons but ruled it out because the refresh rate would kill the terminal feel I want. I want this thing to feel responsive, like a real shell, not like waiting on a Kindle.
              </p>

              <p>
                The third problem was the language stack. The obvious answer for a Pi was Python, and I challenged that choice on purpose because "obvious" is not a reason. I looked at Rust (too heavy a learning curve to ship by deadline), Go (great, but the TUI ecosystem is thin), and Node (rejected, I do not want a JS runtime sitting on a battery powered cyberdeck). Python won because of the rich library for the UI, psutil for live system stats, and the offline LLM tooling around Ollama, which is all Python first. My strategy was to pick the stack that lets me ship the most modules in the time I have, not the stack that wins benchmarks.
              </p>

              <p>
                With hardware and stack locked, next week I can finally start drawing the architecture for real. Five components, one event bus, and a strict arbitration layer between the AI and anything that can move motors. That is the plan, and now I have a real machine to put it on.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Week 2 — Architecture */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Week 2: Locking In the Architecture</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>April 17, 2026</span>
                <span>•</span>
                <span>3 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>
            
            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                With the hardware and the stack locked in last week, this week was about turning DeckOS from a list of components into an actual architecture. The chassis is a hollowed out hardcover copy of Thoreau's Walden, the brain is a Raspberry Pi 4, and the screen is a 7 inch IPS panel mounted to the inside of the book cover. It looks like a notebook on a shelf, and opens like a laptop on a workbench. Now I had to decide how the software inside it would actually be organized.
              </p>

              <p>
                Here's the problem I'm trying to solve. Modern operating systems assume you have unlimited internet, unlimited battery, and a full sized monitor. None of that is true on a cyberdeck. Standard Raspberry Pi OS will technically run on this hardware, but the desktop environment is heavy, the menus assume a mouse, and almost every "default" app expects a network connection. If I dropped a stock OS onto this build, half the screen would be wasted on window chrome and the other half would be waiting on a Wi-Fi handshake that never comes. That's a bad experience for the kind of field work, security research, and offline computing I'm targeting.
              </p>

              <p>
                DeckOS is my answer. It's a lightweight, terminal first interface that sits on top of Raspberry Pi OS and replaces the desktop entirely. Every feature (system monitor, network scanner, file browser, AI assistant, logs) is a self contained module that the core can load, unload, or swap out without restarting. The whole thing is keyboard driven, offline first, and built around a strict five layer architecture so that nothing dangerous (like an AI prompt) can ever talk directly to hardware. Safety lives in the arbitration layer, not in the AI.
              </p>

              <p>
                This week I locked in that architecture and got the supporting work done so the rest of the project has somewhere to land. I finalized the five core components (UI Engine, Module Loader, Command Processor, Data Manager, and Arbitration Layer), drafted the Entity Relationship Diagram for the SQLite database (Users, Modules, Logs), and stood up the public face of the project: a brand kit, this blog, and a live interactive 3D preview of the cyberdeck hardware that's embedded right on this page. Drag it, spin it, click any component to see what it does. I wanted reviewers and future employers to be able to actually see what I'm building, not just read about it.
              </p>

              <p>
                Next week I start the real work: implementing the boot sequence and shipping the first functional module, the system monitor. Once the dashboard is reading live CPU, RAM, and temperature off the Pi, this stops being a wireframe and starts being an operating system.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Week 3 */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Week 3: Pitch, Jira, and the Final Design Doc</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>April 24, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                This week was almost entirely paperwork, and that is exactly the problem I want to talk about. The temptation on a hardware project like DeckOS is to spend every hour soldering, flashing images, and writing Python. The pitch, the project board, and the design document feel like overhead. They are not. They are the thing that makes the technical work survive contact with reality, and this week proved that to me harder than I expected.
              </p>

              <p>
                The first issue I ran into was the pitch deck. I sat down to write a five minute talk explaining DeckOS to a non technical audience and immediately realized I could not summarize it. I had a hundred cool details (the BioAmp neural pulse, the five layer arbitration model, the offline LLM) and zero through line. My strategy for fixing it was brutal subtraction. I forced myself into a one sentence problem statement ("modern OSes assume infinite internet, infinite battery, and a full sized monitor, and a cyberdeck has none of those") and rebuilt every slide to support that one sentence. If a slide did not move that idea forward, it got cut. The deck went from twenty slides to nine and got noticeably stronger.
              </p>

              <p>
                The second issue was Jira. I had been tracking work in a notes app, which works great until you have twenty plus user stories, three release tiers (MVP, Alpha, Beta), and dependencies between them. By Tuesday I could not tell you what was actually next. So I rebuilt the backlog properly. Every requirement from the spec became a Jira story written in "the user will be able to..." form, tagged with its release tier, estimated, and linked to the module it lives in. Now I can open the board and immediately see what is unblocked, what is in progress, and what is at risk for the MVP cutoff. The fix was not Jira itself, the fix was committing to one source of truth and deleting every other to-do list I had floating around.
              </p>

              <p>
                The third issue was the final design doc. The rubric demanded twenty plus user stories, four user segments, expanded use cases, and a full ERD with an AI history table. My draft had placeholders and three stories. The strategy here was to stop treating the design doc as documentation and start treating it as the contract. I wrote out all twenty one stories first, then let the architecture follow. Once the stories were real, the missing pieces (the AI_History table, the offline mode toggle, the macro JSON loader) became obvious instead of theoretical.
              </p>

              <p>
                I also shipped a 3D wireframe of the UI on this blog so reviewers can actually see the four pane layout in space instead of squinting at a flat mockup. Click any pane to inspect it, hit "data flow" to see how input routes through the system. Next week I get back to code, with a much clearer picture of what code to write.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 2 Week 1 — Shipping the Core Engine */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 2, Week 1: Shipping the Core Engine</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>May 1, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                The MVP cutoff is no longer abstract. This week I shipped the first real version of DeckOS: a functional boot sequence, a working module loader, and a Python UI shell that actually reads live data off the Pi. Three weeks of architecture are now running on hardware, and the gap between the design doc and what is actually on screen is smaller than I expected in some places and larger than I expected in others.
              </p>

              <p>
                The boot sequence was the first thing I built. When DeckOS starts, it runs a short log stream that checks each subsystem (kernel, module loader, hardware arbitration, network mesh, UI engine) and prints a status line for each one before handing off to the main shell. This sounds cosmetic but it is actually the first real test of the arbitration layer. If any subsystem fails to check in, the boot sequence halts with a clear error instead of silently degrading. That behavior has already caught two initialization order bugs that would have been much harder to trace in a fully running system.
              </p>

              <p>
                The module loader was the second piece. Every DeckOS module (dashboard, terminal, file browser, AI assistant) is a separate Python class that registers itself with the loader on startup. The loader handles lifecycle: it loads the module, renders it to its assigned pane, handles the keyboard shortcut that brings it to focus, and unloads it cleanly when the user switches away. Getting this right took most of the week because the lifecycle hooks and the event bus integration need to happen in exactly the right order or you get ghost processes holding hardware handles.
              </p>

              <p>
                The hardware arbitration layer got its skeleton this week too. The rule is simple: nothing that can move a motor, toggle a relay, or write to a file can be called directly from the AI layer. Every hardware action goes through the arbitration layer, which checks the action against the current session permissions before forwarding it. Right now the permissions are all allow-listed manually, but the structure is there for the security work coming in the next few weeks.
              </p>

              <p>
                By Friday, the Pi was booting into the DeckOS shell, loading the system monitor module, and reading live CPU, RAM, and temperature. The dashboard is not pretty yet but it is real. Next week I start on the AI integration.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 2 Week 2 — AI Upgrade + Ollama */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 2, Week 2: Upgrading the AI Layer with Ollama</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>May 8, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                This week was about upgrading the AI capabilities of DeckOS from a simple API call to a real local inference stack. The goal was to have a working three-tier AI system running on the Pi by end of week: cloud Claude for high-reasoning tasks, a local Ollama model for fast command routing, and a deterministic rule engine as a fallback when no model is available. Getting there required more setup work than I anticipated, and I ran into one fundamental hardware constraint that changed my approach.
              </p>

              <p>
                The first thing I did was install Ollama on the Pi and pull a small model for testing. I started with phi3 mini because it is one of the smallest models that can still follow multi-step instructions reliably. On the Pi 4, phi3 mini runs at a usable speed for single-turn commands. Longer reasoning chains are slow, which is exactly why I needed the tier split: Claude handles the heavy lifting when the Pi has a network connection, and Ollama handles everything that needs to be fast and offline.
              </p>

              <p>
                The second thing was setting up a basic training pass. I collected about two hundred example command pairs from my own session logs: short user inputs mapped to the correct DeckOS shell command or module action. I used Ollama's Modelfile format to create a fine-tuned variant of phi3 that is biased toward DeckOS-specific vocabulary. The fine-tune is not dramatic, but it meaningfully reduces the number of times the model outputs generic assistant responses instead of actual shell commands. More training data next week as I log more real sessions.
              </p>

              <p>
                The third thing was wiring the three tiers together in the cognitive loop. The current logic is: if a Claude API key is available, send the request there. If the Pi is offline or the API fails, route to Ollama. If Ollama is not running or times out, fall back to the rule engine, which handles a fixed set of voice-style commands like "open terminal," "show dashboard," and "lock screen." This degradation chain means DeckOS stays functional even in fully air-gapped environments, which is a hard requirement for the field-use case.
              </p>

              <p>
                One hardware constraint I ran into: at high AI inference load, the Pi 4 temperature spiked past the thermal throttle threshold. I tuned the inference thread count down and added a temperature check to the cognitive loop that pauses inference if the sensor reads over 75C. Annoying but manageable. Next week I start the security layer, OpenClaw, which will put hard boundaries around everything the AI tier is allowed to do.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 2 Week 3 — OpenClaw Security */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 2, Week 3: Building Toward OpenClaw Security</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>May 15, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                This week I started the security work in earnest. The AI layer in DeckOS can now route commands, run local inference, and call out to the cloud when available. All of that capability needs a containment model before I can call this system safe enough to use in the field. The framework I am building toward is called OpenClaw: a set of security protocols that sit between the AI inference tier and the hardware arbitration layer and define exactly what the AI is and is not allowed to do.
              </p>

              <p>
                The core problem OpenClaw is solving is this: an LLM, even a locally-run one, can be prompted into producing outputs that look like legitimate DeckOS commands but are actually malicious. Prompt injection through a crafted input, jailbreak attempts through the chat interface, or simply a model hallucination that produces a shell command with unintended side effects. The arbitration layer I built in Week 1 prevents direct hardware calls, but it does not yet validate the semantic intent of a command before forwarding it. OpenClaw closes that gap.
              </p>

              <p>
                This week I laid the groundwork in three areas. First, I built a command schema validator that parses every AI output before it reaches the arbitration layer. If the output does not conform to the registered command schema for the active module, it gets rejected and logged. The AI cannot invent new commands at runtime. Second, I added an intent scoring pass. Before any write operation (file save, config change, network action), the system runs a lightweight classifier on the command and scores its alignment with the user's stated session goal. Commands that score below a threshold are queued for manual confirmation instead of auto-executing. Third, I started the audit log: every command that the AI tier generates, whether it executes or not, is written to an append-only SQLite table with a timestamp, the raw model output, the parsed command, and the execution status.
              </p>

              <p>
                The OpenClaw protocols are not fully implemented yet. Next week I finish the permission scoping system, which lets the user define at session start what modules the AI is allowed to act on. A session started in read-only mode would block the AI from calling any write-side arbitration handlers, regardless of what the model outputs. The goal by end of month two is a demonstrably safe AI interface, one where the worst thing the AI can do is get confused, not break something.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 2 Week 4 — OpenClaw Complete */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 2, Week 4: Closing the Loop on OpenClaw</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>May 22, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                Month two ends this week. The MVP milestone I set back in April was a functional core engine with a safe AI layer, and by Friday I can honestly say that milestone is met. The OpenClaw permission scoping system is done, the audit log is running in production on the Pi, and I spent the final two days stress-testing the AI interface by intentionally trying to break it with adversarial prompts. It held.
              </p>

              <p>
                The permission scoping system works like this: before a user starts a session, they declare an intent scope. Right now the three scopes are READ (AI can query state and display information, nothing else), EXECUTE (AI can run pre-approved module commands), and ADMIN (AI can write configs and call arbitration handlers). Each scope is a whitelist of arbitration handler IDs. If the AI output resolves to a handler that is not on the whitelist for the active scope, the call is rejected at the arbitration boundary and the rejection is logged. The AI is never told why a command failed, it just sees a generic "action unavailable" response. This prevents the model from learning the exact permission boundaries through trial and error.
              </p>

              <p>
                The stress test results were better than I expected in most areas and humbling in one. Every injection attempt I could think of was caught cleanly. Commands that looked like valid DeckOS syntax but targeted handlers outside the active scope were blocked. Hallucinated commands (the model inventing handler names that do not exist) hit the schema validator and never reached arbitration. The one area that surprised me was the intent classifier. On two occasions with carefully constructed prompts, the classifier scored a write operation as low-risk and it executed without the manual confirmation step. I tightened the threshold and both cases now queue for confirmation, but it is a reminder that the classifier is the softest part of the security model.
              </p>

              <p>
                With the software security layer in a stable state, I can start thinking about the next major milestone: physical expansion. Month three is about Alpha features — network tools, the file explorer, and the first hardware peripherals beyond the Pi and the screen. I have been looking at projectors and GPIO-connected devices as the first real IoT surface for DeckOS. Next week I start laying the groundwork for that, and the architecture will need to grow to match it.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 3 Week 1 — Alpha Begins */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 3, Week 1: Alpha Begins — Network Tools and the Hardware Surface Expands</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>May 29, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                Month three is the Alpha tier, which on the Jira board means network tools, the file explorer, and the first real hardware expansion beyond the core Pi setup. This week I shipped the network scanner module and started pulling the pieces together for what I am calling the physical integration sprint: getting DeckOS to talk to devices in the room, not just components inside the chassis.
              </p>

              <p>
                The network scanner was the cleanest module I have written so far. It uses Python's scapy and nmap bindings to run a local subnet sweep on demand, display discovered hosts with their MAC addresses and open ports, and flag anything that changed since the last scan. The whole thing renders in the MAIN pane with a live count and scrollable host list. Keyboard shortcut to trigger a scan, another to drill into a host. It fits the DeckOS interaction model exactly and it took about two days to go from nothing to stable. The architecture work from month one is starting to pay off in exactly the way I hoped.
              </p>

              <p>
                The bigger shift this week was starting to think seriously about the hardware expansion. Up until now DeckOS has been a self-contained system: one Pi, one screen, one keyboard. But the Alpha spec I wrote back in week three includes peripheral support, and the first peripherals I am targeting are a projector (for presenting from the deck directly) and a set of GPIO-connected sensors that would make DeckOS a first-class IoT hub. This is where the project gets genuinely interesting to me as an engineering problem, because IoT integration forces the arbitration layer to handle a whole new class of devices, and the security model has to extend outward into the physical world.
              </p>

              <p>
                I spent Thursday and Friday doing hardware research and component ordering. The projector integration will likely go over HDMI with a software mirror mode built into the display module. The GPIO sensors are more involved: I need to extend the arbitration layer to register physical devices as first-class actors, define read and write permissions for each pin, and make sure the AI tier cannot toggle a relay or drive a motor without an explicit user confirmation regardless of what model is running. The groundwork for that work starts next week, and I expect it to surface some interesting design questions about how DeckOS thinks about physical versus virtual state.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 3 Week 2 — Physical Integration */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 3, Week 2: Plugging Into the Physical World</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>June 5, 2026</span>
                <span>•</span>
                <span>5 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                This week DeckOS stopped being a closed box and started talking to the room around it. I got the projector working as a DeckOS output device, wired the first GPIO sensors into the arbitration layer, and laid the foundation for what is going to become the IoT hub module. It was the most physically hands-on week of the project so far, and it exposed some real gaps in the architecture that I had not anticipated when this was purely a software problem.
              </p>

              <p>
                The projector integration was the first thing I tackled and it turned out to be both simpler and trickier than I expected. Simple because the Pi's HDMI output already handles dual-display; I just needed DeckOS to detect a second display at boot and offer a mirror or extend mode from the display module. Tricky because the projector I am working with introduces about 40ms of extra latency on the HDMI signal, which makes the DeckOS status bar clock and some of the animation timings look slightly off when you are watching the projected output while also looking at the primary screen. I ended up adding a display profile flag to the config that disables frame animations when a projector is detected. The projected output is now a clean, no-flicker view of whatever module is in the MAIN pane. Presenting directly from the deck works.
              </p>

              <p>
                The GPIO work was the more technically interesting problem. I registered four physical pins in the arbitration layer as named devices: a temperature and humidity sensor on a DHT22, an LED indicator strip, a piezo buzzer, and a passive infrared motion sensor. Each one gets its own handler ID, a declared type (INPUT or OUTPUT), and a permission level. The DHT22 and the PIR sensor are INPUT devices, which means the AI tier can read their state in any session scope. The LED strip and the buzzer are OUTPUT devices, which means they sit behind the EXECUTE permission scope and require a confirmed user intent before the AI can trigger them.
              </p>

              <p>
                Wiring this up forced me to make a design decision I had been deferring: how does DeckOS represent physical state in its internal data model? Virtual state (which module is active, what the user typed, what the AI output was) has a clean answer — it lives in SQLite. Physical state is trickier because a sensor reading is continuous and stale the moment it is written, and an output device has a real-world side effect that cannot be rolled back if the user changes their mind. I ended up adding a PhysicalDevice table to the database with last-read value, timestamp, and a dirty flag that marks whenever the stored value is more than 30 seconds old. The AI tier always sees the cached value with a freshness indicator, not a live poll. This keeps the cognitive loop from hammering the GPIO bus on every inference call and makes the data model honest about what it actually knows.
              </p>

              <p>
                By end of week, DeckOS is projecting onto a wall, reading ambient temperature, and lighting up an LED strip when the motion sensor trips. None of this is polished yet, but all of it is working through the same arbitration and permission model that governs the purely software modules. The IoT surface is now part of the same architecture, not bolted on the side. Next week I formalize the IoT hub module UI and start thinking about how to expose device state to the user in a way that fits the DeckOS interaction model.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 3 Week 3 — Full IoT Device Week */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 3, Week 3: We Built Hardware All Week</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>June 14, 2026</span>
                <span>•</span>
                <span>5 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                This was a zero-code week. No Python, no TypeScript, no commits to the DeckOS repo. Just hardware on the table from Monday to Saturday. We built and wired IoT devices from scratch, tested everything that touched the Pi, and by the end of the week the physical surface of DeckOS had grown from four GPIO pins to something that actually looks like a system.
              </p>

              <p>
                The neuroscience kit was the first thing we got into. I have been reading about BioAmp hardware for months and this week we actually got electrodes on skin and watched the signal come in live. The kit reads EMG from muscle surface and EEG from forehead placement depending on how you set up the electrodes. We ran both. The EMG signal off the forearm is clean enough that you can see individual muscle contractions as distinct spikes. The EEG signal is noisier but the alpha rhythm shows up clearly when you close your eyes and relax. Getting this to talk to the Pi required setting up a serial read loop that pulls ADC samples at around 500 Hz and feeds them into a ring buffer. The processing side of that is now sitting in the DeckOS signal library waiting for the UI layer to catch up with it.
              </p>

              <p>
                Range and distance sensors were next. We tested both HC-SR04 ultrasonic and a VL53L0X time-of-flight sensor. The ultrasonic is simpler to wire and good enough for room-scale detection, roughly accurate to a couple centimeters at distances up to two or three meters. The ToF sensor is more precise and way faster at close range but has a narrower field of view. We ended up registering both in the arbitration layer as separate INPUT devices so DeckOS can pick the right one depending on what the active module needs. The ultrasonic handles broad presence detection. The ToF handles precise close-range measurement. They serve different use cases and both are now live.
              </p>

              <p>
                The projector work this week went deeper than last week. Last week I got mirror mode working. This week we actually ran a full presentation session with DeckOS as the source, projecting the main pane onto a wall while using the 7-inch screen as the control surface. That workflow actually holds up. The display profile flag I added last week did its job and the output was clean. The more interesting thing we discovered is that the projector can act as a secondary output for IoT device dashboards, showing live sensor readings in a room without anyone needing to look at the cyberdeck directly. That is a use case I had not thought about before this week and it opens up some interesting directions for the IoT hub UI.
              </p>

              <p>
                Cameras were the fourth thing we wired up. We tested a standard Pi Camera Module V2 and a USB webcam. The Pi camera connects over the CSI ribbon cable and shows up as a V4L2 device once you enable it in raspi-config. The USB webcam is plug and play. Both feed into OpenCV running on the Pi without much setup. We did a basic motion detection pass using frame differencing and got it publishing motion events to the DeckOS event bus within a couple hours. The interesting part is that camera output and PIR output now both generate the same event type on the bus, so any module listening for a motion event does not need to know whether the trigger came from a sensor or a camera. The arbitration layer just routes it the same way.
              </p>

              <p>
                Controllers were the last thing on the list. We tested a standard USB gamepad and a Bluetooth controller connecting to the Pi. The gamepad shows up as a joystick device and Python's inputs library reads it without any driver work. We mapped the buttons to DeckOS module navigation shortcuts so you can flip between modules without touching the keyboard. It works and it is genuinely more comfortable than F-key navigation when the deck is sitting on a table across from you. The Bluetooth controller took longer to pair and had some latency that made it feel wrong for anything real-time, so for now the USB gamepad is the one we are actually keeping in the setup.
              </p>

              <p>
                By Saturday we had seven physical devices registered in the arbitration layer and talking to DeckOS: the BioAmp neuroscience kit, HC-SR04, VL53L0X, Pi Camera, USB webcam, LED strip, and gamepad. The piezo buzzer and DHT22 from last week are still active too. None of the UI for this is done yet. The IoT hub module is still a placeholder pane. But the data is flowing, the arbitration layer is handling it, and the architecture is proving out the way I designed it. Everything talks to DeckOS the same way regardless of what the physical device actually is. That is the thing I wanted to prove this month and this week proved it.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 3 Week 4 — UI Simplification */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 3, Week 4: Making It Less Overwhelming</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>June 21, 2026</span>
                <span>•</span>
                <span>4 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                We have been so deep in building that we forgot to check whether any of it was actually usable by someone who was not the person who built it. This week I sat down and went through DeckOS from the perspective of a first-time user and the honest answer was that it was a lot. Too many panes visible at once, too many options without context, and no clear sense of where to start. The system worked fine technically but the experience of using it was exhausting. That is the problem this week was about fixing.
              </p>

              <p>
                The first thing I changed was the default view. Before this week, DeckOS booted into a five-pane layout that showed everything simultaneously. Status bar, navigation column, main content area, side actions panel, and terminal all visible at once. For me that is readable because I built every part of it and I know what each thing does. For anyone else it reads as noise. The fix was a simplified boot mode that starts with just the status bar and the main pane active. The nav column collapses to icon-only by default and the side panel and terminal are hidden until the user explicitly opens them. Same functionality, just not thrown at you all at once.
              </p>

              <p>
                The second change was to the module navigation. The old F-key system still works but we added a home screen with a simple card grid that shows each module by name with a one-line description of what it does. If you have never used DeckOS before you can now open it, read six cards, and immediately understand what your options are. Experienced users can still hit F1 through F5 and skip the home screen entirely. Both paths coexist and neither breaks the other.
              </p>

              <p>
                The third change was to how IoT device state gets surfaced. Last week we had seven devices registered and all of their readings were flooding into the same data stream with no filtering. This week we added a device context layer that groups readings by device and only surfaces the ones relevant to the active module. If you are in the terminal module you do not see DHT22 temperature readings unless you ask for them. If you are in the IoT hub module you see everything. The system routes information based on context instead of broadcasting everything everywhere all the time.
              </p>

              <p>
                The reason all of this matters right now is that next month we redeploy the server with all the build changes reflected in it. The server has been updated to handle everything we built over the last six weeks including the GPIO device registry, the physical device data model, the updated arbitration layer, and the OpenClaw permission scoping. When that redeployment happens we need to be able to hand the system to testers who were not in the room when we built it. A cleaner UI is not just a nice-to-have at that point, it is the difference between useful feedback and people giving up after two minutes. This week was about making sure we are ready for that.
              </p>
            </div>
          </article>
        </section>

        {/* Blog Post: Month 3 Week 5 — Full IoT Integration */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Month 3, Week 5: Everything Is Talking to Everything</h2>
              <div className="flex gap-4 text-sm text-muted-foreground font-mono">
                <span>June 28, 2026</span>
                <span>•</span>
                <span>5 min read</span>
                <span>•</span>
                <span className="text-secondary">By Devin C. Roberts</span>
              </div>
            </div>

            <div className="font-sans text-lg leading-relaxed text-foreground/90 space-y-6">
              <p>
                This is the week I have been building toward since April. Every device on the table is connected, every signal is flowing into DeckOS, and for the first time the whole system is running together as one thing instead of a collection of separate parts I have been testing in isolation. Raspberry Pi, projector, Arduino, IR sensors, and EEG are all live and reading each other. This is the end of Month 3 and the picture looks like what I drew in that first architecture doc.
              </p>

              <p>
                The Raspberry Pi is the center of everything as planned. It is running DeckOS, hosting the event bus, managing the arbitration layer, and handling inference routing. Everything else connects to it or through it. What changed this week is that we stopped testing each device one at a time and started running all of them simultaneously. The Pi handled it without thermal throttling, which was a real question mark going into the week. The temperature peaked at 68 degrees Celsius under full load with the EEG signal processing running alongside GPIO polling, camera feed, and Ollama inference. That is inside the safe range and the thermal check I added back in Month 2 never triggered.
              </p>

              <p>
                The projector is fully integrated as a second output surface. The display module now auto-detects it at boot and switches to the projector display profile automatically. We ran a live demo session this week where the projector was showing the IoT hub module with real-time sensor readings while the 7-inch screen was used to issue commands. That split was exactly the use case I imagined when I first thought about adding projector support. It held up in real use.
              </p>

              <p>
                The Arduino is handling fast hardware tasks that the Pi should not be doing directly. It reads the IR sensors at high frequency and sends processed events to the Pi over serial rather than raw ADC samples. This keeps the Pi's event bus from getting flooded with low-level sensor data and puts the signal processing where it belongs, close to the hardware. The IR sensors are now tracking presence and proximity in the room and feeding that context into the DeckOS active session. When someone moves into range the system knows it without anyone pressing a button.
              </p>

              <p>
                The EEG integration is the piece I am most proud of this week. The BioAmp hardware is reading from forehead electrodes, the signal is getting processed through the StarkProcessor pipeline, and the classified brain state is now part of the DeckOS session context. Alpha state, focus state, and blink events are all being logged in real time. We ran a test where the EEG state was used to automatically adjust the DeckOS display brightness and notification verbosity based on whether the user was in a focused or relaxed state. It worked. The system responded to brain state without any manual input. That is the thing I wrote in the design doc as a stretch goal and we actually shipped it.
              </p>

              <p>
                Testing starts next month. The server has been updated to reflect everything from the last three months of build work and we are ready to put real users on this. The architecture held up, the hardware is integrated, and the UI changes from last week make it approachable enough to hand to someone who was not in the room when we built it. Month 4 is about finding out what breaks when someone else uses it.
              </p>
            </div>
          </article>
        </section>

        {/* Roadmap */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
          <h2 className="text-3xl font-bold mb-12">Deployment Timeline</h2>
          
          <div className="flex flex-col gap-2">
            {[
              { tier: "MVP", time: "Month 2", desc: "Core engine, UI shell, hardware arbitration.", color: "border-primary text-primary", hoverStyle: { backgroundColor: "hsl(var(--primary) / 0.05)" } },
              { tier: "Alpha", time: "Month 3", desc: "Network tools, dashboard, file explorer.", color: "border-secondary text-secondary", hoverStyle: { backgroundColor: "hsl(var(--secondary) / 0.05)" } },
              { tier: "Beta", time: "Month 4", desc: "Offline AI integration, full hardware mapping.", color: "border-accent text-accent", hoverStyle: { backgroundColor: "hsl(var(--accent) / 0.05)" } },
              { tier: "v2.0", time: "Post-grad", desc: "Neural link optimization, custom PCB.", color: "border-destructive text-destructive", hoverStyle: { backgroundColor: "hsl(var(--destructive) / 0.05)" } }
            ].map((phase, i) => (
              <HoverRow key={i} hoverStyle={phase.hoverStyle}>
                <div className={`font-bold w-24 ${phase.color}`}>
                  [{phase.tier}]
                </div>
                <div className="text-muted-foreground w-32 font-bold text-sm">
                  {phase.time}
                </div>
                <div className="flex-1 font-sans text-foreground/80 group-hover:text-foreground transition-colors">
                  {phase.desc}
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground opacity-0 group-hover:opacity-100 transition-all transform -translate-x-4 group-hover:translate-x-0" />
              </HoverRow>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-card py-8 px-6 md:px-12 lg:px-24">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-col gap-1">
            <span className="font-bold text-foreground">Devin C. Roberts, CPMAI</span>
            <span className="text-muted-foreground text-sm">dcroberts1@student.fullsail.edu</span>
          </div>
          <div className="text-xs text-muted-foreground opacity-50 hover:opacity-100 hover:text-primary transition-colors flex items-center gap-2 cursor-default">
            <Terminal className="w-3 h-3" /> / posted from the deck
          </div>
        </div>
      </footer>
    </div>
  );
}
