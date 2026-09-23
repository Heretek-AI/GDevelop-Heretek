// @flow

/**
 * Truncate text without splitting a surrogate pair.
 *
 * A plain `slice(0, maxLength)` cuts at a UTF-16 code-unit offset, which can
 * fall between the two halves of an astral character (an emoji, or rare CJK —
 * both realistic in GDevelop scene, object and variable names, and in the text
 * a sub-agent writes back). The lone high surrogate left behind encodes to
 * U+FFFD, so the replacement character reaches whatever the string feeds: a
 * sub-agent prompt or the parent's transcript and hence the model.
 *
 * In its own module because both `FinalizeSubAgents` (the report cap) and
 * `SpawnSubAgents` (the GDD context note cap) need it, and `FinalizeSubAgents`
 * already imports from `SpawnSubAgents` — importing the other way would be a
 * cycle.
 */
export const truncateAtCodePointBoundary = (
  text: string,
  maxLength: number
): string => {
  if (text.length <= maxLength) return text;
  let end = maxLength;
  const lastCode = text.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1;
  return text.slice(0, end);
};
