# Tray Companion Field-Validation Results

## Record status

- Task: 2.3-03 Tray Companion
- Scope: ADR-003 disposable prototype field validation
- Branch: `feature/2.3-03-tray-field-validation`
- Starting commit: `1e79ccf3a35ab26c083280bc58673618baef753a`
- Overall classification: **DEV-01 safely runnable slice complete; Task 2.3-03 remains incomplete**
- Validation owner: Chris
- Review date: 2026-07-29

This record must not contain passwords, bearer tokens, health-credential contents, personal account details, operational coordinates, or unnecessarily sensitive machine paths. Reference only sanitized evidence.

## Machine inventory

| Machine ID | Hardware/model | Windows edition/build | Architecture | Scale/resolution | Touch | Identity type | Field role | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEV-01 | Development desktop; firmware reports generic manufacturer/model | Windows registry reports Windows 10 Home 25H2, build 26200.8973 | AMD64 | Scale pending; 3840x1080 | Pending | Interactive validation: unelevated administrator with filtered token; automated rows retain their originally recorded identity | Development Windows | `FieldOpsAgent` was installed and `Running` for interactive service-control validation. It was absent during the earlier packaging baseline. Windows edition label requires physical confirmation because the reported build is newer than the product-name string. |
| TB-01 | Pending | Pending | Pending | Pending | Pending | Pending | ToughBook | |
| TP-01 | Pending/Unavailable | Pending | Pending | Pending | Pending | Pending | ToughPad | |

Use stable non-sensitive machine IDs in all test rows.

## DEV-01 closure

The DEV-01 slice is complete for every case that could be run safely without creating identities, changing Windows security policy, uninstalling the service, manufacturing service/health failures, enabling network access, or substituting unavailable field hardware.

- `PASS`: 12
- `FAIL`: 1
- `BLOCK`: 1
- `NOT RUN`: 12

The known failure is TRAY-003 repeated launch: the disposable prototype permits multiple concurrent tray instances. ADR-003 explicitly defers single-instance behavior, so this is a production implementation requirement rather than an architecture change or a field-validation patch.

UAC-005 is `BLOCK` because DEV-01 has no existing genuine standard-user validation identity. A filtered administrator token, even when `net session` returns access denied, is not valid standard-user evidence. No account, group membership, SCM permission, or security policy was changed.

The remaining `NOT RUN` cases require a service-free machine, approved failure/delay fixtures, additional existing identities or sessions, an existing RDP/network peer, built-in-identity test infrastructure, or representative ToughBook/ToughPad hardware. Optional physical abandoned-owner validation is also deferred because deterministic automated coverage already passes.

Task 2.3-03 is not complete under the authoritative planning sources. The Development Roadmap requires the Tray Companion to show authenticated health and recover a stopped or unhealthy service. The Engineering Backlog explicitly classifies 2.3-03 as partially implemented and retains native health-client provisioning, real multi-identity ACL validation, production UI, packaging, startup, and hardware validation as active or incomplete gates. DEV-01 closure does not waive those acceptance criteria.

## Results

Allowed outcome values: `PASS`, `FAIL`, `BLOCK`, `NOT RUN`.

| Test ID | Machine | Windows build | Identity | Setup | Expected result | Actual result | Outcome | Evidence reference | Notes | Follow-up required |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AUTO-001 | DEV-01 | 26200.8973 | Standard user | Locked restore, Release build, complete solution tests | 138 tests pass | Restore/build passed with zero warnings/errors; 88 agent and 50 tray/helper tests passed | PASS | Codex console run, 2026-07-29 | No telemetry-test flake occurred | None |
| AUTO-002 | DEV-01 | 26200.8973 | Standard user | Windows integration category | 12 tests pass | 12 passed | PASS | Codex console run, 2026-07-29 | | Repeat under field identities |
| AUTO-003 | DEV-01 | 26200.8973 | Standard user | Restart/helper selection | Selected tests pass | 27 passed, including real executable exit 19, mutex, typed restart, and path tests | PASS | Codex console run, 2026-07-29 | | Cross-session physical evidence pending |
| AUTO-004 | DEV-01 | 26200.8973 | Standard user | ACL policy selection | Narrow ACL tests pass | 11 passed | PASS | Codex console run, 2026-07-29 | | Real identity matrix pending |
| AUTO-005 | DEV-01 | 26200.8973 | Standard user | Repository audit | No production registration | `git diff --check` passed; no prototype references in production agent/install/update paths | PASS | Codex console run, 2026-07-29 | Documentation changes remain uncommitted by instruction | None |
| UAC-001 | DEV-01 | 26200.8973 | Standard user; non-elevated PowerShell | Cancel UAC | Cancellation reported; no restart | Launched tray from non-elevated PowerShell; UAC consent appeared; selected **No**; tray reported **Windows elevation was canceled**; `FieldOpsAgent` did not restart | PASS | Operator observation, 2026-07-29 | No unexpected behavior observed | None |
| UAC-002 | DEV-01 | 26200.8973 | Unelevated administrator; member of `BUILTIN\Administrators`; non-elevated PowerShell token | Healthy installed service; tray launched from `C:\FieldOpsValidation\FieldOps.TrayPrototype.exe` | Exit 0 after healthy restart | UAC consent appeared and was accepted; tray reported **FieldOps Agent restarted and authenticated health passed.**; restart and authenticated health succeeded | PASS | Operator observation, 2026-07-29 | Two live tray instances were confirmed separately under TRAY-003; the restart and health result remained correct | None |
| UAC-003 | DEV-01 | 26200.8973 | Unelevated administrator; non-elevated PowerShell token | Helper at `C:\FieldOpsValidation\FieldOps.ServiceControlPrototype.exe` invoked with `unexpectedArgument` | Exit 19; no UAC; no service operation | `net session` returned system error 5 / access denied; helper exited 19; `FieldOpsAgent` remained `Running`; no UAC prompt, service transition, or surviving helper process | PASS | Operator observation, 2026-07-29 | Prior duplicate tray processes were fully cleaned up | None |
| UAC-004 | Pending | Pending | Elevated administrator PowerShell | Service missing | Exit 11 | Not run | NOT RUN | | Record that the shell was elevated | |
| UAC-005 | DEV-01 | 26200.8973 | Unelevated administrator; filtered token | Existing genuine standard-user account required; do not create users or alter membership/SCM policy | Standard-user helper invocation is denied with exit 10 and no service transition, or BLOCK when no suitable identity exists | BLOCKED: `whoami /groups` showed `BUILTIN\Administrators` as **Group used for deny only**, proving a filtered administrator token rather than genuine standard-user membership; `net session` returned system error 5 / access denied but was not treated as sufficient identity proof | BLOCK | Operator identity checks, 2026-07-29 | No account was created; no group membership, SCM permission, or security policy was changed | Run on an approved machine or existing account with a genuine standard-user token |
| FAIL-001 | Pending | Pending | Administrator | Approved unhealthy/unavailable fixture | Exit 15 or 16 | Not run | NOT RUN | | | |
| FAIL-002 | Pending | Pending | Administrator | Approved failure fixture | Exit 20/13/12/14, bounded | Not run | NOT RUN | | | |
| MUTEX-001 | DEV-01 | 26200.8973 | Elevated administrator; same Windows session | Baseline service `Running` with zero helpers; launch two fixed helpers back-to-back; retain both process results; verify later reacquisition | One owner completes normally, overlapping helper exits 17, service finishes `Running`, no helper remains, and later invocation reacquires the mutex | PID 17104 ran 17:44:48–17:44:50 and exited 0; overlapping PID 4084 started and ended at 17:44:48 and exited 17; both completed; final service was `Running`; `HelperLive=False`; earlier post-overlap invocation exited 0 and confirmed reacquisition | PASS | Operator automated process capture, 2026-07-29 | Same-session exclusion, typed restart-in-progress result, normal release, and later reacquisition confirmed | Cross-session behavior remains MUTEX-002/MUTEX-003 scope |
| MUTEX-002 | Pending | Pending | Two local sessions | Console + switched user | One owner; other exit 17 | Not run | NOT RUN | | | |
| MUTEX-003 | Pending | Pending | Console + RDP | Existing RDP availability | One owner; other exit 17 | Not run | NOT RUN | | | |
| MUTEX-004 | Pending | Pending | Administrator | Approved abandoned-owner fixture | Next invocation recovers | Not run | NOT RUN | | | |
| ACL-001 | Pending | Pending | Multiple real users | Temporary validation group/users | Narrow identity behavior | Not run | NOT RUN | | | |
| ACL-002 | Pending | Pending | LocalService/LocalSystem | Temporary scheduled tasks | Intended access | Not run | NOT RUN | | | |
| ACL-003 | Pending | Pending | Network origin | Existing second machine | No remote/anonymous access | Not run | NOT RUN | | | |
| TRAY-001 | DEV-01 | 26200.8973 | Unelevated administrator; non-elevated PowerShell token | Installed and running service; launch one tray instance; inspect initial state and select **Refresh** without restart | Accurate SCM state; honest read-only health; no elevation or service transition | Initial and refreshed text both showed **Service: Running** and **Health: Unavailable**; service remained `Running`; no UAC or helper; tray exited cleanly and no tray/helper process survived | PASS | Operator observation and process check, 2026-07-29 | Read-only health honestly remained unavailable because the unelevated token could not use the protected health credential | None |
| TRAY-002 | DEV-01 | 26200.8973 | Unelevated administrator; non-elevated PowerShell token | Tray and co-located helper existed; launched tray from `%TEMP%` with `PATH=C:\Windows\System32` and misleading `FIELDOPS_HELPER_PATH=C:\FieldOpsValidation\must-not-run.exe` | UAC identifies only the fixed helper beside the tray; cancellation causes no restart | UAC identified `C:\FieldOpsValidation\FieldOps.ServiceControlPrototype.exe`; selected **No**; tray reported **Windows elevation was canceled.**; `FieldOpsAgent` remained `Running`; no restart or surviving helper; tray PID 6464 exited cleanly | PASS | Operator observation and process check, 2026-07-29 | Working directory, `PATH`, and misleading environment variable did not redirect helper selection | None |
| TRAY-003 | DEV-01 | 26200.8973 | Unelevated administrator; member of `BUILTIN\Administrators`; non-elevated PowerShell token | Repeated launch, Explorer notification-area recovery, and clean exit | Repeated launch must not leave two usable production tray instances; a live tray should recover its icon after Explorer restart and exit cleanly | **Repeated launch FAIL:** two concurrent live and responding processes used `C:\FieldOpsValidation\FieldOps.TrayPrototype.exe`, with two visible icons: PID 8228 started 2026-07-29 16:51:10 and PID 14412 started 2026-07-29 16:59:32. **Explorer recovery PASS:** the tray survived Explorer restart, exactly one icon automatically returned, the menu remained usable, Refresh showed **Service: Running** and **Health: Unavailable**, no helper started, Exit terminated the tray, and final checks found no tray/helper process | FAIL | Operator process snapshots and interactive observation, 2026-07-29 | Overall outcome remains FAIL because the disposable prototype permits concurrent instances; Explorer notification-area recovery and clean exit passed. Manually starting `explorer.exe` opened an Explorer window; recorded as shell-launch behavior, not a prototype failure | Production implementation must define and test per-user/session single-instance ownership; no Explorer-recovery correction required |
| HW-001 | DEV-01/TB-01/TP-01 | Pending | Intended operator | DPI/touch matrix | Readable and usable | Not run | NOT RUN | | | |
| HW-002 | DEV-01/TB-01/TP-01 | Pending | Intended operator | Sleep/lid/network/service | Honest recovery | Not run | NOT RUN | | | |
| HW-003 | DEV-01 | 26200.8973 | Unelevated administrator; non-elevated PowerShell token | Five-minute idle-resource slice with one tray instance; do not select Restart | Responsive tray, stable idle CPU/memory, honest read-only state, no helper/UAC/duplication, clean exit | PID 16412 sampled for 300.42 seconds: working set 41.20 to 40.94 MB (-0.26 MB); private memory 9.13 to 9.05 MB (-0.08 MB); processor time remained 0.3125 seconds (delta 0); responding throughout; one icon; Refresh showed **Service: Running** and **Health: Unavailable**; no UAC/helper/crash/duplicate; service remained `Running`; cleanup left zero tray/helper processes | PASS | Operator measurements and observation, 2026-07-29 | Runnable DEV-01 idle slice passed | Repeat idle measurements on representative field hardware when available |
| HW-003 | Pending approved fixture | Pending | Approved validation identity | Slow-health slice only | Five-second HTTP bound produces honest unavailable result rather than success | Not run; no approved delay fixture was used | NOT RUN | | Slow-health behavior was intentionally not manufactured on DEV-01 | Requires an approved disposable delay fixture that preserves the fixed endpoint and credential boundary |

Add rows when the same test is run on multiple machines or identities. Do not overwrite earlier failures with later passes. For every `UAC-*` result, record the launch context as one of **standard user**, **unelevated administrator**, or **elevated administrator**, together with whether the tray or helper was started from Explorer, PowerShell, or another host. An elevated-administrator launch suppresses the consent prompt and does not provide valid consent-prompt coverage for UAC-001 or UAC-002.

## Stop-condition review

| Stop condition | Observed? | Evidence | Decision |
| --- | --- | --- | --- |
| Cross-session mutex failure | Pending | | |
| Broader-than-intended ACL access | Pending | | |
| Unauthorized helper execution | Pending | | |
| Unexpected helper substitution risk | Pending | | |
| UAC inconsistent with ADR-003 | Pending | | |
| Unreliable SCM state | Pending | | |
| Health credential exposure | Pending | | |
| Health/restart authorization confusion | Pending | | |
| Unacceptable ToughBook/ToughPad behavior | Pending | | |

## Sanitized evidence index

| Evidence ID | Test ID | Description | Sanitized location | Sanitization reviewed by |
| --- | --- | --- | --- | --- |
| Pending | | | | |

## Follow-up decisions

- Production native health gateway: Pending validation.
- Production operator-group provisioning: Pending validation and installer review.
- Cross-session coordination: Pending physical evidence.
- UAC and SCM behavior: Pending physical evidence.
- ToughBook/ToughPad acceptance: Pending hardware evidence.
- Production packaging, startup, signing, and update integrity: Deferred.

## Final classification

Select one only after all required results and stop conditions are reviewed:

- [ ] Field validation passed
- [ ] Field validation passed with production follow-up
- [ ] Architecture revision required
- [ ] Validation blocked

Rationale: Pending.

Task 2.3-03 remains incomplete regardless of this record until separately authorized production work is implemented and accepted.
