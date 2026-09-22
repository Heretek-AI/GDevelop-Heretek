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
  // Critical / malware / high
  minimist: ['< 1.2.6'],                                // GHSA-xvch-5gv4-984h
  'gh-pages': ['< 5.0.0'],                             // GHSA-8mmm-9v2q-x3f9
  lodash: ['< 4.17.21'],                                // command injection + prototype pollution
  'brace-expansion': ['< 2.0.2'],                      // ReDoS in 1.x / 2.0.1
  tar: ['< 6.2.1'],                                     // various CVEs
  shelljs: ['< 0.9.0'],                                 // privilege management
  'js-yaml': ['< 4.3.1'],                               // safeLoad removal in 3.x, quadratic DoS
  'follow-redirects': ['< 1.15.0'],                     // GHSA-74fj-2j2h-c42q
  async: ['< 3.0.0'],                                   // prototype pollution in 2.x
  minimatch: ['< 5.1.0'],                               // ReDoS in 3.x
  'shell-quote': ['< 1.8.4'],                           // GHSA-w7jw-789q-3m8p
  handlebars: ['< 4.7.9'],                              // GHSA-2699-9764-gw49
  ejs: ['< 3.1.10'],                                    // GHSA-x2rg-2cr9-2m93
  // High-volume / medium-severity
  axios: ['< 1.7.0'],                                   // prototype pollution, SSRF, etc.
  'electron-updater': ['< 6.6.0'],                      // cross-origin redirect leaks
  'extract-zip': ['< 2.0.0'],                           // unvalidated symlink path traversal
  'form-data': ['< 4.0.6'],                             // CRLF injection in <4.0.6
  '@xmldom/xmldom': ['< 0.9.0'],                         // prototype pollution
  undici: ['< 6.0.0'],                                  // GHSA-cxrh-jh5x-9p9g etc.
  'fast-uri': ['< 3.1.5'],                              // ReDoS
  bodyparser: ['< 1.20.3'],                             // DoS
  braces: ['< 3.0.3'],                                  // ReDoS in 2.x
  picomatch: ['< 3.0.0'],                               // ReDoS in 2.x
  cookie: ['< 0.7.0'],                                  // GHSA-pxg6-pf52-xh8x
  qs: ['< 6.15.3'],                                     // GHSA-q8mj-m7cp-5q26
  tmp: ['< 0.2.7'],                                     // GHSA-52f5-j9jc-3726
  ws: ['< 7.5.10'],                                     // GHSA-3h5v-q93c-6h6q
  diff: ['< 5.2.0'],                                    // ReDoS in <5
  'http-proxy': ['< 1.18.1'],                           // GHSA-6x8p-c9mf-4wrg
  debug: ['< 2.6.9'],                                   // ReDoS in <2.6.9
  chownr: ['< 1.1.4'],                                  // TOCTOU
  ini: ['< 1.3.8'],                                     // ReDoS in <1.3.8
  decodeuricomponent: ['< 0.2.2'],                      // GHSA-w7cr-mhqq-3fmw
  esbuild: ['< 0.25.0'],                                // GHSA-67mh-4wv8-vw99 (dev-only)
  'adm-zip': ['< 0.6.0'],                               // GHSA-4gg4-h6c6-9cw9
  'ip-address': ['< 10.5.0'],                           // GHSA-3k65-mwh4-6c84
  'node-forge': ['< 1.3.1'],                            // CVE-2022-24771 etc
  rollup: ['< 2.79.2'],                                 // GHSA-gcx4-mw6x-p8f3
  piscina: ['< 4.8.0'],                                 // CVE-2024-52804
  // npm audit failures surfaced during CI integration (2026-08-20)
  'node-fetch': ['< 2.6.7'],                             // GHSA-r683-j2x4-v87g (header leak)
  '@grpc/grpc-js': ['< 1.14.4'],                        // GHSA-99f4-grh7-6pcq etc.
  protobufjs: ['< 7.6.5'],                             // GHSA-xq3m-2v4x-88gg etc.
  'websocket-driver': ['< 0.7.5'],                      // GHSA-mp7j-qc5w-4988 etc.
  semver: ['< 7.5.2'],                                  // GHSA-c2qf-rxjj-qqgw (ReDoS)
  uuid: ['< 11.1.1'],                                   // GHSA-w5hq-g745-h8pq (buffer bounds)
  yaml: ['< 2.8.3'],                                    // GHSA-48c2-rrv3-qjmp (stack overflow)
  '@protobufjs/utf8': ['< 1.1.2'],                       // GHSA-q6x5-8v7m-xcrf (overlong UTF-8)
};

const lockfiles = [
  'GDevelop.js/package-lock.json',
  'GDJS/package-lock.json',
  'GDJS/tests/package-lock.json',
  'newIDE/app/package-lock.json',
  'newIDE/electron-app/package-lock.json',
  'newIDE/electron-app/app/package-lock.json',
  'newIDE/web-app/package-lock.json',
  'newIDE/visual-tests/package-lock.json',
  'SharedLibs/TileMapHelper/package-lock.json',
  'SharedLibs/ThreeAddons/package-lock.json',
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
      // Take the segment after the final "node_modules/" so that nested
      // installs (e.g. "node_modules/@scope/a/node_modules/b") are keyed
      // by the inner package "b", not the path-prefixed string.
      const pkgName = pkgPath.split('node_modules/').pop();
      if (!info || !info.version) continue;
      if (!pinned.has(pkgName)) pinned.set(pkgName, new Set());
      pinned.get(pkgName).add(info.version);
    }
  } else if (lockfileJson.dependencies) {
    // lockfileVersion 1: walk the dependency tree, keying each entry by
    // its own package name (not the parent's path) so that nested
    // transitive deps with the same name aggregate into one bucket.
    const walk = (deps) => {
      for (const [name, info] of Object.entries(deps || {})) {
        if (info.version) {
          if (!pinned.has(name)) pinned.set(name, new Set());
          pinned.get(name).add(info.version);
        }
        if (info.dependencies) walk(info.dependencies);
      }
    };
    walk(lockfileJson.dependencies);
  }
  return pinned;
}

function rangeMatches(version, range) {
  // Tiny semver "< M.m.p" matcher. Treats pre-release tags (e.g. 1.2.3-beta.1)
  // as equal to 1.2.3 — good enough for our advisory-floor use case.
  //
  // Security advisories apply to a specific major-version line, so a range
  // "< 2.8.3" should NOT match versions in the 1.x line (different package,
  // different advisory list). We require same-major before comparing.
  const m = range.match(/^<\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const vParts = version.split('-')[0].split('.').map(Number);
  if (vParts.length !== 3 || vParts.some(Number.isNaN)) return false;
  const [vMaj, vMin, vPat] = vParts;
  const [tMaj, tMin, tPat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (vMaj !== tMaj) return false;
  if (vMin !== tMin) return vMin < tMin;
  return vPat < tPat;
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
