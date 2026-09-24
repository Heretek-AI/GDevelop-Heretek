// @flow
import { getPersistablePreferences } from './PreferencesStorage';

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
