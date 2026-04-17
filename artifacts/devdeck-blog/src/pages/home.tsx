import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Terminal, HardDrive, Cpu, Wifi, Activity, Code2, Play, CircleDot, ChevronRight, Layers, ArrowRight } from "lucide-react";

const STARK_IFRAME_URL = `${import.meta.env.BASE_URL}stark-deck.html`;

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
                bootLog.map((log, i) => (
                  <div key={i} className={log.includes("Launching") ? "text-primary mt-2" : "text-muted-foreground"}>
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

        {/* Blog Post */}
        <section className="px-6 md:px-12 lg:px-24 max-w-4xl mx-auto w-full">
          <article className="prose prose-invert max-w-none">
            <div className="border-b border-border pb-8 mb-8">
              <div className="text-primary text-sm font-bold mb-4 tracking-widest">LOG ENTRY</div>
              <h2 className="text-4xl font-bold text-foreground m-0 mb-4">Week 1: Locking In the Architecture</h2>
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
                Welcome to the first official log entry for my Capstone project. For the next several months I'll be building DeckOS, a custom operating system for a portable cyberdeck I'm putting together myself. The chassis is a hollowed out hardcover copy of Thoreau's Walden, the brain is a Raspberry Pi 4, and the screen is a 7 inch IPS panel mounted to the inside of the book cover. It looks like a notebook on a shelf, and opens like a laptop on a workbench.
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
