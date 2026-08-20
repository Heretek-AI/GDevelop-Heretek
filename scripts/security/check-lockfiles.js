#!/usr/bin/env node
/*
 * Regression guard: asserts that no manifest in the repo pins a known-malicious
 * or critically-vulnerable version of a curated list of npm packages.
 *
 * Add new advisories to VULNERABLE_VERSIONS / VULNERABLE_RANGES below as they
 * come in. The script exits 0 when everything is clean and 1 when at least one
 * manifest has a bad version — wire it into CI so a regression reintroducing
 * an old package version fails the build.
 *
 * Usage:
 *   node scripts/security/check-lockfiles.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');

// (package, [list of "pinned version" strings considered vulnerable])
// Exact-match: we compare the "version" field in lockfileVersion 2/3 packages,
// or the "version" field in lockfileVersion 1 dependencies tree.
const VULNERABLE_VERSIONS = {
  fsevents: ['1.2.4'],                                  // GHSA-xv2f-5jw4-v95m (malware)
  'socket.io-parser': ['3.3.0', '3.2.0'],              // ReDoS / prototype pollution
  'xmlhttprequest-ssl': ['1.6.2'],                     // prototype pollution
  'set-value': ['3.0.0', '3.0.1'],                     // prototype pollution
  'mixin-deep': ['1.3.1'],                             // prototype pollution
  growl: ['1.10.0', '1.10.3'],                         // command injection (1.10.5 fixed)
};

// (package, [list of "X.Y.Z" lower-bound comparisons]).
// Currently only "< M.m.p" form is supported.
const VULNERABLE_RANGES = {
  minimist: ['< 1.2.6'],                                // GHSA-xvch-5gv4-984h
  'gh-pages': ['< 5.0.0'],                             // GHSA-8mmm-9v2q-x3f9
  lodash: ['< 4.17.21'],                                // command injection + prototype pollution
  'brace-expansion': ['< 2.0.1'],                      // ReDoS in 1.x
  tar: ['< 6.2.1'],                                     // various CVEs
  shelljs: ['< 0.9.0'],                                 // privilege management
  'js-yaml': ['< 4.0.0'],                               // safeLoad removal in 3.x
  'follow-redirects': ['< 1.15.0'],                     // GHSA-74fj-2j2h-c42q
  async: ['< 3.0.0'],                                   // prototype pollution in 2.x
  minimatch: ['< 5.1.0'],                               // ReDoS in 3.x
};

const lockfiles = [
  'GDevelop.js/package-lock.json',
  'GDJS/package-lock.json',
  'GDJS/tests/package-lock.json',
  'newIDE/app/package-lock.json',
  'newIDE/electron-app/package-lock.json',
  'newIDE/electron-app/app/package-lock.json',
  'newIDE/web-app/package-lock.json',
];

function readLockfile(relPath) {
  const abs = path.join(repoRoot, relPath);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function collectPinnedVersions(lockfileJson) {
  const pinned = new Map(); // package -> Set<version>
  if (lockfileJson.packages) {
    for (const [pkgPath, info] of Object.entries(lockfileJson.packages)) {
      if (!pkgPath || !pkgPath.startsWith('node_modules/')) continue;
      const pkgName = pkgPath.replace(/^node_modules\//, '');
      if (!info || !info.version) continue;
      if (!pinned.has(pkgName)) pinned.set(pkgName, new Set());
      pinned.get(pkgName).add(info.version);
    }
  } else if (lockfileJson.dependencies) {
    const walk = (deps, prefix) => {
      for (const [name, info] of Object.entries(deps || {})) {
        const fullName = prefix ? `${prefix}/${name}` : name;
        if (info.version) {
          if (!pinned.has(fullName)) pinned.set(fullName, new Set());
          pinned.get(fullName).add(info.version);
        }
        if (info.dependencies) walk(info.dependencies, fullName);
      }
    };
    walk(lockfileJson.dependencies, '');
  }
  return pinned;
}

function rangeMatches(version, range) {
  const m = range.match(/^<\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return false;
  const [tMaj, tMin, tPatch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (major !== tMaj) return false;
  if (minor !== tMin) return false;
  return patch < tPatch;
}

const failures = [];
for (const relPath of lockfiles) {
  const json = readLockfile(relPath);
  if (!json) {
    failures.push(`${relPath}: lockfile missing`);
    continue;
  }
  const pinned = collectPinnedVersions(json);

  for (const [pkg, badVersions] of Object.entries(VULNERABLE_VERSIONS)) {
    const versions = pinned.get(pkg);
    if (!versions) continue;
    for (const v of versions) {
      if (badVersions.includes(v)) {
        failures.push(`${relPath}: ${pkg}@${v} is in VULNERABLE_VERSIONS`);
      }
    }
  }
  for (const [pkg, ranges] of Object.entries(VULNERABLE_RANGES)) {
    const versions = pinned.get(pkg);
    if (!versions) continue;
    for (const v of versions) {
      for (const range of ranges) {
        if (rangeMatches(v, range)) {
          failures.push(`${relPath}: ${pkg}@${v} matches ${range}`);
        }
      }
    }
  }
}

if (failures.length) {
  console.error('❌ Vulnerable lockfile pin(s) detected:');
  for (const f of failures) console.error('   ' + f);
  process.exit(1);
}
console.log('✅ All lockfiles free of the pinned vulnerable versions in this guard.');
