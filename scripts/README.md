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

## Documentation and translations

-   **GenerateAllDocs.[bat|sh]**: Calls doxygen to generate all documentation into _docs_ folder.
-   **ExtractTranslations.[bat|sh]**: Creates the _source.pot_ file containing the strings to be translated using [Crowdin](https://crowdin.com/project/gdevelop).

## Upstream scripts removed in this fork

`ReleaseProcedure.bat`, `ReleaseProcedure.sh` and
`CopyWindowsToLinuxReleaseFiles.sh` are referenced by older upstream docs but do
not exist in this checkout — packaging happens through
`.github/workflows/build-release.yml` and `newIDE/electron-app`. Do not add them
back from an upstream sync.
