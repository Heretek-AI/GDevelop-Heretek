# Maintaining this fork

Operational guide for `Heretek-AI/GDevelop-Heretek` (a fork of `4ian/GDevelop`).
Covers the two things that make a fork expensive to keep alive: **divergence from
upstream** and **static-analysis noise**. Read this before touching `.fallow.toml`,
`.sonarcloud.properties`, `.github/workflows/`, or `fork-divergence.json`.

Numbers below were measured on `master` @ `f72bb71f6` (2026-09-22). Re-measure
rather than trusting them if the tree has moved.

---

## 1. Fork divergence

### What diverges

The fork diverges on **180 paths** out of ~6,700. `fork-divergence.json` is the
checked-in allowlist, in three buckets, measured against the baseline commit the
manifest records:

| Bucket | Count | Meaning |
|---|---:|---|
| `modified` | 116 | Existed upstream at the baseline and the fork's content differs |
| `forkOnly` | 57 | The fork created it; upstream had no such path at the baseline |
| `upstreamMissing` | 7 | Existed upstream at the baseline and the fork deliberately does not carry it |

`upstreamMissing` is the dangerous bucket: an upstream merge re-introduces those
files, and nothing else notices. The 7 are:

| Path | Why it is absent |
|---|---|
| `newIDE/app/patches/wavesurfer.js+7.12.6.patch` | Obsoleted by the bump to `wavesurfer.js@7.12.12`; the patch pinned a renderer bug fixed upstream in 7.12.8. Delete it again if a sync restores it. |
| `newIDE/app/src/Utils/{Array,Delay,UseForceUpdate,UseIsMounted,UseTimeout}.js` | Converted to `.ts` in place. The `.js` originals must not come back, or the build resolves duplicates. |
| `newIDE/web-app/yarn.lock` | `BUILD.md` forbids it; this repo uses npm only. Delete it again if a sync restores it. |

### The guard

```bash
# verify: exits 1 on new or stale divergence
node scripts/check-fork-divergence.js

# record the current divergence as intended
node scripts/check-fork-divergence.js --update

# print the full divergence set without judging it
node scripts/check-fork-divergence.js --list
```

It runs in `ci.yml` (`fork-divergence` job, every PR) and informationally in
`upstream-sync.yml` after the merge. It reads upstream two ways, preferring a
local ref and otherwise the GitHub trees API — the upstream repo is ~1.7 GB, so a
clone on every PR is not acceptable. Provide `GH_TOKEN` (or `GITHUB_TOKEN` in CI)
for the API path, or add the remote locally:

```bash
git remote add upstream https://github.com/4ian/GDevelop.git
git fetch --depth=1 upstream master
```

The comparison includes uncommitted work, so `--update` describes the tree you
actually have, not just the last commit.

### The baseline commit

The guard measures against **the baseline commit recorded in the manifest**
(`baselineCommit`), not against live `upstream/master`. That distinction is what
makes it usable:

- Measured against live upstream, every upstream push that touched a file the
  fork also carries read as "new divergence" — a locale file upstream
  regenerates, a platformer behavior upstream edits. On 2026-09-23 upstream
  pushed 70 such files in one afternoon and the guard went red without the fork
  having changed anything. A guard that fires on upstream's own activity gets
  ignored, which is exactly when real divergence slips through.
- Measured against a fixed baseline, the reported set only moves when **the
  fork's own content** moves. The 66 files above produced zero actionable
  signal; they are upstream movement, not fork divergence.

`baselineCommit` is the last upstream point the fork reconciled with — normally
the merge base of the upstream sync, so it advances when a sync PR merges and the
reported set re-derives from the newly-merged tree. Resolution order when the
field is absent: `git merge-base HEAD upstream/master`. Both paths are stable
across upstream pushing between syncs, which is the property the guard needs.

`--update` records the resolved baseline, and additionally drops entries that
have *converged*: a path the fork once modified but which now matches the
baseline (an upstream fix adopted by the merge, say) is no longer divergence and
must leave the manifest, or the next `--update` keeps re-listing it. If the
guard reports the manifest baseline differing from the comparison baseline, a
bucket may look stale because the two describe different upstream points — run
`--update` to re-anchor.

### Why the manifest excludes itself

`fork-divergence.json` and `.sonarcloud-drift-baseline` are filtered out of the
comparison: neither can contain a stable hash of itself. Everything else is fair
game, including files the fork added.

### Adding intentional divergence

1. Make the change.
2. `node scripts/check-fork-divergence.js --update`
3. Commit the change **and** `fork-divergence.json` together, and say why in the
   commit message. A future sync reviewer reads that manifest, not the PR.

Do not add an entry to silence the guard for something accidental. Revert it
instead — that is the entire point. Note that `--update` regenerates the whole
manifest: review the diff for entries it *removed*, not just those it added.

---

## 2. Static analysis

Two systems scan this repo, and they overlap only slightly.

| System | Where findings appear | Config |
|---|---|---|
| Fallow | GitHub code scanning (SARIF) + PR comment | `.fallow.toml` |
| SonarCloud | sonarcloud.io dashboard | `.sonarcloud.properties` |
| CodeQL | GitHub code scanning | default setup, **not** `.github/codeql-config.yml` |

### Fallow

```bash
npx --yes fallow@3.27.0 health --format json   # complexity/CRAP findings
npx --yes fallow@3.27.0 dead-code              # unused files/exports
npx --yes fallow@3.27.0 audit                  # changed-files review
```

Pin the version. A bare `npx fallow` resolves the `latest` dist-tag at run time
and has been observed to hand back three different versions across runs, which
makes the config's thresholds mean different things on different days.

**Scope (`ignorePatterns`).** 59 patterns covering vendored bundles (Emscripten
builds, Firebase SDK, Recast/Jolt wasm, pixi-filters, PeerJS, draco, the SHA
implementations), codemod output, generated declarations, and build artifacts.
These are byte-identical to their upstream copies and are never hand-edited.
`ignorePatterns` is confirmed to work — every listed path reports zero findings,
and listing the vendored bundles removed 2,399 of the 3,449 code-scanning alerts
that were open before.

**Thresholds (`[health]`).** `maxCrap = 200`, `maxCyclomatic = 25`,
`maxCognitive = 25`, `maxUnitSize = 200`. The defaults (`maxCrap 30`) reported
926 functions in non-vendored code, which is not actionable. The raised values
leave 154 — the genuine outliers. Current state:

```
files_analyzed 2601   functions_analyzed 12882   above_threshold 154
average_maintainability 87.9
```

Re-derive the values from `health --format json` if the tree changes materially;
do not copy them forward out of habit.

**Do not add `health.thresholdOverrides` for test suites.** One was tried and
removed: `describe()` blocks are not reported as oversized functions, so the
override matched nothing and emitted 1,520 `stale` rows. Fallow reports stale
suppression config, so dead overrides are visible rather than silent — keep it
that way.

**Inline suppression.** `// fallow-ignore-next-line <kind>` and
`// fallow-ignore-file <kind>`, where `<kind>` is e.g. `unused-export` or
`complexity`. A trailing `-- <reason>` is recorded by the suppression-hygiene
output. Prefer `rules` / `ignorePatterns` over sprinkling inline markers.

**CI.** `.github/workflows/fallow.yml`. The `audit` job (PRs) is informational
(`fail-on-issues: false`); the weekly `full` scan uploads SARIF and archives
`fallow.log`. Nothing here gates a merge — the SARIF upload is the gate's
visible surface. If you promote `audit` to a real gate, do it after the
thresholds above are stable, or every unrelated PR turns red.

### SonarCloud

**This project uses automatic analysis.** `sonar.autoscan.enabled` is `true` on
the project. Consequences that have already caused wasted effort:

- **`sonar.issue.ignore.multicriteria` cannot be configured from
  `.sonarcloud.properties`.** It is a Project Settings → Issues → Exclusions
  (UI) setting, and automatic analysis does not read it from the file. A
  previous revision of `.sonarcloud.properties` carried ~200 lines of commented
  `sonar.issue.ignore.multicriteria.e1..e88` entries plus
  `scripts/sonarcloud-apply-suppressions.sh` to paste them. Both are deleted.
  Do not re-add them: they were inert for two phases of remediation work and
  the documented "10,289 → 3,029" progress was path exclusions and organic
  expiry, not those rules.
- Only these keys are honoured: `sonar.sources`, `sonar.exclusions`,
  `sonar.inclusions`, `sonar.tests`, `sonar.test.exclusions`,
  `sonar.test.inclusions`, `sonar.sourceEncoding`, `sonar.cpd.exclusions`,
  `sonar.python.version`.
- **Analysis logs are not available**, which is why the state below has to be
  measured through the API.

**What is actually scanned.** Measured via the SonarCloud API:

```
files         822
ncloc         180,894
Extensions     346 files      GDevelop.js  325
GDJS            86 files      newIDE        44   (all under newIDE/app/scripts)
SharedLibs      21 files
```

**`newIDE/app/src` — the editor source, ~2,350 files — is not in the index.**
Every query for it returns nothing; its files are absent from the component
tree. The `files` metric dropped 3,921 → 819 on 2026-09-13 and has not moved
since. The cause could not be determined from outside (no analysis logs), and it
is **not** the `sonar.exclusions` list — `newIDE/app/src` is not excluded by it.

Probe the current state with:

```bash
curl -fs "https://sonarcloud.io/api/measures/component?component=Heretek-AI_GDevelop-Heretek&metricKeys=files,ncloc" \
  | python3 -m json.tool
curl -fs "https://sonarcloud.io/api/components/tree?component=Heretek-AI_GDevelop-Heretek&qualifiers=FIL&ps=1" \
  | python3 -c "import json,sys; print('files:', json.load(sys.stdin)['paging']['total'])"
```

This gap has a real cost: the fork's own AI code (`newIDE/app/src/AI/`,
`AiGeneration/Studio/`) gets no analysis at all. Do **not** "fix" it by adding
`newIDE/app/src/**` to `sonar.exclusions` — that would make the blind spot
permanent and deliberate instead of unexplained. Resolve it in the SonarCloud
UI (Administration → Analysis Method / Analysis Scope), or switch the project to
CI-based analysis, which also makes the multicriteria rules real.

**The residual issue count is mostly not this fork's code.** Of 2,845 open
issues measured, **2,526 sit in files byte-identical to upstream** and 319 in
fork-added or fork-modified files. Fixing the upstream-identical ones means
either diverging for style (which the sync then fights) or re-fixing them after
every sync. Leave them; the point of the dashboard here is to catch *new* issues
in *fork* code.

**Drift guard.** `scripts/sonarcloud-drift.js` + `.sonarcloud-drift-baseline`
(committed). It self-seeds the baseline when the file is missing, writes
`count` / `baseline` / `seeded` to `$GITHUB_OUTPUT`, and is enforced weekly by
the `sonarcloud-drift` job in `fallow.yml` — which is now a real gate (it was
`continue-on-error` against a 1,500 ceiling that predated the exclusions and was
never reachable). The ceiling is `baseline + 10%`.

```bash
node scripts/sonarcloud-drift.js                  # report + compare
node scripts/sonarcloud-drift.js --update-baseline  # after a legitimate change
```

### CodeQL

Code scanning runs **default setup** (languages: `actions`, `c-cpp`,
`javascript`, `python`, `typescript`; `extended` query suite).
`.github/codeql-config.yml` is **not read** — default setup only honours a config
file named by the `github-codeql-config-file` repository property, which is
unset. Proof: the file excludes `**/__tests__/**`, yet an open alert exists in
`GDevelop.js/__tests__/ExpressionCompletionFinder.spec.js`. See the header of
that file for the two ways to make it real.

Third-party actions are pinned to full commit SHAs with a trailing `# vN`
comment, and every workflow declares an explicit `permissions:` block. Keep both
properties when editing a workflow: Dependabot's `github-actions` ecosystem
updates SHA pins as long as the version comment is present, and the
`actions/unpinned-tag` / `actions/missing-workflow-permissions` alerts return
otherwise. `.github/workflows/**` is restored from local `master` by
`upstream-sync.yml`, so upstream will never overwrite these changes.

### Which alerts to fix, and which to leave

| Finding | Action |
|---|---|
| Anything in a fork-added or fork-modified file | **Fix it.** It is the fork's code. |
| Anything in a workflow file | **Fix it.** Workflows are fork-owned and sync-protected. |
| Anything in a file byte-identical to upstream | **Leave it**, or fix it upstream. Editing it creates divergence the sync then re-resolves forever. |
| Vendored bundle / generated declaration | Should not appear. If it does, the path is missing from `ignorePatterns` / `sonar.exclusions` — add it there, do not edit the file. |

---

## 3. Upstream sync

`.github/workflows/upstream-sync.yml` runs daily and is **PR-only**; `master` is
never modified automatically. It merges `upstream/master` into
`upstream-sync-<date>`, restores `.github/workflows/` from local `master`, and
verifies five BYOK files still exist.

Two things to know:

- **`.github/workflows/` is restored from local `master` on every sync.** A
  change to a workflow is safe from being overwritten, and upstream workflow
  fixes will never arrive. Apply them by hand if they matter.
- **The BYOK integrity check is path-based.** It guards
  `src/AI/CustomAIClient.js`, `src/AI/CustomAIClient.spec.js`,
  `src/AiGeneration/AiConfiguration.js`,
  `src/MainFrame/Preferences/PreferencesDialog.js`, and
  `src/MainFrame/Preferences/PreferencesProvider.js`. Renaming or moving any of
  those silently disables the guard. `fork-divergence.json` now covers the same
  ground more broadly — if you move a BYOK file, run `--update` and expect the
  manifest diff to show it.

When a sync lands, run `node scripts/check-fork-divergence.js` before reviewing
the diff; it tells you which changes are the fork's own and which are new.

---

## 4. Repo-wide checks

```bash
node scripts/check-lockfiles.js          # vulnerable-pin guard (all 10 manifests)
cd newIDE/app && npm run lint && npm run check-format && npm run check-types
cd GDJS && npm run check-types           # known-red baseline: see AGENTS.md
```

`AGENTS.md` holds the architecture map, build/test commands, and the conventions
per language area. It is the right place for "how is this repo laid out"; this
file is the right place for "how do I keep it maintainable".
