# Build Notes

This fork (`Heretek-AI/GDevelop-Heretek`) has a few build conventions that
differ from upstream — they exist to keep Dependabot alerts from piling up
again and to avoid lockfile drift.

## Package manager: `npm` everywhere

Upstream's `newIDE/web-app/` previously shipped both `package-lock.json`
**and** `yarn.lock`. The duplicate lockfiles meant every dependency update
generated two stale advisories, and they drifted over time. This fork uses
`npm` for that package and **only** ships `package-lock.json`.

Rules:

1. CI must run `npm ci` (not `yarn install`) in `newIDE/web-app/`.
2. Local development in `newIDE/web-app/` should use `npm install` only.
3. Do not regenerate `yarn.lock` — `git diff` should show no such file.

If upstream re-introduces `yarn.lock` on a sync, delete it again in the
same PR. See Phase 3 of `SECRETS.md` and the original remediation plan
for the rationale.

## Other manifest quirks

- `newIDE/app/` has a non-trivial `overrides` block in `package.json` (in
  addition to the original `@pixi/*` overrides). The extra entries pin
  every transitive dep that has been a Dependabot alert target to a safe
  range. Don't remove these without re-running `scripts/security/check-lockfiles.js`.
- `GDJS/tests/` uses Karma 1.7.1 (very old). It runs but `npm install` will
  print EBADENGINE warnings. These are harmless and are not part of this
  fork's scope.

## Security guard

`scripts/security/check-lockfiles.js` asserts that no manifest pins a
known-malicious or critically-vulnerable version of the npm packages
listed in its `VULNERABLE_VERSIONS` / `VULNERABLE_RANGES` constants. Wire
this into CI:

```yaml
- name: Lockfile security guard
  run: node scripts/security/check-lockfiles.js
```

When adding a new advisory, edit the guard's constants and run it
locally before opening the PR — the CI job will fail loudly if the lockfile
isn't clean.
