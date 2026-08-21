# SonarCloud Phase 3 Remediation Plan

## Context

Phases 1 (PR #44) and 2 (PR #50) dropped the SonarCloud open-issue count from **10,289 → 3,649 → 3,029** (-70.6%) via path exclusions, real fixes (security vulnerabilities + test-quality bugs), and per-rule suppressions documented in the operator's SonarCloud UI.

This Phase 3 plan attacks the remaining **3,029 open issues** with the same playbook, but adjusted for what didn't get fully applied in Phase 2. The Phase 2 multicriteria block is **server-side** — many of its rules (S101, S6582, S1186, S878, S1135, S7773, S3504, S3776, S7741, cpp:*) are STILL firing because the operator hasn't pasted the block into SonarCloud → Project Settings → Issues → Exclusions yet.

**Goal:** drop the open count to ~500–1,000 (a 70-85% reduction from current) by:
1. Fixing the remaining real BLOCKER + CRITICAL bugs (security + test quality)
2. Adding path exclusions for newly-merged hot files that emerged after Phase 2
3. Adding **Phase 2's still-unapplied suppressions** to `.sonarcloud.properties` and extending with Phase 3 rules
4. Adding an explicit operator-runnable script that pastes everything at once

**User decision captured (2026-08-20):** same approach as Phase 2. Don't try to drive the count to zero.

---

## Phase 3 inventory (live, fetched 2026-08-20)

| Bucket | Count | Δ vs Phase 2 start (3,649) |
|---|---:|---:|
| **Total open** | **3,029** | -620 |
| BLOCKER | 9 | -17 |
| CRITICAL | 600 | -63 |
| MAJOR | 931 | -244 |
| MINOR | 1,328 | -286 |
| INFO | 161 | -10 |
| CODE_SMELL | 2,931 | -609 |
| VULNERABILITY | 68 | -1 |
| BUG | 30 | -10 |
| Effort total | 19,752 min | -5,867 min |

The 620-issue drop happened organically:
- 17 BLOCKER `S2970` test-quality fixes in `GDevelop.js/__tests__/Core.js` (PR #50)
- ~600 issues auto-close as aged or accepted by SonarCloud's analysis lifecycle

---

## Remaining BLOCKER (9 total)

The 9 remaining BLOCKER are all in tests:

| Count | Type | Rule | File:Line | Action |
|---:|---|---|---|---|
| 1 | VULN | `pythonsecurity:S2083` | `newIDE/app/scripts/fix-codemod-syntax.py:605` | **Fix** — same as Phase 1/2; line moved |
| 1 | SMELL | `javascript:S2187` | `Extensions/Physics3DBehavior/tests/Physics3DRuntimeBehavior.spec.js` | Add a minimal real test, or delete the empty test file |
| 1 | SMELL | `javascript:S2703` | `Extensions/PlatformBehavior/benchmarks/platformerobjectruntimebehavior.benchmark.js:13` | Add `var`/`let`/`const` keyword |
| 4 | SMELL | `javascript:S2699` | `GDevelop.js/__tests__/SerializerBenchmark.js:24,39,55,72` | Add at least one assertion |
| 2 | SMELL | `javascript:S2699` | `GDevelop.js/__tests__/GDJS.js:760,765` | Add at least one assertion |

These are all mechanical and small. 8 of 9 are test fixes that prevent a real BUG (incomplete tests).

## Remaining CRITICAL real issues (VULNERABILITY + BUG, not just code smells)

| Count | Type | Rule | Example | Action |
|---:|---|---|---|---|
| 8 | VULN | `typescript:S2819` | postMessage wildcard target origin (5 files) | **Already fixed in Phase 2** but the `// nosonar` placement was wrong. Phase 3 commit 9ba765c moves the comments to the right line. Re-analyze to confirm. |
| 1 | VULN | `typescript:S1523` | `GDJS/Runtime/gameplay-tests/gameplay-test-runner.ts:2951` | Add `// nosonar` with rationale (test runner code, sandboxed) |
| 6 | VULN | `javascript:S1523` | `GDevelop.js/TestUtils/CodeGenerationHelpers.js:82,93,108,161,227,463` | Same — test utility code |
| 1 | VULN | `javascript:S5443` | `GDevelop.js/TestUtils/FakeAbstractFileSystem.js:15` | Investigate: writable-dir safety in test fixture |
| 1 | VULN | `typescript:S4335` | `GDJS/Runtime/CustomRuntimeObject.ts:22` | Add `// nosonar: typescript:S4335` with rationale (cross-type assignment intentional for runtimeobject) |
| 1 | VULN | `javascript:S2871` | `newIDE/app/scripts/lib/ArrayHelpers.js:32` | Provide locale-aware comparator (real bug if used in i18n contexts) |
| 10 | VULN | `python:S3776` | Various Python files (extract to a helper) | Refactor or accept (mostly tooling scripts) |
| 10 | VULN | `typescript:S2245` | `Math.random()` use | Document or override |
| 9 | VULN | `jssecurity:S8707` | LLM CLI path escape (script files) | Validate CLI args, similar to Phase 1/2 |

## Top 20 hot files (where the volume sits)

| File | Issues | Strategy |
|---|---:|---|
| `Extensions/Physics2Behavior/physics2runtimebehavior.ts` | 145 | Real code, suppress (Phase 2-style) |
| `GDJS/Runtime/events-tools/commontools.ts` | 82 | Real code, suppress |
| `GDJS/Runtime/InGameEditor/InGameEditor.tsx` | 75 | Real code, suppress |
| `GDJS/Runtime/debugger-client/hot-reloader.ts` | 65 | Real code, suppress |
| `Extensions/PlatformBehavior/platformerobjectruntimebehavior.ts` | 52 | Real code, suppress |
| `GDJS/Runtime/gameplay-tests/gameplay-test-runner.ts` | 48 | Test runner; also has S1523 |
| `GDJS/Runtime/runtimeobject.ts` | 45 | Real code, suppress |
| `GDJS/Runtime/pixi-renderers/runtimegame-pixi-renderer.ts` | 40 | Real code, suppress |
| `Extensions/TileMap/JsExtension.js` | 37 | Generated extension shell |
| `Extensions/Physics2Behavior/JsExtension.js` | 33 | Generated extension shell |
| `newIDE/app/scripts/extract-changelog.js` | 33 | Build script |
| `Extensions/Firebase/B_firebasetools/D_cloudfirestoretools.ts` | 32 | Bundled Firebase JS extension |
| `Extensions/Multiplayer/multiplayertools.ts` | 31 | Real code, suppress (had been 42 in Phase 2; the 8 S2819 fixes dropped it) |
| `GDJS/Runtime/variable.ts` | 31 | Real code, suppress |
| `Extensions/TweenBehavior/TweenManager.ts` | 31 | Real code, suppress |
| `Extensions/NavMeshPathfinding/JsExtension.js` | 28 | Generated extension shell |
| `GDJS/Runtime/gd.ts` | 25 | Core runtime file |
| `Extensions/Physics3DBehavior/Physics3DRuntimeBehavior.ts` | 24 | Real code |
| `Extensions/Effects/pixi-filters/filter-glitch.js` | 24 | Vendored pixi filter port |
| `Extensions/Firebase/B_firebasetools/D_authtools.ts` | 24 | Bundled Firebase |

## Top 50 rules (Phase 3 inventory)

| Count | Rule | Severity | Notes |
|---:|---|---|---|
| 275 | `javascript:S101` | MINOR | Class naming convention |
| 228 | `typescript:S6582` | MINOR | Single-char names |
| 209 | `typescript:S1186` | CRITICAL | Empty methods (interface stubs) |
| 144 | `typescript:S1135` | INFO | TODO markers |
| 135 | `javascript:S878` | MAJOR | `==` vs `===` |
| 123 | `typescript:S3776` | CRITICAL | Cognitive complexity |
| 110 | `javascript:S3504` | CRITICAL | `var` → `const`/`let` |
| 99 | `typescript:S7741` | MINOR | Refactor |
| 88 | `cpp:S3471` | MINOR | C++ |
| 82 | `typescript:S2933` | MAJOR | TODO |
| 72 | `typescript:S4138` | MINOR | `==` vs `===` |
| 72 | `typescript:S1874` | MINOR | Parameter naming |
| 65 | `javascript:S7772` | MINOR | `node:` prefix |
| 58 | `javascript:S7773` | MINOR | Mixed tabs/spaces |
| 58 | `cpp:S3230` | MAJOR | C++ |
| 55 | `typescript:S3358` | MAJOR | Nested ternaries |
| 54 | `typescript:S6660` | MAJOR | Refactor |
| 51 | `typescript:S6535` | MAJOR | Refactor |
| 49 | `typescript:S107` | MAJOR | **NEW** — function has too many parameters |
| 46 | `typescript:S7773` | MINOR | Mixed tabs/spaces |
| 46 | `typescript:S1444` | MINOR | Private field |
| 41 | `typescript:S107` | (same as above) | |
| 38 | `cpp:S3490` | CRITICAL | C++ |
| 34 | `typescript:S1121` | MAJOR | Sub-expression assignment |
| 26 | `typescript:S1121` | (same) | |
| 24 | `typescript:S7762` | MAJOR | `.remove()` vs `.removeChild()` |
| 23 | `typescript:S6035` | MAJOR | Replace alternation with character class |
| 23 | `typescript:S7740` | (combined) | |
| 20 | `typescript:S6671` | MAJOR | Promise rejection should be Error |
| 20 | `javascript:S6557` | MAJOR | `String#startsWith` |
| 20 | `typescript:S6861` | CRITICAL | Add default case in switch |

**Key observation:** Many of these still appear because the **Phase 2 suppressions haven't been applied server-side**. Phase 3 makes them more discoverable by:

1. Generating a single, runnable script the operator can paste
2. Adding Phase 2's still-unapplied rules to Phase 3's multicriteria block
3. Documenting which block to apply when

---

## Remediation plan

### Phase 3.1 — Configuration exclusions (closes ~300-500)

Add 4-5 new path exclusions to `.sonarcloud.properties`:
- `Extensions/Effects/pixi-filters/filter-glitch.js` (24, similar to filter-color-gradient)
- `Extensions/Firebase/B_firebasetools/**` (~50, bundled Firebase JS)
- `Extensions/TileMap/JsExtension.js` (37, generated extension shell)
- `Extensions/NavMeshPathfinding/JsExtension.js` (28, generated extension shell)

And to `.fallow.toml` (mirror).

**Estimated impact:** drops ~150 issues.

### Phase 3.2 — Real fixes (closes ~30-50)

In priority order:
1. **9 BLOCKER** (above) — all mechanical, ~5-line changes total
2. **`javascript:S2871`** in `newIDE/app/scripts/lib/ArrayHelpers.js:32` — provide locale-aware `String.localeCompare` comparator
3. **`typescript:S4335`** in `CustomRuntimeObject.ts:22` — add `// nosonar`
4. **`typescript:S1523`** in 8 test-runner/test-utility sites — add `// nosonar` with rationale
5. **`javascript:S5443`** in `FakeAbstractFileSystem.js:15` — investigate and either fix or add nosonar
6. **`jssecurity:S8707`** in the remaining 9 script files — add CLI-arg validation

**Estimated impact:** drops ~30 CRITICAL/MAJOR issues + 9 BLOCKERs.

### Phase 3.3 — Suppressions (closes ~2,000-2,500)

The Phase 2 multicriteria block **already contains** the e27-e63 entries — but they haven't been applied yet. The biggest immediate win for Phase 3 is:

1. **Operator action document:** Generate a single script in `scripts/sonarcloud-apply-suppressions.sh` that walks the operator through pasting the e1-e63 block into SonarCloud UI. Add a checklist in `SONARCLOUD_PHASE2_PLAN.md` that says "do this once".

2. **Add Phase 3 rules** to the multicriteria block (continuation e64+):
   - `typescript:S107` (49) — function has too many parameters (over-disambiguation of methods)
   - `typescript:S1121` (34) — assignment in expression
   - `typescript:S7762` (24) — `.remove()` vs `.removeChild()`
   - `typescript:S6035` (23) — replace alternation with character class
   - `typescript:S6671` (20) — promise rejection should be Error
   - `javascript:S6557` (20) — `String#startsWith`
   - `typescript:S6666` (17) — spread vs `apply`
   - `typescript:S7765` (17) — `.includes()` vs `.some()`
   - `typescript:S7778` (16) — don't call `push()` multiple times
   - `javascript:S7780` (15) — `String.raw`
   - `typescript:S7750` (15) — `.find()` over `.filter()[0]`
   - `typescript:S6551` (13) — default stringification
   - `typescript:S7740` (11) — don't `this = harness`
   - `python:S3776` (10) — Python cognitive complexity
   - `typescript:S6644` (10) — refactor
   - `javascript:S4144` (10) — tagged template literal
   - `typescript:S2486` (9) — console.log usage
   - `javascript:S8786` (9) — `'Math.random()' is insecure`
   - `typescript:S3626` (9) — use rest parameters
   - `typescript:S1533` (9) — refactor (closing brace placement)
   - `typescript:S6571` (8) — bad magic number
   - `javascript:S107` (8) — JS counterpart of typescript:S107
   - `javascript:S2681` (8) — refactor (switch without default)
   - `cpp:S1659` (7) — C++ refactor
   - `Web:S7926` (3) — production code shouldn't have `console.log`

These all follow the same pattern: blanket suppression across the codebase with rationale. Estimated impact: drops ~1,500-2,000 issues.

### Phase 3.4 — CI guard updates

Keep drift threshold at 1,500 (already lowered in Phase 2). After Phase 3 suppressions land, the new baseline will be ~500-1,000, so consider lowering to 1,000.

### Phase 3.5 — Operator action script

Add `scripts/sonarcloud-apply-suppressions.sh` (no-op when run, but gives the operator a single command to copy-paste):

```bash
#!/usr/bin/env bash
# SonarCloud suppressions setup
# Phase 1: Project Settings → Analysis Scope → Set "sonar.exclusions"
#          (paste the contents of .sonarcloud.properties's sonar.exclusions line)
# Phase 2: Project Settings → Issues → Exclusions → Multi-criteria → Add
#          paste each e1..e63 entry from .sonarcloud.properties
# Phase 3: same → paste e64..e88 entries
#
# Verify with: scripts/sonarcloud-drift.js
```

This makes the operator's job a single read-and-paste instead of searching through 200+ lines of comments.

---

## Critical files to modify

| File | Purpose |
|---|---|
| `.sonarcloud.properties` | New path exclusions + extended multicriteria block (e64+) |
| `.fallow.toml` | Mirror path exclusions |
| `newIDE/app/scripts/fix-codemod-syntax.py` | S2083 fix at line 605 |
| `newIDE/app/scripts/lib/ArrayHelpers.js` | `String.localeCompare` comparator |
| `GDJS/Runtime/CustomRuntimeObject.ts` | `// nosonar: typescript:S4335` |
| `GDJS/Runtime/gameplay-tests/gameplay-test-runner.ts` | `// nosonar: typescript:S1523` × 2 |
| `GDevelop.js/TestUtils/CodeGenerationHelpers.js` | `// nosonar: javascript:S1523` × 6 |
| `GDevelop.js/TestUtils/FakeAbstractFileSystem.js` | Investigate S5443 |
| `GDevelop.js/__tests__/SerializerBenchmark.js` | Add assertions (S2699) × 4 |
| `GDevelop.js/__tests__/GDJS.js` | Add assertions (S2699) × 2 |
| `Extensions/Physics3DBehavior/tests/Physics3DRuntimeBehavior.spec.js` | Add real test (S2187) or delete |
| `Extensions/PlatformBehavior/benchmarks/platformerobjectruntimebehavior.benchmark.js` | Add `var` keyword (S2703) |
| `scripts/sonarcloud-apply-suppressions.sh` | **NEW** — operator action script |

---

## Reused existing infrastructure

| Concern | Reuse |
|---|---|
| Phase 2 suppressions block | already in `.sonarcloud.properties` (just needs operator to apply) |
| Lockfile guard | `scripts/security/check-lockfiles.js` |
| Fallow CI | `.github/workflows/fallow.yml` |
| SonarCloud REST API | `scripts/sonarcloud-drift.js` |

---

## Verification

After each sub-phase:

```bash
# CI guard
node scripts/security/check-lockfiles.js                  # exit 0

# Lint and format
cd newIDE/app && npm run lint                          # clean
cd newIDE/app && npm run check-format                  # clean

# Tests
cd newIDE/app && npm test -- --watchAll=false --ci    # 1206 passed
cd GDevelop.js && timeout 90 npx jest --watchAll=false # ~32 passed

# Static analysis
npx fallow audit --format compact                     # clean

# SonarCloud API
curl -s "https://sonarcloud.io/api/issues/search?componentKeys=Heretek-AI_GDevelop-Heretek&issueStatuses=OPEN&ps=1" \
  | python3 -c "import json,sys; print('Open:', json.load(sys.stdin)['total'])"
```

### Final success criteria

- Open count drops to **≤ 1,000** by close of Phase 3
- SonarCloud Quality Gate on PR stays **PASS**
- All CI checks pass (12 of 12 active)
- Phase 2 + Phase 3 suppressions applied server-side via the operator action script
- Documentation updated; future contributors can use `scripts/sonarcloud-drift.js` as the steward

---

## Risks & open questions

1. **Operator hasn't applied Phase 2 yet.** Until the operator pastes the e27-e63 multicriteria block into SonarCloud, the open count won't drop dramatically regardless of what this PR adds. Phase 3.5 is the script that makes the operator action crisp.
2. **`typescript:S107`** (too many parameters): triggering on `gd.Vector*` and `gd.Object*` methods that legitimately need 8-10 args. The fix is to break up the functions, but that's a 100+ file refactor.
3. **`python:S3776`** in `fix-flow-errors.sh` and other tooling scripts: not user-facing, low priority.
4. **C++ volume (300+)** is mostly auto-generated binding code. Phase 2's `cpp:*` suppressions cover most of it; if the operator applies them, the remaining cpp issues should drop to a manageable count.

---

## Critical files quick-reference

- `SONARCLOUD_REMEDIATION_PLAN.md` — Phase 1 plan (executed)
- `SONARCLOUD_PHASE2_PLAN.md` — Phase 2 plan (executed, suppressions waiting for operator)
- `SONARCLOUD_PHASE3_PLAN.md` — **this file** (Phase 3)
- `.sonarcloud.properties` — path exclusions + e1-e88 (server-side pending)
- `.fallow.toml` — mirror exclusions
- `.sonar-issues-cache/phase-3-p*.json` — raw cache (3,029 issues, ignored by git)
- `scripts/sonarcloud-drift.js` — drift detection
- PR #50 — merged Phase 2 PR
