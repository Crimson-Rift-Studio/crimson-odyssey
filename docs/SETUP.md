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
5. Keep or replace an existing credential, or enter the required API key directly.
6. Select a live, cached, suggested, current, or exact model ID.
7. Select a starter Loadout.
8. Select a security profile.
9. Select history retention.
10. Select update behavior.
11. Optionally configure Telegram, Discord, or both.
12. Run doctor verification.
13. Optionally enter the TUI immediately.

Use `crimson setup --auto` to resolve and verify installed Codex, Claude Code, Gemini, Command Code, OpenCode, Kilo, Cline, Aider, and Ollama commands. CLI bridges store the resolved executable path and use the official non-interactive command without reading another agent's private authentication files.

Secret prompts accept normal Windows Terminal, PowerShell, and right-click paste. Received characters are shown only as mask characters.

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
