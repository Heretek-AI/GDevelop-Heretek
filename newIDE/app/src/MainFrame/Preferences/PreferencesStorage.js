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

/**
 * Merge preferences read from localStorage with the defaults, mirroring the
 * provider's upgrade path: a key that is *missing* (undefined) is backfilled
 * from the defaults; a key that is present is kept as-is, even if falsy or
 * wrong-typed (the app validates at the point of use, not here). Also applies
 * the two stored-value migrations (renamed themes, the deprecated-warning
 * tri-state). Returns null when the stored value is not a plain object, which
 * the caller treats as "no stored preferences".
 *
 * Extracted from `PreferencesProvider.loadPreferencesFromLocalStorage` so the
 * backfill contract can be unit-tested (that file imports React, Electron and
 * the GDevelop core).
 */
export const mergeStoredPreferencesWithDefaults = (
  storedValues: any,
  defaults: Object
): ?Object => {
  if (
    !storedValues ||
    typeof storedValues !== 'object' ||
    Array.isArray(storedValues)
  ) {
    return null;
  }
  const values = { ...storedValues };
  for (const key in defaults) {
    if (
      Object.prototype.hasOwnProperty.call(defaults, key) &&
      typeof values[key] === 'undefined'
    ) {
      values[key] = defaults[key];
    }
  }
  // Migrate renamed themes.
  if (values.themeName === 'GDevelop default') {
    values.themeName = 'GDevelop default Light';
  } else if (values.themeName === 'Dark') {
    values.themeName = 'Blue Dark';
  }
  if (typeof values.showDeprecatedInstructionWarning === 'boolean') {
    values.showDeprecatedInstructionWarning = values.showDeprecatedInstructionWarning
      ? 'icon'
      : 'no';
  }
  return values;
};
