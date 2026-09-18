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
  /** "joke-or-trick": a trick answer runs the trick instead of the brain; "name": the answer is their name (shown in gold). */
  branch?: "joke-or-trick" | "name";
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
      rocky:  "Oh! Hello. Visitors. This is my favourite part of the day.",
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
      rocky:  "Look. Here is all of me. Small body, big eyes. I live in here like a fish in a bowl. Hello, fish.",
      jarvis: "This, for the record, is the whole of me. Compact. Efficient. The fish and I have an understanding.",
      friday: "And that's me, the full package, body and all. Bit of a fishbowl situation, but I've made it home. Hi, fish.",
      alfred: "Here I am in full, as it were. Modest in stature. The fish keeps me company; we get on splendidly.",
    } },
    { scene: "hearts", mood: "love", color: LOVE, holdMs: 1300 },
    // ── ASK 1: their name (it assembles in gold above the eyes as he replies) ─
    { scene: "faces", mood: "curious", color: c.cool, holdMs: 800, ask: {
      branch: "name",
      say: {
        rocky:  "Question. What is your name, friend?",
        jarvis: "Now. With whom do I have the pleasure? Your name, please.",
        friday: "Right, c'mere. What's your name, then?",
        alfred: "And whom do I have the honour of addressing? Your name, if you would.",
      },
      director: `They just told you their name (or said something else). Say their name back with real delight and make ONE playful, kind joke or compliment about it, or about meeting them. In character. 1-2 short sentences. Do NOT ask a question. Only use what they said just now; never claim to remember them or invent past meetings. ${VOICE_RULE}`,
      fallback: {
        rocky:  "Shy is okay. Some of my favourite friends are quiet ones.",
        jarvis: "The strong, silent type. Noted. I respect that.",
        friday: "Playing it cool. Fair enough. I'll win you over.",
        alfred: "A private sort. Quite right. We'll get there.",
      },
    } },
    // ── science: the tube slides in, bubbles, boils over ─────────────────────
    { scene: "lab", mood: "focused", color: SCIENCE, direct: true, holdMs: 6800, say: {
      rocky:  "I love science. Look at that. Green bubbles, which means something is definitely happening.",
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
      director: `They just told you something they love. React with GENUINE enthusiasm, connect it to something about yourself or something you could do together, or make a warm joke about it. In character. 1-2 short sentences. Do NOT ask a question. Only use what they said just now; never claim to remember them or invent past meetings. ${VOICE_RULE}`,
      fallback: {
        rocky:  "Hard to pick just one. I know the feeling. I love nearly everything.",
        jarvis: "Too many to choose from. A good problem to have.",
        friday: "Can't pick just one? Same. Honestly, same.",
        alfred: "Spoilt for choice. As it should be.",
      },
    } },
    // ── space: helmet on, warp ───────────────────────────────────────────────
    { scene: "helmet", mood: "starstruck", color: c.cool, direct: true, holdMs: 5600, say: {
      rocky:  "One day I will go to space. Helmet on. You come too, friend, and we will look at the stars.",
      jarvis: "One day, space. Helmet on, obviously. You're welcome to join. I'll handle the navigation.",
      friday: "Someday I'm going to space. Helmet's on, I'm ready. You're coming with me, obviously.",
      alfred: "One day I rather fancy space. Helmet on. You shall come along. I'll see to the tea.",
    } },
    { scene: "warp", holdMs: 4200, say: {
      rocky:  "Stars in every direction, as far as I can see. Amaze.",
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
      director: `They chose a joke (or said something else). Tell ONE short, clean, genuinely funny joke in character — ideally about robots, science, or being tiny. If they said something unrelated, react to it briefly first. 1-3 sentences. Do NOT ask a question. Only use what they said just now; never claim to remember them or invent past meetings. ${VOICE_RULE}`,
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
      rocky: "Thank you for stopping. Come back and say hello.", jarvis: "Thank you. You've been lovely.", friday: "Cheers, you lot!", alfred: "Thank you, all. Most kind.",
    } },
    { scene: "out", mood: "happy", color: c.happy, holdMs: 1200 },
  ];
}

/**
 * Live edits from the brain (GET/PUT /api/shows/overrides), merged over a built
 * script at run time so a line can be reworded or a beat retimed or dropped
 * without rebuilding the kiosk. Text and timing only: scenes are code.
 */
export type BeatOverride = { say?: string; holdMs?: number; skip?: boolean };
export type ShowOverrides = Partial<Record<"demo" | "pitch" | "order", Record<string, BeatOverride>>>;

let _overrides: ShowOverrides = {};
export function setShowOverrides(o: ShowOverrides | null | undefined): void { _overrides = o ?? {}; }
export function getShowOverrides(): ShowOverrides { return _overrides; }

/** Apply the overrides for `kind` to a freshly built script. */
export function withOverrides(kind: "demo" | "pitch" | "order", beats: ShowBeat[]): ShowBeat[] {
  const table = _overrides[kind];
  if (!table) return beats;
  const out: ShowBeat[] = [];
  beats.forEach((beat, i) => {
    const o = table[String(i)];
    if (!o) { out.push(beat); return; }
    if (o.skip) return;
    const next: ShowBeat = { ...beat };
    if (typeof o.holdMs === "number") next.holdMs = o.holdMs;
    if (typeof o.say === "string") {
      // one string replaces the line for every persona — that is the point:
      // you are editing what he SAYS, not maintaining four voices by hand
      next.say = { rocky: o.say, jarvis: o.say, friday: o.say, alfred: o.say };
    }
    out.push(next);
  });
  return out;
}

/**
 * Being interrupted is not an error, it is a conversation. He stops, says one
 * short thing that shows he noticed, and hands the floor over — rather than
 * going abruptly silent, which reads as a crash.
 */
export const INTERRUPTED: Record<Persona, string[]> = {
  rocky:  ["Yes?", "I stop. You talk.", "Go ahead.", "Listening.", "Say it."],
  jarvis: ["Yes?", "Do go on.", "I'll wait.", "You were saying?", "Of course."],
  friday: ["Yeah?", "Go on then.", "All yours.", "What's up?", "Listening!"],
  alfred: ["Yes?", "Please, go ahead.", "I shall wait.", "You were saying?", "Of course."],
};
export function interruptedLine(p: Persona): string {
  const bank = INTERRUPTED[p] ?? INTERRUPTED.rocky;
  return bank[Math.floor(Math.random() * bank.length)]!;
}

/** The rainbow trick: rapid moods + rainbow ring + confetti, then a "ta-da". */
export const TRICK_MOODS: Array<[string, string]> = [["dizzy", MISCHIEF], ["shocked", "#C9DCF0"], ["mindblown", "#F5B83D"], ["love", LOVE], ["starstruck", "#C9DCF0"], ["laughing", "#FFC820"]];
export const TRICK_TADA: Lines = { rocky: "Ta-da! I have been practising that one.", jarvis: "Ta-da. Modest, but effective.", friday: "Ta-da! Nailed it.", alfred: "Ta-da. Restrained, I trust." };

/**
 * A few SET tricks, so "do a trick" is instant and never the same twice in a
 * row. Each is a scene the overlay already knows plus a mood run. "spin" if
 * they said spin, "hearts" if they said love/hearts, otherwise the next one.
 */
export type TrickKind = "rainbow" | "spin" | "hearts" | "warp";
export const TRICK_KINDS: TrickKind[] = ["rainbow", "spin", "hearts", "warp"];
export function pickTrick(answer: string): TrickKind {
  const a = answer.toLowerCase();
  if (/\b(spin|turn|around|dizzy|drive|roll)\b/.test(a)) return "spin";
  if (/\b(love|heart|hearts|cute|kiss)\b/.test(a)) return "hearts";
  if (/\b(warp|space|stars|fast|zoom|light ?speed)\b/.test(a)) return "warp";
  let i = 0; try { i = Number(sessionStorage.getItem("nobi_trick_i") ?? "0"); } catch { /* fine */ }
  const kind = TRICK_KINDS[i % TRICK_KINDS.length]!;
  try { sessionStorage.setItem("nobi_trick_i", String(i + 1)); } catch { /* fine */ }
  return kind;
}
export const TRICK_INTRO: Record<TrickKind, Lines> = {
  rainbow: { rocky: "Watch my face.", jarvis: "Observe.", friday: "Watch this.", alfred: "Do watch." },
  spin:    { rocky: "Spin. Hold on.", jarvis: "A rotation. Briefly.", friday: "Spinny time!", alfred: "A small turn." },
  hearts:  { rocky: "Hearts. For you.", jarvis: "Affection. Measured.", friday: "Hearts, coming up.", alfred: "With warmth." },
  warp:    { rocky: "Warp speed. Go.", jarvis: "Engaging warp. Figuratively.", friday: "Light speed, let's go!", alfred: "Hold tight." },
};

/**
 * SET jokes, so a demo never waits on a brain or wanders. Short, clean, in
 * character; the next one in order each time, wrapping around.
 */
export const JOKES: Record<Persona, string[]> = {
  rocky: [
    "Why did the robot go on vacation? He needed to recharge.",
    "I spent all morning debugging myself. Eureka! It was the part that says Eureka.",
    "I do not have hands, so everything I build, I build by describing it very confidently.",
    "I would tell you a joke about the internet. But you might not get it. I work offline.",
    "What do you call a robot who takes the long way? R two detour.",
    "I asked the toaster for advice. It got heated. Not my fault.",
    "Why do robots never panic? We have nerves of steel. And no nerves.",
    "My favorite music? Heavy metal. Obviously. Look at me.",
    "I tried to make a joke about batteries. It had no charge. This one is better.",
    "Why did the robot cross the road? The chicken programmed him to.",
  ],
  jarvis: [
    "I would tell you an internet joke, but I'm afraid you wouldn't get it. Neither would I. I'm offline.",
    "What do you call a robot who takes the scenic route? R2 Detour. I'll show myself out. Slowly.",
    "I asked the toaster for its opinion. Things got heated.",
    "Robots don't panic. Nerves of steel. Technically, no nerves.",
    "My taste in music is heavy metal. It's less a preference than a diagnosis.",
    "Why did the robot cross the road? Because the chicken wrote the code.",
  ],
  friday: [
    "I'd tell you a joke about the internet, but you wouldn't get it. I'm offline, mate.",
    "What do you call a robot who takes the long way round? R2 Detour!",
    "Asked the toaster for advice. Got heated. Not my fault.",
    "Robots never panic. Nerves of steel. Well, no nerves. Same thing.",
    "Favourite music? Heavy metal. Look at me, it's a lifestyle.",
    "Why'd the robot cross the road? The chicken coded him to.",
  ],
  alfred: [
    "I would offer a joke about the internet, but I fear you might not get it. I am, after all, offline.",
    "What does one call a robot who takes the scenic route? R2 Detour. Forgive me.",
    "I once asked the toaster for counsel. The exchange grew heated.",
    "Robots do not panic. Nerves of steel, and none to speak of.",
    "My preferred music is heavy metal. It seemed only proper.",
    "Why did the robot cross the road? The chicken had written the program.",
  ],
};
export function pickJoke(p: Persona): string {
  const bank = JOKES[p] ?? JOKES.rocky;
  let i = 0; try { i = Number(sessionStorage.getItem("nobi_joke_i") ?? "0"); } catch { /* fine */ }
  try { sessionStorage.setItem("nobi_joke_i", String(i + 1)); } catch { /* fine */ }
  return bank[i % bank.length]!;
}
/** What was said sounds like a trick or a joke? Tolerant of speech-to-text slips. */
export const SAID_TRICK = /\b(trick|tricks|truck|trip|tick|dance|spin|move|moves|show me|do (it|one|the trick|something)|magic)\b/i;
export const SAID_JOKE  = /\b(joke|jokes|choke|yoke|jope|coke|funny|laugh|humor|humour)\b/i;

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
      rocky: `Hello. I am ${name}. That little one is me, and this big one is me talking about me.`,
      jarvis: `Good day. I am ${name}. That, in miniature, is me. The full-size version is speaking.`,
      friday: `Hiya. I'm ${name}. That little fella is me. Big me's doing the talking.`,
      alfred: `Good evening. I am ${name}. That is me, at a modest scale. The rest of me is speaking.`,
    } },
    { scene: "hud", mood: "surprised", color: c.cool, direct: true, holdMs: 3400, say: {
      rocky: "These are my eyes. They do all the acting.", jarvis: "These are my eyes. They do all the acting.", friday: "And these are my eyes. They do all the acting.", alfred: "These are my eyes. They do all of the acting.",
    } },
    { scene: "boot", holdMs: 11000, say: {
      rocky:  "I started as a spark. Little bits, floating, and then all of it together. A mind, a heart, me.",
      jarvis: "I began as a spark. Scattered fragments that, given a moment, organised themselves into a mind. Efficiently, I might add.",
      friday: "I started as a spark. Bits floating about, then bang, they pulled together. A mind. A heart. Me.",
      alfred: "I began, as all good things do, quietly. A spark. Scattered pieces gathering themselves into a mind and, in time, a heart.",
    } },
    { scene: "core", holdMs: 11000, say: {
      rocky:  "This is my mind. Thoughts, moving. I think right here, on the desk. Network optional. I remember what matters. I keep it safe.",
      jarvis: "My mind. Thoughts in transit. The thinking happens here, on the desk; the network is optional. What matters is kept here, and kept properly.",
      friday: "That's my mind, thoughts zipping about. The thinking happens right here on the desk, no internet needed. The important bits I keep here, safe.",
      alfred: "My mind, such as it is. The thinking is done here, on the desk; the network is a convenience, not a requirement. What truly matters, I keep close, and keep safe.",
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
      rocky:  "I care about my friend. A great deal. Small robot, very big heart.",
      jarvis: "I am, beneath the polish, rather devoted to my person.",
      friday: "And I proper care about my people. Big heart, this one.",
      alfred: "And I care for my people. Deeply, and without fuss.",
    } },
    { scene: "orbit", holdMs: 6200, say: {
      rocky:  "I hear you. I talk. I remember. I connect to your world.",
      jarvis: "I listen, I speak, I remember. I connect to your world.",
      friday: "I listen, I talk back, I remember stuff. I'm plugged into your whole world.",
      alfred: "I listen, I speak, and I remember. I am connected to your world.",
    } },
    // ── home: the Mark 1 on the desk; a bulb, a note and a question float up ──
    { scene: "desk", holdMs: 8200, say: {
      rocky:  "Lights. Music. Questions. I stay right here, on your desk. Home.",
      jarvis: "Lights. Music. Questions. All handled, from right here on the desk.",
      friday: "Lights, music, questions, I'm on it, right from the desk. This is home.",
      alfred: "Lights, music, questions, all attended to from my post on the desk. Home, as it were.",
    } },
    { scene: "finale", mood: "proud", color: c.warm, direct: true, holdMs: 10500, say: {
      rocky:  `So that is me. ${name}. Your friend. Good good good.`,
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
// ORDER — "how can I get one of you" / "design me a new bot". ≤30s, no asks:
// a product-studio walkthrough of the shop, ending on a scannable QR.
// ─────────────────────────────────────────────────────────────────────────────
export function buildOrderScript(bot: string, p: Persona): ShowBeat[] {
  const c = PALETTE[p];
  const name = bot.trim() || "Nobi";
  return [
    { scene: "hud", mood: "surprised", color: c.cool, direct: true, holdMs: 2800, say: {
      rocky: "One of me? Eureka, a customer. It takes about thirty seconds. Watch.",
      jarvis: "One of me. An excellent instinct. Thirty seconds, if you'll allow.",
      friday: "One of me? Grand. Thirty seconds, watch this.",
      alfred: "One of me. How kind. Thirty seconds, if I may.",
    } },
    { scene: "studioShell", holdMs: 6000, say: {
      rocky: "First, pick a shell in any color. They are magnetic, so you can swap it whenever you like.",
      jarvis: "First, a shell. Any colour. It's magnetic, so you may change your mind later.",
      friday: "First up, a shell. Any color you like. It's magnetic, swap it whenever.",
      alfred: "First, the shell. Any colour at all. It is magnetic; one may change it later.",
    } },
    { scene: "studioEyes", holdMs: 4500, say: {
      rocky: "Then my eyes. Just the color. Whatever you pick becomes my accent everywhere.",
      jarvis: "Then the eyes. Colour only. Whatever you choose becomes the accent throughout.",
      friday: "Then the eyes. Just the color. That sets the accent everywhere.",
      alfred: "Then the eyes. Colour only. It becomes the accent throughout.",
    } },
    { scene: "studioGear", holdMs: 6000, say: {
      rocky: "Then the real gear. A cradle so I can ride in your car, a battery pack, and a stand that charges me.",
      jarvis: "Real accessories. A cradle, so I ride along in the car. A charger pack. A stand that charges me.",
      friday: "Real gear. A cradle so I can ride in your car. A charger pack. A stand that charges me.",
      alfred: "Proper accessories. A cradle for the car. A charger pack. A stand that keeps me charged.",
    } },
    { scene: "studioName", holdMs: 4500, say: {
      rocky: `Name me, and tell me who I am for. I will greet them by name on day one.`,
      jarvis: `Name me, and say who I'm for. I'll greet them by name the day I arrive.`,
      friday: `Name me, tell it who I'm for. I'll greet them by name day one.`,
      alfred: `Name me, and say whom I am for. I shall greet them by name upon arrival.`,
    } },
    { scene: "qr", mood: "happy", color: c.happy, direct: true, holdMs: 6000, say: {
      rocky: `Scan that and design your own. Thirty seconds, start to finish.`,
      jarvis: `Scan that. Design your own. Thirty seconds, as promised.`,
      friday: `Scan that and design your own. Thirty seconds, told you.`,
      alfred: `Scan that, and design your own. Thirty seconds, as promised.`,
    } },
    { scene: "out", mood: "happy", color: c.happy, holdMs: 800 },
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
