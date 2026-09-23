# Heretek Roadmap

Researched direction for the GDevelop-Heretek fork, based on upstream demand signals
(open issues/PRs on [4ian/GDevelop](https://github.com/4ian/GDevelop), forum threads, and the
upstream 2026 roadmap), gathered 2026-09-22.

The fork currently ships: BYOK/local-AI endpoints (`newIDE/app/src/AI/CustomAIClient.js`),
client-side feature unlocks (no watermark/splash clamp, network preview, debugger), and a
Heretek release/update feed.

## Demand signals

|Demand signal|Evidence|Fork status|
|---|---|---|
|**BYOK (bring your own key/model) for the AI agent**|2 open upstream issues ([#7932](https://github.com/4ian/GDevelop/issues/7932), [#8854](https://github.com/4ian/GDevelop/issues/8854), 6 reactions, top non-bug reaction count)|**Already built here** — the fork leads upstream on its #1 AI request.|
|3D rendering: post-processing/PBR, dynamic lighting, spot lights|2026 roadmap item "3D Dynamic lighting" ([discussion #8580](https://github.com/4ian/GDevelop/discussions/8580)); open community PRs [#8343](https://github.com/4ian/GDevelop/pull/8343)/[#8347](https://github.com/4ian/GDevelop/pull/8347)/[#8348](https://github.com/4ian/GDevelop/pull/8348)/[#8349](https://github.com/4ian/GDevelop/pull/8349) (post-processing shaders, PBR material, directional shadows, spotlight object); forum threads "3D navigation" (46 replies), "More 3D features" (Feb 2026), "3D visual effects" (Aug 2026)|Upstream-active; PRs not merged yet|
|LDtk level-designer integration|Long-standing issue (49 comments, rysolv bounty)|Not started|
|Folders for scenes/external events/layouts|[Issue #7777](https://github.com/4ian/GDevelop/issues/7777) (4 reactions)|Not started|
|2D object culling by default|[Issue #8206](https://github.com/4ian/GDevelop/issues/8206)|Not started|
|UX polish cluster|Delete key in Instances list [#8291](https://github.com/4ian/GDevelop/issues/8291); drag&drop image into scene [#8297](https://github.com/4ian/GDevelop/issues/8297); integer/pixel-art scaling [#7495](https://github.com/4ian/GDevelop/issues/7495); focus-management "task force"; event-sheet UI to reduce logic errors (forum, Mar 2026)|Not started|
|Web-app: save/import local projects via File System Access API|Open upstream issue|Not started|
|Spatial/directional sound|[Issue #6954](https://github.com/4ian/GDevelop/issues/6954)|Not started|

Upstream 2026 roadmap emphasis: 3D dynamic lighting overhaul, continued 3D editor investment
(navmesh pathfinding shipped in 5.6.278), multiplayer fixes (lobby join hangs
[#8968](https://github.com/4ian/GDevelop/issues/8968)).

## Directions (recommended order)

### A. Own the AI/BYOK angle (fork's differentiator — highest leverage)

Upstream's top AI request is exactly the fork's core feature.

1. Audit `CustomAIClient.js` against upstream's AI Agent architecture (`AiGeneration/` changes
   from the Sept sync) and close gaps: tool-use/agent-loop parity, per-task model routing,
   streaming.
2. Add what upstream users ask for beyond BYOK: local model presets (Ollama / LM Studio
   endpoint discovery), token/cost meter, per-request model picker in the AI toolbar.
3. Publish a comparison note (Heretek README section) so users arriving at upstream issue
   [#7932](https://github.com/4ian/GDevelop/issues/7932) find the fork.

### C. Fork-only power features (cheap, on-brand) — quick wins first

1. "Folders for scenes/layouts" ([#7777](https://github.com/4ian/GDevelop/issues/7777)) if
   upstream hasn't landed it — ProjectManager UI + serialization.
2. Editor UX cluster: Delete key in Instances list ([#8291](https://github.com/4ian/GDevelop/issues/8291)),
   drag&drop image into scene ([#8297](https://github.com/4ian/GDevelop/issues/8297)),
   integer pixel-art scaling ([#7495](https://github.com/4ian/GDevelop/issues/7495)) — all
   small, isolated editor changes.
3. File System Access API saving for the web build.

### B. Track upstream's 3D wave instead of duplicating it

Upstream will land dynamic lighting/PBR eventually; community PRs
[#8347](https://github.com/4ian/GDevelop/pull/8347)–[#8349](https://github.com/4ian/GDevelop/pull/8349)
are the vehicles.

1. Keep the daily upstream sync green (already automated).
2. Cherry-pick/extend the community 3D PRs early into the fork if upstream stalls — each is a
   self-contained renderer change in `GDJS/Runtime/pixi-renderers/` + `Extensions/3D/`.
3. Low-risk quick win from the demand table: 2D object culling
   ([#8206](https://github.com/4ian/GDevelop/issues/8206)) — runtime-only change in
   `GDJS/Runtime`, no editor UI.

### D. Hygiene (small, constant effort)

- Keep the dev build green (the Flow type-only-import fix landed 2026-09-22).
- Pin Node 20 via `.nvmrc` to match CI (local machine runs Node 26).
- Refresh the stale root `scripts/README.md`.
