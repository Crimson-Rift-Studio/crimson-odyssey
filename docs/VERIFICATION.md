# Verification Contract

A release candidate is accepted only when all of the following pass:

1. JavaScript syntax validation for every source, test, and CLI module
2. Automated unit and integration tests
3. No em dash character in repository text
4. No raw credential fixture or runtime secret in the package
5. Package dry-run contains only intended source and documentation
6. CLI version, help, status, doctor, setup, and update smoke tests
7. Full setup writes complete state without creating `.env`
8. Secure setup stores credentials by reference only
9. Schema migration preserves existing user configuration
10. Update check caching and semantic version comparison
11. Git update dirty-worktree protection
12. TUI layout tests at narrow, medium, and wide terminal sizes
13. Transcript and sidebar scroll tests
14. Update availability rendering during interactive startup
15. Loadout slot limit, external skill, and selective context tests
16. Provider catalog and custom model tests
17. Secret vault encryption and log redaction tests
18. Telegram and Discord authorization and pairing tests
19. Local tarball installation and CLI execution
20. GitHub Actions on Linux, Windows, and macOS

Live provider, gateway, and remote update checks remain environment-dependent. They require valid credentials, repository access, and external network connectivity.
