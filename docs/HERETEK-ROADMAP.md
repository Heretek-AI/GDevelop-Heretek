# Heretek Roadmap

Researched direction for the GDevelop-Heretek fork. Demand signals gathered 2026-09-22 from
upstream issues/PRs, forum threads, and the upstream 2026 roadmap. **Status pass 2026-09-22**
records what has since landed and reorders work around stabilize → trust UX → battle-test.

Tracking issues live on [Heretek-AI/GDevelop-Heretek](https://github.com/Heretek-AI/GDevelop-Heretek/issues);
each phase below cites them.

## What the fork ships today

| Area | State |
|---|---|
| **BYOK / local AI** | `newIDE/app/src/AI/CustomAIClient.js` — SSE streaming (+ non-stream fallback), per-chat model picker, token meter, history trim/compaction, schema-validated tool calls, local server presets, Stop/abort, error hints, 70+ specs |
| **AI Game Studio (local multi-agent)** | All 11 phases of `AI_GAME_STUDIO_ASSESSMENT.md` landed and wired: role registry, real `create_or_update_plan`, `spawn_agent` + spawner, finalize/runtime hook, write gate, loop guard, plan merge, turn lock — modules under `AiGeneration/Studio/` |
| **Engine (culling / instancing)** | Scene-level 3D frustum culling, `Model3DInstancePool` + `useInstancing`, TileMap culling for non-Simple maps (nested maps fail safe to full draw) |
| **Unlocked client features** | No watermark/splash clamp, network preview, debugger, Heretek release feed |
| **Editor UX landed** | Delete key in Instances list, drag-drop image → Sprite on canvas |
| **Divergence hygiene** | 180 intentional paths allowlisted against a pinned baseline; `fork-divergence.json` + CI guard + daily PR-only upstream sync |

Direction A (own AI/BYOK) is substantially delivered as of cycle 34 / `ae815f489`. The work
below is what remains to make it *trustworthy* and *maintained*.

## Demand signals (upstream)

| Demand signal | Evidence | Fork status |
|---|---|---|
| **BYOK for the AI agent** | Upstream [#7932](https://github.com/4ian/GDevelop/issues/7932), [#8854](https://github.com/4ian/GDevelop/issues/8854) | **Built here** — fork leads upstream |
| 3D lighting / PBR / shadows | 2026 roadmap; PRs [#8343](https://github.com/4ian/GDevelop/pull/8343)/[#8347](https://github.com/4ian/GDevelop/pull/8347)/[#8348](https://github.com/4ian/GDevelop/pull/8348)/[#8349](https://github.com/4ian/GDevelop/pull/8349) | Track upstream; cherry-pick if stalled |
| LDtk integration | Long-standing upstream issue | Not started — defer |
| Folders for scenes/layouts | Upstream [#7777](https://github.com/4ian/GDevelop/issues/7777) | Tracked in [#159](https://github.com/Heretek-AI/GDevelop-Heretek/issues/159) if upstream stalls |
| 2D object culling by default | Upstream [#8206](https://github.com/4ian/GDevelop/issues/8206) | Not started — small runtime win |
| UX polish cluster | Delete key, image drop, pixel scaling, focus mgmt | Delete key + image drop **done**; pixel scaling needs no work (project properties already cover #7495) |
| Web-app File System Access save | Open upstream issue | [#159](https://github.com/Heretek-AI/GDevelop-Heretek/issues/159) |
| Spatial sound | Upstream [#6954](https://github.com/4ian/GDevelop/issues/6954) | Not started — defer |

## Phases (recommended order)

### S. Stabilize — green baseline before new surface area

A red suite is how slop ships. No UX or feature work merges while S is red.

| # | Work | Issue |
|---|---|---|
| S1 | Fix 2 SSE `TextEncoder` failures in `CustomAIClient.spec.js`; document react-scripts runner rule (never bare `npx jest` for AI specs) | [#149](https://github.com/Heretek-AI/GDevelop-Heretek/issues/149) |
| S2 | Close dispatcher/runtime/editor test gaps: `AiGeneration/Utils.js`, `UseStudioRuntime.js`, fork-modified `SceneEditor`/`InstancesEditor`, entitlement surfaces | [#150](https://github.com/Heretek-AI/GDevelop-Heretek/issues/150) |
| S3 | `AiRequestChat` component specs + wire existing AI Storybook stories into `newIDE/visual-tests` | [#151](https://github.com/Heretek-AI/GDevelop-Heretek/issues/151) |
| S4 | Golden-project offline acceptance harness (plan → spawn → edit → finalize, no network) | [#157](https://github.com/Heretek-AI/GDevelop-Heretek/issues/157) |

**Exit criteria:** full `newIDE/app` suite green under `npm test`; divergence guard green; harness fails when Studio wiring is deliberately broken.

### U. Trust UX — make every AI edit visible and recoverable

Highest-leverage product gap: users approve opaque batches and cannot undo selectively.

| # | Work | Issue |
|---|---|---|
| U1 | Visual diff / per-item change list on `EditApprovalRow` | [#152](https://github.com/Heretek-AI/GDevelop-Heretek/issues/152) |
| U2 | Studio visibility: role badges + persistent plan status strip (keep Studio inside Ask AI — no separate dashboard) | [#153](https://github.com/Heretek-AI/GDevelop-Heretek/issues/153) |
| U3 | Playtest report card in chat (`run_gameplay_test` → structured pass/fail + open editor) | [#154](https://github.com/Heretek-AI/GDevelop-Heretek/issues/154) |
| U4 | AI change-set browser with selective revert (only safe inverses; full restore stays on save points) | [#155](https://github.com/Heretek-AI/GDevelop-Heretek/issues/155) |

**Ordering:** U1 before U4 (both need the same batch/apply metadata model). U2 and U3 are parallelizable after S3 stories exist.

### E. Engine residual — inherit from upstream; fix only deferred forks

Policy: **diverge on AI + editor UX; track, don't duplicate, on 3D.**

| # | Work | Notes |
|---|---|---|
| E1 | Container-space 3D frustum culling + nested TileMap cull windows | [#156](https://github.com/Heretek-AI/GDevelop-Heretek/issues/156); residual from phases 6–8; blocked in part by [#146](https://github.com/Heretek-AI/GDevelop-Heretek/issues/146) Karma env |
| E2 | 2D object culling by default ([#8206](https://github.com/4ian/GDevelop/issues/8206)) | Small, runtime-only — grab when convenient |
| E3 | Cherry-pick community 3D lighting/PBR PRs only if upstream stalls | Never reimplement upstream's lighting wave |
| — | Instancing for multi-mesh/skinned models; nested custom-object base container camera | Document-as-limit unless a golden project proves a need |

### F. Features (demand + on-brand)

| # | Work | Issue |
|---|---|---|
| F1 | Web-app File System Access save/import; scene folders if upstream #7777 stalls | [#159](https://github.com/Heretek-AI/GDevelop-Heretek/issues/159) |
| F2 | BYOK asset **generation** (placeholder v0 offline → optional user-configured image endpoint; designer role only) | [#158](https://github.com/Heretek-AI/GDevelop-Heretek/issues/158) |
| — | LDtk, spatial audio, event-sheet redesign | Explicitly out of fork scope until S/U stabilize |

### G. Skills & process — how we keep quality without slop

| # | Work | Issue |
|---|---|---|
| G1 | Enable `code-review` + `autofix` on PRs; author a GDevelop-Heretek conventions skill (toolchains, runner hygiene, red baselines, divergence `--update`, offline AI tests) | [#160](https://github.com/Heretek-AI/GDevelop-Heretek/issues/160) |
| G2 | Use `grill-with-docs` / ADRs for contentious U-phase design before code | Optional per feature |
| G3 | `design-system` skill for panel/token work in U phases; `find-skills` if a Jest/RTL skill is missing | — |

### D. Hygiene (continuous)

- Keep daily upstream sync PRs green; `node scripts/check-fork-divergence.js` on every intentional divergence.
- Full checks before merge: `newIDE/app` lint / format / types / tests; lockfile check; known-red baselines unchanged (see `AGENTS.md`).
- SonarCloud/Fallow: fix **fork-owned** findings only (see `MAINTENANCE.md`).
- Dependabot majors remain parked in [#125](https://github.com/Heretek-AI/GDevelop-Heretek/issues/125) / [#136](https://github.com/Heretek-AI/GDevelop-Heretek/issues/136).

## How we battle-test (standing rules)

1. **Baseline first:** S1 red fixed or baselined same-day; never stack features on unknown red.
2. **Offline by default:** AI/Studio tests mock axios; no network in CI; golden harness (#157) runs offline.
3. **Break-on-purpose check:** each wiring change should have a test that fails if the import/seam is removed.
4. **Visual safety net:** AI Storybook stories screenshot-tested (#151) so chat UX regressions are mechanical.
5. **Dogfood checklist (local, real endpoint):** new project → Studio plan → spawn → approve with U1 UI → run gameplay test → report card → selective revert. Run after U phases land and after any upstream sync that touches `AiGeneration/`.
6. **PR bar:** lint `--max-warnings=0`, Flow clean in touched dirs, specs or stories for UI, divergence `--update` with why in the commit message, `code-review` pass (G1).

## Long-term identity

**Local-first AI game development.** You own the model (BYOK/local); a role-aware Studio plans, edits, and playtests inside the editor; every mutation is inspectable and selectively reversible; engine improvements arrive from upstream through a guarded sync instead of a brittle long-lived branch.

What we refuse to become: a permanent mega-fork of the renderer, an ungated cloud-agent clone, or a UI that asks for trust it has not earned with previews and tests.
