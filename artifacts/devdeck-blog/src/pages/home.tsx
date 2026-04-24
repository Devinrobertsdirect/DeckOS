import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Terminal, HardDrive, Cpu, Wifi, Activity, Code2, Play, CircleDot, ChevronRight, Layers, ArrowRight } from "lucide-react";

const STARK_IFRAME_URL = `${import.meta.env.BASE_URL}stark-deck.html`;
const WIREFRAME_IFRAME_URL = `${import.meta.env.BASE_URL}wireframe-3d.html`;

export default function Home() {
  const [bootLog, setBootLog] = useState<string[]>([]);
  const [bootComplete, setBootComplete] = useState(false);

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
      {/* Persistant Status Bar */}
      <div className="fixed top-0 left-0 right-0 h-8 border-b border-border bg-card/80 backdrop-blur-md z-40 flex items-center px-4 text-xs font-mono text-muted-foreground justify-between">
        <div className="flex items-center gap-4">
          <span className="text-primary font-bold">[DECKOS]</span>
          <span className="hidden sm:inline">CPU: 12%</span>
          <span className="hidden sm:inline">RAM: 1.4GB</span>
          <span className="hidden sm:inline">TEMP: 42°C</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Wifi className="w-3 h-3 text-secondary" /> ONLINE</span>
          <span>{new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
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
                src="/cyberdeck-hero.png" 
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

        {/* Roadmap */}
        <section className="px-6 md:px-12 lg:px-24 max-w-7xl mx-auto w-full">
          <h2 className="text-3xl font-bold mb-12">Deployment Timeline</h2>
          
          <div className="flex flex-col gap-2">
            {[
              { tier: "MVP", time: "Month 2", desc: "Core engine, UI shell, hardware arbitration.", color: "border-primary text-primary", bg: "bg-primary/5" },
              { tier: "Alpha", time: "Month 3", desc: "Network tools, dashboard, file explorer.", color: "border-secondary text-secondary", bg: "bg-secondary/5" },
              { tier: "Beta", time: "Month 4", desc: "Offline AI integration, full hardware mapping.", color: "border-accent text-accent", bg: "bg-accent/5" },
              { tier: "v2.0", time: "Post-grad", desc: "Neural link optimization, custom PCB.", color: "border-destructive text-destructive", bg: "bg-destructive/5" }
            ].map((phase, i) => (
              <div key={i} className={`border border-border p-4 flex flex-col md:flex-row md:items-center gap-4 hover:${phase.bg} transition-colors group cursor-default`}>
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
              </div>
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
