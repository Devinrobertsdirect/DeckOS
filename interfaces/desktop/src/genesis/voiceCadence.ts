/**
 * voiceCadence — punctuation is how the ElevenLabs voice PACES a line, so a
 * character's cadence can be shaped on the way to the speaker without
 * touching the words. Applied to server-voice utterances only.
 *
 * Rocky (Project Hail Mary) talks in fragments and rapid triples:
 *   "Good, good, good."  → "Good good good."   (one quick run, not three beats)
 *   "It works — mostly." → "It works. Mostly." (dashes/semicolons become stops)
 *   "Hmm, let me see."   → "Hmm… let me see."  (a real pause while he thinks)
 * Other personas pass through untouched.
 */
export function shapeForVoice(text: string, personaId: string): string {
  if (!text) return text;
  if (personaId !== "rocky") return text;
  return text
    .replace(/\b(\w+)[,.]\s+\1[,.]\s+\1\b/gi, "$1 $1 $1")   // "Good, good, good" / "Good. Good. Good."
    .replace(/\b(\w+),\s+\1\b/gi, "$1 $1")                    // "good, good"
    .replace(/\s+[—–]\s+|\s+-{2,}\s+/g, ". ")                 // dashes join clauses; Rocky speaks in fragments
    .replace(/;\s+/g, ". ")
    .replace(/\b(hmm+|hm+)\b[.,]?\s*/gi, "$1… ")               // a pause while he thinks
    .replace(/\.\s*\.\s*\./g, "…")
    .replace(/!{2,}/g, "!")
    .replace(/\s{2,}/g, " ")
    .trim();
}
