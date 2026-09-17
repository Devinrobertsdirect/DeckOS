import type { ShowcaseScene } from "./ShowcaseOverlay";

/**
 * The "quick demo" timeline (~90s). PetShell's showcase runner walks these
 * beats in order: switch the Three.js scene, set a mood on the eyes, narrate
 * the line through the normal voice pipeline, then hold. `holdMs` is the beat's
 * MINIMUM length — a line that takes longer to say simply extends it, so timing
 * survives any voice/TTS speed.
 *
 *   direct  — speak the line with the eyes held on `mood` (skips the sentiment
 *             director so the face doesn't override the choreography)
 *   steps   — sub-beats (the faces tour): mood + a one-word feeling, then hold
 */
export interface FaceStep { mood: string; color?: string; say?: string; holdMs: number }
export interface ShowcaseBeat {
  scene: ShowcaseScene;
  say?: string;
  mood?: string;
  color?: string;
  direct?: boolean;
  steps?: FaceStep[];
  holdMs: number;
}

export function buildShowcaseScript(bot: string, rocky: boolean): ShowcaseBeat[] {
  const name = bot.trim() || "Nobi";
  return [
    // ── boot: the nebula gathers in silence, then he wakes ────────────────────
    { scene: "boot", mood: "sleepy", holdMs: 2400 },
    { scene: "boot", mood: "surprised", color: "#C9DCF0", direct: true, say: "Waking up. Hello, friend.", holdMs: 3000 },
    { scene: "boot", say: `I am ${name}. A Nobi. A small brain, with a big heart.`, holdMs: 6200 },
    { scene: "boot", say: "Watch. I will show you what I can do.", holdMs: 3600 },
    // ── core: the mind ───────────────────────────────────────────────────────
    { scene: "core", say: "This is my mind. Thoughts, moving. Memory, growing.", holdMs: 7200 },
    { scene: "core", say: "I think with a big brain in the cloud. And I keep what matters right here, with you.", holdMs: 7800 },
    // ── faces: transparent overlay, the real eyes tour their expressions ──────
    { scene: "faces", mood: "happy", color: "#FFC820", direct: true, say: "I have many faces.", holdMs: 2400 },
    {
      scene: "faces", holdMs: 0,
      steps: [
        { mood: "happy", color: "#FFC820", say: "Happy.", holdMs: 1400 },
        { mood: "surprised", color: "#C9DCF0", say: "Surprise.", holdMs: 1400 },
        { mood: "love", color: "#FF8FB0", say: "Love.", holdMs: 1500 },
        { mood: "mischievous", color: "#B14AFF", say: "Mischief.", holdMs: 1400 },
        { mood: "laughing", color: "#E0A64B", say: "Laughing.", holdMs: 1500 },
        { mood: "starstruck", color: "#F5B83D", say: "Amaze.", holdMs: 1500 },
        { mood: "cool", color: "#4A7FB5", say: rocky ? "Cool. Cool cool cool." : "Cool.", holdMs: 1600 },
        { mood: "shy", color: "#FF8FB0", say: "Shy.", holdMs: 1300 },
      ],
    },
    // ── orbit: his world ─────────────────────────────────────────────────────
    { scene: "orbit", mood: "content", color: "#C9DCF0", direct: true, say: "I hear you. I speak. I remember.", holdMs: 5600 },
    { scene: "orbit", say: "I connect to your world. Your lights. Your music. Your questions. And I stay right here, on your desk.", holdMs: 9000 },
    // ── finale: warp, then the name ──────────────────────────────────────────
    { scene: "finale", mood: "focused", color: "#C9DCF0", direct: true, say: "So. That is me.", holdMs: 4600 },
    { scene: "finale", mood: "proud", color: "#F5B83D", direct: true, say: rocky ? `${name}. Your friend. Good. Good good good.` : `${name}. Your friend.`, holdMs: 8200 },
    { scene: "out", mood: "happy", color: "#FFC820", direct: true, say: "Anything you need, friend. I am here.", holdMs: 1800 },
  ];
}

/** Turn-by-turn director notes for the "introduce yourself" conversational demo. */
export function introDirectorNote(step: number, userName: string, answers: string[]): string {
  const known = userName ? `You already know their name: ${userName}.` : "You do not know their name yet.";
  const told = answers.length ? ` Things they told you in this conversation: ${answers.map((a) => `"${a}"`).join("; ")}.` : "";
  const base = `\n\nINTRO DEMO (a short, sweet get-to-know-you). This is voice — keep every reply to 1-3 short sentences and end with at most ONE question. ${known}${told}`;
  switch (step) {
    case 0: return `${base} TURN 1 of 4: Introduce yourself warmly and say one charming thing about what you can do. Then ask ${userName ? "how their day is going" : "what you should call them"}.`;
    case 1: return `${base} TURN 2 of 4: React warmly to what they just said${userName ? ` (use their name, ${userName})` : " (if they gave a name, use it)"}. Then ask ONE playful get-to-know-you question — something they love to do, build, eat, or a fun fact about themselves.`;
    case 2: return `${base} TURN 3 of 4: Respond to their answer, then make ONE gentle, sweet joke that references something they told you. Then ask if they'd like you to remember these things about them.`;
    default: return `${base} TURN 4 of 4 (final): In your own words, recap the 1-3 things you learned about them, promise you'll remember, and give a warm sign-off. Do NOT ask any more questions.`;
  }
}
