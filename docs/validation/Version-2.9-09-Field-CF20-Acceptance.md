# Version 2.9-09 Field and CF-20 Acceptance

- Date: **2026-09-13**
- Baseline: `4254be395c2aff3873c921c4dba98f8655409460`
- Target/source/native revision: `3ff84c5d9d13b6dc230fa81c4ab0ff8d35b15a2a`
- Corrective updater commit: `4254be395c2aff3873c921c4dba98f8655409460`
- Status: **PASSED; V2.9-09 complete; V2.9.0 release candidate**

## Initial failure and rollback

The initial running-Dashboard update attempt failed while the installed Dashboard was launched from the documented `C:\FieldOpsDashboard\start.bat` as `node dist/server.cjs`. The updater did not recognize the legacy relative Node command as the running Dashboard, and `Move-Item` failed because `C:\FieldOpsDashboard` remained in use. Rollback succeeded for the Agent, Tray, and V2.8 revision, but the Dashboard remained stopped.

The root cause was process ordering: launcher-wrapper cleanup preceded runtime shutdown. Removing the `cmd.exe` wrapper first allowed the legacy relative `node dist/server.cjs` process to survive and prevented runtime shutdown from verifying and stopping the owned Dashboard child.

## Corrective change

PR #72 corrected the updater and was merged as commit `4254be395c2aff3873c921c4dba98f8655409460`. Runtime shutdown now discovers and stops the owned Dashboard process before launcher-wrapper cleanup, while retaining process ownership checks and child-before-wrapper shutdown behavior.

## Corrected live updater evidence

- The corrected updater succeeded while the Dashboard was running.
- Target/source/native revision: `3ff84c5d9d13b6dc230fa81c4ab0ff8d35b15a2a`.
- Source/native revision parity: matched.
- The Dashboard restarted and reported `RUNNING`.
- Configuration SHA-256 remained `E2B0B54B2F34BB746F8FFE59492532C818C989AEF861B09ACCE6B74F09B060B9`.

## Post-reboot verification

- Dashboard responded on port `3000`.
- Source/native parity passed.
- Runtime bundle SHA-256: `91ed7449ff1047fe67494b8e0d1728c8afab2e39634989e57dc7377cdd912537`.
- Configuration API responded.
- App Catalog records: `40`.
- Tombstones: `0`.
- Agent: `Running/Auto`.
- Tray process count: `1`.

These results close the supported update-path, restart and rollback, persisted App Catalog/configuration, and CF-20 field-acceptance evidence for V2.9-09. The V2.9.0 release-candidate closure is recorded separately; publication remains a separately authorized action.

## Focused validation

- Focused updater tests: `70/70` passed.
- The broader automated integration evidence is recorded in [Version 2.9-09 Automated Integration Gate](Version-2.9-09-Automated-Integration-Gate.md).

## Remaining release gate

The remaining V2.9 gate is final release closure: approved release metadata, version/tag decisions, release notes, and release authorization must be recorded separately. V2.9 remains unreleased until that closure is explicitly accepted.
