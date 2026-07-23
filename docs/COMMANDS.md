# Command Reference

## Core

```text
crimson
crimson setup [--auto] [--no-tui]
crimson model
crimson doctor [--json] [--live]
crimson fix
crimson status [--json]
crimson run <prompt>
crimson models [provider] [--refresh]
```

## Updates

```text
crimson update status [--json]
crimson update check [--json]
crimson update apply [--json]
crimson update configure
```

## Loadout

```text
crimson loadout list
crimson loadout preview
crimson loadout install <directory>
crimson loadout validate [skill-id]
crimson loadout equip <skill-id> <slot>
crimson loadout unequip <skill-id> <slot>
```

## Gateways

```text
crimson gateway add <telegram|discord>
crimson gateway list
crimson gateway doctor <id>
crimson gateway bind <id>
crimson gateway start <id>
```
