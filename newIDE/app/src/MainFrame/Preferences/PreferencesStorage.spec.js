// @flow
import {
  getPersistablePreferences,
  mergeStoredPreferencesWithDefaults,
} from './PreferencesStorage';

describe('getPersistablePreferences', () => {
  it('omits the custom AI API key', () => {
    // The key must never be written to localStorage in cleartext; it lives in
    // memory for the session only.
    const persistable = getPersistablePreferences({
      aiCustomApiKey: 'sk-secret-value',
      language: 'en',
      themeName: 'Blue Dark',
      aiCustomBaseUrl: 'http://localhost:11434/v1',
    });

    expect('aiCustomApiKey' in persistable).toBe(false);
    // Everything else is kept, including the non-secret endpoint settings.
    expect(persistable.language).toBe('en');
    expect(persistable.themeName).toBe('Blue Dark');
    expect(persistable.aiCustomBaseUrl).toBe('http://localhost:11434/v1');
  });

  it('does not mutate the values it is given', () => {
    const values = { aiCustomApiKey: 'k', themeName: 'Blue Dark' };
    getPersistablePreferences(values);
    expect(values.aiCustomApiKey).toBe('k');
  });

  it('tolerates values without the key', () => {
    expect(getPersistablePreferences({ themeName: 'D' })).toEqual({
      themeName: 'D',
    });
  });
});

describe('mergeStoredPreferencesWithDefaults', () => {
  it('backfills only missing keys from the defaults', () => {
    const merged = mergeStoredPreferencesWithDefaults(
      { themeName: 'Blue Dark' },
      { themeName: 'GDevelop default Light', language: 'en', zoom: 1 }
    );
    expect(merged.themeName).toBe('Blue Dark');
    expect(merged.language).toBe('en');
    expect(merged.zoom).toBe(1);
  });

  it('keeps a present value even when falsy or wrong-typed', () => {
    // The provider never type-checks a present key (that is why the app
    // validates at the point of use); backfilling must not overwrite it.
    const merged = mergeStoredPreferencesWithDefaults(
      { language: '', zoom: 0, flag: false, none: null, bad: 'not-a-number' },
      { language: 'en', zoom: 1, flag: true, none: 'default', bad: 2 }
    );
    expect(merged.language).toBe('');
    expect(merged.zoom).toBe(0);
    expect(merged.flag).toBe(false);
    expect(merged.none).toBe(null);
    expect(merged.bad).toBe('not-a-number');
  });

  it('preserves unknown stored keys and does not mutate the input', () => {
    const stored = { unknownKey: 42 };
    const merged = mergeStoredPreferencesWithDefaults(stored, {
      language: 'en',
    });
    expect(merged.unknownKey).toBe(42);
    expect(stored.language).toBeUndefined();
  });

  it('migrates the renamed themes', () => {
    expect(
      mergeStoredPreferencesWithDefaults({ themeName: 'GDevelop default' }, {})
        .themeName
    ).toBe('GDevelop default Light');
    expect(
      mergeStoredPreferencesWithDefaults({ themeName: 'Dark' }, {}).themeName
    ).toBe('Blue Dark');
    // A current name is untouched.
    expect(
      mergeStoredPreferencesWithDefaults({ themeName: 'Blue Dark' }, {})
        .themeName
    ).toBe('Blue Dark');
  });

  it('maps the deprecated-warning tri-state', () => {
    expect(
      mergeStoredPreferencesWithDefaults(
        { showDeprecatedInstructionWarning: true },
        {}
      ).showDeprecatedInstructionWarning
    ).toBe('icon');
    expect(
      mergeStoredPreferencesWithDefaults(
        { showDeprecatedInstructionWarning: false },
        {}
      ).showDeprecatedInstructionWarning
    ).toBe('no');
    // Already-migrated strings stay.
    expect(
      mergeStoredPreferencesWithDefaults(
        { showDeprecatedInstructionWarning: 'icon' },
        {}
      ).showDeprecatedInstructionWarning
    ).toBe('icon');
  });

  it('returns null for a non-object stored value', () => {
    expect(mergeStoredPreferencesWithDefaults(null, {})).toBe(null);
    expect(mergeStoredPreferencesWithDefaults(undefined, {})).toBe(null);
    expect(mergeStoredPreferencesWithDefaults([1, 2], {})).toBe(null);
    expect(mergeStoredPreferencesWithDefaults('text', {})).toBe(null);
    expect(mergeStoredPreferencesWithDefaults(42, {})).toBe(null);
  });
});
