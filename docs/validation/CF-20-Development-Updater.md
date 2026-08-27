# CF-20 Development Updater

The development Desktop launcher is for Version 2.7 CF-20 acceptance testing only.

## One-time setup

From the repository checkout, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-FieldOpsDevelopmentUpdater.ps1
```

This creates or updates the `Deploy FieldOps Development` Desktop shortcut and places the BAT
bootstrap beside it. The shortcut does not replace the release updater or production release
process.

## Normal workflow

Double-click `Deploy FieldOps Development`, approve UAC, confirm the displayed branch and exact
SHA, and wait for `FIELDOPS DEVELOPMENT UPDATE VERIFIED`. The launcher resolves
`feature/2.7-connected-operations` to its current remote commit, then downloads and invokes the
existing exact-revision `UpdateDashboard.ps1` workflow. It verifies that `/api/version` reports
matching `sourceRevision` and `nativeRevision` for that same SHA.

Release updates continue through the published/tagged release process. The development launcher
must not be used as a release updater.

## Specific revision

To deploy a specifically validated commit, pass its full SHA to the Desktop BAT:

```text
UpdateDashboard.bat 20ec56a120d4f38f4e39dd9fc676dcbdbfcf5972
```

The launcher labels this source as `Explicit revision` and skips branch resolution. No PowerShell
or Git command is normally required after the one-time setup.