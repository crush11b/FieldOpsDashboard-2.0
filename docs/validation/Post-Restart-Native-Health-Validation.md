# Post-Restart Native-Health Validation

## Root cause and correction

The native-health server correctly rebuilds a new Named Pipe and ACL whenever `FieldOpsAgent` starts. The deployed MVP installer did not provision the supported operator group or persist `Agent__NativeHealth__OperatorSid` in the service-specific SCM environment. Consequently, a replacement service process could start without the operator SID and correctly fail closed to LocalService and Administrators. The elevated restart helper could still pass the separate protected HTTP health check, while the unelevated tray received `Access denied` from the replacement pipe.

Installation and upgrade now require the supported operator account explicitly. The deployment creates or safely adopts the local `FieldOps Operators` group, enrolls that account, records product ownership in the protected agent data directory, and persists the resolved group SID in the service-specific SCM environment before starting the service. The service therefore reconstructs the same narrow pipe ACL after every ordinary restart. Uninstall removes only configuration, membership, and group state proven to be product-owned.

The native-health client remains per-request and holds no reusable connection or authorization state. The restart helper remains a separate elevated process and checks the protected loopback HTTP health endpoint; the tray never reads the bearer credential. Native-health authorization continues to deny unprovisioned users and does not grant `Everyone` or built-in `Users`.

## Automated validation

Regression coverage verifies explicit operator selection, local user SID resolution, idempotent group enrollment, persisted service-environment configuration, ACL reconstruction from the configured group SID, fail-closed invalid configuration, no broad ACL identities, safe ownership-aware rollback/uninstall, fresh native-health connections, truthful refresh states, and restart/shutdown cancellation behavior.

## ToughBook acceptance result

Validated on the primary ToughBook using the normal local operator account `stick`.

- The corrected installer completed successfully.
- The machine was rebooted to refresh local-group membership.
- Initial status was `FieldOpsAgent: Running` and tray native health `Healthy`.
- The tray's **Restart Service** action completed successfully.
- After restart, the tray returned to `Running` / `Healthy` without relaunch.
- The persistent post-restart `Access Denied` condition did not recur.

## Windows-specific defects corrected during validation

- GitHub ZIP extraction failure in the PowerShell updater; replaced with `.tar.gz` and `tar.exe`.
- Updater working-directory lock during rollback; rollback now leaves the installation tree first.
- Installer ACL application/validation mismatch; directory and file rights now match validation.
- Windows PowerShell 5.1 incompatibility from inline conditional syntax; calculation was refactored.
- Unsupported `FileSystemRights::None`; replaced with the zero-valued enum cast.

This records single-operator hardware acceptance only; it does not claim broad installer hardening or multi-user validation.

<!-- Historical validation procedure retained below for reference. -->

Run this only on the primary supported ToughBook after code review:

1. From an elevated PowerShell session, deploy or upgrade with `UpdateDashboard.ps1 -OperatorAccount '.\<normal-operator-name>'`.
2. Confirm `FieldOpsAgent` runs as `NT AUTHORITY\LocalService`, has automatic startup, and its service registry `Environment` value contains exactly one `Agent__NativeHealth__OperatorSid=<FieldOps Operators SID>` entry without removing unrelated entries.
3. Confirm the named account is a member of local `FieldOps Operators`. If membership was newly added, sign out and sign back in as that normal operator; do not run the tray elevated.
4. Launch the installed tray and wait for `Service: Running` and `Health: Healthy`.
5. Choose **Restart FieldOps Agent**, approve UAC, and confirm the success dialog appears only after the replacement service's authenticated HTTP health endpoint is ready.
6. Keep the tray open through at least two background refresh intervals. Confirm it returns to and remains `Service: Running` and `Health: Healthy`; it must not display `Access denied` or claim healthy during `StartPending`/`StopPending`.
7. Restart the service once more from an elevated console, without restarting the tray, and repeat the two-interval observation.
8. Sign in with an unprovisioned local test account only if one is already available for this validation. Confirm native health reports `Access denied`; do not broaden the ACL. This is a negative check, not alternate-user support.
9. Verify the normal operator cannot read `%ProgramData%\FieldOpsDashboard\Agent\health-token.dat`, while the elevated restart helper still succeeds. Confirm no bearer credential appears in tray files, process arguments, environment, logs, or diagnostics.
10. Exit the tray during a refresh or restart transition and confirm the tray closes cleanly while `FieldOpsAgent` remains running.

Record Windows build, operator SID, operator-group SID, service start time before and after restart, tray observations, and any Event Log warnings. This procedure is required manual evidence; automated results do not constitute ToughBook validation.
