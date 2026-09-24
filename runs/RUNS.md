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
| 184 | WebUI-verify the studio transcript rendering (reasoning + tool flow) | `chore(autonomous): verify the studio transcript rendering` | green (WebUI audit) |
| 185 | Harden the function-call-output builder (null entry + non-object spread) | `fix(ai): harden the function-call-output builder` | green (gates) |
| 186 | Cover the prompt builder and per-chat config resolver (Tier 1) | `test(ai): cover the prompt builder and config resolver` | green (gates) |
| 187 | Unit-test the preferences backfill by extracting it to the tested leaf | `refactor(preferences): extract the stored-preferences merge to the tested leaf` | green (gates) |
| 188 | Sanitize plan tasks at the getLatestActivePlan chokepoint | `fix(ai): sanitize plan tasks at the getLatestActivePlan chokepoint` | green (gates) |
| 189 | Live Phase 5 harness run vs local Ollama; fix the CORS preflight header | `fix(ai): stop sending attribution headers that break local CORS` | green (live local Ollama round-trip) |
| 190 | Bounded live studio-run attempt (plan + sub-agent) via the WebUI | `chore(autonomous): record the bounded live studio-run attempt` | bounded attempt |
| 191 | Stream reasoning as progress so the cold-start hint clears (Tier 2) | `fix(ai): stream reasoning as progress before the first answer token` | green (gates) |
| 192 | Make provider telemetry inspectable per request (Tier 2 audit data layer) | `feat(ai): expose per-request provider telemetry` | green (gates) |
| 193 | Surface the per-request provider telemetry in the chat (Tier 2 consumer) | `feat(ai): show provider response telemetry in the chat` | green (gates) |
| 194 | Phase 5 adversarial diff inspection over the whole session (no change) | `docs(autonomous): record the adversarial diff inspection` | green (gates) |
| 195 | Run the entire editor Jest suite (broadest regression gate) | `chore(autonomous): record the full suite run` | green (gates) |
| 196 | Live multi-turn studio run against local Ollama (Phase 5) | `chore(autonomous): record the live multi-turn studio run` | green (live multi-turn run) |
| 197 | Dispatch the canonical city-builder benchmark live against local Ollama | `chore(autonomous): record the live city-builder benchmark dispatch` | green (live benchmark dispatched; no delegation) |
| 198 | Harden the manager prompt to require delegation (+ live re-run measurement) | `feat(ai): require delegation in the manager prompt` | green (prompt hardened; re-run no compliance change) |
| 199 | Cover the backend-tool filter on the continue and sub-agent paths (Tier 4) | `test(ai): cover the backend-tool filter on continue and sub-agent paths` | green |

## Harness findings (cycles 155-199)

### Live endpoint
- Local Ollama at `http://localhost:11434/v1` (model `deepseek-v4.1-flash:cloud`) works.
- Hosted `llm.heretek.one` is reachable but answers 401 without `config.local.json`.

### Defects found and fixed by running live
- **CORS (critical)**: the client sent OpenRouter attribution headers (`HTTP-Referer`,
  `X-Title`) on every request; Ollama's preflight rejects `x-title`, so the browser
  build could not reach any local server. Removed both (cycle 189).
- **Reasoning progress**: Ollama streams `delta.reasoning` before any `delta.content`;
  partial content ignored it, so the cold-start hint said "waiting for the first token"
  while bytes arrived. Now reports `content || reasoning` (cycle 191).

### Model-behaviour finding (not a harness bug)
- `deepseek-v4.1-flash:cloud` often **stops after planning/inspection** and narrates
  delegation without calling `spawn_agent` (cycles 196-198). The delegation path itself
  is proven: the persisted HarborTown run has 12 sub-agent spawns, and the unit tests
  cover spawn/finalize. Measure across runs / use a stronger model before concluding.

### Automation notes
- `chrome-devtools.fill()` does NOT fire React onChange; use `press_key`/`type_text`.
- `evaluate_script` takes a function-declaration string, not an IIFE.
- The code-mode runtime has no `setTimeout`.

## Gate definitions

- **Green**: all deterministic gates pass.
- **Blocked**: a gate could not run for environmental reasons, stated explicitly.
- **Red**: a gate failed; the cycle is rolled back and a heuristic logged.

