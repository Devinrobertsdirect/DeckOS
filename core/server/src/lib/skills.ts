/**
 * skills.ts — Atlas's hands.
 *
 * The buddy already KNOWS what DeckOS can do; skills let it DO it. Each skill is
 * a deterministic matcher + executor, so real commands ("drive forward",
 * "remember that…", "be more playful", "turn off the lamp", "what's your
 * battery?") become real actions — reliably, even on a small local model, with
 * zero LLM round-trip. If nothing matches, the caller falls back to conversation.
 *
 * Server-side actions (drive the body, read sensors/status, control devices) run
 * here. Client-side actions (rename, switch persona, change the look, forget a
 * fact, navigate) are returned as a typed `ui` instruction the buddy carries out.
 * Everything a skill says is plain words — the face shows emotion, never emoji.
 */
import os from "node:os";
import { getBody, getBodyDetection } from "./body.js";
import { getInferenceState } from "./inference.js";
import { getDeviceManager } from "./device-manager.js";

// ── Client action contract (executed by PetShell) ────────────────────────────
export type UiAction =
  | { type: "none" }
  | { type: "open"; route: string }
  | { type: "remember"; fact: string }
  | { type: "forgetFact"; query: string }
  | { type: "forgetAllFacts" }
  | { type: "searchMemory"; query: string }
  | { type: "setUserName"; name: string }
  | { type: "setBotName"; name: string }
  | { type: "setPersona"; personaId: string }
  | { type: "adjustTrait"; trait: string; delta: number }
  | { type: "setFaceTheme"; themeId: string }
  | { type: "setEmojiPack"; packId: string }
  | { type: "setAccentColor"; color: string }
  | { type: "setVoiceEngine"; engine: "server" | "browser" }
  | { type: "voiceRate"; delta: number }
  | { type: "demoFace"; state: string; ms: number }
  | { type: "setUiMode"; mode: "developer" | "pet" }
  | { type: "setExperienceMode"; mode: "robot" | "computer" }
  | { type: "replayLast" };

export interface AgentDecision {
  mode: "action" | "chat";
  skill?: string;
  speak?: string;
  ui?: UiAction;
}

interface SkillCtx { raw: string; lower: string; facts: string[] }
interface SkillResult { speak: string; ui?: UiAction }
interface Skill { id: string; handle(ctx: SkillCtx): Promise<SkillResult | null> | (SkillResult | null) }

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// ── Body motion ───────────────────────────────────────────────────────────────
let driveTimer: ReturnType<typeof setTimeout> | null = null;
let cruiseSpeed = 0.28;
let cruiseTurn = 1.0;
async function nudge(lin: number, ang: number, ms: number): Promise<void> {
  const body = await getBody();
  if (driveTimer) clearTimeout(driveTimer);
  body.driveVelocity(lin, ang);
  driveTimer = setTimeout(() => { void getBody().then((b) => b.halt()); }, ms);
}

const emergencyStop: Skill = {
  id: "emergency-stop",
  async handle({ lower }) {
    if (!/\b(emergency stop|e-?stop|kill (the )?(motors|power)|cut (the )?power|lock (it )?down)\b/.test(lower)) return null;
    if (/\b(clear|release|reset|unlock)\b/.test(lower)) return null; // that's release
    if (driveTimer) { clearTimeout(driveTimer); driveTimer = null; }
    (await getBody()).setEstop(true);
    return { speak: "Emergency stop engaged. Motors are locked until you clear it." };
  },
};
const releaseEstop: Skill = {
  id: "release-estop",
  async handle({ lower }) {
    if (!(/\b(clear|release|reset|unlock)\b.*(e-?stop|emergency|motors|stop)\b/.test(lower) || /\byou can move again\b/.test(lower) || /\bpower back up\b/.test(lower))) return null;
    (await getBody()).setEstop(false);
    return { speak: "E-stop cleared. I can move again." };
  },
};
const spinSkill: Skill = {
  id: "spin",
  async handle({ lower }) {
    if (!/\b(spin( around| in place)?|do a (spin|360|three sixty)|twirl|full (turn|circle)|all the way around)\b/.test(lower)) return null;
    await nudge(0, 1.6, 2200);
    return { speak: "Spinning around." };
  },
};
const wanderSkill: Skill = {
  id: "wander",
  async handle({ lower }) {
    if (!/\b(wander|roam|explore|patrol|walk around|go for a wander)\b/.test(lower)) return null;
    await nudge(0.2, 0.6, 2500);
    return { speak: "Taking a look around." };
  },
};
const setSpeedSkill: Skill = {
  id: "set-speed",
  handle({ lower }) {
    const persistent = /\b(from now on|always|going forward|generally|keep|permanently)\b/.test(lower);
    const speedy = /\b(speed|pace)\b/.test(lower) && /\b(set|use|go|drive|move|crank|bump|adjust|increase|decrease|up|down|to)\b/.test(lower);
    const barePace = /\b(gentle speed|full speed|top speed|take it slow)\b/.test(lower);
    if (!speedy && !barePace && !(persistent && /\b(faster|slower|slow|fast)\b/.test(lower))) return null;
    if (/\b(slow|gentle|careful)/.test(lower)) { cruiseSpeed = 0.15; cruiseTurn = 0.6; return { speak: "Okay, I'll take it slow from now on." }; }
    if (/\b(fast|quick|full|top|crank)/.test(lower)) { cruiseSpeed = 0.45; cruiseTurn = 1.6; return { speak: "Speeding up — I'll move quicker from now on." }; }
    cruiseSpeed = 0.28; cruiseTurn = 1.0; return { speak: "Back to a normal pace." };
  },
};
const stopSkill: Skill = {
  id: "stop",
  async handle({ lower }) {
    if (!/^\s*(stop|halt|freeze|whoa|hold (on|up)|that'?s enough|stop (moving|driving|going|now))\b/.test(lower)) return null;
    if (/\bstop (remember|telling|saving|storing|talking|listening)/.test(lower)) return null; // not a motion stop
    if (driveTimer) { clearTimeout(driveTimer); driveTimer = null; }
    (await getBody()).halt();
    return { speak: "Stopping." };
  },
};
const driveSkill: Skill = {
  id: "drive",
  async handle({ lower }) {
    if (/\bturn (on|off)\b/.test(lower)) return null;              // device control
    if (/\bgo to\b|\bgo (into|back to)\b/.test(lower)) return null; // navigation / mode
    const dir = /\b(forward|backward|backwards|ahead|reverse|closer|left|right|around)\b/.test(lower) || /\bcome (here|closer|to me)\b/.test(lower) || /\bback up\b/.test(lower);
    const moveVerb = /\b(drive|roll|scoot)\b/.test(lower);
    if (!dir && !moveVerb) return null;
    const slow = /\b(a little|slightly|a bit|slowly|slow|carefully)\b/.test(lower);
    const fast = /\b(fast|quick|quickly|hurry)\b/.test(lower);
    const speed = slow ? 0.15 : fast ? 0.45 : cruiseSpeed;
    const turn = slow ? 0.6 : fast ? 1.6 : cruiseTurn;
    if (/\bturn\b.*\bleft\b|\bleft\b.*\bturn\b|\bspin left\b|\bgo left\b/.test(lower)) { await nudge(0, turn, 900); return { speak: "Turning left." }; }
    if (/\bturn\b.*\bright\b|\bright\b.*\bturn\b|\bspin right\b|\bgo right\b/.test(lower)) { await nudge(0, -turn, 900); return { speak: "Turning right." }; }
    if (/\b(back|backward|backwards|reverse|away)\b/.test(lower)) { await nudge(-speed, 0, 1200); return { speak: "Backing up." }; }
    await nudge(speed, 0, 1200);
    return { speak: /\bcome\b/.test(lower) ? "On my way." : "Moving forward." };
  },
};

// ── Mode switches (client) ────────────────────────────────────────────────────
const experienceModeSkill: Skill = {
  id: "set-experience-mode",
  handle({ lower }) {
    if (/\b(robot mode|kiosk mode|lock (your |the )?(face|screen)|face.only mode)\b/.test(lower)) return { speak: "Robot mode — I'll stay on my face now.", ui: { type: "setExperienceMode", mode: "robot" } };
    if (/\b(computer mode|desktop mode|unlock (your |the )?(face|screen)|exit robot mode)\b/.test(lower)) return { speak: "Computer mode — the full command center is back.", ui: { type: "setExperienceMode", mode: "computer" } };
    return null;
  },
};
const uiModeSkill: Skill = {
  id: "set-ui-mode",
  handle({ lower }) {
    if (/\b(developer mode|dev mode|command center|full dashboard|the dashboard)\b/.test(lower)) return { speak: "Opening the command center.", ui: { type: "setUiMode", mode: "developer" } };
    if (/\b(pet mode|simple mode|just (show )?(the |your )?face|back to your face)\b/.test(lower)) return { speak: "Back to my face.", ui: { type: "setUiMode", mode: "pet" } };
    return null;
  },
};

// ── Open a DeckOS tool ────────────────────────────────────────────────────────
const TOOL_ROUTES: { re: RegExp; route: string; label: string }[] = [
  { re: /\b(memor(y|ies)|what you remember|my profile)\b/, route: "/memory", label: "your memory" },
  { re: /\b(map|location|geofence|where (things|everyone) (is|are))\b/, route: "/map", label: "the map" },
  { re: /\b(briefings?|catch me up|what'?s (going on|new))\b/, route: "/briefings", label: "your briefings" },
  { re: /\b(routines?|automations?)\b/, route: "/routines", label: "your routines" },
  { re: /\b(devices?|gadgets?|smart (home|light))\b/, route: "/devices", label: "your devices" },
  { re: /\b(timeline|activity|history|what happened)\b/, route: "/timeline", label: "the activity timeline" },
  { re: /\b(plugins?|add-?ons?|store|marketplace)\b/, route: "/plugins/store", label: "the skills store" },
  { re: /\b(settings?|preferences?|api keys?|providers?)\b/, route: "/settings", label: "settings" },
  { re: /\b(collection|faces|eye packs?|wardrobe)\b/, route: "/collection", label: "your collection" },
  { re: /\b(commands?|console|terminal)\b/, route: "/commands", label: "the command console" },
  { re: /\b(goals?|planning)\b/, route: "/hud", label: "your goals" },
  { re: /\b(lie detector|polygraph)\b/, route: "/lie-detector", label: "the lie detector" },
];
const openSkill: Skill = {
  id: "open",
  handle({ lower }) {
    if (!/\b(open|show|go to|take me to|pull up|launch|bring up|let'?s see|display)\b/.test(lower)) return null;
    for (const t of TOOL_ROUTES) if (t.re.test(lower)) return { speak: `Opening ${t.label}.`, ui: { type: "open", route: t.route } };
    return null;
  },
};

// ── Devices ───────────────────────────────────────────────────────────────────
function findDevice(phrase: string) {
  const devs = getDeviceManager().listDevices();
  const p = phrase.toLowerCase();
  return devs.find((d) => p.includes(d.name.toLowerCase())) ??
    devs.find((d) => d.name.toLowerCase().split(/\s+/).some((w) => w.length > 2 && p.includes(w))) ?? null;
}
const controlDevice: Skill = {
  id: "control-device",
  handle({ raw, lower }) {
    const m = lower.match(/\b(turn (on|off)|toggle|switch (on|off)|activate|deactivate)\b\s+(.+)/);
    if (!m) return null;
    const action = /off|deactivate/.test(m[0]) ? "off" : /toggle/.test(m[0]) ? "toggle" : "on";
    const dev = findDevice(raw);
    if (!dev) return { speak: "I couldn't find that device — say the name as it appears in your devices." };
    const ok = getDeviceManager().sendCommand(dev.id, { action });
    return { speak: ok ? `Turned ${action} the ${dev.name}.` : `I couldn't reach the ${dev.name}.` };
  },
};
const readSensor: Skill = {
  id: "read-sensor",
  handle({ raw, lower }) {
    if (!/\b(what'?s the|read the|reading (from|for)|what does the|check the)\b.*(sensor|temperature|humidity|reading|level|value)/.test(lower)) return null;
    const dev = findDevice(raw);
    if (!dev || !dev.state.readings.length) return { speak: "I don't have a live reading for that right now." };
    const r = dev.state.readings[0]!;
    return { speak: `The ${dev.name} reads ${r.value}${r.unit ? " " + r.unit : ""}.` };
  },
};
const listDevices: Skill = {
  id: "list-devices",
  handle({ lower }) {
    if (!/\b(what (devices|gadgets|sensors)|list (my )?devices|what'?s online|how many (devices|gadgets)|smart home status)\b/.test(lower)) return null;
    const devs = getDeviceManager().listDevices();
    if (!devs.length) return { speak: "No devices are connected yet." };
    const online = devs.filter((d) => d.state.status === "online");
    return { speak: `${online.length} of ${devs.length} devices are online: ${devs.slice(0, 6).map((d) => d.name).join(", ")}.` };
  },
};

// ── Body / power info (from the HAL) ──────────────────────────────────────────
const obstacleCheck: Skill = {
  id: "obstacle-check",
  async handle({ lower }) {
    if (!/\b(in front of you|what'?s ahead|obstacle|clear (path|ahead)|(path|way) (is )?clear|is the (path|way) clear|how close|is it safe to (go|move)|anything ahead)\b/.test(lower)) return null;
    const s = (await getBody()).getState();
    if (!s.tof.length) return { speak: "I don't have distance sensors on this body." };
    const nearest = Math.min(...s.tof);
    const clear = nearest > 800;
    return { speak: `${clear ? "The path looks clear." : "Careful — something's close."} Nearest thing ahead is about ${(nearest / 1000).toFixed(1)} meters.` };
  },
};
const batterySkill: Skill = {
  id: "battery",
  async handle({ lower }) {
    if (!/\b(battery|charge|power level|how much (juice|power)|running low|need to charge)\b/.test(lower)) return null;
    const b = (await getBody()).getState().battery;
    if (b.pct === undefined) return { speak: "This body doesn't report a battery." };
    const low = b.pct < 20 ? " I'm getting low — I should charge soon." : "";
    return { speak: `Battery's at ${Math.round(b.pct)} percent.${low}` };
  },
};
const bodyStatus: Skill = {
  id: "body-status",
  async handle({ lower }) {
    if (!/\b(how'?s your body|are your motors|body diagnostics|are you docked|what body|which board|connected to hardware)\b/.test(lower)) return null;
    const b = await getBody();
    const s = b.getState();
    const d = getBodyDetection();
    return { speak: `Running the ${s.board} body over the ${d?.backend ?? b.kind} backend. ${s.connected ? "Connected" : "Not connected"}${s.dock ? ", on the dock" : ""}${s.estop ? ", e-stop engaged" : ""}.` };
  },
};

// ── System / info ─────────────────────────────────────────────────────────────
const systemStats: Skill = {
  id: "system-stats",
  handle({ lower }) {
    if (!/\b(cpu|memory usage|how much (memory|ram)|ram|system (load|stats|health)|how'?s the (machine|computer|system) doing)\b/.test(lower)) return null;
    const cpus = os.cpus();
    const memPct = Math.round((1 - os.freemem() / os.totalmem()) * 100);
    return { speak: `${cpus.length} CPU cores, memory about ${memPct} percent used. Everything's nominal.` };
  },
};
const uptimeSkill: Skill = {
  id: "uptime",
  handle({ lower }) {
    if (!/\b(uptime|how long (have you been|you'?ve been) (running|up|awake)|been running)\b/.test(lower)) return null;
    const s = Math.floor(process.uptime());
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return { speak: `I've been running for ${h ? h + " hours " : ""}${m} minutes.` };
  },
};
const timeSkill: Skill = {
  id: "time",
  handle({ lower }) {
    if (!/\b(what time is it|what'?s the (time|date)|today'?s date|what day is it)\b/.test(lower)) return null;
    const now = new Date();
    return { speak: `It's ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} on ${now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.` };
  },
};
const providersSkill: Skill = {
  id: "providers",
  handle({ lower }) {
    if (!/\b(what (ai|brain|provider|model)s? (are )?(connected|available|hooked up)|which (ai|brain|model)s?|connected (ai|brain)s?|is (claude|gpt|gemini|ollama|the cloud) (connected|online|available|hooked up)|what (brain|model) (are you|do you) (use|using|run|running))\b/.test(lower)) return null;
    const s = getInferenceState();
    const have: string[] = [];
    if (s.claudeAvailable) have.push("Claude in the cloud");
    if (s.ollamaAvailable) have.push("a local Ollama brain");
    if (s.openWebUIAvailable) have.push("Open WebUI");
    return { speak: have.length ? `Connected: ${have.join(", ")}.` : "No AI brains are connected yet — I'm on the built-in rule engine." };
  },
};

// ── Memory (client) ───────────────────────────────────────────────────────────
const forgetAll: Skill = {
  id: "forget-all-memory",
  handle({ lower }) {
    if (!/\b(forget everything|wipe (your |all )?(memory|facts)|clear (your |all )?(memory|facts)|forget it all|erase (everything|all)( you know| (my|your) facts)?|delete all (my |your )?(facts|memory))\b/.test(lower)) return null;
    return { speak: "Cleared — I've forgotten what I'd learned about you.", ui: { type: "forgetAllFacts" } };
  },
};
const forgetFact: Skill = {
  id: "forget-fact",
  handle({ raw }) {
    if (/\bdon'?t forget\b/i.test(raw)) return null; // "don't forget to…" is a reminder → remember
    const m = raw.match(/\b(?:forget|drop|erase|stop remembering)\b(?:\s+(?:that|about|the fact that))?\s+(.+)/i);
    if (!m || !m[1]) return null;
    const t = m[1].replace(/[.!?]+$/, "").trim();
    if (/^(it|that|this|everything|all|about it)$/i.test(t) || t.length < 3) return null;
    return { speak: "Done — I've forgotten that.", ui: { type: "forgetFact", query: t } };
  },
};
const searchMemory: Skill = {
  id: "search-memory",
  handle({ raw, lower }) {
    const m = lower.match(/\b(what do you know about|do you remember anything about|what have you got on|search (your )?memory for)\s+(.+)/);
    if (!m) return null;
    const target = m[3] ?? "";
    if (/^(me|myself|us)\b/.test(target)) return null; // that's recall
    const q = raw.slice(raw.toLowerCase().indexOf(target)).replace(/[?.!]+$/, "").trim();
    return { speak: `Let me check what I know about ${q}.`, ui: { type: "searchMemory", query: q } };
  },
};

// ── Identity (client) ─────────────────────────────────────────────────────────
const setUserName: Skill = {
  id: "set-user-name",
  handle({ raw }) {
    const m = raw.match(/\b(?:my name is|call me|i go by|you can call me)\s+([A-Za-z][\w'-]{1,30})\b/i);
    if (!m || !m[1]) return null;
    const name = m[1].trim();
    return { speak: `Nice to meet you, ${name}.`, ui: { type: "setUserName", name } };
  },
};
const setBotName: Skill = {
  id: "set-bot-name",
  handle({ raw }) {
    const m = raw.match(/\b(?:your name is|i'?ll call you|call yourself|change your name to|rename yourself to|you'?re called)\s+([A-Za-z][\w'-]{1,30})\b/i);
    if (!m || !m[1]) return null;
    const name = m[1].trim();
    return { speak: `I'm ${name} now. I like it.`, ui: { type: "setBotName", name } };
  },
};

// ── Personality (client) ──────────────────────────────────────────────────────
const switchPersona: Skill = {
  id: "switch-persona",
  handle({ lower }) {
    // Require EXPLICIT persona intent — a bare "stealth"/"forge" is a face theme,
    // not a persona switch (set-face-theme handles "change your eyes to stealth").
    const explicit = /\b(persona(lity)?|edition|vibe)\b/.test(lower) ||
      /\b(switch to|become|use|be) the (warm|witty|workshop|calm|precise|stealth|bold|playful|forge|hot-?rod|gentle|thoughtful|codex)\b/.test(lower) ||
      /\b(switch to|become|use) (the )?(warm|witty|workshop|calm|precise|stealth|bold|playful|forge|hot-?rod|gentle|thoughtful|codex)\b/.test(lower);
    if (!explicit) return null;
    let id: string | null = null;
    if (/\b(warm|witty|workshop)\b/.test(lower)) id = "workshop";
    else if (/\b(calm|precise|stealth)\b/.test(lower)) id = "stealth";
    else if (/\b(bold|playful|forge|hot-?rod)\b/.test(lower)) id = "forge";
    else if (/\b(gentle|thoughtful|codex)\b/.test(lower)) id = "codex";
    if (!id) return null;
    return { speak: "Switching up my whole vibe.", ui: { type: "setPersona", personaId: id } };
  },
};
const adjustTraits: Skill = {
  id: "adjust-traits",
  handle({ lower }) {
    const m = lower.match(/\b(be|act|get|sound|talk|speak|switch to a)\b.{0,12}?\b(funnier|funny|witty|humor(ous)?|serious|snark(y|ier)?|sarcastic|nicer|warmer|kinder|gentle|colder|energetic|hyper|excited|calm(er)?|chill|mellow|formal|professional|casual|relaxed|quieter|playful|commanding)\b/);
    if (!m) return null;
    const w = m[2] ?? "";
    const less = /\bless\b/.test(lower);
    let trait = "humor", up = true;
    if (/funn|humor|witty/.test(w)) { trait = "humor"; up = true; }
    else if (/serious/.test(w)) { trait = "humor"; up = false; }
    else if (/snark|sarcas/.test(w)) { trait = "sarcasm"; up = true; }
    else if (/nice|warm|kind|gentle/.test(w)) { trait = "warmth"; up = true; }
    else if (/cold/.test(w)) { trait = "warmth"; up = false; }
    else if (/energ|hyper|excited|playful/.test(w)) { trait = "energy"; up = true; }
    else if (/calm|chill|mellow|quiet/.test(w)) { trait = "energy"; up = false; }
    else if (/formal|professional|commanding/.test(w)) { trait = "formality"; up = true; }
    else if (/casual|relaxed/.test(w)) { trait = "formality"; up = false; }
    if (less) up = !up;
    const delta = (up ? 0.22 : -0.22) * (/\bway\b/.test(lower) ? 1.6 : 1);
    return { speak: "You got it — adjusting my style.", ui: { type: "adjustTrait", trait, delta } };
  },
};

// ── Appearance (client) ───────────────────────────────────────────────────────
const setFaceTheme: Skill = {
  id: "set-face-theme",
  handle({ lower }) {
    if (!/\b(eyes|face theme|eye (style|pack|look)|change your (eyes|face|look))\b/.test(lower)) return null;
    let id: string | null = null;
    for (const [re, v] of [[/\bworkshop\b/, "workshop"], [/\bstealth\b/, "stealth"], [/\bforge\b/, "forge"], [/\bcodex\b/, "codex"], [/\bcat\b/, "cat"], [/\bpixel\b/, "pixel"]] as [RegExp, string][]) if (re.test(lower)) id = v;
    if (!id) return null;
    return { speak: "New eyes, coming up.", ui: { type: "setFaceTheme", themeId: id } };
  },
};
const setEmojiPack: Skill = {
  id: "set-emoji-pack",
  handle({ lower }) {
    if (!/\b(emoji|reaction|kawaii|retro|core)\b.*\bpack\b|\b(emoji pack|emojis)\b/.test(lower)) return null;
    let id: string | null = null;
    if (/\bkawaii\b/.test(lower)) id = "kawaii";
    else if (/\bretro\b/.test(lower)) id = "retro";
    else if (/\bcore\b/.test(lower)) id = "core";
    else if (/\bemoji\b/.test(lower)) id = "emoji";
    if (!id) return null;
    return { speak: "Switched my emoji pack.", ui: { type: "setEmojiPack", packId: id } };
  },
};
const setColor: Skill = {
  id: "set-accent-color",
  handle({ lower }) {
    if (!/\b(color|colour|accent|theme color|go (steel|ice|cobalt|blue|emerald|green|amber|yellow|gold|crimson|red))\b/.test(lower)) return null;
    const map: [RegExp, string, string][] = [
      [/\bsteel\b/, "steel", "steel"], [/\bice\b/, "ice", "ice"],
      [/\b(cobalt|blue)\b/, "blue", "cobalt"], [/\b(emerald|green)\b/, "green", "emerald"],
      [/\b(amber|yellow|gold)\b/, "yellow", "amber"], [/\b(crimson|red)\b/, "red", "crimson"],
    ];
    for (const [re, scheme, label] of map) if (re.test(lower)) return { speak: `Going ${label}.`, ui: { type: "setAccentColor", color: scheme } };
    return null;
  },
};
const switchVoice: Skill = {
  id: "switch-voice",
  handle({ lower }) {
    if (/\b(eleven ?labs|natural|premium|studio) voice\b/.test(lower) || /\buse eleven ?labs\b/.test(lower)) return { speak: "Switching to the ElevenLabs voice.", ui: { type: "setVoiceEngine", engine: "server" } };
    if (/\b(default|built-?in|browser|standard) voice\b/.test(lower)) return { speak: "Back to my default voice.", ui: { type: "setVoiceEngine", engine: "browser" } };
    return null;
  },
};
const voiceRate: Skill = {
  id: "voice-rate",
  handle({ lower }) {
    if (/\b(talk|speak|go)\s+(faster|quicker)\b|\bspeed up your (voice|speech|talking)\b/.test(lower)) return { speak: "Talking a little faster.", ui: { type: "voiceRate", delta: 0.12 } };
    if (/\b(talk|speak|go)\s+slower\b|\bslow down( your (voice|speech|talking))?\b/.test(lower)) return { speak: "Slowing down a touch.", ui: { type: "voiceRate", delta: -0.12 } };
    return null;
  },
};
const demoMood: Skill = {
  id: "demo-mood",
  handle({ lower }) {
    const m = lower.match(/\b(show me|do|make|give me|look|act|go)\s+(a |your |all )?(happy|sad|angry|excited|surprised|love|wink|starstruck|thinking|confused|suspicious|silly)\b/);
    if (!m) return null;
    const map: Record<string, string> = { happy: "happy", sad: "sad", angry: "angry", excited: "excited", surprised: "excited", love: "love", wink: "wink", starstruck: "starstruck", thinking: "thinking", confused: "confused", suspicious: "suspicious", silly: "wink" };
    const state = map[m[3] ?? ""] ?? "happy";
    return { speak: "Like this?", ui: { type: "demoFace", state, ms: 2600 } };
  },
};
const replayLast: Skill = {
  id: "replay-last",
  handle({ lower }) {
    if (!/\b(say that again|repeat that|come again|what did you (just )?say|one more time|read that back)\b/.test(lower)) return null;
    return { speak: "", ui: { type: "replayLast" } };
  },
};

// ── Memory: remember / recall ─────────────────────────────────────────────────
const recallSkill: Skill = {
  id: "recall",
  handle({ lower, facts }) {
    if (!/\b(what do you (know|remember) about me|what do you know about me|what have you (learned|got) about me|do you remember (me|about me)|what'?s in your memory|know about me)\b/.test(lower)) return null;
    if (!facts.length) return { speak: "I haven't learned anything about you yet — tell me something and I'll keep it." };
    return { speak: `Here's what I remember: ${facts.slice(0, 5).join("; ")}.` };
  },
};
const rememberSkill: Skill = {
  id: "remember",
  handle({ raw }) {
    if (/\?\s*$/.test(raw)) return null;
    const m = raw.match(/\b(?:remember|note|jot down|keep in mind|don'?t forget)\b(?:\s+that)?\s+(.+)/i);
    if (!m || !m[1]) return null;
    if (/^(that )?(you|i) (know|remember)/i.test(m[1])) return null;
    const fact = m[1].replace(/[.!]+$/, "").trim();
    if (fact.length < 2) return null;
    return { speak: "Got it — I'll remember that.", ui: { type: "remember", fact } };
  },
};

// ── Status + social ───────────────────────────────────────────────────────────
const statusSkill: Skill = {
  id: "status",
  handle({ lower }) {
    if (!/\b(are you (online|connected|working|there|okay|ok)|your status|system status)\b/.test(lower)) return null;
    const s = getInferenceState();
    const online = s.claudeAvailable || s.ollamaAvailable || s.openWebUIAvailable;
    return { speak: `I'm here and running. ${online ? "My brain's connected and responsive." : "No AI brain is connected yet, so I'm keeping it simple."}` };
  },
};

// Social pleasantries — kept STRICT (short, standalone) so they never swallow a
// real question that merely opens with a greeting.
function social(id: string, re: RegExp, speak: string, maxWords = 6): Skill {
  return {
    id,
    handle({ lower }) {
      if (!re.test(lower)) return null;
      if (/\?/.test(lower) && !/\b(how are you|how'?s it going|who are you|what can you do)\b/.test(lower)) return null;
      if (wordCount(lower) > maxWords) return null;
      return { speak };
    },
  };
}
const goodMorning = social("good-morning", /\bgood morning\b/, "Good morning! Ready when you are.", 3);
const goodNight = social("good-night", /\b(good ?night|goodnight|night night)\b/, "Good night — I'll be right here.", 3);
const thanks = social("thanks", /^\s*(thanks|thank you|thx|ty|appreciate it|cheers)\b/, "Anytime.", 4);
const howAreYou = social("how-are-you", /\bhow are you( doing| feeling)?\b|\bhow'?s it going\b/, "Feeling sharp and glad you're here. What can I do?", 6);
const joke: Skill = {
  id: "joke",
  handle({ lower }) {
    if (!/\b(tell me a joke|say something funny|make me laugh|got a joke)\b/.test(lower)) return null;
    if (/\babout\b/.test(lower)) return null; // "a joke about my code" → let the LLM riff
    return { speak: "Why did the robot cross the road? It was programmed by a chicken." };
  },
};
const whoAreYou = social("who-are-you", /\bwho are you\b|\bwhat'?s your name\b|\bwhat kind of (ai|robot|thing) are you\b/, "I'm your Neura — the face of DeckOS. I run your whole system and keep you company.", 8);
const helpSkill: Skill = {
  id: "help",
  handle({ lower }) {
    if (!/^\s*(help|what can you do|what do you do|show me what you can do)\s*\??$/.test(lower)) return null;
    return { speak: "Just talk to me — I can move, remember things, change my look and voice, open any tool, check your devices, and more. Try 'open my memory' or 'be more playful'." };
  },
};
const greet: Skill = {
  id: "greet",
  handle({ lower }) {
    if (!/^\s*(hi|hello|hey|yo|hiya|howdy)\b/.test(lower)) return null;
    if (wordCount(lower) > 3) return null;
    if (/\?/.test(lower)) return null;
    return { speak: "Hey! Good to see you." };
  },
};

// Priority order: most specific first so nothing shadows a narrower skill.
const SKILLS: Skill[] = [
  releaseEstop, emergencyStop, spinSkill, wanderSkill, setSpeedSkill, stopSkill,
  experienceModeSkill, uiModeSkill, openSkill, controlDevice, readSensor, listDevices,
  driveSkill,
  obstacleCheck, batterySkill, bodyStatus,
  systemStats, uptimeSkill, timeSkill, providersSkill,
  forgetAll, forgetFact, searchMemory,
  setBotName, setUserName,
  switchPersona, adjustTraits,
  setFaceTheme, setEmojiPack, setColor, switchVoice, voiceRate, demoMood, replayLast,
  recallSkill, rememberSkill,
  goodMorning, goodNight, thanks, howAreYou, joke, whoAreYou, helpSkill,
  statusSkill, greet,
];

/** Try to fulfil a message with a skill. Returns a chat fallback if none apply. */
export async function runAgent(message: string, facts: string[]): Promise<AgentDecision> {
  const raw = message.trim();
  const ctx: SkillCtx = { raw, lower: raw.toLowerCase(), facts: facts ?? [] };
  for (const skill of SKILLS) {
    try {
      const r = await skill.handle(ctx);
      if (r) return { mode: "action", skill: skill.id, speak: r.speak, ui: r.ui ?? { type: "none" } };
    } catch { /* a broken skill never blocks the buddy */ }
  }
  return { mode: "chat" };
}
