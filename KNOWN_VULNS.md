# Known Vulnerabilities — Current State & Accepted Risk

**Last verified: 2026-09-21** against the live Dependabot API and the manifests in
this repo. Every number and version below was read from the repository or the API,
not carried over from an earlier revision.

If you are here because a check is red, jump to
[Guard coverage gaps](#guard-coverage-gaps) — the guard's `tar` floor is stale.

---

## Summary

| Metric | Value |
|---|---:|
| Open Dependabot alerts | **49** |
| — high | 22 |
| — medium | 25 |
| — low | 2 |
| Distinct packages | 18 |
| Stale alerts (package absent from lockfile) | 0 |
| Lockfiles in repo | 10 |
| Lockfiles covered by `scripts/security/check-lockfiles.js` | 10 |

Reproduce:

```bash
gh api "repos/Heretek-AI/GDevelop-Heretek/dependabot/alerts?state=open&per_page=100" \
  --jq 'group_by(.security_advisory.severity) | map({sev: .[0].security_advisory.severity, n: length})'
```

> An earlier revision of this file claimed "All non-electron vulnerabilities across
> the repository have been remediated." That was true of the *curated override set*
> at the time, but not of the alert feed. The override set and the advisory feed are
> different populations; only this file's alert section reflects the feed.

---

## Electron is no longer pinned to 32.x

**Resolved.** The previous 32.x pin (and its 47 advisories) is gone:

| Manifest | Version |
|---|---|
| `newIDE/electron-app/package.json` | `44.4.3` |
| `GDJS/Runtime/Electron/package.json` | `44.3.0` |

`44.4.3` is the current `latest` on npm, so both are at the head of the release
line. The `ignore:` block that held electron at 32.x has been **removed** from
`.github/dependabot.yml`, so electron is once again eligible for major/minor
updates through the normal PR flow.

No native-module rebuild was required at the time of the bump.

---

## Open alerts by package

Grouped by package, with the advisory range and the version this repo actually
resolves. "Fixable" means a patched version exists in the advisory.

### High

| Package | Advisory | Range | Resolved | Patched | Manifest(s) |
|---|---|---|---|---|---|
| `tar` | 6 advisories (GHSA-34x7-hfp2-rc4v, -83g3-92jg-28cx, -8qq5-rm4j-mr97, -9ppj-qmqm-q256, -qffp-2rhf-9h96, -r6q2-hw4h-h46w) | `<= 7.5.17` | `6.2.1` | `7.5.18` | `newIDE/app`, `newIDE/electron-app` |
| `adm-zip` | GHSA-7q85-xj36-vmfc | `< 0.6.1` | `0.6.0` | `0.6.1` | `newIDE/app`, `newIDE/electron-app` |
| `extract-zip` | GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv | `<= 2.0.1` | `2.0.1` | **none** | `newIDE/app`, `newIDE/visual-tests` |
| `svgo` | GHSA-2p49-hgcm-8545, GHSA-w27v-7q3p-w38r | `>= 1.0.0, < 2.8.4` | `1.3.2`, `2.8.2` | `2.8.4` | `newIDE/app` |
| `vite` | GHSA-fx2h-pf6j-xcff | `<= 6.4.2` | `5.4.21` | `6.4.3` | `newIDE/app` |
| `serialize-javascript` | GHSA-5c6j-r48x-rmvq | `<= 7.0.2` | `4.0.0` | `7.0.3` | `SharedLibs/TileMapHelper` |

### Medium

| Package | Advisory | Range | Resolved | Patched | Manifest(s) |
|---|---|---|---|---|---|
| `webpack-dev-server` | 6 advisories | `<= 5.2.5` | `4.15.2` | `5.2.6` | `newIDE/app` |
| `tar` | GHSA-w8wr-v893-vjvp, GHSA-vmf3-w455-68vh | `<= 7.5.17` | `6.2.1` | `7.5.18` | `newIDE/app`, `newIDE/electron-app` |
| `adm-zip` | GHSA-vwc7-r8mq-g2x9 | `>= 0.5.9, <= 0.6.0` | `0.6.0` | **none** | `newIDE/app`, `newIDE/electron-app` |
| `vite` | GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3 | `<= 6.4.2` | `5.4.21` | `6.4.3` | `newIDE/app` |
| `svgo` | GHSA-4vpr-x523-8j87 | `>= 1.0.0, < 2.8.4` | `1.3.2`, `2.8.2` | `2.8.4` | `newIDE/app` |
| `karma` | GHSA-7x7c-qm48-pq9c, GHSA-rc3x-jf5g-xvc5 | `< 6.3.16` | `1.7.1` | `6.3.16` | `GDJS/tests` |
| `firebase` | GHSA-3wf4-68gx-mph8 | `< 10.9.0` | `9.0.0-beta.2` | `10.9.0` | `newIDE/app` |
| `launch-editor` | GHSA-v6wh-96g9-6wx3 | `<= 2.14.0` | `2.13.1` | `2.14.1` | `newIDE/app` |
| `picomatch` | GHSA-3v7f-55p6-f55p | `>= 4.0.0, < 4.0.4` | `3.0.2`, `4.0.3` | `4.0.4` | `newIDE/app` |
| `yargs-parser` | GHSA-p9pc-299p-vxgp | `>= 6.0.0, < 13.1.2` | `7.0.0` | `13.1.2` | `newIDE/app` |
| `uuid` | GHSA-w5hq-g745-h8pq | `< 11.1.1` | `3.4.0` | `11.1.1` | `GDevelop.js` |
| `tough-cookie` | GHSA-72xf-g2v4-qvf3 | `< 4.1.3` | `2.5.0` | `4.1.3` | `GDevelop.js` |
| `decode-uri-component` | GHSA-vcc3-ghjq-m6fr | `<= 0.4.2` | `0.2.2` | `0.5.0` | `GDJS/tests` |
| `request` | GHSA-p8p7-x288-28g6 | `<= 2.88.2` | `2.88.2` | **none** | `GDevelop.js` |

### Low

| Package | Advisory | Range | Resolved | Patched | Manifest(s) |
|---|---|---|---|---|---|
| `@tootallnate/once` | GHSA-vpq2-c234-7xj6 | `< 2.0.1` | `1.1.2` | `2.0.1` | `newIDE/app` |
| `elliptic` | GHSA-848j-6mx2-7j84 | `<= 6.6.1` | `6.6.1` | **none** | `SharedLibs/TileMapHelper` |

---

## Accepted risk — no upstream patch exists

These cannot be closed from this fork. Each is recorded here so it is a documented
decision rather than an unexamined red badge.

| Package | Advisory | Why accepted |
|---|---|---|
| `extract-zip` | GHSA-7pqw-9j4j-h8q3, GHSA-jmr9-qjv8-65gv | No patched release. Reached only through dev/build tooling, never shipped in a game export. |
| `adm-zip` | GHSA-vwc7-r8mq-g2x9 | No patched release. Note the *separate* high advisory GHSA-7q85-xj36-vmfc **does** have a patch (0.6.1) and should be taken. |
| `elliptic` | GHSA-848j-6mx2-7j84 | No patched release. Test-only dependency under `SharedLibs/TileMapHelper`. |
| `request` | GHSA-p8p7-x288-28g6 | No patched release; the package is deprecated upstream. Build-time only in `GDevelop.js`. |

---

## Guard coverage gaps

`scripts/security/check-lockfiles.js` is a *curated floor list*, not a mirror of the
advisory feed. Two gaps are worth knowing about:

1. **`tar` floor is stale.** The guard asserts `'tar': ['< 6.2.1']`, and this repo
   resolves `tar@6.2.1` — so the guard passes. But the current advisories cover
   `<= 7.5.17`, which **includes 6.2.1**. The guard is therefore quiet on 16 live
   advisories. Raising the floor to `< 7.5.18` without also moving to `tar@7.x`
   would simply turn `master` red, so this needs the tar 6→7 migration first
   (tracked in the dependabot remediation issue).
2. **`newIDE/visual-tests/package-lock.json` was unguarded.** There were 10 lockfiles
   on disk and 9 in the guard's list. Added — it is now covered.

Confirm coverage at any time:

```bash
comm -23 \
  <(find . -name package-lock.json -not -path '*/node_modules/*' | sed 's|^\./||' | sort) \
  <(sed -n '/^const lockfiles/,/^];/p' scripts/security/check-lockfiles.js \
    | grep -oE "'[^']+'" | tr -d "'" | sort)
# expect: no output
node scripts/security/check-lockfiles.js   # expect: exit 0
```

---

## CodeQL

### `js/incomplete-sanitization` in test files

One alert is on `GDevelop.js/__tests__/ExpressionCompletionFinder.spec.js:21`. The
string being escaped is test input, not production data. Dismiss with
`False positive` in the CodeQL UI and leave a comment in the file.

### `js/disabling-electron-websecurity`

The two alerts on `newIDE/electron-app/app/main.js` and
`LocalExternalEditorWindow.js` are intentional — the local-external-editor window
needs `webSecurity: false` to load user-supplied game previews from `file://` URLs.
Dismiss with `Used in tests` plus a code comment pointing at `BUILD.md`.

---

## Google API key secret alerts

Upstream-owned secrets this fork **cannot** dismiss (no permission to revoke). They
remain in the Security tab until upstream purges them from history. This branch
stops re-leaking them via the env-var pattern documented in `SECRETS.md`.
