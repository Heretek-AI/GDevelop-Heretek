# Autonomous Studio Run Log

Metrics appended by the recursive studio engine. `model` is the model doing the
work; `endpoint` is the AI endpoint under test for that cycle.

| cycle | target | commit | harness verdict |
|---|---|---|---|
| 155 | Stop run_script sandbox-probing thrash and wire the teaching through to the model | `fix(ai): teach the run_script sandbox and surface zero-call guidance` | green (gates) |
| 156 | Harden the turn pipeline against non-string network content and null inner entries (malformed-data re-sweep) | `fix(ai): harden turn pipeline against non-string content and null entries` | green (gates) |
| 157 | Null-tolerate every output loop in the dispatch/render feed (AiRequestUtils + loop-guard filter) | `fix(ai): tolerate null holes in the dispatch output loops` | green (gates) |
| 158 | Fan-out cap counts live children, not lifetime spawns (studio delegation) | `fix(ai): count live sub-agents against the spawn fan-out cap` | green (gates) |
| 159 | Pin the BYOK unlock net: hasValidSubscriptionPlan + UNLOCKED seeds spec | `test(paywall): pin the BYOK unlock grant and seeds` | green (gates) |
| 160 | Null-tolerate the studio runtime finalization check (parentHasOutputForCall leaf) | `fix(ai): tolerate null holes in the studio finalization check` | green (gates) |
| 161 | Streamed turns emit provider telemetry; header reads prefer .get (Tier 2 parity) | `feat(ai): log provider telemetry for streamed turns` | green (gates) |
| 162 | Production-build verification over the accumulated studio work (no-change verification cycle) | `chore(autonomous): record cycle 162 production-build verification` | green (gates) |
| 163 | Null-tolerate the sub-agent report/finished output loops (same class, final studio sites) | `fix(ai): tolerate null holes in the sub-agent report loops` | green (gates) |
| 164 | Extract the edit-approval launching-call resolution to a tested leaf | `refactor(ai): extract edit-approval launching-call resolution` | green (gates) |
| 165 | Cover the studio write-back hook with a render harness (useStudioRuntime) | `test(ai): cover the studio write-back hook` | green (gates) |
| 166 | Grapheme-safe truncation via Intl.Segmenter (ecosystem over reinvention) | `perf(ai): segment graphemes when truncating studio text` | green (gates) |
| 167 | Classification tripwire: every registry tool classified or explicitly exempt | `test(ai): pin the tool classification taxonomy` | green (gates) |
| 168 | Context gauge and cost meter count the tool schema (Tier 2 accounting parity) | `fix(ai): count the tool schema in the context gauge and cost meter` | green (gates) |
| 169 | Withhold backend-only tools from local turns (get_game_starter_summary) | `fix(ai): withhold backend-only tools from local turns` | green (gates) |
| 170 | Budget and harden the local suggestions call (history trim + null-hole attach) | `fix(ai): budget and harden the local suggestions call` | green (gates) |
| 171 | Budget the event-generation prompt to the model context window | `fix(ai): budget the event-generation prompt to the context window` | green (gates) |
| 172 | Normalize a non-Error rejection in sendChatCompletion (undefined crash) | `fix(ai): normalize a non-Error rejection in sendChatCompletion` | green (gates) |
| 173 | Guard the untested fork-at-message-id slice against a null hole | `fix(ai): guard the fork-at-message-id slice against a null hole` | green (gates) |
| 174 | Null-tolerate the local turn merge (success and failure paths) | `fix(ai): null-tolerate the local turn merge paths` | green (gates) |
| 175 | Guard the last latent crash: output.some over a persisted hole during a racy failed turn | `fix(ai): guard the racy turn-merge comparison against a hole` | green (gates) |
| 176 | Bring AUTONOMOUS_STATE.json to the required schema and create runs/RUNS.md | `chore(autonomous): complete the state schema and run log` | green (gates) |
| 177 | Actionable hints for HTTP 429 and 502/503 provider failures | `feat(ai): hint at rate limiting and provider outages` | green (gates) |
| 178 | Null-tolerate the plan readiness scan (model-authored plan tasks) | `fix(ai): tolerate null plan tasks in the readiness scan` | green (gates) |
| 179 | Guard the polling splice scan against a hole in the cached output | `fix(ai): guard the polling splice scan against a cached hole` | green (gates) |
| 180 | Guard the ChatMessages render loops against persisted output holes | `fix(ai): guard the ChatMessages render loops against output holes` | green (gates) |
| 181 | Cover the security-relevant role resolution and role predicates (Tier 1) | `test(ai): cover role resolution and role predicates` | green (gates) |
| 182 | Cover spawnSubAgent, the untested delegation glue (Tier 1) | `test(ai): cover spawnSubAgent delegation glue` | green (gates) |
| 183 | Execute the Phase 5 WebUI audit (dev server + Chrome DevTools MCP) | `chore(autonomous): execute the Phase 5 WebUI audit` | green (WebUI audit) |
| 184 | WebUI-verify the studio transcript rendering (reasoning + tool flow) | `chore(autonomous): verify the studio transcript rendering` | green (gates) |
| 185 | Harden the function-call-output builder (null entry + non-object spread) | `fix(ai): harden the function-call-output builder` | green (gates) |
| 186 | Cover the prompt builder and per-chat config resolver (Tier 1) | `test(ai): cover the prompt builder and config resolver` | green (gates) |
| 187 | Unit-test the preferences backfill by extracting it to the tested leaf | `refactor(preferences): extract the stored-preferences merge to the tested leaf` | green (gates) |
| 188 | Sanitize plan tasks at the getLatestActivePlan chokepoint | `fix(ai): sanitize plan tasks at the getLatestActivePlan chokepoint` | green (gates) |
| 189 | Live Phase 5 harness run vs local Ollama; fix the CORS preflight header | `fix(ai): stop sending attribution headers that break local CORS` | green (live local Ollama round-trip) |
| 190 | Bounded live studio-run attempt (plan + sub-agent) via the WebUI | `chore(autonomous): record the bounded live studio-run attempt` | green (gates) |
| 191 | Stream reasoning as progress so the cold-start hint clears (Tier 2) | `fix(ai): stream reasoning as progress before the first answer token` | green (gates) |
| 192 | Make provider telemetry inspectable per request (Tier 2 audit data layer) | `feat(ai): expose per-request provider telemetry` | green (gates) |
| 193 | Surface the per-request provider telemetry in the chat (Tier 2 consumer) | `feat(ai): show provider response telemetry in the chat` | green (gates) |
| 194 | Phase 5 adversarial diff inspection over the whole session (no change) | `docs(autonomous): record the adversarial diff inspection` | green (gates) |
| 195 | Run the entire editor Jest suite (broadest regression gate) | `chore(autonomous): record the full suite run` | green (gates) |
| 196 | Live multi-turn studio run against local Ollama (Phase 5) | `chore(autonomous): record the live multi-turn studio run` | green (live multi-turn run) |
| 197 | Dispatch the canonical city-builder benchmark live against local Ollama | `chore(autonomous): record the live city-builder benchmark dispatch` | green (benchmark dispatched; no delegation) |
| 198 | Harden the manager prompt to require delegation (+ live re-run measurement) | `feat(ai): require delegation in the manager prompt` | green (gates) |
| 199 | Cover the backend-tool filter on the continue and sub-agent paths (Tier 4) | `test(ai): cover the backend-tool filter on continue and sub-agent paths` | green (gates) |
| 200 | Recover a context-overflow turn with one retry at a smaller budget (Tier 2) | `feat(ai): retry a context-overflow turn at a smaller budget` | green (gates) |
| 201 | Extend context-overflow recovery to the create and sub-agent paths (Tier 2 parity) | `feat(ai): recover create and sub-agent turns from context overflow` | green (gates) |
| 202 | Live-verify the per-request telemetry surface with a synthetic provider | `chore(autonomous): live-verify the telemetry surface with a mock provider` | green (gates) |
| 203 | Commit the mock provider as a reusable offline harness tool (Tier 4) | `feat(scripts): add a reusable offline mock AI provider` | green (gates) |
| 204 | Stop streamed tool-call assembly corrupting non-string arguments | `fix(ai): coerce streamed tool-call fragments to strings` | green (gates) |
| 205 | Full-suite regression + run-log refresh (no change) | `chore(autonomous): full-suite regression and run-log refresh` | green (gates) |
| 206 | Make the mock provider scriptable for deterministic offline harness runs (Tier 4) | `feat(scripts): let the mock provider serve a scripted turn sequence` | green (gates) |
| 207 | Deterministic offline proof of the multi-agent loop via the scripted mock | `chore(autonomous): deterministic offline proof of the multi-agent loop` | green (deterministic loop proof) |
| 208 | OSINT assessment: maintained library vs the bespoke tool-argument validator | `docs(autonomous): assess ajv vs the bespoke tool-argument validator` | green (gates) |
| 209 | Attempt the full-loop run with a project created in-script | `chore(autonomous): record the in-script project-creation attempt` | green (gates) |
| 210 | Full-project scripted loop reveals the plan task never flips to done | `docs(autonomous): record the plan-flip clobber found by the harness` | defect found (plan never flipped) |
| 211 | Fix the plan-flip clobber: cache wins for pre-existing messages on write-back | `fix(ai): stop a turn from clobbering a concurrent in-place rewrite` | FIXED + live-verified |
| 212 | Script the parent while sub-agents reply plainly (mock routing) + multi-task example | `feat(scripts): route mock scripts to parent requests and add a multi-agent example` | green (gates) |
| 213 | Deterministic multi-task studio lifecycle proven end-to-end | `chore(autonomous): deterministic multi-task studio lifecycle proof` | green (3-task lifecycle proof) |
| 214 | Post-fix full-suite regression + run-log refresh (no change) | `chore(autonomous): full-suite regression and run-log refresh` | green (gates) |
| 215 | Real-model city-builder benchmark against local Ollama (Phase 5) | `chore(autonomous): record the real-model city-builder benchmark run` | green (real-model benchmark) |
| 216 | Multi-agent audit summary in the chat (Tier 1 UI + Tier 2 audit) | `feat(ai): show a multi-agent audit summary in the chat` | green (audit line live) |
| 217 | Count distinct sub-agents in the audit summary (dedupe by call_id) | `fix(ai): count distinct sub-agents in the audit summary` | green (gates) |
| 218 | Role breakdown in the multi-agent audit summary (Tier 2) | `feat(ai): break the multi-agent audit summary down by role` | green (role breakdown live) |
| 219 | Full-suite regression after the multi-agent UI additions (no change) | `chore(autonomous): full-suite regression and run-log refresh` | green (gates) |
| 220 | Per-agent token accounting, surfaced in the audit line (Tier 2) | `feat(ai): bill sub-agent tokens to the sub-agent and show them` | green (per-agent tokens live) |
| 221 | Clear a request's provider telemetry on delete (registry consistency) | `fix(ai): clear a request's provider telemetry when deleted` | green (gates) |
| 222 | Stop sub-agent children from evicting real chats from persistence | `fix(ai): keep sub-agent children out of persisted chats` | persistence bug fixed |
| 223 | Full-suite regression after the persistence + telemetry fixes (no change) | `chore(autonomous): full-suite regression and run-log refresh` | green (gates) |
| 224 | Re-verify invariant 1 (no paywall) after the session's changes (no change) | `docs(autonomous): re-verify the no-paywall invariant` | green (gates) |
| 225 | Assess an upstream-file guard and revert on policy (verification cycle) | `docs(autonomous): assess an upstream-file guard and revert on policy` | green (gates) |
| 226 | Flow type-check over the session's additions (no change) | `docs(autonomous): verify Flow over the session additions` | green (gates) |
| 227 | Live streaming token counter + a slow-stream mock option (Tier 2) | `feat(ai): show a live streaming token count in the chat` | unit/build verified (live caveat) |
| 228 | Attempt to catch the streaming token counter live (no change) | `docs(autonomous): record the streaming-counter live-catch attempt` | live catch not confirmed (caveat) |
| 229 | Full-suite regression + run-log refresh (no change) | `chore(autonomous): full-suite regression and run-log refresh` | green (gates) |

## Latest full-suite result (after cycle 229)

- `newIDE/app` full Jest: **185 suites, 2370 passed, 1 skipped, 114 snapshots, 0 failures**.
- AI-surface subset: 1652 passed. Production build: exit 0. Lint/Prettier/divergence: clean.

## Fixed defects (cycles 155-229)
- Local-first CORS block (attribution headers rejected by Ollama preflight).
- Plan-flip clobber: a turn overwrote a concurrent in-place plan rewrite.
- Context-overflow recovery on create/continue/sub-agent paths.
- Streamed tool-call fragments corrupted when a chunk sent an object.
- Reasoning-only streams reported no progress.
- Provider telemetry not cleared on delete; sub-agent children evicting real chats
- Recorded-but-unsent outcomes: role denials, the loop-guard warning, spawn
  failures and mixed batches never reached the model (recorded client-side only),
  looping until the guard tripped (cycles 239-241)..

## Proven workflows
- Manager-role fix verified end-to-end (cycle 259): a fresh `@feedback-loop` run
  (Empty project pre-created; `prompt-city.md`) showed the top-level orchestrator
  make **4 spawns (designer ×2, developer ×2) and 0 direct project edits** over
  53 messages, with the plan tracking the model's own ids (`task_design done`,
  `task_build done`, `task_economy in_progress`, `task_test pending`). The
  pre-fix run made 15 manager mutations. The manager's reasoning even
  acknowledged its restricted toolset. Screenshot
  /tmp/opencode/cycle259-manager-fixed.png; recorded as Run 6 in the skill's
  runs/RUNS.md. One child developer errored - sub-agent failure recovery to
  watch next.
- Harness fix: the orchestrator now runs as the studio manager (cycle 258):
  feedback-loop Run 5 showed the top-level orchestrator (mode `orchestrator`)
  planned and spawned 2 agents but also called **14 project-mutating tools
  itself** - it was not running as the manager at all. Root cause: in the BYOK
  client a top-level request got the generic prompt and **every** tool
  (`buildSystemPrompt` role null; tools = full schema); only sub-agents got a
  role's prompt/subset. `resolveStudioRoleId` (Roles.js) now maps an
  `orchestrator`-mode top-level request to the `manager` role, while a
  present-but-unknown role id still fails closed to read-only. Wired into both
  top-level paths (create + continue); a spec asserts an orchestrator request
  sends `spawn_agent`/`create_or_update_plan`, not `create_scene`, and carries
  the manager prompt. Recorded as Run 5 in the skill's runs/RUNS.md.
- Harness fix: change-tool schemas audited and completed (cycle 257): a focused
  audit (every top-level array/object arg an implementation reads must be
  advertised in its OpenAI schema) found three more mismatches of the
  cycle-256 class. Added `changed_effects` to `change_object_properties_effects`,
  `changed_groups` + `changed_layer_effects` + `move_instances` to
  `change_scene_properties_layers_effects_groups`, and `changed_resources` to
  `change_project_properties_resources` - each with the item shape read from the
  implementation. A spec pins all four; the audit now reports no remaining
  top-level array/object mismatch. Verified the served bundle exposes them.
- Harness fix: `change_behavior_property` schema matched to its implementation (cycle 256):
  feedback-loop Run 4's developer could not change any behavior property. Root
  cause: the OpenAI schema advertised flat `property_name`/`new_value`, while the
  tool reads `changed_properties: [{property_name, new_value}]` (and so do every
  spec - like the sibling `change_object_properties_effects`). A schema-conformant
  call left `changed_properties` empty, so the tool always answered "Nothing
  changed." Fixed the schema to advertise the array; a spec pins the shape so it
  cannot drift again. Verified the served app chunk now exposes
  `changed_properties` (and no flat `property_name`) for this tool.
- Harness fix: live requests keep processing after losing selection (cycle 255):
  the dispatcher only processed `[selectedRequest, ...activeSubAgents]`, so a
  request deselected mid-run (e.g. by `initialize_project`; feedback-loop Run 4)
  had its pending calls stall. It now also processes a fresh (<3 min) local
  top-level request that still has pending calls, via the pure, tested
  `getUnselectedActiveRequests`; `onSendMessage` falls back to the client cache
  for a local request not yet in React state. Verified with a seeded unselected
  request: it was processed (`Automatically processing… local-ai-deselect-test`),
  planned, spawned a sub-agent, and reached 8 messages without being selected;
  screenshot /tmp/opencode/cycle255-deselect-fix.png.
- `@feedback-loop` end-to-end against the hosted proxy (cycle 254): ran the
  actual skill with `config.local.json` (key read by a localhost-only helper the
  page fetched, so it never entered an agent command/log; Preferences form
  filled, Test Connection OK, footer `BYOK: opencode-zen/deepseek-v4.1-flash`).
  Sent `prompt-city.md` verbatim. Model worked: recon (2 calls) → plan (4 tasks)
  → design (spawn task_1 → designer, 20 msgs) → build (spawn task_2 → developer,
  79 msgs / 44 calls). Provider: 45 completions, 44×200, 0×5xx. Plan/link/
  transcript/token-meter all correct; `nudgeCount` 0 (never stalled).
  Two harness causes found: (1) the model called `initialize_project` mid-run,
  which re-created the project and dropped the chat selection, so the pending
  `create_or_update_plan` stalled until the chat was re-selected (processing is
  selected-request-only); (2) the developer spent many turns on
  `change_behavior_property`, which reports "nothing changed" for every
  property-name variant. Verdict + per-phase metrics appended to the skill's
  `runs/RUNS.md` (Run 4); the "keep the running chat selected" workaround was
  added to the skill's `SKILL.md`.
- Real-model full-flow run with the session's fixes (cycle 253): local Ollama
  (`deepseek-v4.1-flash:cloud`, `http://localhost:11434/v1`), project opened via
  `initialize_project`. The manager read the project, created a 4-task plan,
  spawned the designer with `related_task_id: task_1`, and the studio stamped the
  linkage: the spawn carried `taskId: 'task_1'` and the plan read
  `task_1 in_progress (agentCallId call_a0iex1p6)`. The dashboard showed
  `1 sub-agent (1 designer): 0 finished, 1 working · ≈62,020 sub-agent tokens`,
  and expanding the row rendered the designer's own transcript - its task,
  reasoning, `read_game_project_json`/`inspect_variables`/`describe_instances`
  and `add_or_edit_variable` calls, including a self-correction after a schema
  error. The designer then paused on the inline edit-approval prompt (a
  non-read-only role with auto-edit off), which is why the run stopped and no
  nudge fired (a sub-agent was live) - both correct. Screenshot
  /tmp/opencode/cycle253-real-transcript.png.
- Sub-agent transcript view, live (cycle 252): expanding an agent row in the
  dashboard now reveals that agent's own conversation - its user request, its
  assistant text and the tools it called - via the pure, tested
  `summarizeSubAgentTranscript`. A sub-agent's request was not accessible after a
  reload, so children are now persisted in their own bounded store
  (`gd-custom-ai-subagent-requests`, 40, separate from the 20-chat parent
  budget). Verified through the mock: the designer child persisted with its
  `read_game_project_json` call, and the row expanded to `▸ Task: …`,
  `Reading the project…`, `⚙ read_game_project_json`, `GDD_Overview written…`;
  screenshot /tmp/opencode/cycle252-transcript.png.
- Delegations linked to their plan task, live (cycle 251): a successful
  `spawn_agent` now stamps `functionCall.taskId` and lifts its plan task to
  `in_progress` with `agentCallId`, so the chat renders the spawn inside that
  task's row (a pending task does not render linked calls). Verified through the
  mock: the persisted spawn call carried `taskId: 'design'`, the plan updated to
  `design: done (agentCallId c_design)`, and the WebUI showed the "Design" call
  row under the "Design the city-builder GDD" task row; screenshot
  /tmp/opencode/cycle251-task-link.png.
- Orchestrator stall recovery, live end-to-end (cycle 250): a manager that
  plans and then ends its turn without delegating is now nudged automatically
  (bounded, once per plan state). Proven against the scriptable mock provider:
  the request transcript went `user → plan output → user[NUDGE] → assistant
  create_or_update_plan → assistant spawn_agent` - the nudge resumed the stalled
  manager, which then delegated. Only one nudge was sent (no loop); screenshot
  /tmp/opencode/cycle250-nudge.png.
- Per-agent report on demand (cycle 249): a finished row in the per-agent
  dashboard is now clickable and reveals that sub-agent's own report (read by the
  pure, tested `extractFunctionCallReport`, handling the studio `{message}`
  object and JSON-string payloads, and rejecting machine payloads with no
  message). This surfaces "what each agent did" without persisting child
  transcripts. Verified live: the real benchmark chat's finished designer row
  expanded to its report (`Report from the Designer: GDD written to project
  variables …`); the still-working developer row stayed non-clickable;
  screenshot /tmp/opencode/cycle249-agent-report.png.
- Per-agent token totals survive a reload (cycle 248): the token meters are
  persisted under `gd-custom-ai-token-totals` (bounded, corrupt-entry safe) and
  reloaded at startup, so the per-agent audit dashboard keeps its figures after
  a page refresh. Verified live: after seeding the real benchmark's two child
  totals and reloading, the expanded panel showed
  `designer ... · ≈1,234 tokens` and `developer ... · ≈567 tokens`
  (summary `· ≈1,801 sub-agent tokens`); screenshot
  /tmp/opencode/cycle248-persisted-tokens.png.
- Per-agent audit dashboard (cycle 247): the chat's sub-agent summary is now an
  expandable panel - one row per spawned agent (role, short title, linked plan
  task, live/finished, its own token meter) - backed by the pure, tested
  `listSubAgentActivity`. Verified live against the real-model benchmark chat
  (two agents shown: `designer: Design city-builder GDD · task_1`,
  `developer: Build HarborTown scene · task_2`); screenshot
  /tmp/opencode/cycle247-subagent-dashboard.png.
- Per-role specialist flow offline with a project open (cycle 236): designer
  scripted to call a tool then report, developer its own report, plan tasks
  design+build both `done` - reproducible via scripts/dev/mock-script-specialists.json.
- Deterministic 3-task lifecycle offline (cycle 213); real-model 4-task benchmark with
  2 sub-agents and correct plan tracking (cycle 215); per-agent audit line with roles and
  tokens (live, cycles 216-220); provider telemetry note (live, cycle 202).
- Streaming token counter: unit/build verified; a mid-stream live capture was not obtained
  (cycles 227-228) - kept as an honest caveat.

## Gate definitions

- **Green**: all deterministic gates pass.
- **Blocked**: a gate could not run for environmental reasons, stated explicitly.
- **Red**: a gate failed; the cycle is rolled back and a heuristic logged.

