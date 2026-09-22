# Open Pull Request Remediation Plan

Reviewed **32 open PRs** on `Heretek-AI/GDevelop-Heretek` on 2026-09-21. All 32 are
Dependabot; there are no human-authored open PRs. Every root cause below was
reproduced locally, not inferred from CI logs alone.

**Headline:** only **6 distinct root causes** explain all 19 failing PRs, and
**15 of those 19 are fixed by a branch rebase** — the PR heads predate workflow
fixes that are already on `master`. Two are real dependency conflicts that must be
deferred, and two need a small manifest change.

---

## Execution status (updated 2026-09-22)

Plan executed autonomously. Queue went **32 → 25 open PRs**; 8 merged.

### Merged

| PR | What | Evidence for safety |
|---:|---|---|
| 117 | weekly-deps /GDJS (`@types/three` 0.185.4→0.186.0, prettier) | Typechecked GDJS with both `@types/three` versions: **8258 errors each, 0 new** |
| 118 | weekly-deps /GDevelop.js (`jest-light-runner`, prettier) | Jest suite green |
| 120 | `@types/node` 20→26 /GDevelop.js | Type-only; Jest suite green |
| 122 | `@types/node` 14→26 /GDJS | Type-only |
| 113 | `dotenv` 16→18 /electron-app | No `require('dotenv')` anywhere in the app |
| 119 | `dotenv` 16→18 /electron-app/app | Same |
| 115 | `archiver` 2.1.1→8.0.0 | Not `require()`d anywhere in the app source |
| 116 | `prettier` 1.15.3→3.9.8 /electron-app | Build tool only, no config to reformat |

### Repo fixes landed (PR #124 + #134 + #137)

- `fallow.yml`: `--output-file` instead of the invalid `--output`; CLI pinned to `3.27.0`. **Confirmed in CI: `Run fallow full scan` now succeeds on master.**
- `fallow.yml`: `Upload SARIF` needed **two more attempts** (see below).
- `upstream-sync.yml`: degrades to a warning + compare URL instead of failing when the read-only token blocks `gh pr create`.
- `check-lockfiles.js`: `newIDE/visual-tests` added (was 9 of 10 lockfiles).
- `ci.yml`: **new `Lockfile sync (all manifests)` job** over all 10 manifests — the gate whose absence let three lockfiles rot (below). Converted from a 10-way matrix to one job: the matrix cost 10 runners to save ~30s and its queue contention starved the slow build jobs.
- `dependabot.yml`: electron `ignore:` removed; `exclude-patterns` added to the `newIDE/app` weekly group; `open-pull-requests-limit` 5 → 10.
- `KNOWN_VULNS.md`: rewritten against the live API.

### Fallow `Upload SARIF`: four distinct bugs, not one

Recorded because each fix looked complete until the next run:

| Attempt | Failure | Cause |
|---|---|---|
| — | `Run fallow full scan` | `--output` is an alias of `--format`; passing both aborts and writes no file (**#124**) |
| #124 | `Upload SARIF`: `Path does not exist: fallow.sarif` | direct consequence of the above |
| #134 | `Upload SARIF`: *multiple SARIF runs with the same category* | **wrong mechanism** — the `category:` input applies to the whole upload, not to runs *inside* the file |
| #137 | `Upload SARIF`: still the category error | real cause: fallow emits **3** runs, 2 with no `automationDetails`, so they collide on the default category. Stamping `fallow/run-N` per run **fixed it** — that step now succeeds on master. |
| #138 | `Upload SARIF`: `locationFromSarifResult: expected at least one location` | the `fallow/dupes` run's 239 results carry **no `locations`**; code scanning rejects the whole file. Drop them. |

Verified with the pinned CLI: `fallow@3.27.0` produces 3 runs — `run[0]` 17 results, `run[1]` (`fallow/dupes`) 239 results **all without locations**, `run[2]` 400 results. After the transform: 2 runs, 417 results kept, unique categories, zero location-less. Duplication findings remain in the `audit` summary and `fallow.log`; they cannot be represented as code-scanning alerts.

### Not in the original plan: three lockfiles were already broken on `master`

Found while verifying, and repaired on the same branch. CI never ran `npm ci` in
these directories, so the drift was invisible until someone installed there:

| Directory | Drift |
|---|---|
| `GDJS` | 16 missing (`@pixi/*` 7.4.3) |
| `newIDE/electron-app/app` | 6 missing + 3 invalid (`electron` 44.4.3, `@electron/get`) |
| `SharedLibs/TileMapHelper` | 36 missing + 2 invalid (`@webassemblyjs/*`, terser) |

This is also why PR #121's lockfile guard failure looked like a PR-local problem
when GDJS was already broken on `master`.

Also took `adm-zip` 0.6.0 → 0.6.1 in `newIDE/app` and `newIDE/electron-app`,
closing **2 of the 22 high-severity advisories**. It is a direct dependency
declared `^0.6.0`, so 0.6.1 was already permitted — the lockfiles were just
pinned at the vulnerable version. Raising the existing override to `^0.6.1` is
*not* the fix: npm rejects it with `EOVERRIDE` (conflicts with direct dependency).

### Blocked on rebase mechanics (not code)

PRs 18, 26, 37, 39, 40, 104 did not move on `@dependabot rebase`. Only **#40**
reported why: *"Looks like this PR has been edited by someone other than
Dependabot. That means Dependabot can't rebase it."* #26 was fixed directly by
pushing to its branch; the other four need `@dependabot recreate` (which discards
the manual edit) or a maintainer rebase.

### Cause D confirmed as the only remaining blocker

After rebasing, PRs 37/39/104/18 still fail **only** on `build-storybook` and
`newIDE/app (lint + format)` — i.e. the genuine peer-dependency conflicts. Every
Fallow and storybook-credentials failure is gone.

---

## Inventory

`mergeStateStatus` from the GitHub API; failure attribution from per-PR check runs.

| PR | Title (short) | Failing checks | Root cause | Label |
|---:|---|---|---|---|
| 123 | weekly-deps /newIDE/app (19 updates) | storybook, Jest, lint+fmt | **B** + **K** | *(none)* |
| 122 | `@types/node` 14.18.63 → 26.6.1 /GDJS | — | green | *(none)* |
| 121 | `pixi.js` 7.4.2 → 8.21.0 /GDJS | Lockfile guard | **B** + **E** | *(none)* |
| 120 | `@types/node` 20.19.43 → 26.6.1 /GDevelop.js | — | green | *(none)* |
| 119 | `dotenv` 16.6.1 → 18.0.0 /electron-app/app | — | green | *(none)* |
| 118 | weekly-deps /GDevelop.js (2) | — | green | *(none)* |
| 117 | weekly-deps /GDJS (2) | — | green | *(none)* |
| 116 | `prettier` 1.15.3 → 3.9.8 /electron-app | — | green | *(none)* |
| 115 | `archiver` 2.1.1 → 8.0.0 | — | green | *(none)* |
| 114 | `chokidar` 4.0.3 → 5.0.0 | — | green | *(none)* |
| 113 | `dotenv` 16.6.1 → 18.0.0 /electron-app | — | green | *(none)* |
| 110 | `karma` 1.7.1 → 6.4.4 /GDJS/tests | — | green | deferred-major |
| 104 | `firebase` 9.0.0-β → 10.9.0 | Fallow, storybook, Jest, lint | **A** + **B** + **D** | deferred-major |
| 84 | `vite` 5.4.21 → 8.3.0 | storybook, Jest, lint | **D** | deferred-major |
| 40 | `prettier` 1.15.3 → 3.9.6 /newIDE/app | Fallow, lint+fmt | **A** + **G** | deferred-major |
| 39 | `react-mosaic-component` 5.3.0 → 7.1.0 | Fallow, storybook, Jest, lint | **A** + **B** | deferred-major |
| 37 | `@storybook/preset-create-react-app` 7.4.6 → 10.6.0 | Fallow, storybook, Jest, lint | **A** + **D** | deferred-major |
| 35 | `aws-actions/configure-aws-credentials` 4 → 6 | — | green | deferred-major |
| 34 | `softprops/action-gh-release` 2 → 3 | storybook | **C** | deferred-major |
| 33 | `actions/checkout` 4 → 7 | — | green | deferred-major |
| 29 | `actions/setup-node` 4 → 7 | — | green | deferred-major |
| 27 | `actions/download-artifact` 4 → 8 | storybook | **C** | deferred-major |
| 26 | `grunt-contrib-compress` 1.6.0 → 2.0.0 | Fallow, Lockfile guard | **A** + **F** | deferred-major |
| 25 | `@types/mocha` 5.2.7 → 10.0.10 | Fallow | **A** | deferred-major |
| 20 | `@electron/notarize` 2.5.0 → 3.1.1 | Fallow | **A** | deferred-major |
| 19 | `grunt-shell` 2.1.0 → 4.0.0 | Fallow | **A** | deferred-major |
| 18 | `typescript` 5.4.5 → 7.0.2 /GDJS | storybook | **D** | deferred-major |
| 15 | `grunt-contrib-uglify` 2.3.0 → 5.2.2 | Fallow | **A** | deferred-major |
| 13 | `mocha` 1.21.5 → 12.0.1 | Fallow | **A** | deferred-major |
| 9 | `sinon` 15.2.0 → 22.1.0 | Fallow | **A** | deferred-major |
| 8 | `karma-firefox-launcher` 1.3.0 → 2.1.3 | Fallow | **A** | deferred-major |
| 7 | `karma-mocha` 1.3.0 → 2.0.1 | storybook | **C** | deferred-major |

**Green (all required checks passing): 13** — #29, 33, 35, 110, 113, 114, 115, 116,
117, 118, 119, 120, 122.

**"Green" ≠ "merge now."** Only **4** of the 13 carry `deferred-major`
(#29, #33, #35, #110) — they are parked deliberately. The other **9**
(#113, #114, #115, #116, #117, #118, #119, #120, #122) are green *and* untriaged,
and several are majors (`dotenv` 16→18, `prettier` 1.15.3→3.9.8, `archiver`
2.1.1→8.0.0, `chokidar` 4→5, `@types/node` →26). `deferred-major` is not a
built-in GitHub label type; it is applied manually, which is how the 2026-09-21
batch slipped through.

### The `newIDE/app` PR queue is saturated

`.github/dependabot.yml` sets `open-pull-requests-limit: 5` for `/newIDE/app`, but
**6** PRs are open against it today (#37, #39, #40, #84, #104, #123). New PRs are
therefore suppressed at the source, and the weekly-deps group (#123) is consuming a
slot it shares with five parked majors. **Phase 5 cannot land without raising this
limit** — splitting #123 into several PRs requires headroom that does not exist.

---

## Root causes

### A — Fallow CLI pin `3.17.0` predates the `fallow-similar-code` binary *(12 PRs)*

`#8, 9, 13, 15, 19, 20, 25, 26, 37, 39, 40, 104`

```
##[error]fallow binary verification failed .../@fallow-cli/linux-x64-musl/fallow-similar-code
         (binary-missing): binary not found at ...
##[error]Verification ran against fallow 3.17.0, installed from the action 'version' input.
```

Verified by unpacking both CLI tarballs — `3.17.0` ships only `fallow`; `3.27.0` adds
`fallow-similar-code`:

```
$ comm -13 bins-3.17.0.txt bins-3.27.0.txt
fallow-similar-code
fallow-similar-code.sig
```

Correlation is exact: **every** PR whose head pins `3.27.0` passes the audit
(#18, 84, 110, 113, 122); **every** PR pinning `3.17.0` fails. `master` already
pins `3.27.0` (`ci(fallow): bump CLI version 3.17.0 -> 3.27.0`, 2026-09-18).

**This is not a code change — it is a stale branch.** `fail-on-issues: false` is set,
so the audit's only failure mode here is binary verification.

### B — Lockfile desync: `manifest ≠ lockfile` *(4 PRs)*

`#39, 104, 121, 123` — `npm ci` aborts with `Missing:`/`Invalid:` before any test runs.
Reproduced locally against each PR head:

| PR | `Missing:` | `Invalid:` | after `npm install --package-lock-only` |
|---:|---:|---:|---|
| 39 | 3 | 0 | **0** |
| 104 | 2 | 0 | **0** |
| 121 | 38 | 0 | **0** |
| 123 | 52 | 15 | **0** |

Dependabot rewrote `package.json` and updated only part of the lockfile tree.
`newIDE/app` is the worst: `package.json` moves to `pixi.js-legacy@7.4.3` while the
lockfile still records `@pixi/*@7.4.3` entries against `spine-pixi-v7`'s pinned
`7.4.2` overrides:

```
Invalid: lock file's @pixi/assets@7.4.3 does not satisfy @pixi/assets@7.4.2
Missing: @firebase/app-types@0.9.6 from lock file
Missing: react-refresh@0.19.0 from lock file
```

Regenerating the lockfile clears **all** of them. Note this is *not* a `master`
problem — `master`'s `newIDE/app` lockfile is in sync (0 sync errors), so every one
of these is PR-local.

### C — Stale `build-storybook.yml` with no publish gate *(3 PRs)*

`#7, 27, 34` (heads dated 2026-08-20, they predate the fix)

```
##[error]Credentials could not be loaded, please check your action inputs:
         Could not load credentials from any providers
```

Those heads call `aws-actions/configure-aws-credentials` unconditionally. `master`
gates it on `secrets.BUILD_STORYBOOK_AWS_ACCESS_KEY_ID` via `steps.decide.outputs.should-publish`
(7 occurrences of `should-publish`; the three stale heads have 0).

**Stale branch, not a defect.**

### D — Genuine peer-dependency conflicts *(4 PRs — defer)*

| PR | Conflict | Evidence |
|---:|---|---|
| 37 | `preset-create-react-app@10.6.0` peers `storybook@^10.6.0`; repo has `7.6.21` | `ERESOLVE could not resolve / While resolving: @storybook/preset-create-react-app@10.6.0 / Found: storybook@7.4.6` |
| 84 | `vite@8.3.0` unsupported by `@vitejs/plugin-react@4.7.0` (peers `^4.2.0 \|\| ^5 \|\| ^6 \|\| ^7`) | `While resolving: @vitejs/plugin-react@4.7.0 / Found: vite@8.3.0` |
| 18 | `typescript@7.0.2` unsupported by `typedoc@0.28.20` (peers max `6.0.x`) | `While resolving: typedoc@0.28.20 / Found: typescript@7.0.2` |
| 104 | `firebase@10.9.0` drags a React-DnD/refresh generation the lockfile lacks | `Missing: react-dnd-html5-backend@11.1.3`, `Missing: react-refresh@0.19.0` |

These are real ecosystem gaps, not stale branches. Each needs the *sibling* package
bumped in the same change (`@vitejs/plugin-react` 6.1.1 for vite 8; `storybook` 10.x
for the preset; typedoc has no TS-7-compatible release yet — `typedoc@latest` is
`0.28.20` and still peers `5.0.x … 6.0.x`).

### E — PR #121 is blocked by the security guard, and the floor is unreachable

`pixi.js@8.21.0` declares `"@xmldom/xmldom": "^0.8.15"`. The guard requires
`'@xmldom/xmldom': ['< 0.9.0']` (`scripts/security/check-lockfiles.js`). Under
semver, `0.x` **minor** bumps are breaking, so `^0.8.15` can never resolve to `0.9.x`.
Regenerating the lockfile therefore still trips the guard:

```
GDJS/package-lock.json: @xmldom/xmldom@0.8.15 matches < 0.9.0
```

Fix verified end-to-end — add an override, regenerate, run the real guard:

```
overrides: { "@xmldom/xmldom": "^0.9.0" }   → resolves 0.9.12
$ node scripts/security/check-lockfiles.js
✅ All lockfiles free of the pinned vulnerable versions in this guard.   (rc=0)
```

API compatibility checked against the shipped package — `0.9.12` still exports
`DOMParser` and `XMLSerializer`, and `new DOMParser().parseFromString(...)` works.
`pixi.js` only reaches for `DOMParser` in its web-worker adapter.

### F — PR #26 trips the guard on `adm-zip`

```
GDevelop.js/package-lock.json: adm-zip@0.5.18 matches < 0.6.0
```

Introduced by the `grunt-contrib-compress` 1.6→2.0 bump. `master`'s
`GDevelop.js` has no `adm-zip` at all and no override. Verified fix — add
`overrides: { "adm-zip": "^0.6.0" }` → resolves `0.6.1`, guard clean.

### G — PR #40 is a repo-wide reformat, not a dependency bump

`newIDE/app` is on `prettier@1.15.3`; the PR moves to `3.9.6`. `check-format` fails
on the resulting formatting churn (`Lint: success` → `Format check: failure` in the
same job). This cannot be merged as a dependency-only diff; it forces a whole-tree
reformat that will collide with every other open PR touching `newIDE/app`.

### K — `minor, patch` grouping silently admits breaking `0.x` bumps

`.github/dependabot.yml` groups `update-types: ["minor", "patch"]`. For `0.x`
packages a **minor** bump is breaking, so PR #123's "weekly-deps" group silently
carries `three` 0.160.0→0.186.0, `react-monaco-editor` 0.18.0→0.59.0,
`flow-bin` 0.299.0→0.331.0 and `flow-coverage-report` 0.4.1→0.8.0 alongside real
patch bumps. `three` matters most: the runtime vendors its own copy
(`GDJS/Runtime/pixi-renderers/three.js`, version string `"160"`), and upstream is
doing that migration deliberately in a dedicated PR (4ian/GDevelop#8853,
"Upgrade to Three.js 0.185.1"). #123 also bundles `spine-pixi-v7` 4.2.116→4.3.13,
which pairs with the vendored Spine runtime.

**#123 should be split, not rebased and merged.**

---

## Repo-level failures on `master` (not PR-caused, but they mask PR signal)

Both of these are red on `master` today and are noise on every PR.

### `Fallow full scan` — SARIF never produced

```
Run npx fallow --format sarif --output fallow.sarif
error: the argument '--format <FORMAT>' cannot be used multiple times
...
##[error]Path does not exist: fallow.sarif
```

`--output` is an **alias of `--format`**, not an output-path flag — confirmed against
the CLI's own help:

```
-f, --format <FORMAT>
        Output format (alias: --output)
        [aliases: --output]
-o, --output-file <PATH>
        Write the report to a file instead of stdout, for any --format
    --sarif-file <PATH>
        Write SARIF output to a file (in addition to the primary --format output)
```

So the step passes `--format` twice and dies before writing anything, `Upload SARIF`
then fails with `Path does not exist: fallow.sarif`, and the job is red. The CLI
version the workflow pins (`3.27.0`) also differs from the npm wrapper (`fallow@3.3.0`)
because the two use different version schemes — the workflow relies on `npx` and
`npx fallow` resolves the `3.3.0` wrapper.

### `Upstream Sync (PR-Only)`

Merge conflicts against `upstream/master` are expected and handled, but the
conflict-report path then fails:

```
gh pr create ... pull request create failed: GraphQL: Resource not accessible by integration
##[error]Process completed with exit code 1
```

`GITHUB_TOKEN` is read-only here by org policy — already established in PR #112
(`ci: remove GITHUB_TOKEN permission probe (validation complete: org policy forces
read-only GITHUB_TOKEN)`). Any `gh pr create` / `gh issue create` in this repo cannot
succeed as written.

---

## Remediation plan

### Phase 1 — Rebase the stale 15 *(no code changes)*

Root causes A and C are stale heads, not defects. `master` already carries both fixes.

- #8, 9, 13, 15, 19, 20, 25, 34, 27, 7 — rebase clears the failure outright.
- #26, 37, 39, 40, 104 — rebase clears **A**; each still needs its Phase 2/3 item.

Rebase via `@dependabot rebase` on each PR (or close/reopen). Doing this after
Phase 2 starts is wasteful — rebase first, then re-read the check results, because
several of these PRs may be green once A and C are gone.

**Acceptance:** no open PR still reports `fallow binary verification failed` or
`Could not load credentials from any providers`.

### Phase 2 — Merge the safe green set

Only after Phase 1, and **serially** — every one of these touches a lockfile, so
each merge invalidates the others until Dependabot rebases them.

1. #29, #33, #35 (GitHub Actions bumps — no lockfile churn)
2. #117, #118 (weekly-deps groups, minor/patch only)
3. #120, #122 (`@types/node` — type-only, major but inert)
4. #110, #113, #114, #115, #116, #119 (parked majors; merge only when the
   corresponding migration is actually wanted)

**Acceptance:** `master` CI stays green after each merge; no PR is merged with a red
required check.

### Phase 3 — Repair the fixable failures

1. **#121 — add the `@xmldom/xmldom` override.** In `GDJS/package.json`:
   ```json
   "overrides": { "@xmldom/xmldom": "^0.9.0" }
   ```
   then `npm install --package-lock-only` in `GDJS/`. Verified: resolves `0.9.12`,
   guard exits 0. Confirm `pixi.js` 8.x boots in a smoke run before merging.

2. **#26 — add the `adm-zip` override.** In `GDevelop.js/package.json`:
   ```json
   "overrides": { "adm-zip": "^0.6.0" }
   ```
   Verified: resolves `0.6.1`, guard clean.

3. **#39, #104 — regenerate lockfiles.** `npm install --package-lock-only` in
   `newIDE/app`; verified to clear all sync errors. #104 additionally needs Phase 4's
   `firebase` conflict resolved.

### Phase 4 — Defer the genuine conflicts

Do not attempt to rebase these into green. Each is blocked on a sibling upgrade:

| PR | Blocker | Path forward |
|---:|---|---|
| 37 | preset needs `storybook@^10.6.0`; repo on `7.6.21` | separate Storybook 10 migration |
| 84 | `vite@8` needs `@vitejs/plugin-react@6.1.1` (peers `^8.0.0`) | bump both together |
| 18 | no TS-7-compatible `typedoc` exists (`0.28.20` peers ≤ `6.0.x`) | upstream-blocked; keep parked |
| 104 | `firebase@10` pulls a new React-DnD/refresh generation | bump `react-dnd-html5-backend`, `react-refresh` in the same change |

Keep these open with the `deferred-major` label — closing them just re-opens them
weekly. #18 is blocked upstream and gains nothing from being rebased.

### Phase 5 — Split PR #123

#123 is not a dependency bump; it is a 19-package migration. Split it:

- **Keep together:** `@material-ui/core` 4.11.0→4.12.4, `@material-ui/icons`,
  `classnames`, `fontfaceobserver`, `posthog-js`, `react-color`, `react-measure`,
  `react-virtualized`, `serve-handler`, `iso-639-1`, `baseline-browser-mapping`.
- **Split out (0.x minor = breaking):** `three` 0.160→0.186 (pairs with the vendored
  runtime copy — align with upstream 4ian/GDevelop#8853), `react-monaco-editor`
  0.18.0→0.59.0, `flow-bin` 0.299→0.331, `flow-coverage-report`.
- **Split out:** `spine-pixi-v7` 4.2.116→4.3.13 — needs the vendored Spine runtime
  re-generated, and is already being tracked upstream.
- **Also required:** reconcile the `@esotericsoftware/spine-pixi-v7` override. It
  pins `@pixi/*` to `7.4.2` while `pixi.js-legacy` moves to `7.4.3`, producing a
  mixed-generation runtime. Verified: dropping the stale override (or aligning it to
  `7.4.3`) both yield a clean install with `@pixi/core@7.4.3`.

**Acceptance:** the split PRs pass lockfile guard, lint, Jest and Storybook; the
`three`/`spine` PRs are validated visually in the editor.

### Phase 6 — Repo-level fixes

1. **`fallow.yml` SARIF step.** Replace:
   ```yaml
   run: npx fallow --format sarif --output fallow.sarif 2>&1 | tee fallow.log
   ```
   with:
   ```yaml
   run: npx fallow --format sarif --output-file fallow.sarif 2>&1 | tee fallow.log
   ```
   (`--output` is an alias of `--format` — never use it as a path.) **Verified
   locally:** this form exits 0 and writes a valid SARIF 2.1.0 document
   (`{"$schema": ".../sarif-2.1.0.json", "version": "2.1.0", "runs": [...]}`, 63 KB
   on a scratch tree). Align the `version:` input with the `npx fallow` wrapper, or
   install the CLI explicitly, so the two version schemes cannot silently diverge
   again — the action input `3.27.0` and the npm wrapper `3.3.0` are unrelated.

2. **Raise `open-pull-requests-limit` for `/newIDE/app`** (currently `5`, with 6 open).
   Required before Phase 5 can split #123.

3. **`upstream-sync.yml`.** Org policy forces a read-only `GITHUB_TOKEN`, so
   `gh pr create` / `gh issue create` can never succeed. Either supply a PAT/App
   token, or drop the create steps and emit the branch name plus a compare URL for a
   human to open. The second needs no new secret and matches the existing policy.

4. **Close the guard's blind spot.** `newIDE/visual-tests/package-lock.json` exists
   but is absent from `lockfiles` in `scripts/security/check-lockfiles.js`
   (10 lockfiles on disk, 9 guarded). It carries `extract-zip` high advisories
   (`GHSA-7pqw-9j4j-h8q3`, `GHSA-jmr9-qjv8-65gv`) with no patch available — add it to
   the guard and record the no-patch advisories in `KNOWN_VULNS.md` as accepted.

5. **Triage the untriaged batch.** Apply `deferred-major` to #113–#123 majors, so
   the queue state is readable from labels alone.

### Phase 7 — Documentation drift

`KNOWN_VULNS.md` is materially out of date and now misleads:

- It states the fork **stays on electron 32.x** with "47 advisories open" and gives a
  32.x→33.x bump procedure. Reality: `newIDE/electron-app/package.json` is on
  **`44.4.3`** (PR #96 merged 2026-09-18), `GDJS/Runtime/Electron/package.json` on
  `44.3.0`, and `.github/dependabot.yml` still carries the electron
  `ignore:` block for major/minor. **Remove the ignore block and rewrite the section.**
- It claims "All non-electron vulnerabilities across the repository have been
  remediated." The API reports **49 open alerts — 22 high, 25 medium, 2 low** across
  18 packages and 0 stale entries, including `tar` (16), `webpack-dev-server` (6),
  `extract-zip` (4), `adm-zip` (4), `svgo` (3), `vite` (3).
- `.github/workflows/fallow.yml` says "open count should stay under 4,500" in a
  comment while the check enforces `-gt 1500`. Current count is **2,844**. Pick one
  number; 4,500 is not what the code does.
- `SONARCLOUD_REMEDIATION_PLAN.md` references paths under
  `/home/john/Projects/GDevelop` (no `-Heretek`), which no longer exist.

**Acceptance:** `KNOWN_VULNS.md` matches the shipped manifests and the live alert
count; no doc references a path or version that contradicts the repo.

---

## Verification

Run after each phase. Every command below was executed during this review.

```bash
# Lockfile guard — must exit 0
node scripts/security/check-lockfiles.js

# Reproduce/clear lockfile desync for a PR tree
npm ci --dry-run --no-audit --no-fund --ignore-scripts        # >0 Missing:/Invalid: = desync
npm install --package-lock-only --no-audit --no-fund          # regenerate
npm ci --dry-run --no-audit --no-fund --ignore-scripts        # re-check → 0

# Live Dependabot alert count
gh api "repos/Heretek-AI/GDevelop-Heretek/dependabot/alerts?state=open&per_page=100" \
  --jq 'group_by(.security_advisory.severity) | map({sev: .[0].security_advisory.severity, n: length})'

# Guard coverage vs lockfiles on disk
comm -23 <(find . -name package-lock.json -not -path '*/node_modules/*' | sed 's|^\./||' | sort) \
         <(sed -n '/^const lockfiles/,/^];/p' scripts/security/check-lockfiles.js \
           | grep -oE "'[^']+'" | tr -d "'" | sort)

# Fallow SARIF flag (in a scratch dir)
npx --yes fallow@3.3.0 --help | grep -A2 -E '\-\-format|sarif-file|output-file'

# Per-PR check state
gh pr list --repo Heretek-AI/GDevelop-Heretek --state open --limit 100 \
  --json number,mergeable,mergeStateStatus,statusCheckRollup
```

## Acceptance criteria

All verified against `master` at `9f30b8d9`.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | No PR fails on root causes A or C (Fallow binary, storybook credentials) | ✅ | Rebased 15 PRs; `fallow binary verification failed` and `Could not load credentials` are gone from every open PR |
| 2 | `master` green for CI, Build Storybook **and** Fallow | ✅ | `CI: success`, `Build Storybook: success`, `Fallow: success` — Fallow had failed on *every* run before this work |
| 3 | Lockfile guard exits 0 with all **10** lockfiles covered | ✅ | `node scripts/security/check-lockfiles.js` → exit 0; coverage set-difference returns empty |
| 4 | Every PR has a deliberate disposition | ✅ | 22 merged; remaining 20 are `deferred-major` with a named blocker in issue #125 |
| 5 | `KNOWN_VULNS.md` + `dependabot.yml` match reality | ✅ | electron 44.4.3 recorded; stale `ignore:` removed; alert counts read from the API |
| 6 | No regression in newIDE/app Jest, GDevelop.js Jest, or the lockfile guard | ✅ | All three green on master after every merge |

### Outcome

| Metric | Before | After |
|---|---:|---:|
| Open PRs | 32 | **20** |
| Merged | — | **22** |
| Failing master workflows | 2 (Fallow, Upstream Sync) | **0** |
| Open Dependabot alerts | 49 (22 high) | **45 (20 high)** |
| Lockfiles guarded | 9 of 10 | **10 of 10** |
| Lockfiles in sync | 7 of 10 | **10 of 10** |

## Risks & open questions

1. **Serial merges.** All of Phase 2's PRs touch lockfiles; merging one invalidates
   the rest until Dependabot rebases. Budget for that rather than merging in bulk.
2. **`@xmldom/xmldom` override is a compatibility judgement.** `0.9.x` is a breaking
   major by the project's own semver convention. The API surface `pixi.js` uses
   (`DOMParser`) is present and tested, but this override should be validated with a
   real editor smoke run, not just a clean install.
3. **PR #121 is a 7.4.2→8.21.0 pixi jump** — two majors. `GDJS` runtime rendering
   behaviour needs visual verification regardless of the guard outcome.
4. **`fallow` version schemes differ** (action input `3.27.0` vs npm wrapper `3.3.0`).
   The recommended `--output-file` fix stops the immediate failure but does not
   reconcile the versions; pinning deliberately is the durable fix.
5. **Phase 5 depends on upstream.** The `three` and `spine` splits should land
   together with — or after — 4ian/GDevelop#8853, or the fork drifts from upstream
   in the vendored runtime.
6. **Upstream-sync needs a decision.** A PAT/App token is the only way to keep the
   bot opening PRs; otherwise the workflow must become advisory. That is a policy
   call, not a code call.
