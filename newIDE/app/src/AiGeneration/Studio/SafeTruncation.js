// @flow

/**
 * Truncate text without splitting a user-perceived character.
 *
 * A plain `slice(0, maxLength)` cuts at a UTF-16 code-unit offset, which can
 * fall between the two halves of an astral character (an emoji, or rare CJK —
 * both realistic in GDevelop scene, object and variable names, and in the text
 * a sub-agent writes back). The lone high surrogate left behind encodes to
 * U+FFFD, so the replacement character reaches whatever the string feeds: a
 * sub-agent prompt or the parent's transcript and hence the model.
 *
 * Surrogate pairs are only the common case: a cut can also land inside a
 * multi-code-point grapheme (a ZWJ family 👨‍👩‍👧, a flag 🇫🇷, a base letter plus
 * a combining mark), leaving a dangling joiner or accent. Rather than
 * hand-rolling grapheme tables, this delegates to `Intl.Segmenter` (a
 * platform API available everywhere the editor runs), with the old
 * surrogate-pair step-back as the fallback for an environment without it.
 *
 * In its own module because both `FinalizeSubAgents` (the report cap) and
 * `SpawnSubAgents` (the GDD context note cap) need it, and `FinalizeSubAgents`
 * already imports from `SpawnSubAgents` — importing the other way would be a
 * cycle.
 */
const getGraphemeEnds = (
  text: string
): Array<{| index: number, length: number |}> | null => {
  try {
    // `(global: any)` so Flow never needs an `Intl` libdef, and so a missing
    // global (rather than a missing property) also falls back instead of
    // throwing at module scope. `SpawnSubAgents` already reads `global.gd`
    // the same way.
    const GlobalIntl: any = (global: any).Intl;
    if (!GlobalIntl || !GlobalIntl.Segmenter) return null;
    const ends = [];
    const iterator: any = new GlobalIntl.Segmenter(undefined, {
      granularity: 'grapheme',
    }).segment(text);
    for (const part of iterator) {
      ends.push({ index: part.index, length: part.segment.length });
    }
    return ends;
  } catch (error) {
    return null;
  }
};

export const truncateAtCodePointBoundary = (
  text: string,
  maxLength: number
): string => {
  if (text.length <= maxLength) return text;
  const graphemes = getGraphemeEnds(text);
  if (!graphemes) {
    let end = maxLength;
    const lastCode = text.charCodeAt(end - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
    return text.slice(0, end);
  }
  let end = 0;
  for (const grapheme of graphemes) {
    // A grapheme starting inside the budget but ending outside it is dropped
    // whole: keeping it would exceed maxLength, splitting it corrupt it.
    if (grapheme.index + grapheme.length > maxLength) break;
    end = grapheme.index + grapheme.length;
  }
  return text.slice(0, end);
};
