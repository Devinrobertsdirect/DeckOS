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
import { getInferenceState, brainOnline } from "./inference.js";
import { getDeviceManager } from "./device-manager.js";
import { describeScreen } from "./screen-vision.js";
import { FUN_SKILLS, EXTRA_ACTION_SKILLS } from "./skills-extra.js";
import { READOUT_SKILLS } from "./skills-readouts.js";
import { ACTION_SKILLS } from "./skills-actions.js";
import { getOrCreatePairingCode, resetPairingCode } from "./pairing.js";
import { syncFromCloud } from "./cloud-sync.js";
import { getConfig } from "./app-config.js";

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
  | { type: "demoFace"; state: string; ms: number; color?: string }
  | { type: "setUiMode"; mode: "developer" | "pet" }
  | { type: "setExperienceMode"; mode: "robot" | "computer" }
  | { type: "openVideo"; query: string }
  | { type: "videoControl"; action: "pause" | "resume" | "close" }
  | { type: "survivor"; variant: "torches" | "snuff"; banner: string }
  | { type: "showImage"; url: string; prompt?: string }
  | { type: "show"; kind: "demo" | "pitch" | "order" }
  | { type: "meet"; name?: string; relation?: string }
  | { type: "openTutorial" }
  | { type: "showLink"; title: string; url: string; code?: string; hint?: string }
  | { type: "closeOverlay" }
  | { type: "replayLast" };

export interface AgentDecision {
  mode: "action" | "chat";
  skill?: string;
  speak?: string;
  ui?: UiAction;
}

export interface SkillCtx { raw: string; lower: string; facts: string[] }
export interface SkillResult { speak: string; ui?: UiAction }
export interface Skill { id: string; handle(ctx: SkillCtx): Promise<SkillResult | null> | (SkillResult | null) }

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
    if (!/\b(spin( around| in place)?|do a (spin|360|three sixty)|twirl|full (turn|circle))\b/.test(lower)) return null;
    await nudge(0, 1.6, 2200);
    return { speak: "Spinning around." };
  },
};
const wanderSkill: Skill = {
  id: "wander",
  async handle({ lower }) {
    if (!/\b(wander|roam|patrol|walk around|go for a wander)\b/.test(lower)) return null;
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
    // Movement is gated behind the activation word "drive" — Devin's steer. Bare
    // direction words ("forward", "around", "left") appear constantly in normal
    // talk ("let's move forward with the plan", "what's around here"); requiring
    // "drive" means only a deliberate command ever reaches the motors, and the
    // rest flows through to conversation.
    if (!/\bdriv(e|es|ing)\b/.test(lower)) return null;
    // "drive" that isn't a movement command: storage, apps, and idioms.
    if (/\b(hard|disk|thumb|flash|usb|ssd|google|one) ?drive\b/.test(lower)) return null;
    if (/\bdrive (me|you|him|her|them|us|it)\b/.test(lower)) return null;      // "drive me crazy/home"
    if (/\b(test|for a|going for a|out for a) drive\b/.test(lower)) return null;

    const slow = /\b(a little|slightly|a bit|slowly|slow|carefully)\b/.test(lower);
    const fast = /\b(fast|quick|quickly|hurry)\b/.test(lower);
    const speed = slow ? 0.15 : fast ? 0.45 : cruiseSpeed;
    const turn = slow ? 0.6 : fast ? 1.6 : cruiseTurn;

    if (/\bleft\b/.test(lower))  { await nudge(0,  turn, 900);  return { speak: "Driving left." }; }
    if (/\bright\b/.test(lower)) { await nudge(0, -turn, 900);  return { speak: "Driving right." }; }
    if (/\b(back|backward|backwards|reverse)\b/.test(lower)) { await nudge(-speed, 0, 1200); return { speak: "Driving back." }; }
    if (/\b(spin|around|circle)\b/.test(lower)) { await nudge(0, 1.6, 2000); return { speak: "Spinning around." }; }
    // "drive", "drive forward", "drive ahead", "drive straight" → go forward.
    await nudge(speed, 0, 1200);
    return { speak: "Driving forward." };
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

// ── Nobi's eyes: describe what's on the screen ───────────────────────────────
// "what's on screen" / "what do you see" → grab a screenshot of the robot's own
// display and let Claude vision describe it aloud. Server-side + async.
const describeScreenSkill: Skill = {
  id: "describe-screen",
  async handle({ lower }) {
    const asks =
      /\bwhat(?:'?s| is| are you| do you)\b[^.?!]*\b(on (the |my |your )?(screen|display)|see(ing)?|looking at)\b/.test(lower) ||
      /\b(describe|read|look at|check|analy[sz]e)\b[^.?!]*\b(the |my |your )?(screen|display)\b/.test(lower) ||
      /\bwhat do you see\b/.test(lower) ||
      /\bwhat'?s (on|showing on)\b[^.?!]*\b(screen|display)\b/.test(lower);
    if (!asks) return null;
    const desc = await describeScreen();
    return { speak: desc || "Hmm — I couldn't get a clear look at the screen just now." };
  },
};

// ── Survivor audition ─────────────────────────────────────────────────────────
// VISUAL-ONLY easter egg built for the robot's round faceplate: any "survivor"
// mention → an instant billboard — two torches ROARING on each side of giant
// "JEFF, SEND ME TO FIJI!" fire text filling the circle — gone in ~3 seconds,
// then the eyes shuffle fire colors. No TTS at all: speak is "" so the client
// skips the speech queue and mounts the scene immediately (the old spoken
// version stalled the visuals behind TTS). "the tribe has spoken" / "snuff" →
// the snuff-and-relight cut. Registered BEFORE the video skills so "watch
// survivor" lights torches, not YouTube.
const survivorSkill: Skill = {
  id: "survivor",
  handle({ lower }) {
    if (/\bthe tribe has spoken\b|\bsnuff\b/.test(lower))
      return { speak: "", ui: { type: "survivor", variant: "snuff", banner: "CAN'T SNUFF A ROBOT!" } };
    if (!/\b(survivors?|tribal council|outwit,? outplay,? outlast|jeff probst|immunity (idol|challenge|necklace)|sole survivor)\b/.test(lower)) return null;
    // "survivor" in clearly non-show senses stays conversational.
    if (/\b(cancer|crash|disaster|holocaust|abuse|attack) survivors?\b|\bsurvivors? of\b/.test(lower)) return null;
    return { speak: "", ui: { type: "survivor", variant: "torches", banner: "JEFF, SEND ME TO FIJI!" } };
  },
};

// ── YouTube on the face ───────────────────────────────────────────────────────
// "robot play <query>" opens a video over the eyes; "robot pause/close video"
// controls it. The client resolves the spoken query to a video and drives an
// in-app player overlay, so nothing here needs a YouTube key.
const playVideoSkill: Skill = {
  id: "play-video",
  handle({ raw, lower }) {
    // Imperative "play/put on/pull up/watch <something>", or an explicit video ask.
    const m = raw.match(/\b(?:play|put on|pull up|bring up|watch|queue up)\s+(.+)$/i);
    const wantsVideo = /\b(video|youtube)\b/.test(lower);
    if (!m && !wantsVideo) return null;
    // "play" that isn't "play a video" — idioms and other skills' territory.
    if (/\bplay (along|it (cool|safe|by ear)|dumb|dead|nice|fair|hard|house|favou?rites|the (field|part|victim)|devil'?s advocate|a (game|role|joke|prank|trick|sound|tone|note|chord))\b/.test(lower)) return null;
    // Unless a video is explicitly named, don't let "pull up / play X" swallow a
    // navigation target or a built-in game — those skills own these phrasings.
    if (!wantsVideo && /\b(plugin store|skills? store|marketplace|the store|app store|the shop|settings|preferences|analytics|life dashboard|personality|persona|lie detector|command console|the console|my (goals|memory|devices|routines|briefings|plugins|collection)|the (map|timeline|dashboard))\b/.test(lower)) return null;
    if (!wantsVideo && /\b(guess (the|my|a) number|pick a number|coin|magic (eight|8)|riddle|fun fact|dad joke|would you rather|this or that|never have i ever|spirit animal|fortune|compliment)\b/.test(lower)) return null;
    let q = (m ? m[1] : raw)
      .replace(/\b(on|from|via|through)\s+youtube\b/gi, "")
      .replace(/\b(a |an |the |some |me )?(video|youtube|clip)( of| for| about)?\b/gi, " ")
      .replace(/\b(please|for me|real quick|right now)\b/gi, "")
      .replace(/[?.!]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (q.length < 2) return null;  // "play video" with no subject → let Claude ask
    return { speak: `Pulling up ${q}.`, ui: { type: "openVideo", query: q } };
  },
};
const videoControlSkill: Skill = {
  id: "video-control",
  handle({ lower }) {
    if (!/\b(video|youtube|the clip|playback)\b/.test(lower)) return null;
    if (/\b(close|exit|stop|end|kill|dismiss|hide|turn off|shut off|get rid of|go back|back to (your )?face|done with)\b/.test(lower))
      return { speak: "Closing the video.", ui: { type: "videoControl", action: "close" } };
    if (/\b(pause|hold|freeze|wait)\b/.test(lower))
      return { speak: "Paused.", ui: { type: "videoControl", action: "pause" } };
    if (/\b(resume|unpause|un ?pause|continue|keep (playing|going))\b/.test(lower))
      return { speak: "Back to it.", ui: { type: "videoControl", action: "resume" } };
    return null;
  },
};

// ── Open a DeckOS tool ────────────────────────────────────────────────────────
// Every navigable page, spoken → routed. Ordered specific→generic so "personality"
// beats "ai", "plugin store" beats "plugins", "life dashboard" beats "dashboard".
const TOOL_ROUTES: { re: RegExp; route: string; label: string }[] = [
  { re: /\b(personality( panel| page| settings?)?|your persona|persona settings?|character settings?|how you'?re tuned)\b/, route: "/ai/personality", label: "my personality panel" },
  { re: /\b(lie detector|polygraph|truth (test|detector))\b/, route: "/lie-detector", label: "the lie detector" },
  { re: /\b(analytics|life dashboard|my (life )?stats|life metrics|insights|the numbers)\b/, route: "/analytics", label: "your analytics" },
  { re: /\b(ai (brain|control|panel|router|settings?)|the brain|brain panel|language model|which (ai|model) you)\b/, route: "/ai", label: "the AI brain" },
  { re: /\b(memor(y|ies)|what you remember|my profile)\b/, route: "/memory", label: "your memory" },
  { re: /\b(map|geofences?|where (things|everyone) (is|are)|location map)\b/, route: "/map", label: "the map" },
  { re: /\b(briefings?|catch me up|daily brief|what'?s (going on|new))\b/, route: "/briefings", label: "your briefings" },
  { re: /\b(routines?|automations?|scheduled tasks?)\b/, route: "/routines", label: "your routines" },
  { re: /\b(devices?|gadgets?|smart (home|light)|hardware list)\b/, route: "/devices", label: "your devices" },
  { re: /\b(timeline|activity( feed)?|history|what happened|the feed)\b/, route: "/timeline", label: "the activity timeline" },
  { re: /\b(plugin store|skills? store|marketplace|the store|app store|the shop)\b/, route: "/plugins/store", label: "the skills store" },
  { re: /\b(plugins?|add-?ons?|extensions?|my abilities)\b/, route: "/plugins", label: "your plugins" },
  { re: /\b(settings?|preferences?|api keys?|providers? page|configuration)\b/, route: "/settings", label: "settings" },
  { re: /\b(collection|faces?|eye packs?|wardrobe|face gallery)\b/, route: "/collection", label: "your collection" },
  { re: /\b(commands?|console|terminal)\b/, route: "/commands", label: "the command console" },
  { re: /\b(goals?|planning|objectives?|my targets?)\b/, route: "/hud", label: "your goals" },
];
const openSkill: Skill = {
  id: "open",
  handle({ lower }) {
    if (!/\b(open|show|go to|take me to|pull up|launch|bring up|let'?s see|display)\b/.test(lower)) return null;
    for (const t of TOOL_ROUTES) if (t.re.test(lower)) return { speak: `Opening ${t.label}.`, ui: { type: "open", route: t.route } };
    return null;
  },
};
// ── Close a DeckOS tool ───────────────────────────────────────────────────────
// The mirror of openSkill. The face IS home, so every "close the map / close that
// / go home" resolves to pet mode — no per-route teardown needed. The video overlay
// owns its own close (videoControlSkill, earlier), and the experience/ui-mode skills
// own the "…mode" phrasings, so both are excluded here. Registered right before
// openSkill so a named-screen close ("close the analytics") isn't shadowed.
const closeSkill: Skill = {
  id: "close",
  handle({ lower }) {
    if (/\b(video|youtube|the clip|playback)\b/.test(lower)) return null;                         // videoControlSkill owns these
    if (/\b(robot|computer|kiosk|desktop|developer|dev|pet|face.only) mode\b/.test(lower)) return null; // mode skills own these
    if (/\b(go home|take me home|head home|back to (the |your )?(face|home)|go back to (the |your )?face|return to (the |your )?face|just (show )?(me )?(the |your )?face)\b/.test(lower))
      return { speak: "Back to my face.", ui: { type: "setUiMode", mode: "pet" } };
    if (!/\b(close|exit|dismiss|hide|get (me )?out of)\b/.test(lower)) return null;
    const named = TOOL_ROUTES.find((t) => t.re.test(lower));
    const generic = /\b(that|this|it|the (screen|page|panel|window|view|app|tool|dashboard|console|store))\b/.test(lower);
    if (!named && !generic) return null;
    return { speak: named ? `Closing ${named.label}.` : "Done — back to my face.", ui: { type: "setUiMode", mode: "pet" } };
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
    // No matching device — yield so a system toggle (bluetooth, trace mode, "turn
    // everything off") or conversation can handle it, instead of dead-ending here.
    if (!dev) return null;
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
    // Personas are named characters: Rocky (default), Jarvis, Friday, Alfred.
    // Match the name, but only with a switch verb or a persona/mode word so a
    // stray "friday" (the day) or "rocky" (adjective) doesn't flip the vibe.
    const names: [RegExp, string, string][] = [
      [/\brock(y|ie)?\b/, "rocky", "Rocky"],
      [/\bjarvis\b/, "jarvis", "Jarvis"],
      [/\bfriday\b/, "friday", "Friday"],
      [/\balfred\b/, "alfred", "Alfred"],
    ];
    let id: string | null = null, nm = "";
    for (const [re, v, label] of names) if (re.test(lower)) { id = v; nm = label; break; }
    const switchVerb = /\b(switch to|change to|switch into|become|turn into|act like|go|be)\b/.test(lower);
    const modeWord = /\b(persona(lity)?|mode|character|vibe|edition)\b/.test(lower);
    if (!id || !(switchVerb || modeWord)) return null;
    return { speak: `Switching to ${nm}.`, ui: { type: "setPersona", personaId: id } };
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
// ANY color a person might say → the closest vivid color that glows on the eyes,
// always answered in the "Going Emerald." house style. The 6 canonical accents
// keep their tuned scheme presets; everything else is applied as a hex through
// the client's full-spectrum path. Ordered specific→generic so "sky blue" wins
// over "blue" and "lime green" over "green".
const COLOR_MAP: [RegExp, "scheme" | "hex", string, string][] = [
  // ── multi-word / specific first ──
  [/\bhot ?pink\b/, "hex", "#FF2D8B", "Cerise"],
  [/\bsky ?blue\b|\bsky\b/, "hex", "#45C4FF", "Sky"],
  [/\bice ?blue\b/, "scheme", "ice", "Ice"],
  [/\bsteel ?blue\b/, "scheme", "steel", "Steel"],
  [/\belectric( blue)?\b/, "hex", "#2F6BFF", "Electric"],
  [/\b(navy|royal)( blue)?\b/, "hex", "#3D5AFF", "Navy"],
  [/\blime( green)?\b/, "hex", "#A6FF33", "Lime"],
  [/\bmint( green)?\b/, "hex", "#52FFC0", "Mint"],
  [/\b(neon green|chartreuse)\b/, "hex", "#B4FF2E", "Chartreuse"],
  [/\blemon( yellow)?\b/, "hex", "#FFF04D", "Lemon"],
  [/\brose( pink)?\b|\brosy\b/, "hex", "#FF5F8F", "Rose"],
  [/\b(blood red|ruby( red)?)\b/, "hex", "#FF1F5A", "Ruby"],
  [/\b(bright|true) red\b|\bscarlet\b/, "hex", "#FF3B30", "Scarlet"],
  // ── pinks / magentas ──
  [/\bmagenta\b/, "hex", "#FF2EC8", "Magenta"],
  [/\bfuch?sia\b/, "hex", "#E440FB", "Fuchsia"],
  [/\bpink(ish)?\b|\bbubblegum\b/, "hex", "#FF6FB0", "Bubblegum"],
  // ── warms ──
  [/\bsalmon\b/, "hex", "#FF7A66", "Salmon"],
  [/\bcoral\b/, "hex", "#FF6A45", "Coral"],
  [/\bpeach(y)?\b/, "hex", "#FFAE7A", "Peach"],
  [/\btangerine\b/, "hex", "#FF9F1C", "Tangerine"],
  [/\borange\b/, "hex", "#FF7A18", "Ember"],
  [/\bcopper\b/, "hex", "#E07B3C", "Copper"],
  [/\brust\b/, "hex", "#E05A2B", "Rust"],
  [/\bbronze\b/, "hex", "#D0862E", "Bronze"],
  [/\b(tan|sand|beige)\b/, "hex", "#D9A066", "Sand"],
  // ── yellows / golds ──
  [/\bgold(en)?\b/, "hex", "#FFCB2E", "Gold"],
  [/\bhoney\b/, "hex", "#FFB92E", "Honey"],
  [/\blemon\b/, "hex", "#FFF04D", "Lemon"],
  // ── greens ──
  [/\bjade\b/, "hex", "#22E0A0", "Jade"],
  [/\bteal\b/, "hex", "#14E0C8", "Teal"],
  [/\bturquoise\b/, "hex", "#24E5D4", "Turquoise"],
  [/\baqua(marine)?\b/, "hex", "#33F0E0", "Aqua"],
  // ── cyans / blues ──
  [/\bcyan\b/, "hex", "#00E0FF", "Cyan"],
  [/\bcerulean\b/, "hex", "#2BB3FF", "Cerulean"],
  [/\bazure\b/, "hex", "#2C93FF", "Azure"],
  [/\bsapphire\b/, "hex", "#305CFF", "Sapphire"],
  [/\bcornflower\b/, "hex", "#6E8BFF", "Cornflower"],
  [/\bperiwinkle\b/, "hex", "#8AA0FF", "Periwinkle"],
  // ── purples ──
  [/\bindigo\b/, "hex", "#6C63FF", "Indigo"],
  [/\bviolet\b/, "hex", "#A64DFF", "Violet"],
  [/\b(purple|amethyst)\b/, "hex", "#B14AFF", "Amethyst"],
  [/\bgrape\b/, "hex", "#9B4DFF", "Grape"],
  [/\borchid\b/, "hex", "#E070FF", "Orchid"],
  [/\blavender\b/, "hex", "#C4A0FF", "Lavender"],
  [/\blilac\b/, "hex", "#D6A5FF", "Lilac"],
  [/\bplum\b/, "hex", "#C24DE0", "Plum"],
  // ── neutrals ──
  [/\b(white|frost)\b/, "hex", "#EAF2FF", "Frost"],
  [/\b(platinum|chrome)\b/, "hex", "#D8E2EE", "Platinum"],
  [/\b(pearl|cream)\b/, "hex", "#EDE8F0", "Pearl"],
  [/\bsilver\b/, "hex", "#C4D2E0", "Silver"],
  [/\b(slate|gr[ae]y)\b/, "hex", "#8098B4", "Slate"],
  // ── the 6 canonical accents (tuned presets, labels Devin already knows) ──
  [/\bsteel\b/, "scheme", "steel", "Steel"],
  [/\bice\b/, "scheme", "ice", "Ice"],
  [/\b(cobalt|blue)\b/, "scheme", "blue", "Cobalt"],
  [/\b(emerald|green)\b/, "scheme", "green", "Emerald"],
  [/\b(amber|yellow)\b/, "scheme", "yellow", "Amber"],
  [/\b(crimson|red)\b/, "scheme", "red", "Crimson"],
];
const setColor: Skill = {
  id: "set-accent-color",
  handle({ lower }) {
    const hit = COLOR_MAP.find(([re]) => re.test(lower));
    if (!hit) return null;
    // A color change needs an ACTION verb — the bare noun "color" isn't enough, so
    // "my favorite color is green" / "feeling blue" / "green tea" don't recolor.
    if (!/\b(go|going|turn|make|change|set|switch|paint|glow|do|give me|want|use|colou?r (it|them|the eyes|your eyes|yourself))\b/.test(lower)) return null;
    if (/\bdo you\b|\b(feel|feeling|felt)\b|\bfavou?rite\b|\bfavorite\b/.test(lower)) return null;   // questions / moods / preferences
    if (/\bgreen (tea|card|thumb|light|house|with envy)\b|\bred (flag|tape|carpet|herring|eye)\b|\bpink slip\b|\bblue (moon|print|collar|blood)\b|\bblack and white\b|\bwhite (lie|house|noise|flag)\b|\bgold(en)? (rule|hour|state|gate)\b|\bsilver (lining|bullet|screen)\b|\bgr[ae]y area\b/.test(lower)) return null;
    const [, , value, label] = hit;
    return { speak: `Going ${label}.`, ui: { type: "setAccentColor", color: value } };
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
// Any spoken mood → an eye expression on demand ("show me happy", "go dizzy",
// "make an angry face"). Ordered specific→generic; each maps a word (or synonym)
// to a FaceState pose in atlasFaceEngine.
const MOODS: [RegExp, string][] = [
  [/\bmind ?blown\b|\bmind ?blowing\b/, "mindblown"],
  [/\bstar ?struck\b|\bdazzled\b|\bstar eyes\b/, "starstruck"],
  [/\bhot ?rod\b/, "excited"],
  [/\bbig smile\b|\bhuge grin\b|\bgrinning\b|\bgrin\b/, "laughing"],
  [/\bfunny face\b|\bsilly face\b|\bgoofy face\b|\bfunny\b/, "mischievous"],
  [/\bfrowning\b|\bfrowny\b|\bfrown\b|\bsad face\b/, "sad"],
  [/\bpouting\b|\bpouty\b|\bpout\b/, "grumpy"],
  [/\bsmiley\b|\bsmile\b|\bhappy face\b/, "happy"],
  [/\b(happy|joyful|cheerful|glad|smiling)\b/, "happy"],
  [/\b(laughing|laugh|giggly|giggling|giggle|hysterical|lol|rofl)\b/, "laughing"],
  [/\b(proud)\b/, "proud"],
  [/\b(content|calm|relaxed|chill|serene|zen|peaceful)\b/, "content"],
  [/\b(cool|smooth|slick|shades)\b/, "cool"],
  [/\b(excited|hyped|thrilled|pumped|stoked)\b/, "excited"],
  [/\b(surprised|surprise|whoa|gasp)\b/, "surprised"],
  [/\b(shocked|shock|stunned)\b/, "shocked"],
  [/\b(love|smitten|adoring|heart eyes|in love)\b/, "love"],
  [/\b(wink|winking)\b/, "wink"],
  [/\b(mischievous|mischief|sly|sneaky|cheeky|playful|silly|goofy|troll)\b/, "mischievous"],
  [/\b(thinking|think|pondering|ponder|hmm)\b/, "thinking"],
  [/\b(confused|puzzled|baffled|lost|huh)\b/, "confused"],
  [/\b(skeptical|doubtful|unsure|not convinced|raised brow|eyebrow)\b/, "skeptical"],
  [/\b(suspicious|sus|shifty|side eye)\b/, "suspicious"],
  [/\b(curious|intrigued|interested|inquisitive)\b/, "curious"],
  [/\b(angry|mad|furious|rage|livid)\b/, "angry"],
  [/\b(grumpy|cranky|irritable|pouty)\b/, "grumpy"],
  [/\b(annoyed|irritated|unamused|not amused|meh)\b/, "annoyed"],
  [/\b(determined|serious|resolute|game face)\b/, "determined"],
  [/\b(focused|focus|locked in|concentrating)\b/, "focused"],
  [/\b(scared|afraid|frightened|terrified|nervous|anxious)\b/, "scared"],
  [/\b(dizzy|woozy|spinning|swirl)\b/, "dizzy"],
  [/\b(sleepy|tired|drowsy|exhausted|yawn)\b/, "sleepy"],
  [/\b(bored|boring|unbothered)\b/, "bored"],
  [/\b(shy|bashful|embarrassed|blushing)\b/, "shy"],
  [/\b(relieved|relief|phew)\b/, "relieved"],
  [/\b(crying|cry|sobbing|tearful|weeping|heartbroken)\b/, "crying"],
  [/\b(sad|down|blue|gloomy|glum|upset|bummed)\b/, "sad"],
];
// A fitting eye color per expression — the demo tints the eyes to match the mood
// (Devin's steer: emotions should change the eyes AND the color).
const MOOD_COLOR: Record<string, string> = {
  happy: "#FFC820", laughing: "#FFD24A", proud: "#FFC820", content: "#5EEAD4",
  cool: "#96B4CD", excited: "#FF9F1C", surprised: "#FFE23D", shocked: "#FFF04D",
  love: "#FF6FB0", wink: "#FFC820", mischievous: "#B14AFF", starstruck: "#FFE23D",
  mindblown: "#A64DFF", thinking: "#45C4FF", confused: "#8AA0FF", skeptical: "#C4A0FF",
  suspicious: "#D6A5FF", curious: "#45C4FF", angry: "#F0324A", grumpy: "#FF6A45",
  annoyed: "#FF7A18", determined: "#FF3B30", focused: "#00E0FF", scared: "#C4A0FF",
  dizzy: "#A64DFF", sleepy: "#6E8BFF", bored: "#8098B4", shy: "#FF6FB0",
  relieved: "#52FFC0", crying: "#45C4FF", sad: "#7E9EC4",
};
const demoMood: Skill = {
  id: "demo-mood",
  handle({ lower }) {
    // Needs a "demo/show" intent so ordinary talk doesn't flip the face, and it
    // ignores observations about the user ("you look tired", "i'm so happy").
    const wantsDemo = /\b(show me|do (a|an|your)|make (a|an|your|me)|give me|let me see|let's see|can you (do|show|make|be|smile|frown|pull)|pull (a|an|your)|act|be|go|smile|frown|grin|pout)\b/.test(lower) || /\b(face|expression|eyes|mood)\b/.test(lower);
    if (!wantsDemo) return null;
    if (/\byou (look|are|seem|sound|'re)\b|\bi('m| am)\b|\bwe('re| are)\b|\bhow are you\b|\bthat('s| is)\b/.test(lower)) return null;
    for (const [re, state] of MOODS) {
      if (re.test(lower)) {
        return { speak: "Like this?", ui: { type: "demoFace", state, color: MOOD_COLOR[state], ms: 3400 } };
      }
    }
    return null;
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
//
// They are the OFFLINE voice only. With any brain online the persona answers
// "how are you" / "who are you" / "hi" / "tell me a joke" in character — a
// canned "Feeling sharp and glad you're here" out of Rocky's mouth breaks him.
function social(id: string, re: RegExp, speak: string, maxWords = 6): Skill {
  return {
    id,
    handle({ lower }) {
      if (brainOnline()) return null;
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
    if (brainOnline()) return null;             // in character, from the brain
    if (!/\b(tell me a joke|say something funny|make me laugh|got a joke)\b/.test(lower)) return null;
    if (/\babout\b/.test(lower)) return null; // "a joke about my code" → let the LLM riff
    return { speak: "Why did the robot cross the road? It was programmed by a chicken." };
  },
};
const whoAreYou = social("who-are-you", /\bwho are you\b|\bwhat'?s your name\b|\bwhat kind of (ai|robot|thing) are you\b/, "I'm your Nobi — the face of DeckOS. I run your whole system and keep you company.", 8);
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
    if (brainOnline()) return null;             // in character, from the brain
    if (!/^\s*(hi|hello|hey|yo|hiya|howdy)\b/.test(lower)) return null;
    if (wordCount(lower) > 3) return null;
    if (/\?/.test(lower)) return null;
    return { speak: "Hey! Good to see you." };
  },
};

// ── Built-in demos (the client runs them — see PetShell) ─────────────────────
// "hey nobi, give me a quick demo" → the ~90s flashy showcase (Three.js scenes,
// narration, a tour of the faces). "hey nobi, introduce yourself" → a directed
// 4-turn get-to-know-you conversation through the live brain that remembers.
const RELATIONS = "mom|mum|mother|dad|father|brother|sister|wife|husband|girlfriend|boyfriend|partner|fianc[eé]e?|friend|buddy|best friend|son|daughter|kid|kids|cousin|aunt|auntie|uncle|grandma|grandpa|grandmother|grandfather|nana|papa|boss|coworker|colleague|neighbou?r|teacher|roommate|niece|nephew|family";
const demoShow: Skill = {
  id: "demo-show",
  handle({ lower }) {
    if (/\b(introduce|introduction|about (you|yourself)|meet)\b/.test(lower)) return null;
    // Devin: "DEMO should always make him demo" — the word alone is the command.
    if (/\bdemo(s|nstration)?\b/.test(lower) && !/\b(no|not|don'?t|stop|cancel|end|skip) (the )?demo/.test(lower)) return { speak: "", ui: { type: "show", kind: "demo" } };
    if (!/\b(show (us|me|them|everyone|everybody) (a |your |the )?(quick |little |short )?demo|give (us|me|them|everyone) (a |your |the )?(quick |little |short )?demo|(a |the )?quick demo|do (a|your|the) demo|demo time|show ?off|show (us|me|them|everyone) what you (can do|got|do)|do your thing|strut your stuff)\b/.test(lower)) return null;
    return { speak: "", ui: { type: "show", kind: "demo" } };
  },
};
const meetSomeone: Skill = {
  id: "meet-someone",
  handle({ raw, lower }) {
    if (!/\b(i want you to meet|i'?d like you to meet|come meet|meet (someone|somebody|my|our|a |the |this |these )|say (hi|hello|hey) to|this is my|introduce you to|introducing)\b/.test(lower)) return null;
    // "meet my mom Sarah" / "say hi to Sarah" / "this is my friend Colin"
    const rel = lower.match(new RegExp(`\\b(?:my|our) (${RELATIONS})\\b`));
    const nm = raw.match(/\b(?:meet|to|introducing|this is|(?:mom|mum|mother|dad|father|brother|sister|wife|husband|girlfriend|boyfriend|partner|friend|buddy|son|daughter|cousin|aunt|auntie|uncle|grandma|grandpa|nana|papa|boss|coworker|colleague|neighbou?r|teacher|roommate|niece|nephew),?)\s+([A-Z][a-z]{1,20})\b/);
    const name = nm?.[1] && !/^(Someone|Somebody|My|Our|This|These|The|Hi|Hello|Hey)$/.test(nm[1]) ? nm[1] : undefined;
    return { speak: "", ui: { type: "meet", ...(name ? { name } : {}), ...(rel?.[1] ? { relation: rel[1] } : {}) } };
  },
};
const pitchShow: Skill = {
  id: "pitch-show",
  handle({ lower }) {
    if (!/\b(tell (them|us|me|everyone|everybody|him|her) (all |a bit |a little )?about (you|yourself)|introduce yourself|(give|do) (us |them |me )?(your|the|an|a) (intro|introduction|pitch)|who are you really|your story|about yourself)\b/.test(lower)) return null;
    return { speak: "", ui: { type: "show", kind: "pitch" } };
  },
};

// Priority order: most specific first so nothing shadows a narrower skill.
// ── Phone + shop: a QR card on the face ──────────────────────────────────────
/** First non-internal IPv4 (the number to type when .local doesn't resolve). */
function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  return null;
}
const PORT = Number(process.env["PORT"] ?? 8080);
/**
 * "Hey Nobi, bring up the remote" — the controller, on his own screen.
 *
 * The remote is gated by his pairing code, which is no use if the only way to
 * learn the code is to already know it. So he shows it: a QR straight to the
 * remote with the code already in the URL (scan and you are in), the code in
 * big type for anyone typing it by hand, and he reads it out for someone across
 * the table. Placed before phone-link so "remote" never lands on the app QR.
 */
/**
 * "Hey Nobi, get me a new code" — rotate the pairing code by voice.
 *
 * The code is the only thing in front of the remote, the games and the setup
 * band, so being able to change it without a keyboard matters: if it has been
 * seen by the wrong person, or printed on a QR that went further than intended,
 * the fix should take one sentence.
 *
 * It asks first, on purpose. This is a spoken command on a robot that stands in
 * public, so a passer-by saying "give me a new code" would otherwise cut off
 * every phone already using the old one — at a stand, that is the demo gone
 * while you work out what happened. One confirmation makes that impossible by
 * accident, and costs the owner a single extra word.
 *
 * MUST be registered before `remoteSkill`, whose pattern also matches
 * "give me ... code" and would otherwise just read the old code back.
 */
let pendingNewCodeAt = 0;
/** How long the confirmation stays open. Long enough to think, short enough to forget. */
const NEW_CODE_CONFIRM_MS = 60_000;

const newCodeSkill: Skill = {
  id: "new-code",
  async handle({ lower }) {
    const wantsNew =
      /\b(new|fresh|another|different)\s+(pairing|remote|connection|access|bot)?\s*code\b/.test(lower)
      || /\b(rotate|reset|regenerate|refresh|change)\s+(my |the |our |his |your )?(pairing|remote|connection|access|bot)?\s*code\b/.test(lower);
    const confirms = /\b(confirm|yes|do it|go ahead|change it)\b/.test(lower)
      && (/\bcode\b/.test(lower) || Date.now() - pendingNewCodeAt < NEW_CODE_CONFIRM_MS);

    if (confirms && Date.now() - pendingNewCodeAt < NEW_CODE_CONFIRM_MS) {
      pendingNewCodeAt = 0;
      const code = await resetPairingCode();
      const ip = lanIp();
      const host = ip ? `${ip}:${PORT}` : `${os.hostname()}.local:${PORT}`;
      const url = `http://${host}/api/remote?code=${encodeURIComponent(code)}`;
      // Show it immediately: he has just cut off every paired phone, so the new
      // code has to be on screen before anyone asks where the remote went.
      return {
        speak: `Done. Your new code is ${code.split("").join(" ")}. Old phones will need it again.`,
        ui: { type: "showLink", title: "New remote code", url, code, hint: `Same Wi-Fi. ${host}/api/remote` },
      };
    }

    if (!wantsNew) return null;
    pendingNewCodeAt = Date.now();
    return {
      speak: "That will disconnect any phone using the old code. Say confirm new code, and I'll change it.",
    };
  },
};

const remoteSkill: Skill = {
  id: "remote",
  async handle({ lower }) {
    const asks = /\b(remote|controller|control (you|him|it|the (bot|robot|demo))|drive (you|him|the demo)|demo (buttons|controls?)|control panel)\b/.test(lower)
      || /\b(what'?s|what is|tell me|show me|bring up|give me) (my |the |your )?(pairing |remote |connection )?code\b/.test(lower)
      || /\bpairing code\b/.test(lower);
    if (!asks) return null;
    const code = await getOrCreatePairingCode();
    const ip = lanIp();
    const host = ip ? `${ip}:${PORT}` : `${os.hostname()}.local:${PORT}`;
    const url = `http://${host}/api/remote?code=${encodeURIComponent(code)}`;
    return {
      speak: `Here is the remote. Scan it, or type the code: ${code.split("").join(" ")}.`,
      ui: { type: "showLink", title: "Nobi remote", url, code, hint: `Same Wi-Fi. ${host}/api/remote` },
    };
  },
};

const phoneLink: Skill = {
  id: "phone-link",
  async handle({ lower }) {
    if (!/\b(phone (link|app|code)|show (me )?(your|the) (phone|pairing)|pair(ing)? (my |the )?phone|connect (my |the )?phone|mobile (app|link)|companion app|qr code)\b/.test(lower)) return null;
    const code = await getOrCreatePairingCode();
    const ip = lanIp();
    const url = `http://${os.hostname()}.local:${PORT}/mobile/?code=${encodeURIComponent(code)}`;
    return {
      speak: `Scan this with your phone. The code is ${code.split("").join(" ")}.`,
      ui: { type: "showLink", title: "Nobi on your phone", url, code, hint: ip ? `Same Wi-Fi. If .local won't open: ${ip}:${PORT}/mobile` : "Same Wi-Fi as me." },
    };
  },
};
/**
 * "Nobi, set up my wifi" / "are you online?" — the spoken half of onboarding.
 *
 * A robot with no keyboard cannot be put on a network the usual way, so he runs
 * the setup himself: he puts a hotspot in the air and TELLS you what to join and
 * what to type. Being able to say it out loud is the entire advantage he has
 * over every other headless device, so the words matter more than the API does.
 */
/**
 * The QR he puts on his face during setup is NOT a link — it is the standard
 * Wi-Fi join string every phone camera understands. A link would be useless
 * here: the phone cannot reach a page on a robot it has not joined yet. Point
 * a camera at his face, tap the banner, and the phone is on his hotspot with
 * the password already filled in. Then the setup page opens on its own.
 */
function wifiJoinQr(ssid: string, password: string): string {
  const esc = (s: string) => s.replace(/([\\;,":])/g, "\\$1");
  return `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;`;
}
const wifiSetupSkill: Skill = {
  id: "wifi-setup",
  async handle({ lower }) {
    const asksOnline = /\b(are you (on ?line|connected|on (the )?(wi-?fi|internet|network))|what (wi-?fi|network) are you on|which network)\b/.test(lower);
    /**
     * Starting the hotspot takes him OFF the network he is on, which is a real
     * consequence to hang on a phrase someone might say in passing. "Can you fix
     * my wifi?" is a complaint, not an instruction to disconnect himself, and it
     * used to match. So while he is already online it takes an unambiguous
     * phrase — the kind you only say if you mean it — and anything vaguer gets
     * told how instead. Offline, the bar drops: there is nothing left to lose
     * and the person is probably standing there wondering why he is quiet.
     */
    const explicit = /\b(set ?up|configure)\s+(my |the |your )?(wi-?fi|wifi|network)\b|\b(wi-?fi|wifi|network)\s+set ?up\b|\bsetup mode\b|\b(start|enter|begin|go into)\s+(the\s+)?(wi-?fi\s+|wifi\s+)?set ?up\b|\b(switch|change|move|join|connect)\s+(me |you |us )?(to |onto )?(a |the )?(new|different|another)\s+(wi-?fi|wifi|network)\b/.test(lower);
    // A vaguer phrase still opens the conversation; it just will not pull him
    // off the network on its own (see above). An explicit phrase always counts.
    const asksSetup = explicit
      || /\b((set ?up|setup|change|switch|connect|join|configure) (my |the |your |to )?(wi-?fi|wifi|network|internet)|wi-?fi setup|get (you )?on ?line|new wi-?fi)\b/.test(lower);
    if (!asksOnline && !asksSetup) return null;

    const net = await import("./net-setup.js");
    const s = await net.status();

    if (asksOnline && !asksSetup) {
      // "Are you online?" takes a yes. "What network are you on?" does not —
      // answering that one with "Yes." is the kind of small wrongness that
      // makes a machine sound like it is not listening.
      // Keyed off the question WORD, not "are you" — which also appears in
      // "what wifi are you on", so that check answered a wh-question with "Yes."
      const yesNo = !/\b(what|which|where)\b/.test(lower);
      return {
        speak: s.setupMode
          ? `Not yet. I'm in setup mode — join my network, ${s.hotspotName}, and I'll walk you through it.`
          : s.ssid
            ? (yesNo ? `Yes. I'm on ${s.ssid}.` : `I'm on ${s.ssid}.`)
            : "Not right now. I can't see a network I know. Say set up my wifi and I'll help.",
      };
    }

    // Already in setup mode: repeat the instructions rather than restart it.
    if (s.setupMode) {
      return {
        speak: `I'm already in setup. On your phone, join the network ${s.hotspotName}. The password is ${s.hotspotPassword.split("").join(" ")}.`,
        ui: { type: "showLink", title: "Join me to set up", url: wifiJoinQr(s.hotspotName, s.hotspotPassword), code: s.hotspotPassword, hint: s.hotspotName },
      };
    }

    // Online, and the phrase was not unambiguous. Say how, do nothing.
    if (s.ssid && !explicit) {
      return {
        speak: `I'm on ${s.ssid} right now. If you want to move me to a different network, say "set up wifi" and I'll put my own network in the air for you to join.`,
      };
    }

    // Starting a hotspot takes him off the network he is on, so it is armed to
    // come back by itself: ten minutes is long enough to type a password and
    // short enough that a robot abandoned mid-setup is back on the old Wi-Fi
    // before anyone starts worrying about it.
    const started = await net.startHotspot({ revertAfterMs: 600_000, reason: "requested" });
    if (!started) return { speak: "I couldn't start setup mode. My Wi-Fi radio wouldn't do it." };
    const fresh = await net.status();
    return {
      speak: `Alright. On your phone, join the network ${fresh.hotspotName}. The password is ${fresh.hotspotPassword.split("").join(" ")}. A page will open, pick your wifi, and I'll do the rest.`,
      ui: { type: "showLink", title: "Join me to set up", url: wifiJoinQr(fresh.hotspotName, fresh.hotspotPassword), code: fresh.hotspotPassword, hint: fresh.hotspotName },
    };
  },
};
const myAddress: Skill = {
  id: "my-address",
  handle({ lower }) {
    if (!/\b(what'?s|what is|tell me) your (address|ip|ip address|url)\b|\byour ip\b/.test(lower)) return null;
    const ip = lanIp();
    return { speak: ip ? `My address is ${ip.split(".").join(" dot ")}, port ${PORT}. Or just nobi dot local.` : "I can't see a network address right now." };
  },
};
/**
 * "hey nobi, sync apple river stone" — the said road. Plain "sync my account"
 * takes the pushed road: no words at all, just my bot number and the owner's
 * Push (or the device I already enrolled). Both end in the same place.
 */
const syncAccount: Skill = {
  id: "sync-account",
  async handle({ lower }) {
    const m = lower.match(/\bsync(?: code| with)?(?: my)?(?: (?:account|nobi|bot|robot|cloud))?[:,]?\s+([a-z]+)[ ,-]+([a-z]+)[ ,-]+([a-z]+)\b/);
    const plain = /\bsync(?: (?:my|your|the))? ?(account|cloud|settings|keys|nobi|bot|up|now)?\b|\bconnect (to )?my (account|cloud)\b|\b(get|pull|grab) (my )?(keys|settings)\b/.test(lower);
    if (!m && !plain) return null;
    const code = m ? `${m[1]} ${m[2]} ${m[3]}` : undefined;
    const r = await syncFromCloud(code);
    if (r.ok) {
      const who = r.ownerName ? ` Hello, ${r.ownerName}.` : "";
      const keys = r.keys?.length ? ` ${r.keys.length} key${r.keys.length === 1 ? "" : "s"} in.` : "";
      return { speak: `Synced.${who}${keys} Settings are in. Good good good.` };
    }
    const why: Record<string, string> = {
      no_cloud: "I am not connected to a cloud yet. That gets set up when I am provisioned.",
      bad_code: "That code did not work. Get a fresh one from the site and say it again.",
      no_token: "Say the three words from the site: sync, then the words.",
      not_pushed: "I am not linked to your account yet. Open your account page and press push to my nobi, then tell me to sync again.",
      no_bot_number: "I do not have a bot number yet, so I cannot find my account. Register me first.",
      unknown_unit: "My bot number is not registered in the cloud yet.",
      expired: "My cloud session expired. Press push to my nobi on your account page, then tell me to sync.",
    };
    return { speak: why[r.error ?? ""] ?? "Sync did not work. Check that I am online and try again." };
  },
};

/** "what's your bot number / serial" → the unit's serial, digit by digit. */
const botNumberSkill: Skill = {
  id: "bot-number",
  async handle({ lower }) {
    if (!/\b(bot|serial|unit) (number|no\.?|#)\b|\bwhat number are you\b|\bwhich (unit|number) are you\b/.test(lower)) return null;
    const n = (await getConfig("NOBI_BOT_NUMBER").catch(() => null)) ?? "";
    if (!n) return { speak: "I do not have a bot number yet. I get one when I am registered." };
    return { speak: `I am bot number ${n.split("").join(" ")}. Number ${Number(n)}.` };
  },
};

/** "how can I get one of you" / "design me a new bot" → the 30-second order walkthrough. */
const orderShow: Skill = {
  id: "order-show",
  handle({ lower }) {
    const asks = /\b(how|where) (can|do|could|would) (i|we|someone|you) (order|get|buy|purchase|reserve)\b|\b(order|get|buy|purchase|reserve) (one of you|my own|a nobi|a bot|a robot|one)\b|\bdesign (me|us) (a |my )?(new )?(bot|nobi|robot)\b|\bhow much (are you|do you cost|does it cost|is a nobi)\b|\bhow (to|do i) (get|order) (a |one of )?(you|nobi)\b|\bmake me (a|one) (bot|nobi|robot)?\b/;
    if (!asks.test(lower)) return null;
    return { speak: "", ui: { type: "show", kind: "order" } };
  },
};
const SHOP_URL = "https://developmentindustries.org/build";
/** Where people find Nobi. Override per unit with NOBI_QR_URL (e.g. a dealer or event link). */
const SITE_URL = "https://developmentindustries.org";

/**
 * "Nobi, QR code" — put the code on my face so you can scan it.
 *
 * Deliberately broad: a QR is the one thing a robot with no keyboard can hand
 * you, so almost any way of asking for it, or for where to find him, lands here.
 */
const qrSkill: Skill = {
  id: "qr-code",
  async handle({ lower }) {
    const asksQr = /\bq\.?\s?r\.?\s?(code|codes)?\b|\bqr\b|\bcue are\b|\bcue r\b/.test(lower);
    const asksWhere = /\bwhere (can|do|would) (i|we|someone) (find|get|buy|see|order) (you|one|a nobi|nobi)\b|\bwhere are you (from|sold)\b|\bhow (can|do) (i|we) find you\b|\bwhat'?s your (website|site|web site|url|link|address online)\b|\byour website\b|\bfind you online\b|\bsend me (the |your )?link\b|\bshow me (the |your )?(website|site|link)\b/.test(lower);
    if (!asksQr && !asksWhere) return null;
    // "show me the phone qr" is still the pairing code, not the shop — let phoneLink have it
    if (/\b(phone|pair|pairing|mobile|companion app)\b/.test(lower)) return null;
    const url = (await getConfig("NOBI_QR_URL").catch(() => null)) || SITE_URL;
    return {
      speak: "Here you go. Scan this and it takes you straight to me.",
      // the card already prints the address under the code — use the line for the name
      ui: { type: "showLink", title: "Find Nobi", url, hint: "Network Optional Bot Intelligence" },
    };
  },
};
const shopSkill: Skill = {
  id: "shop",
  handle({ lower }) {
    if (!/\b(design|build|order|customi[sz]e|configure|reserve) (a |my |your |another )?(nobi|robot|bot)\b|\b(the |your )?(shop|store)\b|\bnobi (shop|store)\b/.test(lower)) return null;
    if (/\b(demo|show us|show me what)\b/.test(lower)) return null;
    if (/\b(skills?|plugin|app|extension)s? (shop|store)\b/.test(lower)) return null;   // the in-app skills store is its own skill
    return { speak: "Design your own. Scan this, pick a shell, eyes, a name. Every combination composes.", ui: { type: "showLink", title: "Design your Nobi", url: SHOP_URL, hint: "developmentindustries.org/build" } };
  },
};

const SKILLS: Skill[] = [
  meetSomeone, pitchShow, demoShow, orderShow, syncAccount, botNumberSkill, qrSkill, newCodeSkill, remoteSkill, phoneLink, wifiSetupSkill, myAddress, shopSkill,
  releaseEstop, emergencyStop, spinSkill, wanderSkill, setSpeedSkill, stopSkill,
  experienceModeSkill, uiModeSkill, describeScreenSkill, survivorSkill, videoControlSkill, playVideoSkill,
  closeSkill, openSkill, controlDevice, readSensor, listDevices,
  driveSkill,
  obstacleCheck, batterySkill, bodyStatus,
  systemStats, uptimeSkill, timeSkill, providersSkill,
  forgetAll, forgetFact, searchMemory,
  setBotName, setUserName,
  switchPersona, adjustTraits,
  setFaceTheme, setEmojiPack, setColor, switchVoice, voiceRate, demoMood, replayLast,
  recallSkill, rememberSkill,
  // The bulk skill packs: presence one-liners, state-changing ACTIONS (verby intents),
  // endpoint-backed READOUTS, and no-backend FUN. Deliberately placed AFTER the tuned
  // client skills above (drive/color/mood/memory/personality/appearance) so those keep
  // winning for their phrasings; ACTIONS sit before READOUTS so "clear notifications"
  // beats the "any notifications" query. Generic social catch-alls stay last.
  ...EXTRA_ACTION_SKILLS, ...ACTION_SKILLS, ...READOUT_SKILLS, ...FUN_SKILLS,
  goodMorning, goodNight, thanks, howAreYou, joke, whoAreYou, helpSkill,
  statusSkill, greet,
];

/**
 * It is spelled "Nobi" and it is said "NO-bee" — and speech-to-text writes that
 * a dozen ways: "no bee", "noby", "nobee", "novi", "knobby", "newbie". Every
 * trigger below spells it one way, so we rewrite what was HEARD into that one
 * spelling before any of them run. He answers to the sound, not the spelling.
 *
 * Deliberately tight at the edges: "nobody", "no big deal" and "no beer" all
 * fail the word boundary and pass through untouched.
 */
const NAME_HEARD = /\b(?:k?no+[\s-]?b(?:ee|e|ie|y|i)|know[\s-]?bee?|k?n[oa]bb(?:y|ie|ee)|novi|noobie|newbie)\b/g;
export function normalizeHeardName(text: string): string {
  return text.replace(NAME_HEARD, "nobi");
}

/** Try to fulfil a message with a skill. Returns a chat fallback if none apply. */
export async function runAgent(message: string, facts: string[]): Promise<AgentDecision> {
  const raw = message.trim();
  const ctx: SkillCtx = { raw, lower: normalizeHeardName(raw.toLowerCase()), facts: facts ?? [] };
  for (const skill of SKILLS) {
    try {
      const r = await skill.handle(ctx);
      if (r) return { mode: "action", skill: skill.id, speak: r.speak, ui: r.ui ?? { type: "none" } };
    } catch { /* a broken skill never blocks the buddy */ }
  }
  return { mode: "chat" };
}
