# Changelog

## 0.3.0 - Third Rift

### Added

- One-command full AI agent setup through `crimson setup`
- Language, Identity, Soul, provider, model, Loadout, security, retention, updates, and gateway onboarding
- Secure credential choices with keyring or encrypted vault recommended by default
- Starter Loadout profiles for Balanced, Builder, Creative, and Minimal workflows
- Setup completion and schema migration metadata
- Update status, check, apply, and configure commands
- Notify, ask, auto, and disabled update modes
- Git and global npm installation detection
- Cached remote update metadata and semantic version comparison
- Dirty Git working tree protection and fast-forward-only update application
- Update availability during interactive startup and through CLI commands
- Tag-driven GitHub package release workflow

### Changed

- `crimson setup` now runs the complete onboarding flow
- `crimson model` provides model-only reconfiguration
- Config schema upgraded from 2 to 3 without replacing existing user values
- Installers target `github:aabrur/crimson-odyssey#main`

### Verification

- 55 automated tests passed
- JavaScript syntax verification passed
- Package, secret scan, no-em-dash, setup, update, and TUI gates passed

## 0.2.0 - Second Rift

### Added

- Adaptive TUI with no outer top or left frame
- Scroll-preserving conversation history and fixed bottom composer
- Responsive, independently scrollable right sidebar
- Shared provider-first model selection
- Project-local Soul, Identity, Heartbeat, Agent, Memory, Session, and Workspace state
- Loadout engine and owner-only Telegram and Discord gateways
