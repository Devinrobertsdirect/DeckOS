/**
 * skills.ts — Atlas's hands.
 *
 * The buddy already KNOWS what DeckOS can do; skills let it actually DO it.
 * Each skill is a deterministic matcher + executor, so "drive forward", "remember
 * that…", "open my memory", "are you online?" turn into real actions — reliably,
 * even on a small local model, with zero LLM round-trip. If nothing matches, the
 * caller falls back to normal conversation.
 *
 * Server-side actions (drive the body, read status) run here; client-side
 * actions (open a tool, store a fact) are returned as a `ui` instruction for the
 * buddy to carry out. Everything a skill says is plain words — the face still
 * shows the emotion, never emoji.
 */
import { getBody } from "./body.js";
import { getInferenceState } from "./inference.js";

export type UiAction =
  | { type: "open"; route: string }
  | { type: "remember"; fact: string }
  | { type: "none" };

export interface AgentDecision {
  mode: "action" | "chat";
  skill?: string;
  speak?: string;
  ui?: UiAction;
}

interface SkillCtx {
  raw: string;
  lower: string;
  facts: string[];
}
interface SkillResult { speak: string; ui?: UiAction }
interface Skill {
  id: string;
  handle(ctx: SkillCtx): Promise<SkillResult | null> | (SkillResult | null);
}

// ── Body motion ───────────────────────────────────────────────────────────────
let driveTimer: ReturnType<typeof setTimeout> | null = null;
async function nudge(lin: number, ang: number, ms: number): Promise<void> {
  const body = await getBody();
  if (driveTimer) clearTimeout(driveTimer);
  body.driveVelocity(lin, ang);
  driveTimer = setTimeout(() => { void getBody().then((b) => b.halt()); }, ms);
}

const stopSkill: Skill = {
  id: "stop",
  async handle({ lower }) {
    if (/^\s*(stop|halt|freeze|whoa|hold (on|up)|that'?s enough|stop (moving|driving|going))\b/.test(lower)) {
      const body = await getBody();
      if (driveTimer) { clearTimeout(driveTimer); driveTimer = null; }
      body.halt();
      return { speak: "Stopping." };
    }
    return null;
  },
};

const driveSkill: Skill = {
  id: "drive",
  async handle({ lower }) {
    // Direction + a gentle default speed; each command is a short, safe nudge.
    const isMove = /\b(go|drive|move|roll|come|scoot|head)\b/.test(lower) ||
      /\b(forward|backward|backwards|ahead|reverse|closer)\b/.test(lower) ||
      /\bturn\b/.test(lower) || /\bcome (here|closer|to me)\b/.test(lower);
    if (!isMove) return null;

    const slow = /\b(a little|slightly|a bit|slowly|slow|carefully)\b/.test(lower);
    const fast = /\b(fast|quick|quickly|hurry)\b/.test(lower);
    const speed = slow ? 0.15 : fast ? 0.45 : 0.28;
    const turn = slow ? 0.6 : fast ? 1.6 : 1.0;

    if (/\bturn\b.*\bleft\b|\bleft\b.*\bturn\b|\bspin left\b|\bgo left\b/.test(lower)) {
      await nudge(0, turn, 900); return { speak: "Turning left." };
    }
    if (/\bturn\b.*\bright\b|\bright\b.*\bturn\b|\bspin right\b|\bgo right\b/.test(lower)) {
      await nudge(0, -turn, 900); return { speak: "Turning right." };
    }
    if (/\b(back|backward|backwards|reverse|away)\b/.test(lower)) {
      await nudge(-speed, 0, 1200); return { speak: "Backing up." };
    }
    // default: forward / come here
    await nudge(speed, 0, 1200);
    return { speak: /\bcome\b/.test(lower) ? "On my way." : "Moving forward." };
  },
};

// ── Open a DeckOS tool (client navigates) ─────────────────────────────────────
const TOOL_ROUTES: { re: RegExp; route: string; label: string }[] = [
  { re: /\b(memor(y|ies)|what you remember|my profile)\b/, route: "/memory", label: "your memory" },
  { re: /\b(map|location|where (things|everyone) (is|are))\b/, route: "/map", label: "the map" },
  { re: /\b(briefing|catch me up|what'?s (going on|new))\b/, route: "/briefings", label: "your briefings" },
  { re: /\b(routine|automation)s?\b/, route: "/routines", label: "your routines" },
  { re: /\b(device|gadget|sensor|smart (home|light))s?\b/, route: "/devices", label: "your devices" },
  { re: /\b(timeline|activity|history|what happened)\b/, route: "/timeline", label: "the activity timeline" },
  { re: /\b(plugin|skill|add-?on|store)s?\b/, route: "/plugins/store", label: "the skills store" },
  { re: /\b(setting|preference|api key|provider)s?\b/, route: "/settings", label: "settings" },
  { re: /\b(collection|faces|eye pack|wardrobe)s?\b/, route: "/collection", label: "your collection" },
  { re: /\b(command|console|terminal)\b/, route: "/commands", label: "the command console" },
  { re: /\b(system|cpu|memory usage|monitor|hud)\b/, route: "/hud", label: "the system monitor" },
  { re: /\b(personality|voice|attitude|persona)\b/, route: "/ai/personality", label: "your personality settings" },
  { re: /\b(lie detector|polygraph)\b/, route: "/lie-detector", label: "the lie detector" },
];

const openSkill: Skill = {
  id: "open",
  handle({ lower }) {
    if (!/\b(open|show|go to|take me to|pull up|launch|bring up|let'?s see|display)\b/.test(lower)) return null;
    for (const t of TOOL_ROUTES) {
      if (t.re.test(lower)) return { speak: `Opening ${t.label}.`, ui: { type: "open", route: t.route } };
    }
    return null;
  },
};

// ── Recall (before remember — questions about memory) ─────────────────────────
const recallSkill: Skill = {
  id: "recall",
  handle({ lower, facts }) {
    const asks = /\b(what do you (know|remember)|what have you (learned|got)|do you remember|what'?s in your memory|know about me)\b/.test(lower);
    if (!asks) return null;
    if (!facts.length) return { speak: "I haven't learned anything about you yet — tell me something and I'll keep it." };
    const top = facts.slice(0, 5).join("; ");
    return { speak: `Here's what I remember: ${top}.` };
  },
};

// ── Remember (imperative "remember that X") ───────────────────────────────────
const rememberSkill: Skill = {
  id: "remember",
  handle({ raw, lower }) {
    if (/\?\s*$/.test(raw)) return null; // a question isn't a command to store
    const m = raw.match(/\b(?:remember|note|jot down|keep in mind|don'?t forget)\b(?:\s+that)?\s+(.+)/i);
    if (!m || !m[1]) return null;
    // Guard against "what do you remember" style already handled by recall.
    if (/^(that )?(you|i) (know|remember)/i.test(m[1])) return null;
    void lower;
    const fact = m[1].replace(/[.!]+$/, "").trim();
    if (fact.length < 2) return null;
    return { speak: "Got it — I'll remember that.", ui: { type: "remember", fact } };
  },
};

// ── Status ────────────────────────────────────────────────────────────────────
const statusSkill: Skill = {
  id: "status",
  handle({ lower }) {
    if (!/\b(are you (online|connected|working|there|okay|ok)|what (brain|model) are you (running|using)|which (brain|model)|your status|how are you feeling|system status)\b/.test(lower)) return null;
    const s = getInferenceState();
    const brain = s.claudeAvailable ? "the cloud brain (Claude)"
      : s.ollamaAvailable ? "a local brain on this machine"
      : s.openWebUIAvailable ? "a local Open WebUI brain"
      : "my built-in rule engine";
    const online = s.claudeAvailable || s.ollamaAvailable || s.openWebUIAvailable;
    return { speak: `I'm here and running on ${brain}. ${online ? "Everything's responsive." : "No AI brain is connected yet, so I'm keeping it simple for now."}` };
  },
};

const SKILLS: Skill[] = [stopSkill, driveSkill, openSkill, recallSkill, rememberSkill, statusSkill];

/** Try to fulfil a message with a skill. Returns a chat fallback if none apply. */
export async function runAgent(message: string, facts: string[]): Promise<AgentDecision> {
  const raw = message.trim();
  const ctx: SkillCtx = { raw, lower: raw.toLowerCase(), facts: facts ?? [] };
  for (const skill of SKILLS) {
    const r = await skill.handle(ctx);
    if (r) return { mode: "action", skill: skill.id, speak: r.speak, ui: r.ui ?? { type: "none" } };
  }
  return { mode: "chat" };
}
