# Secrets Required at Runtime

This fork (`Heretek-AI/GDevelop-Heretek`) does **not** ship the Firebase Web
API key (or any other secret) in source. The keys that previously lived in
the repo were publicly-leaked Google API keys owned by the upstream project
[`4ian/GDevelop`](https://github.com/4ian/GDevelop); they were replaced with
clearly-marked placeholders to stop further leaks from this branch.

This file lists the environment variables that operators, CI, and end-user
installers must supply. **No value lives in this file** — see the upstream
project for where to obtain each key.

## Required for the web/IDE build (`newIDE/app`)

| Env var | Where it is read | Owner |
|---|---|---|
| `GD_FIREBASE_API_KEY` | `newIDE/app/src/Utils/GDevelopServices/ApiConfigs.js` (`GDevelopFirebaseConfig.apiKey`) | Upstream (`4ian/GDevelop`) |

If `GD_FIREBASE_API_KEY` is unset, the app falls back to a string beginning
with `AIzaSyDUMMY…`, which will not authenticate against Firebase. Build
failures and sign-in errors when this happens are expected.

## Required for the Firebase extension end-to-end test

| Env var | Where it is read | Owner |
|---|---|---|
| `GD_TEST_FIREBASE_API_KEY` | `Extensions/Firebase/tests/FirebaseExtension.spec.js` | Test project (`gdtest-e11a5`) |

The Firebase extension test only runs when `navigator.onLine` is true and
uses a real Firebase project. Set `GD_TEST_FIREBASE_API_KEY` if you want
this test to actually exercise Firebase; without it, the test will fail
when it tries to authenticate against the dummy placeholder.

## How operators should set these

```bash
# Local development — copy the tracked template and edit
cp .env.example .env.local
# fill in the keys in .env.local (do not commit .env.local — see .gitignore)

# CI — set them as repository or organization secrets and inject via your
# CI job's "env:" block, never inline in workflow YAML.
```

## Reporting new leaks

If you find a secret in this branch that should not be there, open a PR
replacing it with a clearly-marked placeholder (`AIzaSyDUMMY…` for Google
keys, `ghp_DUMMY…` for GitHub PATs, etc.) and add the corresponding env
var to this table. Do **not** rewrite git history for keys that aren't
yours — flag the original owner instead.
