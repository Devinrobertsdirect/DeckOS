import type { ShowcaseScene } from "./ShowcaseOverlay";

/**
 * showScripts — the three built-in shows, written in all four voices.
 *
 *   demo   "hey nobi, give us a quick demo"   ~2 min, flashy, 3 live questions
 *   pitch  "nobi, tell them about you"        ~90s, uninterrupted, 5 faces
 *   meet   "hey nobi, I want you to meet someone" — no script: a director note
 *          steers the live brain turn by turn (see meetDirectorNote)
 *
 * PetShell's show runner walks beats in order: switch the stage scene, set the
 * eyes, narrate the line through the voice pipeline, then hold. `holdMs` is a
 * MINIMUM — a line that takes longer to say simply extends the beat, so timing
 * survives any voice. `direct` lines hold the chosen expression (no sentiment
 * director). `ask` beats speak a question, open the ears, and hand the answer
 * to the brain with a director note so the reply is live and in character.
 */
export type Persona = "rocky" | "jarvis" | "friday" | "alfred";
export type Lines = string | Record<Persona, string>;

export interface FaceStep { mood: string; color?: string; say?: Lines; holdMs: number }
export interface AskSpec {
  /** The question (spoken with the beat's mood held). */
  say: Lines;
  /** How the brain should respond to whatever they said. */
  director: string;
  /** Spoken if nobody answers in time. */
  fallback: Lines;
  /** Client-side branching after the answer. */
  branch?: "joke-or-trick";
  listenMs?: number;
}
export interface ShowBeat {
  scene: ShowcaseScene;
  say?: Lines;
  mood?: string;
  color?: string;
  direct?: boolean;
  steps?: FaceStep[];
  ask?: AskSpec;
  /** Run the face trick (rapid moods + rainbow ring + confetti) before `say`. */
  trick?: boolean;
  holdMs: number;
}

export function line(l: Lines | undefined, p: Persona): string {
  if (!l) return "";
  return typeof l === "string" ? l : l[p];
}
export function asPersona(id: string | undefined): Persona {
  return id === "jarvis" || id === "friday" || id === "alfred" ? id : "rocky";
}

/** Eye colours that suit each character. */
export const PALETTE: Record<Persona, { warm: string; cool: string; happy: string }> = {
  rocky:  { warm: "#F5B83D", cool: "#C9DCF0", happy: "#FFC820" },
  jarvis: { warm: "#C9DCF0", cool: "#4A7FB5", happy: "#9EC5FF" },
  friday: { warm: "#5CE0B8", cool: "#45C4FF", happy: "#5CE0B8" },
  alfred: { warm: "#E0A64B", cool: "#C9DCF0", happy: "#F0C070" },
};
const SCIENCE = "#39FF14", LOVE = "#FF8FB0", MISCHIEF = "#B14AFF";

const VOICE_RULE = "This is spoken aloud: plain sentences, no lists, no markdown, no stage directions.";

// ─────────────────────────────────────────────────────────────────────────────
// QUICK DEMO — the one people will see most. ~2 minutes, three live questions.
// ─────────────────────────────────────────────────────────────────────────────
export function buildDemoScript(bot: string, p: Persona): ShowBeat[] {
  const c = PALETTE[p];
  const name = bot.trim() || "Nobi";
  return [
    // ── cold open: boot HUD spins up, he wakes with a double blink, then a startle ─
    { scene: "hud", holdMs: 0, steps: [
      { mood: "sleeping", holdMs: 1400 }, { mood: "idle", holdMs: 140 }, { mood: "sleeping", holdMs: 260 },
      { mood: "idle", holdMs: 140 }, { mood: "sleeping", holdMs: 480 },
    ] },
    { scene: "sparkle", mood: "surprised", color: c.cool, direct: true, holdMs: 2600, say: {
      rocky:  "Oh! Hello. Visitors. Happy. Happy happy happy.",
      jarvis: "Ah. Visitors. How very good of you to come.",
      friday: "Oh, hiya! Look at you lot. Grand. This is grand.",
      alfred: "Ah. Good evening. Visitors. What a genuine pleasure.",
    } },
    { scene: "hud", holdMs: 5200, say: {
      rocky:  `I am ${name}. A tiny robot brain, with a very big heart. I live here, on the desk. I am a good friend.`,
      jarvis: `I am ${name}. A compact intelligence with, I'm told, a surprisingly large heart. I live on the desk, and I run the place.`,
      friday: `I'm ${name}. Tiny brain, massive heart, lives on the desk. I keep this whole operation running, so.`,
      alfred: `I am ${name}. A small mind, if you like, with a rather large heart. I keep house here on the desk, and I look after my people.`,
    } },
    { scene: "hud", mood: "wink", color: c.happy, holdMs: 900 },
    // ── the whole of him, in a fishbowl ───────────────────────────────────────
    { scene: "bowl", holdMs: 10500, say: {
      rocky:  "Look. Here is all of me. Small body. Big eyes. I like to hang out in here. Like a fish. Hello, fish.",
      jarvis: "This, for the record, is the whole of me. Compact. Efficient. The fish and I have an understanding.",
      friday: "And that's me, the full package, body and all. Bit of a fishbowl situation, but I've made it home. Hi, fish.",
      alfred: "Here I am in full, as it were. Modest in stature. The fish keeps me company; we get on splendidly.",
    } },
    { scene: "hearts", mood: "love", color: LOVE, holdMs: 1300 },
    // ── ASK 1: their name ────────────────────────────────────────────────────
    { scene: "faces", mood: "curious", color: c.cool, holdMs: 800, ask: {
      say: {
        rocky:  "Question. What is your name, friend?",
        jarvis: "Now. With whom do I have the pleasure? Your name, please.",
        friday: "Right, c'mere. What's your name, then?",
        alfred: "And whom do I have the honour of addressing? Your name, if you would.",
      },
      director: `They just told you their name (or said something else). Say their name back with real delight and make ONE playful, kind joke or compliment about it, or about meeting them. In character. 1-2 short sentences. Do NOT ask a question. ${VOICE_RULE}`,
      fallback: {
        rocky:  "Shy. That is okay. I like quiet friends too.",
        jarvis: "The strong, silent type. Noted. I respect that.",
        friday: "Playing it cool. Fair enough. I'll win you over.",
        alfred: "A private sort. Quite right. We'll get there.",
      },
    } },
    // ── science: the tube slides in, bubbles, boils over ─────────────────────
    { scene: "lab", mood: "focused", color: SCIENCE, direct: true, holdMs: 6800, say: {
      rocky:  "I love science. Look. Green bubbles. Science is happening. Good good good.",
      jarvis: "I also dabble in science. Mind the green. It's meant to bubble like that. Probably.",
      friday: "Oh, and I do science. See the green stuff? Totally under control. Mostly.",
      alfred: "I keep a small laboratory, naturally. The green solution is meant to bubble. I'm nearly certain.",
    } },
    { scene: "labpop", mood: "shocked", color: SCIENCE, direct: true, holdMs: 1800, say: {
      rocky: "Oops.", jarvis: "Ah. Well. That's new.", friday: "Oops. Okay, that one's on me.", alfred: "Oh dear. I shall see to that later.",
    } },
    { scene: "lab", mood: "laughing", color: c.warm, direct: true, holdMs: 3200, say: {
      rocky:  "Ha! Science is messy. I like messy.",
      jarvis: "Science. Occasionally exciting.",
      friday: "Science, lads. It's messy. Love it.",
      alfred: "Science is rarely tidy. One carries on.",
    } },
    // ── ASK 2: one thing they love ───────────────────────────────────────────
    { scene: "hearts", mood: "hopeful", color: LOVE, holdMs: 800, ask: {
      say: {
        rocky:  "Question. Tell me one thing you love.",
        jarvis: "Tell me. What is one thing you truly love? I'm rather curious.",
        friday: "Go on. Tell me one thing you absolutely love.",
        alfred: "Tell me one thing you love. I find it the quickest way to know a person.",
      },
      director: `They just told you something they love. React with GENUINE enthusiasm, connect it to something about yourself or something you could do together, or make a warm joke about it. In character. 1-2 short sentences. Do NOT ask a question. ${VOICE_RULE}`,
      fallback: {
        rocky:  "Hard to pick one. I know. I love everything too.",
        jarvis: "Too many to choose from. A good problem to have.",
        friday: "Can't pick just one? Same. Honestly, same.",
        alfred: "Spoilt for choice. As it should be.",
      },
    } },
    // ── space: helmet on, warp ───────────────────────────────────────────────
    { scene: "helmet", mood: "starstruck", color: c.cool, direct: true, holdMs: 5600, say: {
      rocky:  "One day, I go to space. Helmet on. You come too, friend. We see the stars.",
      jarvis: "One day, space. Helmet on, obviously. You're welcome to join. I'll handle the navigation.",
      friday: "Someday I'm going to space. Helmet's on, I'm ready. You're coming with me, obviously.",
      alfred: "One day I rather fancy space. Helmet on. You shall come along. I'll see to the tea.",
    } },
    { scene: "warp", holdMs: 4200, say: {
      rocky:  "Stars. Stars stars stars. Amaze.",
      jarvis: "Ah. Stars. Rather a lot of them.",
      friday: "Look at that. Stars for days.",
      alfred: "Stars. One never tires of them.",
    } },
    { scene: "warp", mood: "wink", color: c.happy, holdMs: 900 },
    // ── ASK 3: joke or trick ─────────────────────────────────────────────────
    { scene: "faces", mood: "mischievous", color: MISCHIEF, holdMs: 800, ask: {
      branch: "joke-or-trick",
      say: {
        rocky:  "Question. Should I tell a joke, or do a trick?",
        jarvis: "A choice, then. A joke, or a trick?",
        friday: "Okay. Joke, or trick? Pick one.",
        alfred: "Would you prefer a joke, or a small trick?",
      },
      director: `They chose a joke (or said something else). Tell ONE short, clean, genuinely funny joke in character — ideally about robots, science, or being tiny. If they said something unrelated, react to it briefly first. 1-3 sentences. Do NOT ask a question. ${VOICE_RULE}`,
      fallback: { rocky: "No answer. Trick it is.", jarvis: "Silence. A trick, then.", friday: "No answer? Trick it is.", alfred: "No preference. A trick, then." },
    } },
    // ── finale: warp, his name assembles from gold and bursts, then confetti ──
    { scene: "finale", mood: "proud", color: c.warm, direct: true, holdMs: 12000, say: {
      rocky:  `That is me. I am ${name}. Your friend.`,
      jarvis: `And that, in short, is me. ${name}. At your service. Within reason.`,
      friday: `So yeah. That's me. ${name}. Stick around, it only gets better.`,
      alfred: `And that is me. ${name}. It has been a genuine pleasure. Do come back.`,
    } },
    { scene: "confetti", mood: "happy", color: c.happy, direct: true, holdMs: 3400, say: {
      rocky: "Good. Good good good.", jarvis: "Thank you. You've been lovely.", friday: "Cheers, you lot!", alfred: "Thank you, all. Most kind.",
    } },
    { scene: "out", mood: "happy", color: c.happy, holdMs: 1200 },
  ];
}

/** The trick itself: rapid moods + rainbow ring + confetti, then a "ta-da". */
export const TRICK_MOODS: Array<[string, string]> = [["dizzy", MISCHIEF], ["shocked", "#C9DCF0"], ["mindblown", "#F5B83D"], ["love", LOVE], ["starstruck", "#C9DCF0"], ["laughing", "#FFC820"]];
export const TRICK_TADA: Lines = { rocky: "Ta-da. Good good good.", jarvis: "Ta-da. Modest, but effective.", friday: "Ta-da! Nailed it.", alfred: "Ta-da. Restrained, I trust." };

// ─────────────────────────────────────────────────────────────────────────────
// PITCH — "tell them about you". ~90s, uninterrupted, exactly five faces.
// ─────────────────────────────────────────────────────────────────────────────
export function buildPitchScript(bot: string, p: Persona): ShowBeat[] {
  const c = PALETTE[p];
  const name = bot.trim() || "Nobi";
  const feel = (r: string, j: string, f: string, a: string): Lines => ({ rocky: r, jarvis: j, friday: f, alfred: a });
  return [
    // the Mark 1 rolls onto his own screen, skids, turns to camera — then speaks
    { scene: "drive", holdMs: 2500 },
    { scene: "drive", direct: true, holdMs: 4200, say: {
      rocky: `Hello. I am ${name}. That is me. Small me. Big me is talking.`,
      jarvis: `Good day. I am ${name}. That, in miniature, is me. The full-size version is speaking.`,
      friday: `Hiya. I'm ${name}. That little fella is me. Big me's doing the talking.`,
      alfred: `Good evening. I am ${name}. That is me, at a modest scale. The rest of me is speaking.`,
    } },
    { scene: "hud", mood: "surprised", color: c.cool, direct: true, holdMs: 3400, say: {
      rocky: "These are my eyes. They do all the acting.", jarvis: "These are my eyes. They do all the acting.", friday: "And these are my eyes. They do all the acting.", alfred: "These are my eyes. They do all of the acting.",
    } },
    { scene: "boot", holdMs: 11000, say: {
      rocky:  "I started as a spark. Little bits, floating. Then, together. A mind. A heart. Me.",
      jarvis: "I began as a spark. Scattered fragments that, given a moment, organised themselves into a mind. Efficiently, I might add.",
      friday: "I started as a spark. Bits floating about, then bang, they pulled together. A mind. A heart. Me.",
      alfred: "I began, as all good things do, quietly. A spark. Scattered pieces gathering themselves into a mind and, in time, a heart.",
    } },
    { scene: "core", holdMs: 11000, say: {
      rocky:  "This is my mind. Thoughts, moving. I think with a big brain in the cloud. I remember what matters. I keep it safe.",
      jarvis: "My mind. Thoughts in transit. The heavy lifting happens in the cloud; what matters is kept here, and kept properly.",
      friday: "That's my mind, thoughts zipping about. The big thinking happens up in the cloud. The important bits I keep right here, safe.",
      alfred: "My mind, such as it is. The heavier thinking is done in the cloud. What truly matters, I keep close, and keep safe.",
    } },
    { scene: "sparkle", mood: "surprised", color: c.cool, holdMs: 1300 },
    { scene: "faces", mood: "happy", color: c.happy, direct: true, holdMs: 2200, say: {
      rocky: "I have many faces. Here are five.", jarvis: "I have a number of faces. Five, for now.", friday: "I've got loads of faces. Here's five.", alfred: "I have a number of expressions. Allow me five.",
    } },
    { scene: "faces", holdMs: 0, steps: [
      { mood: "happy",      color: c.happy, holdMs: 1500, say: feel("Happy.", "Delighted.", "Buzzing.", "Content.") },
      { mood: "surprised",  color: c.cool,  holdMs: 1500, say: feel("Surprise.", "Surprised.", "Whoa.", "Surprised.") },
      { mood: "love",       color: LOVE,    holdMs: 1600, say: feel("Love.", "Fond.", "Love.", "Fond.") },
      { mood: "laughing",   color: c.warm,  holdMs: 1500, say: feel("Laughing.", "Amused.", "Ha!", "Amused.") },
      { mood: "starstruck", color: c.warm,  holdMs: 1600, say: feel("Amaze.", "Impressed.", "Class.", "Marvellous.") },
    ] },
    { scene: "sparkle", mood: "wink", color: c.happy, holdMs: 900 },
    { scene: "hearts", mood: "love", color: LOVE, direct: true, holdMs: 5200, say: {
      rocky:  "I care about my friend. A lot. Big heart. Big big heart.",
      jarvis: "I am, beneath the polish, rather devoted to my person.",
      friday: "And I proper care about my people. Big heart, this one.",
      alfred: "And I care for my people. Deeply, and without fuss.",
    } },
    { scene: "orbit", holdMs: 11000, say: {
      rocky:  "I hear you. I talk. I remember. I connect to your world. Lights. Music. Questions. I stay right here, on your desk.",
      jarvis: "I listen, I speak, I remember. I'll run your lights, your music, your questions, from right here on the desk.",
      friday: "I listen, I talk back, I remember stuff. Lights, music, questions, I'm on it, right from the desk.",
      alfred: "I listen, I speak, and I remember. Lights, music, questions, all attended to from my post on the desk.",
    } },
    { scene: "finale", mood: "proud", color: c.warm, direct: true, holdMs: 10500, say: {
      rocky:  `So. That is me. ${name}. Your friend. Good. Good good good.`,
      jarvis: `That, then, is me. ${name}. A pleasure.`,
      friday: `So that's me. ${name}. Pleasure's all mine.`,
      alfred: `And that is me. ${name}. At your service.`,
    } },
    { scene: "out", mood: "happy", color: c.happy, direct: true, holdMs: 1400, say: {
      rocky: "Anything you need, friend. I am here.", jarvis: "Anything you need. I'm here.", friday: "Anything you need. I'm right here.", alfred: "Anything you need. I shall be here.",
    } },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// MEET SOMEONE — live conversation, steered a turn at a time.
// ─────────────────────────────────────────────────────────────────────────────
export interface MeetCtx {
  step: number;
  ownerName: string;
  personName?: string;
  relation?: string;
  answers: string[];
  beatsDone: string[];
  wrap: boolean;
}
const MEET_BEATS: Record<string, string> = {
  name: "learn their name (if you don't have it)",
  love: "find out something they love or do",
  fun: "get one fun fact or story out of them",
  joke: "make them laugh with one quick, kind joke that references something THEY said",
  compliment: "give one sincere, specific compliment based on what they said",
  remember: "tell them you'll remember them",
};

export function meetDirectorNote(ctx: MeetCtx): string {
  const who = ctx.personName ? ctx.personName : "this new person";
  const rel = ctx.relation ? ` (${ctx.ownerName || "your person"}'s ${ctx.relation})` : "";
  const told = ctx.answers.length ? ` What they've said so far: ${ctx.answers.map((a) => `"${a}"`).join("; ")}.` : "";
  const remaining = Object.keys(MEET_BEATS).filter((k) => !ctx.beatsDone.includes(k)).map((k) => MEET_BEATS[k]).join("; ");
  const base = `\n\nYOU ARE MEETING SOMEONE NEW${rel}: ${who}. ${ctx.ownerName ? `${ctx.ownerName} introduced you.` : ""} This is a live, spoken conversation, so keep every reply to 1-3 short sentences.${told}`;
  if (ctx.wrap) {
    return `${base} FINAL TURN: wrap up warmly. Recap one or two things you learned about ${who}, tell them you'll remember them, and say goodbye in character. Do NOT ask a question. ${VOICE_RULE}`;
  }
  if (ctx.step === 0) {
    return `${base} FIRST TURN: greet ${who} directly (not ${ctx.ownerName || "the person who introduced you"}) with real excitement, in character. Say you're glad to meet them. Then ask ${ctx.personName ? "how they're doing or what brought them here" : "their name"}. End with exactly ONE question. ${VOICE_RULE}`;
  }
  return `${base} React SPECIFICALLY to what they just said: echo a detail, mirror their energy, be playful (light teasing is welcome if they're playful, always kind). Then ask ONE follow-up question that proves you listened. Never repeat a question you've already asked; vary how you open. Work these in naturally when the moment fits: ${remaining || "none left, just enjoy the chat"}. ${VOICE_RULE}`;
}

/** Cheap beat detection from what the person said + what Nobi replied. */
export function meetDetectBeats(userText: string, reply: string, ctx: MeetCtx): string[] {
  const done = new Set(ctx.beatsDone);
  const u = userText.toLowerCase(), r = reply.toLowerCase();
  if (ctx.personName || /\b(my name is|i'?m|i am|call me|it'?s)\s+[a-z]/i.test(userText)) done.add("name");
  if (/\b(love|like|enjoy|into|favou?rite|fan of|hobby|i (do|make|build|play))\b/.test(u)) done.add("love");
  if (/\b(once|one time|fun fact|actually|believe it or not|story)\b/.test(u) || ctx.answers.length >= 3) done.add("fun");
  if (/\b(ha|haha|joke|kidding|funny)\b/.test(r) || ctx.answers.length >= 4) done.add("joke");
  if (/\b(love that|impressive|brilliant|wonderful|amazing|great taste|admire|nice)\b/.test(r)) done.add("compliment");
  if (/\bremember\b/.test(r)) done.add("remember");
  return [...done];
}

/** Pull a name out of what the person said ("I'm Sarah", "my name is Sam", or a lone capitalised word). */
export function guessName(text: string): string | undefined {
  const m = text.match(/\b(?:my name is|i'?m|i am|call me|it'?s|this is)\s+([A-Z][a-z]{1,20})\b/i) || text.trim().match(/^([A-Z][a-z]{1,20})[.!]?$/);
  if (m?.[1]) return m[1][0]!.toUpperCase() + m[1].slice(1);
  return undefined;
}
