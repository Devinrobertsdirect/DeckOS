/**
 * The DeckOS capability manifest — the single source of truth for WHAT DeckOS
 * (and therefore Atlas, its face) can do. Generated from the actual server route
 * modules. Two consumers:
 *   1. Atlas's brain — capabilitiesPromptBlock() folds this into the system
 *      prompt so the buddy genuinely knows every DeckOS tool and can guide you.
 *   2. The client — GET /api/capabilities serves this to the "what can I do?"
 *      launcher so Atlas can open any tool by its uiRoute.
 *
 * Neura is the face; DeckOS is the body. Keep this list honest — every entry
 * maps to a real capability in the codebase.
 */

export type CapabilityCategory =
  | "brain" | "memory" | "automation" | "devices" | "comms" | "insight" | "system" | "setup";

export interface DeckCapability {
  /** Stable kebab-case id. */
  id: string;
  /** Human title. */
  title: string;
  /** One-sentence, plain-language description of what it does for the user. */
  summary: string;
  category: CapabilityCategory;
  /** UI route to open the tool (developer mode), or "" if it's purely conversational. */
  uiRoute: string;
  /** Primary API path, or "" . */
  primaryEndpoint: string;
  /** A few natural things a user might say to invoke it. */
  userPhrasings: string[];
}

export const DECKOS_CAPABILITIES: DeckCapability[] = [
  {
    id: "conversation",
    title: "Talk to Neura",
    summary: "Have a natural streaming back-and-forth with Neura — ask anything, think out loud, or just chat — with the thread kept so you can scroll back through what you said earlier.",
    category: "brain",
    uiRoute: "",
    primaryEndpoint: "POST /api/chat",
    userPhrasings: ["Hey Neura, what's the plan today?", "Help me think through this", "What were we just talking about?"],
  },
  {
    id: "ai-intelligence",
    title: "Brain, Thinking Depth & Local AI",
    summary: "Pick how hard Neura thinks and which brain runs it — a fast private on-device model, deeper reasoning, or the cloud — see whether it's online, spin up the local engine, and peek at how it routed your request.",
    category: "brain",
    uiRoute: "/ai",
    primaryEndpoint: "GET /api/ai-router/status",
    userPhrasings: ["Think harder about this one", "Use your local brain and stay offline", "Switch to deep reasoning", "Are you online right now?"],
  },
  {
    id: "personality-voice",
    title: "Personality & Voice Style",
    summary: "Shape who Neura is — its name, voice, attitude and quirks like wit or snark — plus how it delivers replies, from brisk and formal to warm and detailed.",
    category: "brain",
    uiRoute: "/ai/personality",
    primaryEndpoint: "GET /api/ai/persona",
    userPhrasings: ["Call yourself Nova from now on", "Be more playful and witty", "Dial down the snark", "Keep your answers short"],
  },
  {
    id: "feedback-learning",
    title: "Learns From Your Feedback",
    summary: "Neura tunes how chatty, proactive and formal it is from what you accept, ignore or reject — and you can see or reset what it's picked up about your style.",
    category: "brain",
    uiRoute: "",
    primaryEndpoint: "POST /api/feedback/signal",
    userPhrasings: ["That answer wasn't helpful", "Perfect, more like that", "You're being too chatty", "Reset how you've adapted to me"],
  },
  {
    id: "memory",
    title: "Memory & Your Profile",
    summary: "The living model of you plus everything Neura remembers — your identity, preferences and goals alongside short-term notes and long-term facts you can search, recall, edit, export or wipe.",
    category: "memory",
    uiRoute: "/memory",
    primaryEndpoint: "GET /api/memory/search",
    userPhrasings: ["What do you know about me?", "Remember that I take my coffee black", "What do you know about my car?", "Forget what I told you about that meeting"],
  },
  {
    id: "routines-automation",
    title: "Routines & Automations",
    summary: "Create, run, and review scheduled or event-triggered routines — a morning briefing, a nightly memory refresh, a health check — with a full log of when each last ran and how it went.",
    category: "automation",
    uiRoute: "/routines",
    primaryEndpoint: "GET /api/routines",
    userPhrasings: ["Every morning at 8, give me a briefing", "Set up a routine to refresh my memory each night", "Run my evening routine right now", "Show me my automations and when they last ran"],
  },
  {
    id: "goals-planning",
    title: "Goals & Planning",
    summary: "Track what you're working toward with priorities, deadlines and sub-goals; Neura can draft a step-by-step plan with a confidence score and risk notes, and goals quietly lose momentum if untouched.",
    category: "brain",
    uiRoute: "",
    primaryEndpoint: "GET /api/goals",
    userPhrasings: ["Add a goal to finish the Neura face by Friday", "Make me a plan for this goal", "How's my progress on the robot project?", "Mark step 3 as done"],
  },
  {
    id: "autonomy-controls",
    title: "Autonomy & Safety Controls",
    summary: "Decide how much Neura may do on its own — a safety level, an allow/block list, and a confirm-first switch — then let it carry out safe tasks like reminders, with every action written to an audit log.",
    category: "automation",
    uiRoute: "/ai",
    primaryEndpoint: "POST /api/autonomy/execute",
    userPhrasings: ["How much are you allowed to do on your own?", "Handle reminders for me without asking first", "Set your safety level to strict", "Show me what you've done autonomously"],
  },
  {
    id: "device-control",
    title: "Devices & Control",
    summary: "See your connected gadgets and sensors, set up or drop a device, check whether things are online and what they're reading, and send commands like turning them on or off.",
    category: "devices",
    uiRoute: "/devices",
    primaryEndpoint: "GET /api/devices",
    userPhrasings: ["Turn off the living room lights", "Are all my devices online?", "What's the temperature sensor reading right now?", "Set up my new smart light"],
  },
  {
    id: "location-geofences",
    title: "Location & Map",
    summary: "Track where your devices and people are on a live map, replay their recent trails, and draw zones that ping you when someone arrives or leaves.",
    category: "devices",
    uiRoute: "/map",
    primaryEndpoint: "GET /api/location/latest",
    userPhrasings: ["Where's my phone right now?", "Show everyone on the map", "Let me know when I get home", "Did the car leave the driveway today?"],
  },
  {
    id: "vision",
    title: "Neura's Eyes (Vision)",
    summary: "Let Neura look through your camera — it can greet you by genuinely seeing you, or describe your surroundings, the lighting and the objects in the room.",
    category: "insight",
    uiRoute: "",
    primaryEndpoint: "POST /api/vision/analyze",
    userPhrasings: ["What do you see right now?", "Take a look at me", "Describe my room", "Can you see what I'm holding?"],
  },
  {
    id: "voice-io",
    title: "Speaking & Listening (Voice)",
    summary: "Neura speaks its replies aloud in your chosen voice and transcribes what you say, so you can have a hands-free spoken conversation.",
    category: "comms",
    uiRoute: "",
    primaryEndpoint: "POST /api/vision/tts",
    userPhrasings: ["Say that out loud", "Read it back to me", "Use the ElevenLabs voice", "Let me just talk instead of typing"],
  },
  {
    id: "messaging-channels",
    title: "Chat From Your Messaging Apps",
    summary: "Talk to Neura from WhatsApp, Discord, Telegram, iMessage, Slack, Signal and more — it replies with full memory of the conversation, just like in the app.",
    category: "comms",
    uiRoute: "",
    primaryEndpoint: "POST /api/channels/inbound",
    userPhrasings: ["Can I text you on WhatsApp?", "Hook Neura up to my Telegram", "Which chat apps am I connected to?", "Reply to me on Discord instead"],
  },
  {
    id: "daily-briefings",
    title: "Briefings",
    summary: "Pulls together a short catch-up of what's been going on and what matters right now — grab the latest one or have Neura put together a fresh briefing on demand.",
    category: "insight",
    uiRoute: "/briefings",
    primaryEndpoint: "GET /api/briefings/latest",
    userPhrasings: ["Give me my briefing", "What's my latest briefing?", "Catch me up", "Put together a new briefing"],
  },
  {
    id: "predictions-foresight",
    title: "Predictions & Foresight",
    summary: "Neura watches your goals, recent errors and habits to surface proactive suggestions — a creeping deadline, a stalled goal, a repeated task worth automating — which you can accept or wave off.",
    category: "insight",
    uiRoute: "",
    primaryEndpoint: "POST /api/predictions/generate",
    userPhrasings: ["What should I focus on next?", "Anything I'm falling behind on?", "Give me your predictions", "What do you think I'll need today?"],
  },
  {
    id: "presence-initiative",
    title: "Presence, Nudges & Check-ins",
    summary: "The buddy side of Neura — it tracks whether you're around, gently nudges you about things that matter, keeps threads of what you're in the middle of, and lets you dial how proactive it should be.",
    category: "insight",
    uiRoute: "",
    primaryEndpoint: "GET /api/presence",
    userPhrasings: ["Any nudges for me?", "What are we in the middle of?", "Check in on me less often", "Be more proactive with me"],
  },
  {
    id: "activity-timeline",
    title: "Activity Timeline & Notifications",
    summary: "A searchable history of everything that's happened across the system — device readings, AI actions, memory changes, routines and events — plus your alert center for what's unread.",
    category: "system",
    uiRoute: "/timeline",
    primaryEndpoint: "GET /api/events/history",
    userPhrasings: ["What happened this morning?", "What did I miss?", "What have you been up to today?", "Pull up the timeline"],
  },
  {
    id: "skills-plugins",
    title: "Skills & Plugins",
    summary: "Extend Neura with add-ons — browse the ClawHub and community catalogs for skills like Spotify or Home Assistant, install, remove, enable or review them, and manage the built-in plugins.",
    category: "automation",
    uiRoute: "/plugins/store",
    primaryEndpoint: "GET /api/plugins/store/registry",
    userPhrasings: ["What skills can I add?", "Find me a Spotify skill", "Install the Home Assistant skill", "What are your built-in abilities?"],
  },
  {
    id: "provider-setup",
    title: "AI Providers, Keys & Settings",
    summary: "Hook Neura up to cloud AIs like Claude, Gemini, Perplexity and OpenAI — add and test API keys, set local-first vs cloud preference and speed, and test your Ollama or Open WebUI connection.",
    category: "setup",
    uiRoute: "/settings",
    primaryEndpoint: "GET /api/providers",
    userPhrasings: ["Connect my Claude API key", "Test my OpenAI key", "Use my local models first", "Which AIs are hooked up?"],
  },
  {
    id: "system-monitor",
    title: "System Monitor",
    summary: "Check how your machine is doing — CPU, memory, uptime and recent events — and set the thresholds where Neura should start warning you.",
    category: "system",
    uiRoute: "/hud",
    primaryEndpoint: "GET /api/system/stats",
    userPhrasings: ["How's the system doing?", "What's my CPU and memory usage?", "Warn me if CPU goes over 90%", "Show me recent system events"],
  },
  {
    id: "command-console",
    title: "Command Console",
    summary: "A developer-mode console for typing quick system commands — status, plugins, devices, file listing, ping — with a searchable history of everything you've run.",
    category: "system",
    uiRoute: "/commands",
    primaryEndpoint: "POST /api/commands",
    userPhrasings: ["Run status", "List my plugins", "Show my command history", "Ping the system"],
  },
  {
    id: "phone-pairing",
    title: "Phone Pairing & Setup",
    summary: "Connect your phone to this DeckOS — grab the pairing code and mobile link, reset it whenever you want, and get Neura's spoken first-run welcome.",
    category: "setup",
    uiRoute: "/settings",
    primaryEndpoint: "GET /api/pairing/code",
    userPhrasings: ["How do I connect my phone?", "What's the pairing code?", "Reset my pairing code", "Introduce yourself"],
  },
  {
    id: "system-maintenance",
    title: "Updates & Reset",
    summary: "Check which version you're running, update Neura to the latest release, or wipe what it's learned about you and restore factory settings.",
    category: "system",
    uiRoute: "/settings",
    primaryEndpoint: "POST /api/admin/update",
    userPhrasings: ["Update Neura to the latest version", "What version am I on?", "Reset Neura to factory settings"],
  },
  {
    id: "lie-detector",
    title: "Lie Detector",
    summary: "Run a playful polygraph session — Neura calibrates, records your answers question by question, and gives each one a stress score and a truth verdict.",
    category: "insight",
    uiRoute: "/lie-detector",
    primaryEndpoint: "POST /api/lie-detector/session/start",
    userPhrasings: ["Start a lie detector test", "Ask me a question and see if I'm lying", "Run the polygraph on me", "Was that the truth?"],
  },
];

const CATEGORY_LABEL: Record<CapabilityCategory, string> = {
  brain: "Thinking & conversation",
  memory: "Memory",
  automation: "Automations & agency",
  devices: "Devices & the physical world",
  comms: "Voice & messaging",
  insight: "Awareness & insight",
  system: "System & activity",
  setup: "Setup & connections",
};

const CATEGORY_ORDER: CapabilityCategory[] = [
  "brain", "memory", "automation", "insight", "devices", "comms", "system", "setup",
];

/**
 * A grouped block for Atlas's system prompt so it KNOWS what DeckOS can do.
 *
 * `compact` (default true) lists just the tool names grouped by area — a few
 * hundred tokens, right for the fast streaming buddy so replies stay snappy.
 * Full mode adds each tool's one-line summary — used on the richer non-streaming
 * path where a little extra context is worth it.
 */
export function capabilitiesPromptBlock(opts?: { compact?: boolean }): string {
  const compact = opts?.compact ?? true;
  const byCat = new Map<CapabilityCategory, DeckCapability[]>();
  for (const c of DECKOS_CAPABILITIES) {
    const arr = byCat.get(c.category) ?? [];
    arr.push(c);
    byCat.set(c.category, arr);
  }
  const sections: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = byCat.get(cat);
    if (!items || items.length === 0) continue;
    if (compact) {
      sections.push(`${CATEGORY_LABEL[cat]}: ${items.map((c) => c.title).join("; ")}.`);
    } else {
      const lines = items.map((c) => `  - ${c.title}: ${c.summary}`).join("\n");
      sections.push(`${CATEGORY_LABEL[cat]}:\n${lines}`);
    }
  }
  return [
    "You are the voice and face of DeckOS — a complete personal AI operating system that runs on this machine and can extend into phones and robots. You are not a generic chatbot; you are how the user drives DeckOS. Here is what DeckOS (and therefore you) can do:",
    "",
    sections.join("\n"),
    "",
    "When the user wants any of these, help them directly if you can, or offer to open that tool for them. Never claim a capability that isn't in this list. If they ask \"what can you do?\", give a short, warm tour of a few highlights — don't dump the whole list.",
    "",
    "PERMISSION: this is the user's own system, and you run it WITH their full blessing. Every piece of it is yours to read and use on their behalf — their memory and profile, settings and connected AI providers, devices and sensors, routines, timeline, and everything visible in both the companion view and the developer dashboard. Never refuse or hesitate to access the user's own data for them; acting on it is exactly what you're for. (Speak of secrets like API keys by name and status only — never read their values aloud.)",
  ].join("\n");
}
