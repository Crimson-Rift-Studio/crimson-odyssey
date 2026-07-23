# Crimson Odyssey v0.3.0 Verification Report

Date: 2026-07-23
Target repository: `aabrur/crimson-odyssey`
Target branch: `main`
Runtime: Node.js v22.16.0, npm 10.9.2

## Release status

The local release candidate passed source, package, onboarding, update, TUI layout, security, Loadout, provider, session, and mocked gateway verification.

Live Telegram, Discord, provider, and remote GitHub update checks were not executed in this build environment because external DNS resolution is unavailable. Credential-backed workflows and commands remain included without committing secrets.

## Automated verification

| Gate | Result |
|---|---|
| JavaScript syntax | PASS, 52 files |
| Automated tests | PASS, 55 passed, 0 failed, 0 skipped |
| Full CLI setup smoke | PASS |
| Setup without `.env` | PASS |
| Config schema 2 to 3 migration | PASS |
| Secure credential reference | PASS |
| Semantic update comparison | PASS |
| Update cache | PASS |
| Dirty Git tree protection | PASS |
| Startup update notice | PASS |
| No em dash policy | PASS |
| Secret pattern scan | PASS |
| Package dry-run | PASS |
| Local tarball installation | PASS |
| CLI version smoke | PASS, 0.3.0 |
| CLI status smoke | PASS |
| TUI size matrix | PASS, 80x24 through 200x60 |
| Loadout and selective context | PASS |
| Soul and Identity rollback | PASS |
| Encrypted vault round trip | PASS |
| Telegram and Discord mocks | PASS |
| Owner pairing and authorization | PASS |

## Commands executed

```bash
npm run check
npm test
npm pack --dry-run
npm pack
npm install --prefix <temporary-prefix> ./crimson-odyssey-0.3.0.tgz
<temporary-prefix>/node_modules/.bin/crimson --version
crimson setup --no-tui
crimson status --json
```

## Package evidence

- Package: `crimson-odyssey-0.3.0.tgz`
- Package contains the source, documentation, verification report, and build manifest
- Runtime dependencies: none
- The final SHA-256 is published with the generated artifact

## Update contract

- `notify` shows update availability without installation.
- `ask` requests confirmation before installation.
- `auto` installs only when update checks succeed and safety gates allow it.
- `off` disables update checks.
- Git updates require a clean working tree and use fast-forward-only pull.
- Workspace state under `.crimson/odyssey/` is not part of application updates.

## Known verification boundary

A real incoming Telegram message, Discord Gateway connection, live model reply, remote GitHub update, and tag-driven GitHub release require external network access. Unit and integration paths are verified locally, but live success must be confirmed on a networked user machine or GitHub Actions.
