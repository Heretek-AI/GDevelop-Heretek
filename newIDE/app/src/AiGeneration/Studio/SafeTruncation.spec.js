// @flow
import { truncateAtCodePointBoundary } from './SafeTruncation';

const hasLoneSurrogate = (text: string): boolean =>
  Array.from(text).some(
    character => character.length === 1 && /[\uD800-\uDFFF]/.test(character)
  );

describe('truncateAtCodePointBoundary', () => {
  it('never leaves a lone surrogate at any cut point', () => {
    const body = 'A𝟘B😀C';
    for (let max = 1; max < body.length; max++) {
      expect(hasLoneSurrogate(truncateAtCodePointBoundary(body, max))).toBe(
        false
      );
    }
  });

  it('keeps a ZWJ family whole instead of leaving a dangling joiner', () => {
    // U+1F468 U+200D U+1F469 U+200D U+1F467: the old step-back only saw
    // surrogate halves, so a cut after the first person kept 'A👨‍'.
    expect(truncateAtCodePointBoundary('A👨‍👩‍👧', 4)).toBe('A');
    expect(truncateAtCodePointBoundary('A👨‍👩‍👧!', 10)).toBe('A👨‍👩‍👧!');
  });

  it('keeps a flag pair whole', () => {
    // Two regional indicators are one grapheme: cutting between them leaves
    // a lone indicator that renders as a letter.
    expect(truncateAtCodePointBoundary('AB🇫🇷CD', 4)).toBe('AB');
    expect(truncateAtCodePointBoundary('AB🇫🇷CD', 6)).toBe('AB🇫🇷');
  });

  it('keeps a base letter with its combining mark', () => {
    expect(truncateAtCodePointBoundary('éx', 1)).toBe('');
    expect(truncateAtCodePointBoundary('éx', 2)).toBe('é');
  });

  it('returns the original reference when nothing is cut', () => {
    const text = 'Town déjà 🇫🇷';
    expect(truncateAtCodePointBoundary(text, text.length)).toBe(text);
  });

  it('falls back to the surrogate step-back without Intl.Segmenter', () => {
    const realIntl = (global: any).Intl;
    // $FlowFixMe test-only global mutation, restored below.
    (global: any).Intl = undefined;
    try {
      expect(truncateAtCodePointBoundary('AB😀CD', 3)).toBe('AB');
    } finally {
      (global: any).Intl = realIntl;
    }
  });
});
