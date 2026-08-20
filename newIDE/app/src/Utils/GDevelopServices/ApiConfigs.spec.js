// @flow
/**
 * Tests for the Firebase config loader.
 *
 * Regression test for: secret-scanning alerts on two leaked Google API keys
 * owned by the upstream `4ian/GDevelop` project. The full key strings are
 * not embedded here (to avoid re-triggering secret scanning); we use the
 * first 8 and last 6 characters as fingerprints instead. The CI history
 * (PR/3df95d0e21, PR/5ecdfa1c7f) carries the full fingerprints if anyone
 * needs to compare.
 *
 * The apiKey must come from process.env.GD_FIREBASE_API_KEY at runtime and
 * must never be a hard-coded leaked value. A clearly-marked placeholder is
 * the safe default when no env var is provided.
 */

import { GDevelopFirebaseConfig } from './ApiConfigs';

// Use first 8 / last 6 char fingerprints so the full key string is never
// spelled out in the source tree.
const LEAKED_KEY_FINGERPRINTS = [
  { prefix: 'AIzaSyAn', suffix: 'VDDewBc' }, // production (gdevelop-services)
  { prefix: 'AIzaSyBw', suffix: 't7YM8' }, // test (gdtest-e11a5)
];

describe('GDevelopFirebaseConfig (env-driven, no leaked keys)', () => {
  const originalEnv = process.env.GD_FIREBASE_API_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GD_FIREBASE_API_KEY;
    } else {
      process.env.GD_FIREBASE_API_KEY = originalEnv;
    }
  });

  test('the apiKey is never one of the known leaked upstream keys', () => {
    const current = GDevelopFirebaseConfig.apiKey || '';
    for (const { prefix, suffix } of LEAKED_KEY_FINGERPRINTS) {
      const isLeaked = current.startsWith(prefix) && current.endsWith(suffix);
      expect(isLeaked).toBe(false);
    }
  });

  test('the apiKey is read from process.env.GD_FIREBASE_API_KEY when set', () => {
    process.env.GD_FIREBASE_API_KEY = 'test-from-env';
    // Re-require to pick up the env change (module is cached; reload via Jest reset)
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const { GDevelopFirebaseConfig: fresh } = require('./ApiConfigs');
      expect(fresh.apiKey).toBe('test-from-env');
    });
  });

  test('the apiKey falls back to a clearly-marked placeholder when env is missing', () => {
    delete process.env.GD_FIREBASE_API_KEY;
    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const { GDevelopFirebaseConfig: fresh } = require('./ApiConfigs');
      expect(fresh.apiKey).toMatch(/^AIzaSyDUMMY/);
      expect(fresh.apiKey).toMatch(/DUMMY|REPLACE|YOUR-OWN/);
    });
  });

  test('the non-secret fields stay as the gdevelop-services Firebase project', () => {
    expect(GDevelopFirebaseConfig.authDomain).toBe(
      'gdevelop-services.firebaseapp.com'
    );
    expect(GDevelopFirebaseConfig.projectId).toBe('gdevelop-services');
    expect(GDevelopFirebaseConfig.storageBucket).toBe(
      'gdevelop-services.appspot.com'
    );
  });
});
