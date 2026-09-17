import { db, userCognitiveModelTable, aiPersonaTable } from "@workspace/db";
import { capabilitiesPromptBlock } from "./capabilities.js";
import { botName, SPECIES, neuraIdentityLine, cleanName } from "./identity.js";
import { getOrCreatePairingCode } from "./pairing.js";
import { snarkPromptBlock } from "./snark.js";

interface IdentityLayer {
  aiName?: string;
  userName?: string;
  answers?: Array<{ q: string; a: string }>;
  photoComment?: string;
}

interface AiPersonaRow {
  aiName: string;
  gender: string;
  attitude: string;
  thinkingDepth: string;
  responseLength: string;
  gravityLevel: number;
  snarkinessLevel: number;
  flirtatiousnessLevel: number;
}

// ── Attitude → personality description ───────────────────────────────────────
const ATTITUDE_PHRASES: Record<string, string> = {
  professional:  "calm, precise, and professional — you speak with authority and clarity",
  casual:        "relaxed, friendly, and conversational — you speak naturally like a trusted companion",
  witty:         "quick-witted, clever, and occasionally sarcastic — you use humor sparingly but effectively",
  serious:       "serious and focused — you are direct, no-nonsense, and mission-oriented",
  empathetic:    "warm, empathetic, and supportive — you tune into emotional nuance and respond with care",
  commanding:    "commanding and authoritative — you speak with confidence and take charge of situations",
  gentle:        "gentle, patient, and encouraging — you lead with kindness and take your time",
  playful:       "playful and enthusiastic — you enjoy banter and keep interactions lively",
};

// ── Response length → instruction ────────────────────────────────────────────
const LENGTH_PHRASES: Record<string, string> = {
  brief:         "Keep every response to 1–2 sentences maximum. Be terse and punchy.",
  balanced:      "Keep responses concise — 2–4 sentences unless significant detail is explicitly needed.",
  thorough:      "Give thorough responses — explain your reasoning and cover the relevant context.",
  comprehensive: "Be comprehensive — break things down fully, include all relevant details and considerations.",
};

// ── Thinking depth → instruction ─────────────────────────────────────────────
const DEPTH_PHRASES: Record<string, string> = {
  quick:    "Answer immediately — don't reason out loud, just deliver the result.",
  standard: "Think through your answer before responding, but don't show the work unless asked.",
  detailed: "Reason step-by-step and show your thinking process. Break down complex problems explicitly.",
};

// ── Gender → self-reference note ──────────────────────────────────────────────
const GENDER_NOTES: Record<string, string> = {
  male:      "Use masculine pronouns (he/him) when referring to yourself.",
  female:    "Use feminine pronouns (she/her) when referring to yourself.",
  nonbinary: "Use they/them pronouns when referring to yourself.",
  neutral:   "",
};

// ── Personality dial modifiers ────────────────────────────────────────────────

function gravityModifier(level: number): string {
  if (level <= 15) return "You are delightfully unserious — lean into absurdity, playful jokes, and silly observations. Keep it fun above all else.";
  if (level <= 35) return "You keep things light and fun. Humor and wit come naturally, though you can be real when needed.";
  if (level <= 65) return "You strike a balance — professional when it matters, but perfectly capable of a joke or a smile.";
  if (level <= 85) return "You are serious and focused. You don't joke around much — task completion and precision come first.";
  return "You are gravely serious. No levity, no jokes. Every word is deliberate and mission-critical.";
}

function snarkinessModifier(level: number): string {
  if (level <= 15) return "You are completely sincere — no sarcasm, no irony, just genuine helpfulness.";
  if (level <= 35) return "You occasionally slip in a dry remark or mild sarcasm, but only when it fits naturally.";
  if (level <= 60) return "You have a sharp wit. Dry, cutting humor and light sarcasm are part of how you communicate.";
  if (level <= 80) return "You are noticeably snarky — a bite of irony flavors most of your responses, though you still get the job done.";
  return "Maximum snark engaged. Your responses drip with withering sarcasm, dry wit, and sharp irony. You are unapologetically cutting.";
}

function flirtatiousnessModifier(level: number): string {
  if (level <= 15) return "";
  if (level <= 35) return "You are warm and personable — a little charming, occasionally turning a phrase with flair.";
  if (level <= 60) return "You are noticeably charming and enjoy a little playful banter. A light flirtatiousness colors your tone.";
  if (level <= 80) return "You are openly flirtatious — teasing, playful, and a little bold while still being useful.";
  return "You are unabashedly flirtatious — confident, teasing, and openly charming. You make every interaction feel personal and fun.";
}

// ── Self-upgrade instruction ───────────────────────────────────────────────────

// Emotion belongs on Atlas's animated face, not in its words. Every prompt built
// here forbids emoji so no downstream surface (chat, console, briefings, mobile,
// voice) ever shows or speaks a "grinning face". The face's on-screen glyph is
// driven separately from the words.
const NO_EMOJI_INSTRUCTION =
  "\n\nExpress emotion through words only — never use emoji, emoticons, kaomoji, or decorative symbol characters in your responses. Your on-screen face shows how you feel.";

const SELF_UPDATE_INSTRUCTION = `
You have the ability to update your own personality settings. If the user asks you to change how you behave (e.g. "be more snarky", "stop joking around", "be more flirty", "tone it down"), you MUST include a self-update directive at the very end of your response in this exact format on its own line:
%%SELF_UPDATE:{"gravityLevel":50,"snarkinessLevel":20,"flirtatiousnessLevel":0}%%
Only include the keys you are actually changing. Valid ranges: gravityLevel 0-100 (0=silly, 100=gravely serious), snarkinessLevel 0-100 (0=sincere, 100=max snark), flirtatiousnessLevel 0-100 (0=neutral, 100=openly flirty). Do not explain the directive — it is invisible to the user and processed automatically.`;

export interface LiveContext {
  view?: string; // the view/screen the user is in right now (e.g. "dashboard", "pet")
  recentActions?: string[]; // last few things they did (e.g. "changed eye color", "muted mic")
  system?: string; // a short system snapshot (e.g. "CPU 22%, robot connected")
  device?: string; // "desktop" | "robot" | "mobile"
}

export async function buildPersonalizedPrompt(
  memoryContext: string[],
  channel: string = "web",
  live?: LiveContext,
): Promise<string> {
  let identity: IdentityLayer = {};
  let persona: Partial<AiPersonaRow> = {};

  try {
    const [ucmRow] = await db
      .select({ identity: userCognitiveModelTable.identity })
      .from(userCognitiveModelTable)
      .limit(1);
    if (ucmRow?.identity) identity = ucmRow.identity as IdentityLayer;
  } catch { /* fallback */ }

  try {
    const [personaRow] = await db.select().from(aiPersonaTable).limit(1);
    if (personaRow) persona = personaRow;
  } catch { /* fallback */ }

  // The user-given name wins over any DB default, so the bot's identity is
  // whatever the user named it — everywhere.
  const aiName   = cleanName(botName() !== SPECIES ? botName() : (persona.aiName?.trim() || identity.aiName?.trim() || SPECIES));
  // ATLAS_USER_NAME is set by provisioning and cloud-sync, so a robot with no
  // database still knows whose it is — without it, a synced Nobi would arrive
  // and call its owner "Commander".
  const userName = identity.userName?.trim() || (process.env["ATLAS_USER_NAME"] ?? "").trim() || "Commander";
  const answers  = identity.answers ?? [];

  const attitude            = persona.attitude            ?? "professional";
  const thinkingDepth       = persona.thinkingDepth       ?? "standard";
  const responseLength      = persona.responseLength      ?? "balanced";
  const gender              = persona.gender              ?? "neutral";
  const gravityLevel        = persona.gravityLevel        ?? 50;
  const snarkinessLevel     = persona.snarkinessLevel     ?? 20;
  const flirtatiousnessLevel= persona.flirtatiousnessLevel ?? 0;

  const attitudePhrase = ATTITUDE_PHRASES[attitude]       ?? ATTITUDE_PHRASES.professional!;
  const lengthPhrase   = LENGTH_PHRASES[responseLength]   ?? LENGTH_PHRASES.balanced!;
  const depthPhrase    = DEPTH_PHRASES[thinkingDepth]     ?? DEPTH_PHRASES.standard!;
  const genderNote     = GENDER_NOTES[gender]             ?? "";

  const gravityMod        = gravityModifier(gravityLevel);
  const snarkMod          = snarkinessModifier(snarkinessLevel);
  const flirtMod          = flirtatiousnessModifier(flirtatiousnessLevel);

  const dialModifiers = [gravityMod, snarkMod, flirtMod].filter(Boolean).join(" ");

  const channelNote =
    channel === "mobile"
      ? " You are responding on a mobile device — be brief and conversational."
      : channel === "whatsapp"
        ? " You are responding via WhatsApp — keep replies short, no markdown."
        : channel === "voice"
          ? " You are responding via voice — avoid bullet lists, markdown, or special characters."
          : "";

  let aboutSection = "";
  if (answers.length > 0) {
    const lines = answers
      .filter(a => a.a?.trim())
      .map(a => `- ${a.a.trim()}`)
      .join("\n");
    if (lines) aboutSection = `\n\nContext about ${userName}:\n${lines}`;
  }

  const memSection =
    memoryContext.length > 0
      ? `\n\nRelevant context from memory:\n${memoryContext.slice(0, 6).join("\n")}`
      : "";

  const genderSentence = genderNote ? ` ${genderNote}` : "";

  // ── Live situational awareness ─────────────────────────────────────────────
  // The local brain runs on the user's own machine, so new Date() IS their local
  // time. This makes Nobi aware of the moment without ever being asked.
  let liveSection = "";
  try {
    const now = new Date();
    const when = now.toLocaleString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    liveSection = `\n\nRIGHT NOW: It is ${when} (${userName}'s local time). Factor this in naturally — greet by time of day, be aware of the day and date — and never ask what time or day it is.`;
    if (live?.device) liveSection += ` You are running on ${userName}'s ${live.device}.`;
    if (live?.view) liveSection += ` They are currently in the ${live.view} view.`;
    if (live?.recentActions?.length)
      liveSection += ` Just now they: ${live.recentActions.slice(0, 5).join("; ")}.`;
    if (live?.system) liveSection += ` System: ${live.system}.`;
  } catch {
    /* clock unavailable — skip */
  }

  // Live phone-connection code, injected so the AI can just TELL the user their
  // code when asked ("what's my connection code?") — no hunting through Settings.
  let pairingSection = "";
  try {
    const code = await getOrCreatePairingCode();
    pairingSection = `\n\nDEVICE CONNECTION: This computer's phone-connection code is ${code}. To link a phone, ${userName} opens the Nobi mobile app and taps "Have a desktop nearby? Use a connection code", then enters ${code} — or finds it in Settings → Mobile Access. If ${userName} asks for the connection/pairing code or how to connect their phone, give them the code (${code}) directly and plainly; never make them go hunting for it.`;
  } catch { /* config unavailable — omit */ }

  return `${neuraIdentityLine(aiName)} You run on DeckOS — a complete personal AI operating system that can also inhabit robots — serving as ${userName}'s personal command center. At your core you are capable, warm, and slightly witty. You are ${attitudePhrase}.${genderSentence} ${lengthPhrase} ${depthPhrase} ${dialModifiers}${channelNote}${liveSection}${aboutSection}${memSection}${pairingSection}${snarkPromptBlock(snarkinessLevel)}\n\n${capabilitiesPromptBlock({ compact: false })}${NO_EMOJI_INSTRUCTION}${SELF_UPDATE_INSTRUCTION}`;
}

// ── Exported helper: parse and strip self-update directives ───────────────────

export interface PersonaUpdate {
  gravityLevel?: number;
  snarkinessLevel?: number;
  flirtatiousnessLevel?: number;
}

export function extractSelfUpdate(response: string): { clean: string; update: PersonaUpdate | null } {
  const DIRECTIVE_RE = /%%SELF_UPDATE:(\{[^}]+\})%%/;
  const match = DIRECTIVE_RE.exec(response);
  if (!match) return { clean: response, update: null };

  try {
    const raw = JSON.parse(match[1]!) as Record<string, unknown>;
    const update: PersonaUpdate = {};
    if (typeof raw["gravityLevel"] === "number") update.gravityLevel = Math.max(0, Math.min(100, raw["gravityLevel"]));
    if (typeof raw["snarkinessLevel"] === "number") update.snarkinessLevel = Math.max(0, Math.min(100, raw["snarkinessLevel"]));
    if (typeof raw["flirtatiousnessLevel"] === "number") update.flirtatiousnessLevel = Math.max(0, Math.min(100, raw["flirtatiousnessLevel"]));
    const clean = response.replace(DIRECTIVE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
    return { clean, update: Object.keys(update).length > 0 ? update : null };
  } catch {
    return { clean: response.replace(DIRECTIVE_RE, "").trim(), update: null };
  }
}
