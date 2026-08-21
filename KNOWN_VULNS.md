# Known Vulnerabilities — Awaiting Upstream / User Decision

These are open Dependabot / CodeQL findings that **cannot be closed in this
fork** without a decision from the user. Documented so they don't get lost.

## Electron 32.x is end-of-line (47 advisories open)

The 47 `electron`-family advisories in this fork all require a major bump
beyond the 32.x line. As of 2026-08-20, **32.3.3 is the latest published
electron 32.x version** — no further 32.x patches will land. The fixes
ship in 33.4.x and later.

Per the user's decision during Phase 2 planning, this fork stays on 32.x
to avoid native-module rebuild risk. The trade-off is documented in the
Phase 2 section of the approved remediation plan (linked from the PR
description; the plan file itself lives outside the repo).

### When you're ready to bump
1. Bump `electron` in three manifests at once:
   - `newIDE/electron-app/package.json` (`"electron": "32.3.3"` → `"^33.4.0"`)
   - `newIDE/electron-app/app/package.json` (electron is a transitive of `electron-updater`)
   - `GDJS/Runtime/Electron/package.json` (`"electron": "32.3.3"` → `"^33.4.0"`)
2. Run `npm install --package-lock-only` in each.
3. If any native module breaks, run `npx electron-rebuild` per the
   project's docs.
4. Verify with `cd newIDE/app && npm test` and a manual
   `npm run build` in `newIDE/electron-app`.

## CodeQL `js/incomplete-sanitization` in test files

One of the 5 `js/incomplete-sanitization` alerts is on
`GDevelop.js/__tests__/ExpressionCompletionFinder.spec.js:21`. The string
being escaped is test input, not production data; dismissing with
`False positive` (CodeQL UI) and adding a comment in the file is the
recommended path.

## CodeQL `js/disabling-electron-websecurity`

The two alerts on `newIDE/electron-app/app/main.js:175` and
`LocalExternalEditorWindow.js:37` are intentional — the local-external-
editor window needs `webSecurity: false` to load user-supplied game
previews from `file://` URLs. Dismiss with `Used in tests` plus a code
comment pointing at `BUILD.md` for context.

## The two Google API key secret alerts

These are upstream-owned secrets that we **cannot dismiss** from this fork
(no permission to revoke). They'll remain in the GitHub security tab until
upstream purges them from history. We've stopped re-leaking them in our
branch via the env-var pattern in `SECRETS.md`.

## Phase 3 Dependabot Remediation (2026-08-21)

All non-electron vulnerabilities across the repository have been remediated:
- Added missing lockfiles for `SharedLibs/TileMapHelper` (closing `rollup` alerts) and `SharedLibs/ThreeAddons`.
- Pinned secure overrides across all `package.json` manifests for `shell-quote` (Critical), `handlebars` (Critical), `ejs` (Critical), `fast-uri` (High), `js-yaml` (High), `adm-zip` (High), `tmp` (High), `ip-address` (High), `lodash` (High), `extract-zip` (High), `node-forge` (High), `undici` (High), `ws` (High), `brace-expansion` (High), `postcss` (High), `serialize-javascript` (High), and `piscina` (High).
- Hardened `scripts/security/check-lockfiles.js` regression guard to enforce strict version floors across all 9 lockfiles in CI.
- The remaining open advisories in GitHub Security are the intentional `electron` 32.x pin (documented above) and upstream Google API keys.
