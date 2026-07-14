import type { FaceState } from "@/components/faces/AtlasFace";
import { glyphFor } from "@/components/faces/atlasFaceEngine";

/**
 * Emotion director — makes Atlas *act* while it talks.
 *
 * It reads the AI's reply, splits it into sentences, and tags each with an
 * emotion from a keyword/punctuation lexicon. Each emotion maps to a face pose
 * plus (optionally) an eye colour and a disc tint — so Atlas's eyes go slanted
 * and red for a moment when it's angry, dart side to side when it's being sneaky,
 * arc up when it's happy, and so on, timed to the words being spoken.
 */

export type Emotion =
  | "neutral"
  | "happy"
  | "excited"
  | "angry"
  | "suspicious"
  | "sad"
  | "confused"
  | "thinking"
  | "love"
  | "surprised"
  | "proud"
  | "playful"
  | "grateful"
  | "celebrating"
  | "curious"
  | "cool";

export interface EmotionStyle {
  expression: FaceState;
  /** "r,g,b" eye colour override, or null to keep the user's chosen colour. */
  eyeColor: string | null;
  /** "r,g,b" disc tint, or null. */
  discTint: string | null;
  /** Semantic emoji key resolved against the ACTIVE pack at render (see emojiGlyph). */
  emojiKey?: string;
}

/** Resolve an emotion's accent glyph in whatever emoji pack is active. */
export function emojiGlyph(style: EmotionStyle): string | null {
  return style.emojiKey ? glyphFor(style.emojiKey) : null;
}

// Mood → face. Eye colours are deliberately restrained; only anger reddens the
// disc. Several moods also carry an accent glyph from EMOJI_PACKS core — the
// face flashes it above the eyes while the eyes hold the base pose.
export const EMOTION_STYLE: Record<Emotion, EmotionStyle> = {
  neutral:    { expression: "talking",    eyeColor: null,          discTint: null },
  happy:      { expression: "happy",      eyeColor: null,          discTint: null, emojiKey: "star" },
  excited:    { expression: "excited",    eyeColor: "255,214,120", discTint: null, emojiKey: "sparkle" },
  angry:      { expression: "angry",      eyeColor: "232,74,58",   discTint: "150,36,30" },
  suspicious: { expression: "suspicious", eyeColor: "214,182,110", discTint: null },
  sad:        { expression: "sad",        eyeColor: "126,158,196", discTint: null },
  confused:   { expression: "confused",   eyeColor: null,          discTint: null, emojiKey: "question" },
  thinking:   { expression: "thinking",   eyeColor: null,          discTint: null },
  // Widened spectrum — several now use the new expressive forms (heart/star/wink).
  love:       { expression: "love",       eyeColor: "236,138,160", discTint: null, emojiKey: "love" },
  surprised:  { expression: "excited",    eyeColor: "255,214,120", discTint: null, emojiKey: "exclaim" },
  proud:      { expression: "happy",      eyeColor: null,          discTint: null, emojiKey: "ok" },
  playful:    { expression: "wink",       eyeColor: null,          discTint: null, emojiKey: "wink" },
  grateful:   { expression: "love",       eyeColor: "236,138,160", discTint: null, emojiKey: "love" },
  celebrating:{ expression: "starstruck", eyeColor: "255,214,120", discTint: null, emojiKey: "sparkle" },
  curious:    { expression: "listening",  eyeColor: null,          discTint: null, emojiKey: "question" },
  cool:       { expression: "idle",       eyeColor: "150,180,205", discTint: null, emojiKey: "cool" },
};

// Keyword lexicon. Matched case-insensitively as substrings/word-ish hits.
const LEXICON: Record<Exclude<Emotion, "neutral">, string[]> = {
  angry: ["angry", "furious", "mad", "unacceptable", "warning", "danger", " stop", "no way",
    "never", "seriously", "enough", "frustrat", "annoy", "outrage", "do not ", "don't you",
    "watch out", "back off", "how dare", "not okay", "absolutely not", "ridiculous"],
  suspicious: ["suspicious", "sneaky", "sketchy", "hmm", "secret", "hiding", "sneak", "fishy",
    "are you sure", "sure about", "i wonder", "trust", "up to something", "between us",
    "don't tell", "quietly", "behind"],
  happy: ["great", "love", "wonderful", "awesome", "glad", "happy", "delight", "perfect",
    "excellent", "good idea", "sounds good", "of course", "absolutely!", "brilliant",
    "fantastic", "yay", "wonderful", "my pleasure", "thank you", "thanks"],
  excited: ["wow", "amazing", "incredible", "can't wait", "cannot wait", "exciting", "let's go",
    "lets go", "whoa", "epic", "so cool", "unbelievable", "this is huge", "here we go"],
  sad: ["sorry", "unfortunately", "afraid", "sadly", "apolog", "regret", "too bad", "i can't",
    "i cannot", "unable", "bummer", "wish i could", "disappoint"],
  confused: ["confused", "not sure", "unsure", "i don't know", "i do not know", "unclear",
    "what do you mean", "no idea", "puzzl", "strange"],
  thinking: ["let me think", "thinking", "one moment", "calculating", "working on it",
    "give me a second", "let me check", "let me see", "hmm, let"],
  love: ["i love you", "adorable", "my favorite", "aww"],
  surprised: ["what?!", "no way", "really?!", "surprising", "whoa", "didn't expect"],
  proud: ["well done", "proud of you", "great job", "you nailed it", "impressive"],
  playful: ["haha", "lol", "just kidding", "kidding", "teasing", "tease", "fun"],
  grateful: ["thank you so much", "grateful", "appreciate it", "means a lot"],
  celebrating: ["congratulations", "congrats", "we did it", "hooray", "let's celebrate"],
  curious: ["interesting", "tell me more", "i wonder", "curious", "what if"],
  cool: ["no problem", "got it", "easy", "sure thing", "on it", "cool"],
};

// Order = tie-break priority (earlier wins on equal score). More specific /
// compound-phrase moods sit ahead of generic ones so e.g. "great job" reads
// proud (not happy) and "thank you so much" reads grateful (not happy), while
// existing anger/suspicion behaviour is preserved ("no way"→angry, "i wonder"
// →suspicious). Punctuation still lets "whoa!" resolve excited over surprised.
const ORDER: Exclude<Emotion, "neutral">[] = [
  "angry", "suspicious", "surprised", "love", "grateful", "proud", "sad",
  "excited", "celebrating", "playful", "curious", "cool", "happy",
  "confused", "thinking",
];

/** Classify one sentence into an emotion. */
export function classify(sentence: string): Emotion {
  const t = " " + sentence.toLowerCase() + " ";
  const scores: Partial<Record<Emotion, number>> = {};
  for (const emo of ORDER) {
    let s = 0;
    for (const kw of LEXICON[emo]) if (t.includes(kw)) s++;
    if (s) scores[emo] = s;
  }
  // Punctuation nudges.
  const excl = (sentence.match(/!/g) || []).length;
  if (excl >= 1) scores.excited = (scores.excited ?? 0) + Math.min(excl, 2) * 0.5;
  if (/\?\s*$/.test(sentence)) scores.confused = (scores.confused ?? 0) + 0.4;

  let best: Emotion = "neutral";
  let bestScore = 0.6; // threshold so plain sentences stay neutral
  for (const emo of ORDER) {
    const sc = scores[emo] ?? 0;
    if (sc > bestScore) { best = emo; bestScore = sc; }
  }
  return best;
}

export interface EmotionSegment {
  text: string;
  emotion: Emotion;
  style: EmotionStyle;
}

/** Split a reply into sentences, tag each, and merge adjacent same-emotion runs. */
export function segmentReply(reply: string): EmotionSegment[] {
  const clean = reply.trim();
  if (!clean) return [];
  // Split on sentence enders while keeping them attached.
  const sentences = clean.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const segs: EmotionSegment[] = [];
  for (const s of sentences) {
    const emo = classify(s);
    const last = segs[segs.length - 1];
    if (last && last.emotion === emo) {
      last.text = (last.text + " " + s).trim();
    } else {
      segs.push({ text: s, emotion: emo, style: EMOTION_STYLE[emo] });
    }
  }
  return segs;
}

/** Overall dominant emotion of a reply (for a single-shot reaction). */
export function dominantEmotion(reply: string): Emotion {
  const segs = segmentReply(reply);
  const counts: Partial<Record<Emotion, number>> = {};
  for (const s of segs) counts[s.emotion] = (counts[s.emotion] ?? 0) + s.text.length;
  let best: Emotion = "neutral";
  let bestLen = 0;
  for (const [emo, len] of Object.entries(counts) as [Emotion, number][]) {
    if (emo !== "neutral" && len > bestLen) { best = emo; bestLen = len; }
  }
  return best;
}
