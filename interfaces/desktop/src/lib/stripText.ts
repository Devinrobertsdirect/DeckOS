/**
 * stripEmoji — keep emoji OUT of Atlas's words.
 *
 * Atlas expresses emotion in two separate channels:
 *   1. the WORDS it says (spoken by TTS, shown in the caption), and
 *   2. the little glyph its FACE flashes on screen — the emotion *animation*,
 *      driven entirely by the emotion director (a keyword classifier), not by
 *      characters sitting in the text.
 *
 * Emoji belong to channel 2 only. If they leak into the text they get read
 * aloud ("grinning face") and clutter the caption. So every AI reply is passed
 * through this before it is shown or spoken. The on-screen emotion animation is
 * unaffected — it never came from the text in the first place.
 *
 * We remove true pictographic characters (faces, hands, hearts, sparkles,
 * symbol emoji), regional-indicator flag pairs, variation selectors, ZWJ
 * joiners and keycap combiners. We deliberately do NOT touch plain arrows
 * (←↑→↓) or ASCII punctuation, which are legitimate in normal prose.
 */
const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

export function stripEmoji(input: string): string {
  if (!input) return input;
  return input
    .replace(EMOJI_RE, "")
    .replace(/[ \t]{2,}/g, " ") // collapse gaps left where a glyph used to be
    .replace(/[ \t]+([.,!?;:])/g, "$1") // no space stranded before punctuation
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
