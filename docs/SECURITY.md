# Security

## Credentials

Normal users do not need to create `.env`. The setup wizard stores API keys and bot tokens in the operating-system keyring when a supported command is available:

- macOS Keychain through `security`
- Linux Secret Service through `secret-tool`

When a keyring is unavailable, Crimson uses an AES-256-GCM encrypted local vault under `~/.crimson`. Windows uses this encrypted vault fallback unless a future Windows Credential Manager backend is installed.

Workspace configuration contains only references such as `keyring:openai-api-key`, `vault:telegram-bot-token`, or `env:OPENAI_API_KEY`.

## Update safety

The updater never edits `.crimson/odyssey/` workspace state. Git updates require a clean working tree and use fast-forward-only pull. Crimson does not reset, stash, or discard user changes.

Global package updates require existing GitHub authentication when the repository is private.

## Logs

The logger removes common API key, Discord token, and Telegram bot token patterns before writing JSONL logs.

Do not paste credentials into prompts. Revoke any credential that has been shared in an untrusted channel.

## Remote access

Telegram and Discord are owner-only. A correct UID alone is not enough. The configured owner must complete an expiring `/bind CODE` challenge.

## Terminal safety

Model and remote message text is sanitized before TUI rendering. OSC, DCS, CSI, and control bytes are removed to prevent terminal control injection.

Interactive secret prompts process pasted input as stdin chunks, show only mask characters, and never print the entered secret.

## Workspace safety

Runtime state is stored inside the active workspace, but credentials remain outside the workspace. `.crimson/` is ignored by Git.
