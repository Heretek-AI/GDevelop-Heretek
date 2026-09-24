# Scripts files for GDevelop

Repository-wide tooling. Per-package scripts live in each package's own
`package.json`, not here.

## Fork maintenance

See [MAINTENANCE.md](../MAINTENANCE.md) for how these fit together.

-   **check-fork-divergence.js**: keeps the fork's divergence from upstream
    `4ian/GDevelop` bounded. Compares this tree against the **baseline commit**
    recorded in `fork-divergence.json` (falling back to
    `git merge-base HEAD upstream/master`) and checks the result against the
    checked-in allowlist; exits 1 on a path that diverges without being listed
    or a listed path that no longer diverges. Measuring against a fixed baseline
    rather than live `upstream/master` is what keeps upstream's own pushes from
    reading as fork divergence. `--update` rewrites the allowlist and records the
    baseline, `--list` prints the divergence set. Runs in `ci.yml`
    (`fork-divergence` job) and, informationally, in `upstream-sync.yml`.
-   **sonarcloud-drift.js**: compares the project's open SonarCloud issue count
    against `.sonarcloud-drift-baseline` and fails when growth exceeds the
    threshold. Self-seeds the baseline when it is missing and writes `count` /
    `baseline` / `seeded` to `$GITHUB_OUTPUT`. `--update-baseline` records the
    current count; `--max-growth-pct=<n>` overrides the 10% default. Runs weekly
    in `.github/workflows/fallow.yml`.
-   **security/check-lockfiles.js**: asserts no manifest in the repo pins a
    known-malicious or critically vulnerable version of the packages listed in
    the script. Runs in `ci.yml` (`lockfile-guard` job).

## Development harness

-   **dev/mock-ai-provider.js**: a dependency-free OpenAI-compatible mock
    provider (`node scripts/dev/mock-ai-provider.js`, default `:11435`) so the
    editor's BYOK / multi-agent path can be exercised end-to-end without
    credentials. It streams SSE, answers non-streamed requests, and emits
    `x-omniroute-*` telemetry headers. It sets permissive CORS **and**
    `Access-Control-Expose-Headers`, because a browser client cannot read
    custom response headers from a cross-origin endpoint without the latter —
    the same requirement applies to any real telemetry proxy. Point the editor's
    custom AI base URL at `http://localhost:11435/v1` to use it. Set
    `MOCK_SCRIPT=<file>` to serve a fixed sequence of turns (content and/or
    `toolCalls`) from a JSON array, one per request — see
    `dev/mock-script.example.json` (plan -> spawn_agent -> report) or
    `dev/mock-script-multi.json` (a 3-task plan with dependencies and three
    sequential spawns) — to drive a deterministic multi-step studio run offline.
    The script applies to PARENT requests only; a sub-agent request (its system
    prompt names a studio role) gets a plain reply, so the interleaved
    parent/child request order cannot consume the script out of sequence.
    Set `MOCK_CHILD_SCRIPTS=<file>` to script each SPECIALIST separately: a JSON
    object `{ "designer": [turns], "developer": [...], "tester": [...] }` keyed
    by the role named in the sub-agent's system prompt, consumed per role - see
    `dev/mock-child-scripts.example.json`. This lets a deterministic run script
    what each role does (e.g. a tool call) instead of one shared sequence.
    `dev/mock-script-specialists.json` pairs with it: a 2-task plan (design ->
    build) that spawns the designer then the developer; with a project open it
    drives a full per-role specialist run offline (verified end-to-end, cycle 236).

## Documentation and translations

-   **GenerateAllDocs.[bat|sh]**: Calls doxygen to generate all documentation into _docs_ folder.
-   **ExtractTranslations.[bat|sh]**: Creates the _source.pot_ file containing the strings to be translated using [Crowdin](https://crowdin.com/project/gdevelop).

## Upstream scripts removed in this fork

`ReleaseProcedure.bat`, `ReleaseProcedure.sh` and
`CopyWindowsToLinuxReleaseFiles.sh` are referenced by older upstream docs but do
not exist in this checkout — packaging happens through
`.github/workflows/build-release.yml` and `newIDE/electron-app`. Do not add them
back from an upstream sync.
