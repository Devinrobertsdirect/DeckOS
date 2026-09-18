/**
 * voiceCadence — punctuation is how the ElevenLabs voice PACES a line, so a
 * character's rhythm can be shaped on the way to the speaker without touching
 * the words. Applied to server-voice utterances only.
 *
 * This used to push every line TOWARD the tic: it rewrote "good, good, good"
 * into the run-on "good good good" wherever it found it, which meant the more
 * he talked the more he sounded like a broken toy. The character is better
 * served by rhythm than by catchphrases, so now the shaping is about how a line
 * BREATHES:
 *   "It works — mostly."      → "It works. Mostly."   (a dash is a stop)
 *   "Hmm, let me see."        → "Hmm… let me see."    (a real pause to think)
 *   a fourteen-word clause    → gains a comma          (somewhere to breathe)
 * The one run-on that survives is a deliberate "good good good" the model
 * actually wrote, which is rare by design and should land when it happens.
 *
 * Other personas pass through untouched.
 */
export function shapeForVoice(text: string, personaId: string): string {
  if (!text) return text;
  if (personaId !== "rocky") return text;
  let t = text
    // Keep an intentional triple as one quick run rather than three flat beats.
    .replace(/\b(\w+)[,.]\s+\1[,.]\s+\1\b/gi, "$1 $1 $1")
    .replace(/\s+[—–]\s+|\s+-{2,}\s+/g, ". ")   // dashes become stops; he speaks in short sentences
    .replace(/;\s+/g, ". ")
    .replace(/\b(hmm+|hm+)\b[.,]?\s*/gi, "$1… ") // a pause while he thinks
    .replace(/\.\s*\.\s*\./g, "…")
    .replace(/!{2,}/g, "!")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Long clauses get somewhere to breathe. Without this the voice runs the
  // whole sentence on one arc of breath and the end of it disappears.
  t = t.split(/(?<=[.!?…])\s+/).map((sentence) => {
    const words = sentence.split(" ");
    if (words.length < 14 || /,/.test(sentence)) return sentence;
    const mid = Math.floor(words.length / 2);
    return [...words.slice(0, mid), `${words[mid]},`, ...words.slice(mid + 1)].join(" ");
  }).join(" ");

  return t;
}
