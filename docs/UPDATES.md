# Update System

## Goal

Users should know when a new Crimson Odyssey build exists and should be able to install it without replacing workspace state, sessions, Soul, Identity, Loadouts, or credentials.

## Commands

```bash
crimson update status
crimson update check
crimson update apply
crimson update configure
```

`status` uses cached data when fresh. `check` forces a remote check. `apply` installs the available update. `configure` changes update mode and interval.

## Modes

- `notify`: show a notice and wait for the user
- `ask`: request approval before installation
- `auto`: install on interactive startup and request a restart
- `off`: do not check

The default interval is 24 hours.

## Git installation

A Git installation uses `git fetch`, semantic version and commit comparison, `git pull --ff-only`, `npm install`, and source verification. A dirty working tree blocks update. Crimson never resets or discards local changes.

## Global npm installation

A global installation uses:

```bash
npm install -g github:aabrur/crimson-odyssey#main
```

Private repository access requires GitHub authentication already configured for npm or Git.

## State protection

Project state lives in `.crimson/odyssey/` and is excluded from package updates. Global vault and cache data live under `~/.crimson`. The updater changes installed application files only.
