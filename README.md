# Crimson Odyssey

**Equip your agent. Enter the rift.**

Crimson Odyssey is a multilingual, loadout-driven terminal AI agent by Crimson Rift Studio. Version 0.3.0 adds one-command onboarding and a secure update lifecycle so normal users do not need to edit `.env`, JSON, or YAML by hand.

## Requirements

- Node.js 22 or newer
- An ANSI-capable terminal
- A provider API key, or a local Ollama or LM Studio server

## Install

### Git clone

```bash
git clone https://github.com/aabrur/crimson-odyssey.git
cd crimson-odyssey
npm link
crimson setup
```

### npm from GitHub

```bash
npm install -g github:aabrur/crimson-odyssey#main
crimson setup
```

### Windows PowerShell

```powershell
git clone https://github.com/aabrur/crimson-odyssey.git
cd crimson-odyssey
Set-ExecutionPolicy -Scope Process Bypass
.\install.ps1
crimson setup
```

## One-command full setup

Run:

```bash
crimson setup
```

The wizard configures language behavior, Identity, Soul, provider, model, secure credential storage, starter Loadout, security profile, history retention, update behavior, and optional Telegram or Discord gateways. It writes project-local state automatically and can open the TUI when setup finishes.

Normal users do not need a `.env` file. Credentials are stored in an operating-system keyring when supported, with an AES-256-GCM encrypted vault fallback. Workspace files contain credential references only.

Use this to change only the active model later:

```bash
crimson model
```

## Updates

Crimson can check for updates on interactive startup, show a notice before the TUI opens, and provide dedicated CLI update commands.

```bash
crimson update status
crimson update check
crimson update apply
crimson update configure
```

Update modes:

- `notify`: show availability and let the user decide
- `ask`: request approval before applying
- `auto`: apply during interactive startup when safe, then request restart
- `off`: disable update checks

Git updates use fast-forward-only pull and refuse to run when the working tree is dirty. Application updates do not overwrite `.crimson/odyssey/` workspace state.

## Quick start

```bash
crimson doctor
crimson
```

In a wide terminal, the adaptive TUI displays an independently scrollable right sidebar. `Ctrl+B` toggles it. The transcript and sidebar scroll independently while the composer stays fixed at the bottom.

Useful commands:

```text
/model       Select provider and model
/loadout     Manage equipped skills
/session     Switch or create a session
/update      Check update status
/help        Show commands
/exit        Close Crimson
```

## Project-local state

Crimson initializes:

```text
.crimson/odyssey/
  soul.yaml
  identity.yaml
  heartbeat.json
  agent.yaml
  workspace.yaml
  config.json
  model.json
  memory/
  sessions/
  histories/
  loadouts/
  skills/
  gateways/
  logs/
  cache/
  state/
  revisions/
```

This directory is ignored by Git. Soul and Identity edits have revision history and rollback.

## Loadout

The default slot contract is:

- 1 Weapon
- 1 Armor
- 2 Accessories
- 2 Magic

The first turn loads the full equipped Loadout. Later turns inject only relevant context. External skills can be installed from `SKILL.md` or `skill.json`.

## Gateways

Telegram and Discord are owner-only. Setup stores bot tokens securely and writes only secret references into gateway configuration. The owner must complete an expiring `/bind CODE` challenge before remote messages are accepted.

```bash
crimson gateway list
crimson gateway doctor telegram
crimson gateway start telegram
```

## Verification

```bash
npm run verify
crimson doctor --json
```

The v0.3.0 local release candidate passed 55 automated tests, syntax verification, secret scanning, no-em-dash enforcement, package dry-run, local package installation, setup tests, TUI layout tests, and mocked gateway verification.

Live provider, gateway, and remote GitHub update success remains environment-dependent and must be proved on a machine with credentials and external network access.

See `docs/SETUP.md`, `docs/UPDATES.md`, and `VERIFICATION_REPORT.md` for the complete contract.
