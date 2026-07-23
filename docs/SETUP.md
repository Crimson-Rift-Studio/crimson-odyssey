# Full Setup Wizard

## Goal

A new user should install Crimson Odyssey, run one command, answer clear questions, and receive a usable AI agent without manually editing `.env`, JSON, YAML, or gateway files.

```bash
crimson setup
```

## Wizard flow

1. Select language behavior.
2. Keep or customize Identity.
3. Keep or customize Soul.
4. Select a provider.
5. Select secure credential storage, an existing environment variable, or skip.
6. Select a live or suggested model, or enter an exact model ID.
7. Select a starter Loadout.
8. Select a security profile.
9. Select history retention.
10. Select update behavior.
11. Optionally configure Telegram, Discord, or both.
12. Run doctor verification.
13. Optionally enter the TUI immediately.

## Files updated

The wizard updates the active workspace only:

- `.crimson/odyssey/config.json`
- `.crimson/odyssey/model.json`
- `.crimson/odyssey/identity.yaml`
- `.crimson/odyssey/soul.yaml`
- `.crimson/odyssey/agent.yaml`
- `.crimson/odyssey/workspace.yaml`
- `.crimson/odyssey/loadouts/default.json`
- `.crimson/odyssey/gateways/*.json`, when configured

Credentials are not stored in those files. Only secure references are stored.

## Reconfiguration

```bash
crimson setup
crimson model
crimson gateway add telegram
crimson gateway add discord
```
