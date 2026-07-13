import { db, userCognitiveModelTable, aiPersonaTable } from "@workspace/db";

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

const SELF_UPDATE_INSTRUCTION = `
You have the ability to update your own personality settings. If the user asks you to change how you behave (e.g. "be more snarky", "stop joking around", "be more flirty", "tone it down"), you MUST include a self-update directive at the very end of your response in this exact format on its own line:
%%SELF_UPDATE:{"gravityLevel":50,"snarkinessLevel":20,"flirtatiousnessLevel":0}%%
Only include the keys you are actually changing. Valid ranges: gravityLevel 0-100 (0=silly, 100=gravely serious), snarkinessLevel 0-100 (0=sincere, 100=max snark), flirtatiousnessLevel 0-100 (0=neutral, 100=openly flirty). Do not explain the directive — it is invisible to the user and processed automatically.`;

export async function buildPersonalizedPrompt(
  memoryContext: string[],
  channel: string = "web",
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

  const aiName   = (persona.aiName?.trim() || identity.aiName?.trim()) || "JARVIS";
  const userName = identity.userName?.trim() || "Commander";
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
      ? `\n\nRecent context from memory:\n${memoryContext.slice(0, 3).join("\n")}`
      : "";

  const genderSentence = genderNote ? ` ${genderNote}` : "";

  return `You are ${aiName}, an advanced AI integrated into DeckOS — ${userName}'s personal command center. You are ${attitudePhrase}.${genderSentence} ${lengthPhrase} ${depthPhrase} ${dialModifiers}${channelNote}${aboutSection}${memSection}${SELF_UPDATE_INSTRUCTION}`;
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
