# AI Game Studio — Assessment

Answers three questions the fork asked, then records what this plan builds on the answers.

Every claim below carries a `path:line` (or a `path`) that was read while writing this
document, in this checkout. Where a figure is quoted from another project, the file that
contains it is named.

---

## 1. Verdict: Anno 1800 on Android — not achievable on this engine

A literal Anno-1800-scale 3D city builder is **not** achievable with GDevelop as it stands.
Four load-bearing reasons, any one of which is disqualifying on its own:

**1.1 No instancing anywhere.** Every `Model3DRuntimeObject` instance clones its own scene
graph: `Extensions/3D/Model3DRuntimeObject3DRenderer.ts:349` —
`const root = THREE_ADDONS.SkeletonUtils.clone(this._originalModel.scene);`. Draw calls
therefore scale 1:1 with instance count. A city builder's defining workload is thousands of
repeated small meshes (houses, trees, fences, props); nothing in `GDJS/Runtime` or
`Extensions/` uses `THREE.InstancedMesh` — a repo-wide search matches only vendored
`three.js`, the vendored `ThreeAddons.js`, type declarations under `GDJS/node_modules`, and
`SharedLibs/ThreeAddons/src/examples/jsm/**` (upstream Three.js examples). There is no
batching, no LOD, no merge pass. Phase 7 adds an opt-in instanced path, and it is narrower
than "instancing" sounds: one `THREE.InstancedMesh` per (model resource, material type, layer)
draws every instance of a model that is a **single non-skinned mesh**, and the object is
otherwise on the clone path. A model with several sub-meshes, a skinned or animated model, or
the per-instance "Basic" material substitution cannot share one instanced mesh (the vendored
Three.js build does not even export `BufferGeometryUtils` to merge child geometries), and
those silently keep the per-object clone. So Phase 7 removes the 1:1 draw-call cost for the
common repeated-prop case, not for an arbitrary scene.

**1.2 No 3D culling.** 3D objects are never culled. Four independent pieces of evidence:

- Three explicit `TODO (3D) culling` markers left in the render loop:
  `GDJS/Runtime/runtimescene.ts:524`, `GDJS/Runtime/RuntimeInstanceContainer.ts:496`,
  `GDJS/Runtime/CustomRuntimeObjectInstanceContainer.ts:263`.
- `RuntimeObject3D.getRendererObject()` returns `null`
  (`Extensions/3D/A_RuntimeObject3D.ts:97-99`), so the 2D AABB culling path in
  `CustomRuntimeObjectInstanceContainer._updateObjectsPreRender` skips every 3D object
  entirely: `if (rendererObject) { ... } else { object.updatePreRender(this); }`
  (`GDJS/Runtime/CustomRuntimeObjectInstanceContainer.ts:266-283`).

So every 3D object in the scene is submitted to the GPU every frame regardless of where the
camera is. Combined with 1.1, a large city is not merely slow — it is bounded by total
object count, not visible object count.

**1.3 Android is a WebView around the same HTML5 runtime.** There is no native renderer.
A Cordova export copies the identical JS runtime into a WebView
(`GDJS/GDJS/IDE/Exporter.cpp:152-181`: `source = gdjsRoot + "/Runtime/Cordova/www/index.html"`
for `options.target == "cordova"`). Two upstream acknowledgements of what that costs:

- `GDJS/Runtime/Cordova/config.xml:28` —
  `<preference name="loadUrlTimeoutValue" value="60000" />`, commented
  `<!-- Increase timeout value for low-end android devices -->`.
- WebView processes killed for memory are a first-class editor concern:
  `newIDE/app/src/Utils/NativeAppLifecycle.js:4-5` ("Declare what the editor is displaying,
  so that the native mobile app knows what was running if the system killed the WebView
  (because of the memory used)").

**1.4 15 MB per resource, cloud build.** `PROJECT_RESOURCE_MAX_SIZE_IN_BYTES = 15 * 1000 *
1000` (`newIDE/app/src/Utils/GDevelopServices/Project.js:23`), enforced on upload
(`newIDE/app/src/ResourcesList/FileToCloudProjectResourceUploader.js:186`, and the user-facing
message at `:319`). An Anno-scale asset set — large terrain meshes, many building models,
music, voice — does not fit through that pipe.

**Not in the four reasons, but worth stating:** the shader-program problem is real and
measurable but is not disqualifying on its own — `GDJS/Runtime/profiler.ts:306-318` documents
that the 3D renderer compiles a separate program for each new combination of material
features/lights/fog/shadows/tone-mapping/instancing, and the cost lands on a single frame
("unexplained stutter early in a playthrough"). See section 4 — accepted, not fixed.

---

## 2. Verdict: what is achievable — a 2D isometric city builder, today, with no engine work

An Anno-1602/1701-scope **2D isometric** city builder is reachable on this engine as it
stands. The building blocks exist and are already used in shipped extensions:

| Need | Facility | Evidence |
|---|---|---|
| The world grid | `TileMap::SimpleTileMap` — the only renderer that culls at all | `Extensions/TileMap/tilemapruntimeobject-pixi-renderer.ts:152-159`; the object type is declared at `Extensions/TileMap/JsExtension.js:996` |
| Save/load of the whole world | `SaveState` extension: full state persistence over `getNetworkSyncData` into IndexedDB | `Extensions/SaveState/SaveStateTools.ts:334-403` (`gameNetworkSyncData`, per-object `getNetworkSyncData` at `:384`, per-scene at `:400`); the actual write is `gdjs.indexedDb.saveToIndexedDB` at `:453` |
| Unit movement (crowds) | `NavMeshPathfinding` — Recast/Detour navmesh + crowd | `Extensions/NavMeshPathfinding/NavMeshObstacleRuntimeBehavior.ts:174-186` |
| Unit movement (grid) | `PathfindingBehavior` — 2D grid A* | `Extensions/PathfindingBehavior/pathfindingruntimebehavior.ts` |
| Building ↔ resource links | `LinkedObjects` extension | `Extensions/LinkedObjects/` (`Extension.cpp`, `JsExtension.cpp`, `linkedobjects.ts`) |
| Economy, timers | Builtin variables + timers on the scene/project | `Core/GDCore/Project/Layout.h`, `Project.h` |

The AI side already knows how to drive all of this: 29 tool definitions in the BYOK tool
schema (`newIDE/app/src/AI/CustomAIClient.js:219` onwards, names enumerated in section 3.2),
including `create_scene`, `put_2d_instances`, `create_or_replace_object`,
`add_scene_events`, `add_or_edit_variable`.

### 2.1 Three quantified caveats

These are not blockers; they are limits that shape the design.

**Grid A* has a hard iteration cap and fails silently.** `_maxComplexityFactor: integer = 50`
(`Extensions/PathfindingBehavior/pathfindingruntimebehavior.ts:636`); the search budget is
`startNode.estimateCost * this._maxComplexityFactor` and on exceeding it the behaviour logs
`No path was found after covering N cells.` and returns `false`
(`:752-760`). Long routes across a city grid simply give up. Design around it: keep cells
small, or route with `NavMeshPathfinding` for long journeys.

**Navmesh crowd capacity is fixed at build time.** `maxAgents: this.characters.size + 100`
(`Extensions/NavMeshPathfinding/NavMeshObstacleRuntimeBehavior.ts:179-182`). The crowd is
rebuilt when the obstacle set changes, not per-agent; a settlement that grows past the
initial headcount plus 100 agents needs the obstacle to be re-registered.

**Any tilemap alpha change forces a full re-render.** `TileMapRuntimeObjectPixiRenderer.
updateOpacity` calls `this._object.updateTileMap(true)` (`Extensions/TileMap/
tilemapruntimeobject-pixi-renderer.ts:92`) after walking every layer. Fading a district in
costs a complete tile rebuild, so do not animate tilemap opacity per frame.

---

## 3. Verdict: does the existing agent system suffice?

**The architecture suffices — and it is better than a from-scratch ChatDev-style port would
be. But the fork cannot reach it.**

Upstream's hosted backend *is* the multi-agent company already. It implements:

| Capability | Where the client already expects it |
|---|---|
| A task DAG with `dependsOn` | `AiRequestPlanTask` / `AiRequestPlan` types, `newIDE/app/src/Utils/GDevelopServices/Generation.js:40-50` |
| Sub-agent launch as a tool call, with the child id stamped on the call | `subAgentAiRequestId?: string` on `AiRequestMessageAssistantFunctionCall`, `Generation.js:53-63`; consumed by `getFunctionCallsToProcess` at `newIDE/app/src/AiGeneration/AiRequestUtils.js:103` (`if (functionCall.subAgentAiRequestId) continue;`) |
| Sub-agent classification (edit vs explorer) | `getSubAgentKind`, `AiRequestUtils.js:201` |
| Polling, activation and retirement of children | `AiRequestContext.activateSubAgent` (`:1070`), `removeSubAgentIfDone` (`:1128`), `activeSubAgents` in the context value (`:1480`) |
| Plan rendering | `AiRequestChat/OrchestratorPlan.js`, read back by `getLatestActivePlan` (`AiRequestUtils.js:268`) |
| Edit approval for mutating child calls | `newIDE/app/src/AiGeneration/Utils.js:473-520` |
| A real headless tester | `run_gameplay_test`, `newIDE/app/src/EditorFunctions/GameplayTestTools.js:108`; CLI `RUN_ALL_TESTS` at `newIDE/app/src/MainFrame/LocalCliCommandRunner.js:200` |

The **execution** half already works locally too, and it is shared: `processEditorFunctionCalls`
(`newIDE/app/src/EditorFunctions/EditorFunctionCallRunner.js:96`) runs any request's calls;
`AskAiEditorContainer` builds `aiRequestsToProcess` as the selected request plus every active
sub-agent (`newIDE/app/src/AiGeneration/AskAiEditorContainer.js:1086`-ish, the `useMemo`
feeding `useProcessFunctionCalls`).

The fork's BYOK path strips all of it. `GDEVELOP_OPENAI_TOOLS`
(`newIDE/app/src/AI/CustomAIClient.js:219` through the closing `];` before
`extractThinkingAndContent`) has 29 tools and **no sub-agent tool**; `buildSystemPrompt`
(`:1256`) is a flat seven-guideline string with no role concept; `customCreateAiRequest`
hardcodes `toolsVersion: 'v14'` (`:1590`) and nothing local ever creates a child `AiRequest`.

### 3.1 The five concrete gaps

**Gap 1 — no plan tool.** `create_or_update_plan` exists in the registry
(`newIDE/app/src/EditorFunctions/index.js:10552`, registered at `:11031`) but is a stub:
`makeGenericFailure('Unable to create or update plan - this is handled server-side.')`
(`:10556-10558`). A Local model that calls it gets a failure. → **Phase 3**.

**Gap 2 — no sub-agent tool.** `spawn_agent` does not exist in `GDEVELOP_OPENAI_TOOLS`. The
hosted equivalents (`run_edit_agent` at `newIDE/app/src/EditorFunctions/index.js:10765`,
`run_explorer_agent` above it) are stubs returning `handled server-side`. → **Phase 4**.

**Gap 3 — no role prompts.** There is exactly one system prompt, built by
`buildSystemPrompt` (`newIDE/app/src/AI/CustomAIClient.js:1256-1290`), with no parameter for a
role. A manager, a designer, a developer and a QA tester all receive identical instructions.
→ **Phase 2** (role registry) feeding **Phase 4** (role-scoped prompts and tool subsets).

**Gap 4 — no local spawner.** No code path in `newIDE/app/src` creates a child `AiRequest`
under BYOK. `activeSubAgents` is only ever populated from what the server already put on the
parent's output (`AiRequestContext.activateSubAgent`, `:1070`, is called from
`useActivatePendingSubAgents`, which reads `getPendingSubAgentFunctionCalls`). Nothing writes
`subAgentAiRequestId`. → **Phase 4b/4c**.

**Gap 5 — no local loop guard.** Nothing counts turns, detects repeated identical tool calls,
or reacts to an error storm. The only breakers are server-emitted error codes the client
merely renders (`repeated-tool-call-loop` → `'stuck'`, `context-too-large` → `'too-large'`,
`newIDE/app/src/AiGeneration/AiRequestChat/AiRequestErrorRow.js:51-56`) and
`MAX_AI_REQUEST_RETRIES_IN_A_ROW = 3`, whose own comment states it is "kept in sync with the
API, which is what really enforces it" (`AiRequestUtils.js:34-38`). Under BYOK there is no
server: a looping local agent runs until the user stops it. → **Phase 9b**.

Two supporting gaps that are structural rather than missing features, and are what make a
naive multi-agent port dangerous here:

- **Gap 2b — concurrent whole-request writes.** 31 `updateAiRequest(` call sites in
  `newIDE/app/src`, of which 15+ pass `() => aiRequest` (a whole replacement that discards
  whatever the previous state was) — e.g. `AiRequestContext.js:406`, `:451`, `:1439`, `:1453`;
  `AskAiEditorContainer.js:725`, `:949`, `:1042`, `:1433`. The single state mutator
  (`AiRequestContext.updateAiRequest`, `:368`) supports both merge and replace. Once a parent
  and a child are both being polled and both whole-replaced in the same tick, this is a
  lost-update race. → **Phase 9a** (a write gate) and **Phase 11** (a per-request turn lock).
- **Gap 2c — no plan-merge semantics.** Phase 3 writes a whole task array; Phase 5 flips one
  task's status. Two writers over one plan is exactly the kanban data-loss shape
  munder-difflin's `mergeTaskLedger`/`patchTaskInLedger` exists to prevent (section 6).
  → **Phase 10**.

### 3.2 The 29 BYOK tools, and how the four roles partition them

Names, in schema order (`newIDE/app/src/AI/CustomAIClient.js:219` onward):

```
create_scene, create_or_replace_object, add_behavior, put_2d_instances, add_scene_events,
run_script, read_events_source, describe_instances, inspect_object_properties_effects,
inspect_behavior_properties, inspect_scene_properties_layers_effects,
change_scene_properties_layers_effects_groups, change_object_properties_effects,
change_behavior_property, change_project_properties_resources,
inspect_project_properties_resources, add_or_edit_variable, put_3d_instances,
inspect_variables, read_game_project_json, search_object_asset_store, search_resource_store,
search_docs, read_full_docs, initialize_project, get_game_starter_summary,
create_or_update_plan, run_gameplay_test, change_gameplay_tests
```

`spawn_agent` is added to this list by Phase 4. The four roles and their exact tool names are
defined in `newIDE/app/src/AiGeneration/Studio/Roles.js` (Phase 2); the read-only invariant
(tester mutates nothing; designer's only mutating tool is `add_or_edit_variable`) is asserted
by `Roles.spec.js`.

---

## 4. Engine blocker table

| Symptom | Exact location | User-visible consequence | Phase |
|---|---|---|---|
| No instancing: every Model3D instance clones its own scene graph | `Extensions/3D/Model3DRuntimeObject3DRenderer.ts:349` (`SkeletonUtils.clone`); no `THREE.InstancedMesh` outside vendored Three.js | Draw calls rise 1:1 with repeated props; framerate collapses on any repeated-model set | **7** |
| 3D objects never culled in a scene | `GDJS/Runtime/runtimescene.ts:524` (`TODO (3D) culling`) | Off-camera 3D objects still submitted every frame | **6** |
| 3D objects never culled inside a custom object | `GDJS/Runtime/CustomRuntimeObjectInstanceContainer.ts:263` (`TODO (3D) culling`) | A custom object holding many 3D children is never culled as a whole or in part | **6** |
| `RuntimeObject3D` reports no renderer object, so the 2D AABB path skips it | `Extensions/3D/A_RuntimeObject3D.ts:97-99` (`getRendererObject() { return null; }`); branch at `GDJS/Runtime/CustomRuntimeObjectInstanceContainer.ts:266-283` | Reinforces the two rows above: even the existing 2D culling cannot see 3D objects | **6** |
| Base container has no camera to cull against | `GDJS/Runtime/RuntimeInstanceContainer.ts:496` (`TODO (3D) culling`) | Accepted — see below | accepted, not fixed |
| TileMap viewport culling only for SimpleTileMap, only as a direct scene child, only with an unrotated 3D camera | `Extensions/TileMap/tilemapruntimeobject-pixi-renderer.ts:152-159` (`dimX + dimY > 100 && isSimpleTileMap(object) && instanceContainer === scene && (!gdjs.scene3d || rotations are 0)`) | A large `TileMap` (not Simple) or a tilemap nested in a custom object re-renders the whole map every frame | **8** |
| Any tilemap opacity change forces a full re-render | `Extensions/TileMap/tilemapruntimeobject-pixi-renderer.ts:90-95` (`updateTileMap(true)`) | Fading a district stutters | accepted, not fixed |
| Lazy 3D shader compilation costs a dropped frame | `GDJS/Runtime/profiler.ts:306-318` (documented), `:380-384` (the newly-compiled-program counter) | Unexplained stutter early in a playthrough | accepted, not fixed |
| Per-frame `sortableChildren` z-sorting | `GDJS/Runtime/pixi-renderers/layer-pixi-renderer.ts:246`, `runtimescene-pixi-renderer.ts:33`, `CustomRuntimeObject2DPixiRenderer.ts:37` | CPU cost proportional to 2D object count per layer | accepted, not fixed |
| `_allInstancesList` rebuilt when object membership changes | `GDJS/Runtime/RuntimeInstanceContainer.ts:653`, `:736` (invalidations), `:556-565` (rebuild) | A cost spike per spawn/despawn, not per frame | accepted, not fixed |
| Grid A* gives up on long routes, silently | `Extensions/PathfindingBehavior/pathfindingruntimebehavior.ts:636`, `:739-750` | Units stop pathing with only a console warning | accepted — a design constraint, documented in section 2.1 |
| Navmesh crowd capacity fixed at build | `Extensions/NavMeshPathfinding/NavMeshObstacleRuntimeBehavior.ts:179-182` | Growing population needs the obstacle re-registered | accepted — documented in section 2.1 |

"Accepted, not fixed" means: recorded here, deliberately out of this plan's scope. Phases 6-8
fix the three that bound object count; the rest are either design constraints or costs that
scale with a quantity the user controls.

---

## 5. Roadmap

Eleven phases, in the order they were planned. Phases 1-5 are the studio; 6-8 are engine
culling and instancing; 9-11 are the editor-side modules that make a local multi-agent run
safe. Phases 6-11 are independent of each other and of 2-5, with two named ordering edges
(10 before 5's task-status write; 11 with or before 4's spawner).

| # | Phase | Outcome |
|---|---|---|
| 1 | Assessment document | This file — both verdicts plus the blocker table |
| 2 | Role registry | `AiGeneration/Studio/Roles.js`: four roles, their prompts, their exact tool subsets, their turn caps |
| 3 | Local plan tool | `create_or_update_plan` becomes real under BYOK, returning the exact shape `getLatestActivePlan` and `OrchestratorPlan` already read |
| 4 | Spawn tool + spawner | `spawn_agent` in the tool schema; a spawner that creates and activates a real child `AiRequest` with a role-scoped prompt and tool subset |
| 5 | Finalization + runtime hook | A finished child's report is written onto the parent's `function_call_output`, the plan task flips to done, the next goes in-progress, and the parent takes its next model turn |
| 6 | 3D culling | `RuntimeObject3D.getAABB3D`/`isInFrustum`, a per-frame frustum on the layer renderer, and a 3D branch in both `_updateObjectsPreRender` implementations |
| 7 | Instancing | `Model3DInstancePool` + an opt-in `useInstancing` property; repeated static models share one `THREE.InstancedMesh` |
| 8 | TileMap culling generalisation | Culling works for `TileMap` (not just `SimpleTileMap`) and for tilemaps nested in custom objects, with bounds clamped to the map |
| 9 | Write gate + loop guard | One gate owns writes to an `AiRequest`; a local circuit breaker trips on repeated identical calls, error storms and turn count |
| 10 | Plan merge semantics | `mergePlanTasks` / `patchPlanTask`, so a status flip cannot strip the fields the plan writer wrote |
| 11 | Local turn serialization | One in-flight model turn per request id, and the two in-place mutators made whole-replace |

---

## 6. Verdict: munder-difflin as a "test and active multi-agent harness"

Two verdicts, kept separate. The runtime is unusable here; three of its pure modules are
worth porting, and this plan ports exactly those.

`chaitanyagiri/munder-difflin` v0.4.6, MIT, 7,819 stars (GitHub API, read while writing this),
last pushed 2026-09-17.

### 6.1 Its runtime model does not fit this editor

Munder-difflin wraps **terminal agent CLIs**. Its `package.json` dependencies include
`node-pty ^1.0.0` and `@xterm/xterm ^5.5.0`; its agents coordinate by writing JSON files into
per-agent `inbox/`/`outbox/` directories inside a git repo the harness owns
(`docs/message-queue.md` §1 describes the one gate that types into a PTY;
`src/main/workerWake.ts` describes the inbox-wake watchdog).

A GDevelop agent must call **editor functions** against the in-memory `gd` project built from
`libGD.wasm`. A terminal CLI cannot load that wasm module, cannot produce or mutate `gd`
objects, and has no access to the running editor's state; it would have to round-trip through
the project file. That is strictly worse than the tool-call loop the fork already has, so
munder-difflin's agent runtime, its Pixi office floor, its git-as-coordination-layer (which
would collide with `newIDE/app/src/ProjectsStorage/`), and its MemPalace semantic memory
(which would add a `uv` + Python toolchain to a browser app) are all out of scope.

Two smaller mismatches:

- **Its `mcpCatalog` has no landing site.** A search for `mcp`/`MCP` across
  `newIDE/app/src` returns no matches: this fork has zero MCP surface.
- **Its `test/load-ts.cjs` transpile-one-file loader is unnecessary here.** `newIDE/app` is
  stock Jest 27 through `react-app-rewired` (`config-overrides.js` overrides only
  `transformIgnorePatterns`), and its specs use `jest.mock` freely. The
  `jest-light-runner` no-mocking restriction applies to `GDevelop.js` only
  (`GDevelop.js/package.json:37` declares `jest-light-runner`, `:44` selects it via
  `"runner"`).

### 6.2 Three of its modules close holes this fork verifiably has

| MD module | MD evidence (read while writing this) | GDevelop hole (measured in this checkout) |
|---|---|---|
| `src/main/breaker.ts` — repeated-tool, error-storm, token-velocity and cost trips, with a `steer → constrain → stop` escalation ladder | `DEFAULTS` = `{ enabled: true, hardStop: false, repeatedToolLimit: 8, errorStormLimit: 5, tokenVelocityPerMin: 60_000 }`; `tick()` escalates at most one level per beat toward `ceiling = hardStop ? 'stopped' : 'constrained'`, de-escalates one level when not tripping, and sets `action` only when the level escalates; `toolKey()` is `name + ':' + sha256(inp)`, where the comment records that the old `input.slice(0, 200)` collided on Bash commands sharing a long preamble and constrained an agent over nine *different* measurements (issue #377) | **No client-side turn cap, repeat-tool detection or cost accounting exists anywhere in the AI path.** The only breakers are two server-emitted error codes the client merely renders (`AiRequestErrorRow.js:51-56`) and `MAX_AI_REQUEST_RETRIES_IN_A_ROW = 3`, whose own comment says the API is what really enforces it (`AiRequestUtils.js:34-38`). Under BYOK there is no server, so a looping local agent runs until the user stops it |
| `src/renderer/src/components/terminalAutomation.ts` + `docs/message-queue.md` — one gate owns every write, with a pure predicate returning an explicit block reason | `terminalAutomationBlock(state)` returns `'exited' | 'picker' | 'draft' | 'settling' | null`; `docs/message-queue.md` §1: "One place types automatic messages into a live agent's PTY: the drain loop… This is load-bearing. When the inbox nudge wrote straight into the terminal, it was a second writer with its own idea of when the prompt was free — and its text landed on top of a half-written line"; the drain is "debounced 200 ms … plus a 3 s backstop tick"; `control.ts` `MAX_PENDING_STEERS = 20` drops from the front so the newest instruction still lands | **31 `updateAiRequest(` call sites**, 15+ of them whole-request replacements that ignore previous state (listed in section 3.1). `inFlightFunctionCallIdsRef` (`AiGeneration/Utils.js:386`) is a per-`(requestId, callId)` lock on function-call *processing* only: it does not serialize state writes, and a parent and its sub-agent are both polled and both whole-replaced in the same tick |
| `src/shared/taskLedger.ts` — `mergeTaskLedger` + `patchTaskInLedger` | The module's own header records why: the ledger is hand-written and holds fields the renderer's display model does not know about, so "any writer holding a partial model of a card silently DELETED every field it didn't know about, on EVERY card on the board". `mergeTaskLedger` returns `incoming` (its order, its membership — deletion still works) folded over matching existing entries, and "a field the caller DOES send wins, including an explicit `null`"; an entry with no string `id` passes through untouched. `patchTaskInLedger` edits the **raw** entry so a normalizing parser cannot re-emit a coerced value | Phase 3's `buildPlanOutput` writes the whole task array and Phase 5 flips a task's status: two writers over one plan, the exact kanban data-loss shape this function exists to prevent |

Two supporting patterns worth naming but not porting wholesale: `src/main/workerWake.ts`'s
`announcedInboxIds` edge trigger (a worker is re-nudged only when a **new** message id
appears — "unchanged undrained mail is never re-announced once a minute forever"), and its
`WORKER_WAKE_COOLDOWN_MS = 60_000` / `WORKER_WAKE_HITL_REARM_MS = 5 * 60_000` guards.

### 6.3 What that means for the roadmap

Phases 9-11 exist because of section 6.2, and are independent of phases 1-8.

The false-positive lesson carried over is munder-difflin's `PreCompact` exemption, which
exists because the harness's own auto-compact tripped its own breaker
(`breaker.ts`, the comment on `recordCompactStart`: "the harness's own auto-compact mission
tripping its own breaker on idle agents"). The analogous legitimate-but-long operations here
are a `run_script` (capped at 600 editor-function calls,
`newIDE/app/src/EditorFunctions/ScriptExecution/ScriptRunner.js:243-266`) and a gameplay test
run. So the ported trips are **repeat-tool, error-storm and turn-count, with the turn cap
generous by default (60)** — never a per-tool-call rate, never a wall-clock trip, and never a
cost trip: the BYOK path has no usage feed at all, which Phase 9b states explicitly instead
of inventing one.

**Provenance.** Only algorithms and exact constants are taken from munder-difflin; no MD
source is vendored, no MD module is imported, and no MD dependency is added. The three
upstream files are `src/main/breaker.ts`, `src/shared/taskLedger.ts` and
`src/renderer/src/components/terminalAutomation.ts` (with `src/main/control.ts` for the
pending-steer rule). The MIT grant covers the reuse.
