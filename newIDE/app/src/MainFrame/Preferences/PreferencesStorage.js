// @flow

/**
 * The preferences that may be written to localStorage.
 *
 * `aiCustomApiKey` is deliberately omitted: the user's API key must never be
 * persisted in cleartext (it is kept in memory only, for the session). Both the
 * preferences payload and the custom-AI config payload drop it — see
 * `CustomAIClient.setCustomEndpointConfig`, which does the same for its own
 * store.
 *
 * A pure module so the exclusion can be unit-tested: `PreferencesProvider.js`
 * imports React, Electron and the GDevelop core, which a spec cannot load.
 */
export const getPersistablePreferences = (values: Object): Object => {
  const { aiCustomApiKey, ...persistableValues } = values;
  return persistableValues;
};
