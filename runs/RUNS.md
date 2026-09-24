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
| 183 | Execute the Phase 5 WebUI audit (dev server + Chrome DevTools MCP) | `chore(autonomous): execute the Phase 5 WebUI audit` | green (WebUI-audited) |
| 184 | WebUI-verify the studio transcript rendering (reasoning + tool flow) | `chore(autonomous): verify the studio transcript rendering` | green (gates) |
| 185 | Harden the function-call-output builder (null entry + non-object spread) | `fix(ai): harden the function-call-output builder` | green (gates) |
| 186 | Cover the prompt builder and per-chat config resolver (Tier 1) | `test(ai): cover the prompt builder and config resolver` | green (gates) |
| 187 | Unit-test the preferences backfill by extracting it to the tested leaf | `refactor(preferences): extract the stored-preferences merge to the tested leaf` | green (gates) |
| 188 | Sanitize plan tasks at the getLatestActivePlan chokepoint | `fix(ai): sanitize plan tasks at the getLatestActivePlan chokepoint` | green (gates) |

## Session context (cycles 155-188)

- **model**: `deepseek-v4.1-flash:cloud` (Ollama provider).
- **endpoint**: `llm.heretek.one` reachable but answers 401 without a key; no
  `config.local.json`, so a live model turn is blocked on credentials.
- **turns per phase**: Phase 1 ingest, Phase 2 scoring, Phase 3 implementation,
  Phase 4 gates, Phase 6 consolidation; Phase 5 executed cycle 183.
- **token efficiency**: fork AI suite 1489 -> 1627 passing tests across 81 suites.
- **evidence**: cycle 183/184 loaded the editor via the dev server + Chrome DevTools MCP,
  opened the Ask AI drawer, and read the persisted HarborTown run (114 messages, 35
  assistant turns, 146 tool calls, 12 sub-agent spawns, status ready, no error); console
  had only upstream MUI deprecation warnings; no 4xx/5xx requests.
- **gates every cycle**: `npm test` (react-app-rewired), `eslint --max-warnings=0`,
  `prettier --list-different`, `check-fork-divergence.js`; `npm run build` twice,
  `npm run flow` on Flow-relevant changes, dev-server compile live.

## Gate definitions

- **Green**: all deterministic gates pass.
- **Blocked**: a gate could not run for environmental reasons, stated explicitly.
- **Red**: a gate failed; the cycle is rolled back and a heuristic logged.

