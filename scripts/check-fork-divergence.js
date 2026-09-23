#!/usr/bin/env node
/*
 * Fork-divergence guard.
 *
 * This fork tracks upstream 4ian/GDevelop. Divergence is intentional in a
 * handful of places (BYOK/local-AI, unlocked client features, the Heretek
 * update feed, the fork's CI) and accidental in others. Accidental divergence
 * is what makes upstream syncs expensive: the fork must re-resolve it on every
 * merge, forever.
 *
 * This script makes the divergence set explicit and bounded:
 *
 *   * `fork-divergence.json` is the checked-in allowlist of every path the
 *     fork intentionally diverges on, in three buckets — `modified`,
 *     `forkOnly`, `upstreamMissing`.
 *   * The script recomputes the divergence set from git + the upstream tree
 *     and fails when the two disagree in either direction:
 *       - a path diverges that is not in the allowlist  -> newly-introduced
 *         divergence, which must be a deliberate decision;
 *       - an allowlisted path no longer diverges        -> stale entry, which
 *         must be removed so the file stays trustworthy.
 *
 * Usage:
 *   node scripts/check-fork-divergence.js            # verify (CI + local)
 *   node scripts/check-fork-divergence.js --update   # rewrite the allowlist
 *   node scripts/check-fork-divergence.js --list     # print the diff, exit 0
 *
 * Upstream tree lookup, in order of preference:
 *   1. `git ls-tree` of a local upstream ref (`upstream/master`, then the
 *      `origin/upstream-sync-*` branches the sync workflow pushes), when one
 *      exists and is reachable;
 *   2. the GitHub trees API (`GH_TOKEN` / `GITHUB_TOKEN`), which needs no
 *      clone of the ~1.7 GB upstream repository.
 *
 * Exit codes: 0 clean, 1 divergence mismatch, 2 fatal error.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const MANIFEST_NAME = 'fork-divergence.json';
const MANIFEST_PATH = path.join(REPO_ROOT, MANIFEST_NAME);
const UPSTREAM_REPO = '4ian/GDevelop';
const UPSTREAM_REF = 'master';

function git(...args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Local tree of HEAD as { path: blobSha }. */
function headTree() {
  const out = git('ls-tree', '-r', '-z', 'HEAD');
  const map = new Map();
  for (const entry of out.split('\0')) {
    if (!entry) continue;
    // "<mode> <type> <sha>\t<path>"
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const meta = entry.slice(0, tab).split(' ');
    const sha = meta[2];
    const filePath = entry.slice(tab + 1);
    if (meta[1] === 'blob') map.set(filePath, sha);
  }
  return map;
}

/**
 * Local tree including uncommitted work, as { path: blobSha }.
 *
 * Starting from the HEAD tree and patching in only the paths that actually
 * differ keeps this cheap: `git hash-object` runs once per changed file, not
 * once per tracked file. Without this, `--update` would silently ignore
 * everything still sitting in the working tree and the committed manifest
 * would disagree with the tree it is supposed to describe.
 */
function localTree() {
  const map = headTree();

  // Tracked files whose content differs from HEAD (staged or unstaged).
  const dirty = git('diff-index', '--name-only', '-z', 'HEAD').split('\0').filter(Boolean);
  const deleted = new Set(
    git('ls-files', '--deleted', '-z').split('\0').filter(Boolean)
  );
  for (const filePath of dirty) {
    if (deleted.has(filePath)) {
      map.delete(filePath);
      continue;
    }
    map.set(filePath, git('hash-object', '--', filePath).trim());
  }

  // Untracked files that are not ignored.
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter(Boolean);
  for (const filePath of untracked) {
    map.set(filePath, git('hash-object', '--', filePath).trim());
  }

  return map;
}

/** Upstream tree as { path: blobSha }, via a local ref when possible. */
function upstreamTree() {
  const candidates = ['refs/remotes/upstream/master', 'refs/heads/upstream/master'];
  for (const ref of candidates) {
    try {
      git('rev-parse', '--verify', '--quiet', ref);
    } catch (_) {
      continue;
    }
    const out = git('ls-tree', '-r', '-z', ref);
    const map = new Map();
    for (const entry of out.split('\0')) {
      if (!entry) continue;
      const tab = entry.indexOf('\t');
      if (tab === -1) continue;
      const meta = entry.slice(0, tab).split(' ');
      if (meta[1] === 'blob') map.set(entry.slice(tab + 1), meta[2]);
    }
    return { source: ref, tree: map };
  }

  // Fall back to the GitHub trees API. No upstream clone required.
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'No local upstream ref and no GH_TOKEN/GITHUB_TOKEN. Either run\n' +
        '  git remote add upstream https://github.com/4ian/GDevelop.git\n' +
        '  git fetch --depth=1 upstream master\n' +
        'or export GH_TOKEN.'
    );
  }
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/git/trees/${UPSTREAM_REF}?recursive=1`;
  const body = execFileSync(
    'curl',
    ['-fsSL', '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/vnd.github+json', url],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  );
  const json = JSON.parse(body);
  if (json.truncated) {
    throw new Error(
      `Upstream tree listing was truncated by the GitHub API; use a local upstream ref instead.`
    );
  }
  const map = new Map();
  for (const entry of json.tree) {
    if (entry.type === 'blob') map.set(entry.path, entry.sha);
  }
  return { source: `api:${UPSTREAM_REPO}@${UPSTREAM_REF}`, tree: map };
}

function computeDivergence() {
  const local = localTree();
  const { source, tree: upstream } = upstreamTree();

  const modified = [];
  const forkOnly = [];
  const upstreamMissing = [];

  // The manifest cannot describe itself: its content changes whenever the
  // divergence set changes, so its hash is never stable. It is excluded from
  // both sides. `.sonarcloud-drift-baseline` is excluded for the same reason —
  // it records the live issue count, which moves independently of the tree.
  const selfReferential = new Set([MANIFEST_NAME, '.sonarcloud-drift-baseline']);

  for (const [filePath, sha] of local) {
    if (selfReferential.has(filePath)) continue;
    if (!upstream.has(filePath)) forkOnly.push(filePath);
    else if (upstream.get(filePath) !== sha) modified.push(filePath);
  }
  for (const filePath of upstream.keys()) {
    if (selfReferential.has(filePath)) continue;
    if (!local.has(filePath)) upstreamMissing.push(filePath);
  }

  modified.sort();
  forkOnly.sort();
  upstreamMissing.sort();
  return { source, modified, forkOnly, upstreamMissing };
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function toSet(raw) {
  return new Set(raw || []);
}

function diffSets(actual, allowed) {
  const unexpected = [];
  const stale = [];
  for (const value of actual) if (!allowed.has(value)) unexpected.push(value);
  for (const value of allowed) if (!actual.has(value)) stale.push(value);
  return { unexpected: unexpected.sort(), stale: stale.sort() };
}

function main() {
  const argv = process.argv.slice(2);
  const update = argv.includes('--update');
  const list = argv.includes('--list');

  const actual = computeDivergence();

  if (list) {
    console.log(`Upstream source: ${actual.source}`);
    console.log(`modified:        ${actual.modified.length}`);
    console.log(`forkOnly:        ${actual.forkOnly.length}`);
    console.log(`upstreamMissing: ${actual.upstreamMissing.length}`);
    for (const bucket of ['modified', 'forkOnly', 'upstreamMissing']) {
      for (const filePath of actual[bucket]) console.log(`  ${bucket} ${filePath}`);
    }
    return;
  }

  if (update) {
    const previous = readManifest();
    const manifest = {
      $comment:
        'Checked-in allowlist of every path this fork intentionally diverges from ' +
        '4ian/GDevelop on. Regenerate with `node scripts/check-fork-divergence.js --update`. ' +
        'Enforced by `node scripts/check-fork-divergence.js` in CI. See MAINTENANCE.md.',
      updatedAt: new Date().toISOString().slice(0, 10),
      upstreamSource: actual.source,
      modified: actual.modified,
      forkOnly: actual.forkOnly,
      upstreamMissing: actual.upstreamMissing,
    };
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

    if (previous) {
      const counts = {};
      for (const bucket of ['modified', 'forkOnly', 'upstreamMissing']) {
        const delta = actual[bucket].length - (previous[bucket] || []).length;
        if (delta !== 0) counts[bucket] = delta > 0 ? `+${delta}` : `${delta}`;
      }
      console.log(
        `Wrote ${path.relative(REPO_ROOT, MANIFEST_PATH)} ` +
          `(${actual.modified.length} modified, ${actual.forkOnly.length} fork-only, ` +
          `${actual.upstreamMissing.length} upstream-missing)` +
          (Object.keys(counts).length ? ` delta vs previous: ${JSON.stringify(counts)}` : '')
      );
    } else {
      console.log(`Wrote ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
    }
    return;
  }

  const manifest = readManifest();
  if (!manifest) {
    console.error(
      `No ${path.relative(REPO_ROOT, MANIFEST_PATH)}. Create it with:\n` +
        `  node scripts/check-fork-divergence.js --update`
    );
    process.exit(1);
  }

  console.log(`Upstream source: ${actual.source}`);
  const buckets = ['modified', 'forkOnly', 'upstreamMissing'];
  let failed = false;

  for (const bucket of buckets) {
    const { unexpected, stale } = diffSets(
      toSet(actual[bucket]),
      toSet(manifest[bucket])
    );
    console.log(
      `${bucket}: ${actual[bucket].length} (allowlisted ${(manifest[bucket] || []).length})`
    );
    if (unexpected.length) {
      failed = true;
      console.error(`  UNEXPECTED divergence (${unexpected.length}) — not in the allowlist:`);
      for (const filePath of unexpected.slice(0, 40)) console.error(`    ${filePath}`);
      if (unexpected.length > 40) {
        console.error(`    … and ${unexpected.length - 40} more`);
      }
    }
    if (stale.length) {
      failed = true;
      console.error(`  STALE allowlist entries (${stale.length}) — no longer diverge:`);
      for (const filePath of stale.slice(0, 40)) console.error(`    ${filePath}`);
      if (stale.length > 40) {
        console.error(`    … and ${stale.length - 40} more`);
      }
    }
  }

  if (failed) {
    console.error(
      '\nDivergence from upstream changed. Two acceptable resolutions:\n' +
        '  1. The new divergence is intended -> record it:\n' +
        '       node scripts/check-fork-divergence.js --update && git add fork-divergence.json\n' +
        '  2. It was accidental -> revert it, so the file stays in sync with upstream.'
    );
    process.exit(1);
  }

  console.log('Fork divergence matches fork-divergence.json.');
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message || error);
  process.exit(2);
}
