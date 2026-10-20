# Grain-Nest

Notes for Claude sessions working in this repository.

## GitHub Actions

Actions storage is shared across all of this account's repositories and the
free allowance is small (0.5 GB-months), so every workflow follows these rules:

- Upload artifacts (screenshots, test reports, logs) only when a step fails,
  with `if: failure()` and `retention-days: 5` or less. A green run stores
  nothing.
- Never keep a build (app, dmg, zip) as an artifact for more than two days.
  Anything meant to be downloaded goes on a GitHub release instead, which
  does not count against storage.
- Run tests once per commit: `pull_request` for branches, `push` only for
  `main`. Not `push` on every branch.
- Mac runners cost ten minutes for every real minute, so use `macos-*` only
  for builds that need a Mac, never for routine tests.
- Keep the `Tidy artifacts` workflow (`.github/workflows/tidy.yml`), which
  clears every stored artifact by hand from the Actions tab.
