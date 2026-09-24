# Autonomous Studio Run Log

Metrics appended by the recursive studio engine. `model` is the model doing the
work; `endpoint` is the AI endpoint under test for that cycle.

| cycle | target | commit | harness verdict |
|---|---|---|---|
| 155 | Stop run_script sandbox-probing thrash and wire the teaching through to the model | `fix(ai): teach the run_script sandbox and surface zero-call guidance` | gates green; WebUI audit blocked until cycle 183 |
| 156 | Harden the turn pipeline against non-string network content and null inner entries (malformed-data re-sweep) | `fix(ai): harden turn pipeline against non-string content and null entries` | gates green; WebUI audit blocked until cycle 183 |
| 157 | Null-tolerate every output loop in the dispatch/render feed (AiRequestUtils + loop-guard filter) | `fix(ai): tolerate null holes in the dispatch output loops` | gates green; WebUI audit blocked until cycle 183 |
| 158 | Fan-out cap counts live children, not lifetime spawns (studio delegation) | `fix(ai): count live sub-agents against the spawn fan-out cap` | gates green; WebUI audit blocked until cycle 183 |
| 159 | Pin the BYOK unlock net: hasValidSubscriptionPlan + UNLOCKED seeds spec | `test(paywall): pin the BYOK unlock grant and seeds` | gates green; WebUI audit blocked until cycle 183 |
| 160 | Null-tolerate the studio runtime finalization check (parentHasOutputForCall leaf) | `fix(ai): tolerate null holes in the studio finalization check` | gates green; WebUI audit blocked until cycle 183 |
| 161 | Streamed turns emit provider telemetry; header reads prefer .get (Tier 2 parity) | `feat(ai): log provider telemetry for streamed turns` | gates green; WebUI audit blocked until cycle 183 |
| 162 | Production-build verification over the accumulated studio work (no-change verification cycle) | `chore(autonomous): record cycle 162 production-build verification` | gates green; WebUI audit blocked until cycle 183 |
| 163 | Null-tolerate the sub-agent report/finished output loops (same class, final studio sites) | `fix(ai): tolerate null holes in the sub-agent report loops` | gates green; WebUI audit blocked until cycle 183 |
| 164 | Extract the edit-approval launching-call resolution to a tested leaf | `refactor(ai): extract edit-approval launching-call resolution` | gates green; WebUI audit blocked until cycle 183 |
| 165 | Cover the studio write-back hook with a render harness (useStudioRuntime) | `test(ai): cover the studio write-back hook` | gates green; WebUI audit blocked until cycle 183 |
| 166 | Grapheme-safe truncation via Intl.Segmenter (ecosystem over reinvention) | `perf(ai): segment graphemes when truncating studio text` | gates green; WebUI audit blocked until cycle 183 |
| 167 | Classification tripwire: every registry tool classified or explicitly exempt | `test(ai): pin the tool classification taxonomy` | gates green; WebUI audit blocked until cycle 183 |
| 168 | Context gauge and cost meter count the tool schema (Tier 2 accounting parity) | `fix(ai): count the tool schema in the context gauge and cost meter` | gates green; WebUI audit blocked until cycle 183 |
| 169 | Withhold backend-only tools from local turns (get_game_starter_summary) | `fix(ai): withhold backend-only tools from local turns` | gates green; WebUI audit blocked until cycle 183 |
| 170 | Budget and harden the local suggestions call (history trim + null-hole attach) | `fix(ai): budget and harden the local suggestions call` | gates green; WebUI audit blocked until cycle 183 |
| 171 | Budget the event-generation prompt to the model context window | `fix(ai): budget the event-generation prompt to the context window` | gates green; WebUI audit blocked until cycle 183 |
| 172 | Normalize a non-Error rejection in sendChatCompletion (undefined crash) | `fix(ai): normalize a non-Error rejection in sendChatCompletion` | gates green; WebUI audit blocked until cycle 183 |
| 173 | Guard the untested fork-at-message-id slice against a null hole | `fix(ai): guard the fork-at-message-id slice against a null hole` | gates green; WebUI audit blocked until cycle 183 |
| 174 | Null-tolerate the local turn merge (success and failure paths) | `fix(ai): null-tolerate the local turn merge paths` | gates green; WebUI audit blocked until cycle 183 |
| 175 | Guard the last latent crash: output.some over a persisted hole during a racy failed turn | `fix(ai): guard the racy turn-merge comparison against a hole` | gates green; WebUI audit blocked until cycle 183 |
| 176 | Bring AUTONOMOUS_STATE.json to the required schema and create runs/RUNS.md | `chore(autonomous): complete the state schema and run log` | gates green; WebUI audit blocked until cycle 183 |
| 177 | Actionable hints for HTTP 429 and 502/503 provider failures | `feat(ai): hint at rate limiting and provider outages` | gates green; WebUI audit blocked until cycle 183 |
| 178 | Null-tolerate the plan readiness scan (model-authored plan tasks) | `fix(ai): tolerate null plan tasks in the readiness scan` | gates green; WebUI audit blocked until cycle 183 |
| 179 | Guard the polling splice scan against a hole in the cached output | `fix(ai): guard the polling splice scan against a cached hole` | gates green; WebUI audit blocked until cycle 183 |
| 180 | Guard the ChatMessages render loops against persisted output holes | `fix(ai): guard the ChatMessages render loops against output holes` | gates green; WebUI audit blocked until cycle 183 |
| 181 | Cover the security-relevant role resolution and role predicates (Tier 1) | `test(ai): cover role resolution and role predicates` | gates green; WebUI audit blocked until cycle 183 |
| 182 | Cover spawnSubAgent, the untested delegation glue (Tier 1) | `test(ai): cover spawnSubAgent delegation glue` | gates green; WebUI audit blocked until cycle 183 |
| 183 | Execute the Phase 5 WebUI audit (dev server + Chrome DevTools MCP) | `chore(autonomous): execute the Phase 5 WebUI audit` | green |

## Session context (cycles 155-183)

- **model**: `deepseek-v4.1-flash:cloud` (Ollama provider).
- **endpoint**: `llm.heretek.one` reachable but answers 401 without a key; no
  `config.local.json` in the repo, so a live model turn is blocked on credentials.
- **turns per phase**: Phase 1 ingest, Phase 2 scoring, Phase 3 implementation,
  Phase 4 gates, Phase 6 consolidation; Phase 5 executed cycle 183 (dev server +
  Chrome DevTools MCP).
- **token efficiency**: the fork AI suite grew from 1489 to 1609 passing tests across 80 suites.
- **evidence**: cycle 183 loaded the editor, opened the Ask AI drawer, and read the
  persisted HarborTown run (114 messages, 35 assistant turns, 146 tool calls, 12 spawns,
  status ready, no error); console had only upstream MUI deprecation warnings; no 4xx/5xx.
- **gates every cycle**: `npm test` (react-app-rewired), `eslint --max-warnings=0`,
  `prettier --list-different`, `check-fork-divergence.js`; `npm run build` twice,
  `npm run flow` on Flow-relevant changes, and the dev-server compile in cycle 183.

## Gate definitions

- **Green**: all deterministic gates pass.
- **Blocked**: a gate could not run for environmental reasons, stated explicitly.
- **Red**: a gate failed; the cycle is rolled back and a heuristic logged.

