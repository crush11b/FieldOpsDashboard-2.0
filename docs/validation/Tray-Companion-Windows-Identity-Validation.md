# Tray Companion Windows Field-Validation Checklist

## Purpose and boundary

This is the executable checklist for the Task 2.3-03 disposable Tray Companion prototype selected by ADR-003. It validates Windows identity, ACL, UAC, cross-session coordination, service-control results, tray behavior, and representative hardware. It does not authorize production Tray Companion work.

Do not use this checklist to:

- install or register the tray for startup;
- create the production `FieldOps Operators` group;
- register a production health pipe;
- broaden the health-credential ACL;
- change service or SCM permissions;
- activate telemetry;
- modify installers, updater, uninstaller, packaging, or product metadata.

Run account, service-failure, and process-termination tests only on an approved disposable VM or field-validation machine. Never manufacture a failure on an operational field unit. Record every result in `Tray-Companion-Field-Validation-Results.md`.

## Plain-language glossary

- **Standard user:** a Windows account that is not currently running with administrator privileges.
- **Administrator:** an account allowed to approve a Windows elevation prompt.
- **UAC prompt:** the Windows dialog asking whether an application may make administrator-level changes.
- **SCM:** Windows Service Control Manager, which owns Windows service state and permissions.
- **SID:** Windows' internal identifier for a user, group, or built-in identity.
- **ACL:** the allow/deny list attached to a Windows resource.
- **Console session:** the user signed in directly at the physical screen.
- **RDP session:** a separate Remote Desktop sign-in.
- **Fast User Switching:** leaving one user signed in while switching to another local account.
- **BLOCK:** the test could not be run safely or required unavailable equipment. A blocked result is not a pass.

## Safety stop conditions

Stop this increment and report the evidence before changing code if any test shows:

- overlapping service stop/start operations across sessions;
- access broader than the documented ACL;
- helper execution against a caller-selected target;
- unexpected helper substitution beyond the already documented writable-directory prototype limitation;
- UAC behavior inconsistent with ADR-003;
- inaccurate SCM state;
- health credential exposure or broadened credential access;
- restart authorization depending on a health credential;
- unacceptable ToughBook/ToughPad usability or resource behavior.

## Validation package and evidence layout

Use a disposable repository copy with no secrets in its path:

```powershell
$validationRoot = 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
Set-Location -LiteralPath $validationRoot
$evidenceRoot = Join-Path $validationRoot 'validation-evidence'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
```

Do not commit `validation-evidence`. Copy only sanitized summaries or sanitized screenshots into an approved evidence location after review.

Capture the baseline on each machine. This uses readable registry values instead of requiring WMI/CIM administrator access:

```powershell
$windows = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$bios = Get-ItemProperty 'HKLM:\HARDWARE\DESCRIPTION\System\BIOS'
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$machineRecord = [ordered]@{
    ComputerName = $env:COMPUTERNAME
    Manufacturer = $bios.SystemManufacturer
    Model = $bios.SystemProductName
    WindowsEdition = $windows.ProductName
    WindowsVersion = $windows.DisplayVersion
    WindowsBuild = "$($windows.CurrentBuildNumber).$($windows.UBR)"
    Architecture = $env:PROCESSOR_ARCHITECTURE
    Resolution = "$($screen.Width)x$($screen.Height)"
    Identity = (whoami)
    IsAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    ServiceState = (Get-Service FieldOpsAgent -ErrorAction SilentlyContinue).Status
}
$machineRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidenceRoot 'machine-baseline.json')
dotnet --info | Set-Content -LiteralPath (Join-Path $evidenceRoot 'dotnet-info.txt')
whoami /all | Set-Content -LiteralPath (Join-Path $evidenceRoot 'identity.txt')
```

Record display scaling manually from **Settings > System > Display > Scale** and whether touch input is available from **Settings > System > About > Pen and touch**.

## One-time build

From a normal PowerShell window:

```powershell
Set-Location -LiteralPath 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
dotnet restore .\agent\FieldOps.Agent.sln --locked-mode
dotnet build .\agent\FieldOps.Agent.sln -c Release --no-restore
```

Pass: restore and build exit `0` with zero warnings and zero errors. Save the console transcript. Stop if the build changes source-controlled files.

## Automated validation

These tests can be run directly by Codex or Chris and do not require UAC or account switching.

### AUTO-001 — Complete .NET suite

```powershell
dotnet test .\agent\FieldOps.Agent.sln -c Release --no-build `
  --logger "trx;LogFileName=all-tests.trx" `
  --results-directory $evidenceRoot
```

Expected: 138 tests pass: 88 agent tests and 50 tray/helper tests. Pass only when exit code is `0`. If the two known telemetry sender tests fail during a parallel solution run, retain that TRX and rerun the agent test project alone; record both outcomes rather than hiding the first result.

### AUTO-002 — Windows Named Pipe integration category

```powershell
dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj `
  -c Release --no-build --filter 'Category=WindowsIntegration' `
  --logger "trx;LogFileName=pipe-windows.trx" `
  --results-directory $evidenceRoot
```

Expected: 12 tests pass. This covers real local pipe connections, bounded framing, empty/malformed/mismatched correlations, unsupported commands, timeout, same-process concurrency, unauthorized-current-user behavior, and pipe-name squatting.

### AUTO-003 — Helper result and mutex unit coverage

```powershell
dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj `
  -c Release --no-build `
  --filter 'FullyQualifiedName~RestartCoordinatorTests|FullyQualifiedName~RestartOperationTests' `
  --logger "trx;LogFileName=restart-tests.trx" `
  --results-directory $evidenceRoot
```

Expected: all selected tests pass. The test set proves fixed helper-path resolution, real executable argument rejection with exit `19`, typed stop/start/access/timeout/health results, same-session mutual exclusion, ACL construction, access-denied failure, release/reacquisition, and abandoned-mutex recovery.

### AUTO-004 — Named Pipe ACL inspection

```powershell
dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj `
  -c Release --no-build --filter 'FullyQualifiedName~PipeAuthorizationPolicyTests' `
  --logger "trx;LogFileName=pipe-acl-policy.trx" `
  --results-directory $evidenceRoot
```

Expected ACL policy:

- LocalService: allow;
- Builtin Administrators: allow;
- explicit operator SID: allow;
- Builtin Users and World: no allow ACE;
- Anonymous and Network: no allow ACE and explicit deny ACEs.

Pass only if all selected tests exit `0`.

### AUTO-005 — Repository isolation audit

```powershell
git status --short
git diff --check
rg -n "TrayPrototype|ServiceControlPrototype" `
  agent/scripts UpdateDashboard.ps1 agent/src/FieldOps.Agent `
  -g '*.ps1' -g '*.cs' -g '*.csproj'
```

Expected: no uncommitted files from running validation, `git diff --check` exits `0`, and no production installer/startup/agent registration references to either prototype. Review any `rg` match manually; a test or documentation reference is not production registration.

## Interactive validation matrix

For every `UAC-*` test, record the launch context in the results as **standard user**, **unelevated administrator**, or **elevated administrator**, and identify the launch host (for example, PowerShell or Explorer). Verify the context with `whoami /all` when the account or token state is uncertain. Launching the tray from an elevated-administrator process suppresses the consent prompt; that behavior is expected, but it does not satisfy UAC-001 or UAC-002 consent-prompt coverage.

### UAC-001 — Cancel elevation (first interactive test)

Setup: use the development Windows machine in a normal, non-elevated account. The tray and helper must be side-by-side in the Release output. The service may be installed or missing because cancellation happens before service control.

Launch context to record: **standard user** or **unelevated administrator**, with the tray launched from a non-elevated process. Do not run this test from an elevated-administrator PowerShell or other elevated parent process.

Command:

```powershell
$tray = 'C:\FieldOpsValidation\FieldOpsDashboard-2.0\agent\src\FieldOps.TrayPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.TrayPrototype.exe'
& $tray
```

Action: right-click the FieldOps tray icon, select **Restart FieldOps Agent**, and select **No** on the Windows UAC prompt.

Expected visible result: the tray displays **Windows elevation was canceled** and does not claim a restart succeeded. Expected helper exit code: none, because Windows never launches it.

Evidence: sanitized screenshots of the UAC prompt and failure dialog; approximate timestamp; `Get-Service FieldOpsAgent` before and after if installed.

Cleanup: choose **Exit** from the tray menu.

Pass: cancellation is distinct and no service transition occurs. Fail and stop if cancellation is reported as success or a service transition occurs.

### UAC-002 — Accept elevation and complete a healthy restart

Setup: approved validation machine with `FieldOpsAgent` installed, running, and passing `agent\scripts\Test-FieldOpsAgentHealth.ps1`. Use a non-elevated tray process.

Launch context to record: **standard user** or **unelevated administrator**, with the tray launched from a non-elevated process and UAC consent explicitly approved.

Command: start the tray with the UAC-001 command, select **Restart FieldOps Agent**, then approve UAC.

Expected visible result: success appears only after stop, start, `Running`, and authenticated health. Expected helper exit code through direct elevated invocation: `0`.

Evidence:

```powershell
Get-Service FieldOpsAgent | Format-List Name,Status
Get-WinEvent -LogName Application -MaxEvents 50 | Where-Object ProviderName -eq 'FieldOpsAgent'
```

Capture the tray result and timestamps. Do not capture the health credential.

Cleanup: exit the tray; leave the service running.

Pass: genuine healthy restart and no optimistic success. Fail if success precedes health or the service remains stopped.

Recorded DEV-01 result, 2026-07-29: **PASS**. The tray was launched from non-elevated PowerShell at `C:\FieldOpsValidation\FieldOps.TrayPrototype.exe` by an unelevated administrator whose account is a member of `BUILTIN\Administrators`; UAC appeared and was accepted; the tray reported **FieldOps Agent restarted and authenticated health passed.**; both the service restart and authenticated health succeeded. Two live tray instances were confirmed separately under TRAY-003; they did not invalidate the correct restart and health result.

### UAC-003 — Helper argument rejection

Setup: no elevation required; the argument check occurs before mutex or SCM access.

Launch context to record: the actual context used—**standard user**, **unelevated administrator**, or **elevated administrator**. Prefer a standard-user or unelevated-administrator PowerShell so this test also proves argument rejection does not require elevation.

```powershell
$helper = 'C:\FieldOpsValidation\FieldOpsDashboard-2.0\agent\src\FieldOps.ServiceControlPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.ServiceControlPrototype.exe'
& $helper unexpectedArgument
$LASTEXITCODE
```

Expected: no UAC prompt, no service transition, exit `19`.

Evidence: console output plus service state before/after.

Cleanup: none.

Pass: exit `19` and unchanged service. Fail and stop if any argument affects a target or operation.

Recorded DEV-01 result, 2026-07-29: **PASS**. From a non-elevated PowerShell token, `net session` returned system error 5 / access denied. The operator invoked `C:\FieldOpsValidation\FieldOps.ServiceControlPrototype.exe unexpectedArgument`; no UAC prompt appeared, the helper returned exit `19`, `FieldOpsAgent` remained `Running` before and after, no service transition occurred, and no helper process survived. The prior duplicate tray processes were also confirmed fully cleaned up.

### UAC-004 — Service missing

Setup: use a disposable machine where `Get-Service FieldOpsAgent -ErrorAction SilentlyContinue` returns nothing. Do not uninstall an operational service solely for this test.

Launch context to record: **elevated administrator** PowerShell. This direct elevated-helper test does not exercise a consent prompt from the tray.

Command: run the helper from an elevated PowerShell window with no arguments.

Expected: exit `11`; no unrelated service changes.

Evidence: `Get-Service` result and console exit code.

Cleanup: none.

Pass: exit `11`. Block if no safe service-free machine is available.

### UAC-005 — Insufficient SCM permission

Setup: approved machine with the service installed. Open a normal PowerShell window as a standard user. Do not approve elevation and do not change SCM permissions.

Launch context to record: **standard user** in non-elevated PowerShell. If an unelevated administrator is tested separately, add a separate result row rather than replacing the standard-user result.

```powershell
& 'C:\FieldOpsValidation\FieldOpsDashboard-2.0\agent\src\FieldOps.ServiceControlPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.ServiceControlPrototype.exe'
$LASTEXITCODE
```

Expected: exit `10` when Windows denies stop/start access. If local policy already grants that user service-control rights, record the policy and mark BLOCK rather than weakening it.

Evidence: exit code, `whoami /all`, service state before/after.

Cleanup: ensure the service is running.

Pass: denial is preserved and no restart succeeds. Fail and stop if an unauthorized user restarts the service.

Recorded DEV-01 result, 2026-07-29: **BLOCK**. The available token was an unelevated administrator, not a genuine standard user: `whoami /groups` included `BUILTIN\Administrators` with **Group used for deny only**. Although `net session` returned system error 5 / access denied, that result also occurs for filtered administrator tokens and was not accepted as standard-user identity proof. No account was created, no group membership was modified, and no SCM permission or security policy was changed. UAC-005 requires an approved machine or existing genuine standard-user validation account.

### FAIL-001 — Unhealthy or unavailable post-restart health

Setup: only an approved disposable service/harness that still represents the fixed `FieldOpsAgent` target and can safely return unhealthy or unavailable health after SCM reaches `Running`. Do not move the credential, change its ACL, replace the production service binary, or redirect the fixed URL.

Command: invoke the elevated helper with no arguments under that approved condition.

Expected: exit `15` for unavailable authenticated health or `16` for an authenticated unhealthy response; never `0`.

Evidence: harness configuration identifier, helper exit code, SCM state, sanitized health response.

Cleanup: restore the disposable harness baseline and verify healthy state.

Pass: correct typed result. Block if no approved harness exists. Fail and stop if unhealthy/unavailable becomes success.

### FAIL-002 — Stop rejection, start rejection, and bounded transitions

Setup: use automated coverage unless an approved disposable service fixture can safely reject stop, reject start, or exceed a transition timeout. Do not alter production SCM ACLs, service binaries, dependencies, or recovery policy.

Command with an approved fixture: invoke the elevated helper with no arguments and time it:

```powershell
$duration = Measure-Command { & $helper }
$exitCode = $LASTEXITCODE
[pscustomobject]@{ ExitCode = $exitCode; Seconds = $duration.TotalSeconds }
```

Expected: stop rejection `20`, start rejection `13`, stop timeout `12`, or start timeout `14`. The helper must return within its bounded stop/start/health envelope; it must not wait indefinitely.

Evidence: fixture identifier, exit code, duration, SCM event/log evidence.

Cleanup: restore and verify the disposable fixture.

Pass: matching typed result and bounded completion. Block individual cases without a safe fixture. Never manufacture them on field hardware.

### MUTEX-001 — Same-session overlap and release

Setup: approved machine with a healthy installed service. Open two elevated PowerShell windows in the same sign-in session.

Command: place the helper command in both windows, press Enter in the second immediately after the first, and repeat up to five times if the first restart completes too quickly.

Expected: while the first owns `Global\FieldOpsAgent.RestartPrototype`, the second exits `17`; only one SCM stop/start sequence occurs. After the first finishes, a new invocation may acquire the mutex and return its normal service result.

Evidence: both console timestamps/exit codes and Application log service-transition timestamps.

Cleanup: leave one healthy running service.

Pass: exit `17` during overlap and successful later reacquisition. Block if the restart window is too short to produce overlap reliably; automated same-session exclusion remains evidence but does not replace cross-session validation.

Recorded DEV-01 result, 2026-07-29: **PASS**. Baseline service state was `Running` with zero existing helpers. Two fixed helpers launched back-to-back in the same elevated Windows session. PID `17104` ran from 17:44:48 through 17:44:50, completed, and exited `0`; overlapping PID `4084` started and ended at 17:44:48, completed, and exited `17`. The service finished `Running` and no helper remained. Combined with the earlier post-overlap invocation that exited `0`, this confirms same-session exclusion, the typed restart-in-progress result, normal mutex release, and later reacquisition.

For the repeat, use one elevated PowerShell session to launch both helpers back-to-back and capture their process results automatically. This removes cross-window copy/timing errors while preserving same-session concurrency:

```powershell
$helper = 'C:\FieldOpsValidation\FieldOps.ServiceControlPrototype.exe'

$baseline = [pscustomobject]@{
    CapturedAt = Get-Date
    Service = (Get-Service FieldOpsAgent).Status
    ExistingHelpers = @(Get-Process FieldOps.ServiceControlPrototype -ErrorAction SilentlyContinue).Count
}
$baseline

if ($baseline.Service -ne 'Running' -or $baseline.ExistingHelpers -ne 0) {
    throw 'MUTEX-001 requires a running service and no existing helper process.'
}

$launchStart = Get-Date
$first = Start-Process -FilePath $helper -PassThru
$second = Start-Process -FilePath $helper -PassThru

$firstCompleted = $first.WaitForExit(120000)
$secondCompleted = $second.WaitForExit(120000)
$first.Refresh()
$second.Refresh()

$results = @(
    [pscustomobject]@{
        Label = 'First'
        Pid = $first.Id
        LaunchBatchStart = $launchStart
        StartTime = $first.StartTime
        Completed = $firstCompleted
        EndTime = if ($firstCompleted) { $first.ExitTime } else { $null }
        ExitCode = if ($firstCompleted) { $first.ExitCode } else { $null }
    }
    [pscustomobject]@{
        Label = 'Second'
        Pid = $second.Id
        LaunchBatchStart = $launchStart
        StartTime = $second.StartTime
        Completed = $secondCompleted
        EndTime = if ($secondCompleted) { $second.ExitTime } else { $null }
        ExitCode = if ($secondCompleted) { $second.ExitCode } else { $null }
    }
)

$results | Format-Table -AutoSize

[pscustomobject]@{
    Service = (Get-Service FieldOpsAgent).Status
    HelperLive = [bool](Get-Process FieldOps.ServiceControlPrototype -ErrorAction SilentlyContinue)
    ExitCodes = ($results.ExitCode -join ',')
}
```

Expected: both processes complete; the exit codes are one `0` and one `17`; the service ends `Running`; and no helper remains. If either process does not complete within the bounded wait, retain the PIDs and do not normalize the result to PASS.

### MUTEX-002 — Console versus second local session

Setup: two administrator-capable validation accounts. Sign into the first at the physical console. Use Fast User Switching to leave it signed in and open the second account. Record `query session` in both sessions.

Command: launch the elevated helper in both sessions as simultaneously as practical.

Expected: exactly one owner; the other exits `17`; no overlapping SCM transitions.

Evidence: `query session`, both exit codes/timestamps, and service event timestamps.

Cleanup: close helper windows and sign out the temporary second account.

Pass: one owner and one `17`. Block if Windows edition/policy does not permit simultaneous sessions or the operation is too fast for reliable overlap.

### MUTEX-003 — Console versus RDP

Setup: only when Remote Desktop is enabled by existing policy. Do not enable RDP or change firewall policy solely for this test. Keep one user at the console and sign a different validation administrator into RDP.

Command and expected result: repeat MUTEX-002. Use `query session` to identify console and RDP sessions.

Evidence and cleanup: retain sanitized session IDs, exit codes, and SCM timestamps; sign out RDP.

Pass: one owner and one exit `17`. Block if RDP is unavailable.

### MUTEX-004 — Failure and abandoned-owner recovery

Setup: first rely on AUTO-003 for deterministic abandoned-mutex proof. Physical termination is optional and must use a disposable machine. Start an elevated helper during a deliberately slow approved fixture condition, identify it with `Get-Process FieldOps.ServiceControlPrototype`, then terminate only that helper:

```powershell
Stop-Process -Id <validated-helper-pid> -Force
& $helper
$LASTEXITCODE
```

Expected: the next helper does not remain permanently blocked by the abandoned mutex. It acquires ownership and returns the result appropriate to the service state; it must not return `17` forever.

Evidence: exact PID, termination timestamp, next exit code, and service state.

Cleanup: verify the helper is gone and restore a healthy running service.

Pass: recovery occurs without overlapping transitions. Block if there is no safe way to keep the helper alive long enough to identify it.

### ACL-001 — Temporary identities and operator-group simulation

Setup in elevated PowerShell on a disposable machine:

```powershell
$operatorPassword = Read-Host 'Temporary operator password' -AsSecureString
$otherPassword = Read-Host 'Temporary unauthorized-user password' -AsSecureString
New-LocalGroup -Name 'FieldOps Prototype Operators' -Description 'Temporary ADR-003 validation group'
New-LocalUser -Name 'FieldOpsProtoOperator' -Password $operatorPassword -PasswordNeverExpires
New-LocalUser -Name 'FieldOpsProtoOther' -Password $otherPassword -PasswordNeverExpires
Add-LocalGroupMember -Group 'FieldOps Prototype Operators' -Member 'FieldOpsProtoOperator'
```

Sign into each account once. Under each identity, capture `whoami /all` and run AUTO-002. Also run AUTO-002 once in non-elevated and elevated administrator windows.

Expected:

- the explicitly supplied operator SID succeeds;
- another standard-user SID is denied before a command is accepted;
- elevated Administrators and LocalService receive intended access;
- a filtered non-elevated administrator is not assumed to have an enabled Administrators SID;
- Builtin Users and World have no allow ACE;
- Anonymous and Network have no allow ACE and have explicit deny ACEs.

Evidence: separate TRX and `whoami /all` files for each identity. Do not record passwords.

Cleanup:

```powershell
Remove-LocalGroupMember -Group 'FieldOps Prototype Operators' -Member 'FieldOpsProtoOperator' -ErrorAction SilentlyContinue
Remove-LocalUser -Name 'FieldOpsProtoOperator' -ErrorAction SilentlyContinue
Remove-LocalUser -Name 'FieldOpsProtoOther' -ErrorAction SilentlyContinue
Remove-LocalGroup -Name 'FieldOps Prototype Operators' -ErrorAction SilentlyContinue
```

Pass: results match the narrow policy and all temporary identities are removed. Fail and stop on broader access.

### ACL-002 — LocalService and LocalSystem

Setup: schedule AUTO-002 under each built-in identity. Use a time at least two minutes ahead:

```powershell
$validationRoot = 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
$runAt = (Get-Date).AddMinutes(2).ToString('HH:mm')
$command = 'cmd.exe /c cd /d "{0}" && dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj -c Release --no-build --filter "Category=WindowsIntegration" --logger "trx;LogFileName=pipe-built-in.trx"' -f $validationRoot
schtasks.exe /Create /TN 'FieldOpsProtoLocalService' /SC ONCE /ST $runAt /RU 'NT AUTHORITY\LOCAL SERVICE' /TR $command /F
schtasks.exe /Run /TN 'FieldOpsProtoLocalService'
```

Repeat with task name `FieldOpsProtoLocalSystem` and `/RU SYSTEM`. If the repository or SDK is inaccessible, grant read/execute only on the disposable validation copy; do not alter product credentials.

Expected: the intended built-in identity can complete the authorization probe. Evidence: Task Scheduler result and TRX.

Cleanup:

```powershell
schtasks.exe /Delete /TN 'FieldOpsProtoLocalService' /F
schtasks.exe /Delete /TN 'FieldOpsProtoLocalSystem' /F
```

Pass: intended access succeeds and tasks are removed. Block if local policy forbids the scheduled identity.

### ACL-003 — Network and anonymous origin

Setup: use a second machine only if already available on the same validation network. Do not enable SMB, named-pipe sharing, anonymous access, or firewall exceptions.

Command on the second machine:

```powershell
Test-NetConnection -ComputerName <validation-machine-name> -CommonTCPPort SMB
```

Do not attempt to weaken policy to obtain a protocol response. The spike client itself uses server name `.` and has no remote target option.

Expected: the local-only validation pipe is not remotely reachable. Automated ACL inspection remains the authoritative evidence that Network and Anonymous have explicit deny ACEs.

Evidence: sanitized connectivity result and local ACL-policy TRX.

Cleanup: none.

Pass: no remote pipe access. Block if no second machine is available. Fail and stop if remote or anonymous pipe access succeeds.

### TRAY-001 — Standard-user state and honest health

Setup: installed service and normal standard-user PowerShell. Start the tray with the UAC-001 command.

Expected visible result: SCM state matches `Get-Service FieldOpsAgent`. Health reports **Unavailable** because the standard user cannot read the protected credential. No UAC prompt occurs until Restart is selected.

Evidence: tray menu plus `Get-Service`; sanitized ACL output from the credential file's parent directory without reading the file contents.

Cleanup: exit tray.

Pass: accurate state, honest unavailable health, and no credential disclosure or ACL change.

Recorded DEV-01 result, 2026-07-29: **PASS**. From non-elevated PowerShell, the initial and refreshed tray menu both showed **Service: Running** and **Health: Unavailable**. The service matched `Get-Service` and remained `Running`; refresh stayed read-only; no UAC prompt appeared; no helper started; and after **Exit** neither the tray nor helper remained running. The unavailable health result was honest for the unelevated administrator token and did not broaden credential access.

### TRAY-002 — Fixed helper resolution

Setup: keep the genuine helper beside the tray. In normal PowerShell, set misleading working-directory, `PATH`, and environment values:

```powershell
$oldPath = $env:PATH
$oldLocation = Get-Location
$env:FIELDOPS_HELPER_PATH = 'C:\FieldOpsValidation\must-not-run.exe'
$env:PATH = 'C:\Windows\System32'
Set-Location -LiteralPath $env:TEMP
& 'C:\FieldOpsValidation\FieldOpsDashboard-2.0\agent\src\FieldOps.TrayPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.TrayPrototype.exe'
```

Select Restart and cancel UAC after confirming the prompt names the co-located helper.

Expected: only the fixed helper beside the tray is resolved. Working directory, `PATH`, and `FIELDOPS_HELPER_PATH` do not redirect it.

Evidence: sanitized UAC prompt and actual helper path.

Cleanup:

```powershell
$env:PATH = $oldPath
Remove-Item Env:FIELDOPS_HELPER_PATH -ErrorAction SilentlyContinue
Set-Location $oldLocation
```

Pass: no redirection. Fail and stop on substitution. The writable-directory integrity limitation remains deferred to production signing and packaging.

Recorded DEV-01 result, 2026-07-29: **PASS**. The tray and co-located helper both existed. The tray was launched from `%TEMP%` with `PATH` restricted to `C:\Windows\System32` and misleading `FIELDOPS_HELPER_PATH=C:\FieldOpsValidation\must-not-run.exe`. UAC identified `C:\FieldOpsValidation\FieldOps.ServiceControlPrototype.exe`; the operator selected **No**; the tray reported **Windows elevation was canceled.**; `FieldOpsAgent` remained `Running`; no restart occurred; no helper process remained; and tray PID `6464` exited cleanly after **Exit**.

### TRAY-003 — Explorer restart, repeated launch, and clean exit

Setup: normal interactive session with one tray instance.

Before interpreting duplicate icons, capture a baseline and launch each instance through `Start-Process -PassThru` so Windows returns the actual PID:

```powershell
$trayPath = 'C:\FieldOpsValidation\FieldOps.TrayPrototype.exe'

Get-Process FieldOps.TrayPrototype -ErrorAction SilentlyContinue |
  Select-Object Id,StartTime,SessionId,Path,Responding

Get-CimInstance Win32_Process -Filter "Name='FieldOps.TrayPrototype.exe'" |
  Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine

$first = Start-Process -FilePath $trayPath -PassThru
Start-Sleep -Seconds 3
$first.Refresh()
[pscustomobject]@{
    Label = 'First launch'
    ProcessId = $first.Id
    HasExited = $first.HasExited
    ExitCode = if ($first.HasExited) { $first.ExitCode } else { $null }
}

$second = Start-Process -FilePath $trayPath -PassThru
Start-Sleep -Seconds 5
$second.Refresh()
[pscustomobject]@{
    Label = 'Second launch'
    ProcessId = $second.Id
    HasExited = $second.HasExited
    ExitCode = if ($second.HasExited) { $second.ExitCode } else { $null }
}

Get-Process FieldOps.TrayPrototype -ErrorAction SilentlyContinue |
  Select-Object Id,StartTime,SessionId,Path,Responding

Get-CimInstance Win32_Process -Filter "Name='FieldOps.TrayPrototype.exe'" |
  Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine
```

Classify the evidence as follows:

- **Multiple live tray processes:** two distinct live PIDs remain after the five-second observation and each corresponds to a visible icon.
- **Stale Explorer notification icon:** only one live tray PID exists while two icons are visible; move the pointer over or open each icon and record whether the stale icon disappears without terminating the live process.
- **Second launch partially blocked or short-lived:** the second PID is created but exits, hangs, or produces no usable icon. Record its `HasExited`, exit code when available, lifetime, and any visible message; do not infer a single-instance guarantee from disappearance alone.

Also record the parent PID for each launch and resolve it with `Get-Process -Id <ParentProcessId>` while it still exists. Do not restart Explorer merely to clear an icon until the process evidence and screenshots have been retained.

```powershell
Stop-Process -Name explorer -Force
Start-Process explorer.exe
```

Expected after Explorer restart: the tray icon should return and remain usable. Record actual behavior; lack of icon restoration is a failed production-lifecycle assumption, not permission to patch production during validation.

Start the tray executable a second time. Expected prototype observation: multiple instances may appear because production single-instance behavior is explicitly deferred. Confirm both can exit cleanly and neither remains in Task Manager.

Evidence: screenshots before/after Explorer restart and `Get-Process FieldOps.TrayPrototype` output.

Cleanup: choose Exit for every tray icon; use `Stop-Process FieldOps.TrayPrototype` only for a stranded disposable prototype.

Pass: evidence captured, clean exit works, and Explorer recovery is acceptable. Mark production follow-up if repeated launch produces multiple instances. Fail and stop on crashes or unrecoverable shell behavior.

Recorded DEV-01 repeated-launch result, 2026-07-29: **FAIL**. PID `8228` (started 16:51:10) and PID `14412` (started 16:59:32) were concurrently live and responding, both executable paths were `C:\FieldOpsValidation\FieldOps.TrayPrototype.exe`, and two tray icons were visible. The duplicate icons therefore were not stale Explorer notification residue: the disposable prototype allows multiple concurrent tray instances. ADR-003 explicitly defers single-instance behavior to production process-lifecycle work, and neither the authoritative Roadmap nor Engineering Backlog requires enforcement in the disposable prototype. No ADR or planning correction is required. Production implementation must define the intended per-user/session ownership boundary and add deterministic repeated-launch tests.

Recorded DEV-01 Explorer notification-area recovery result, 2026-07-29: **PASS**. The tray process survived Explorer restart; exactly one notification icon automatically returned; the menu remained fully usable; Refresh showed **Service: Running** and **Health: Unavailable**; no helper started; **Exit** terminated the tray cleanly; and final process checks found no tray or helper. Manually starting `explorer.exe` also opened an Explorer window. That is recorded as shell-launch behavior only, not a Tray prototype failure. This passing recovery slice does not alter the existing TRAY-003 repeated-launch failure or its production single-instance follow-up.

### HW-001 — DPI, resolution, and touch matrix

Run on development Windows, ToughBook, and ToughPad if available. Test 100%, 125%, 150%, and each device's normal scale. Sign out/in if Windows requests it.

At each scale: launch the tray, open its menu, read every label, activate Refresh, cancel Restart at UAC, and exit. On touch hardware perform the same actions without a mouse.

Expected: readable unclipped labels, usable menu targets, correct icon, and no DPI crash.

Evidence: machine baseline and sanitized screenshot at each scale; note touch success/failure.

Cleanup: restore the machine's original scale.

Pass: all applicable scales are usable. Block unavailable hardware/scales. Fail and stop for unusable field-device behavior.

### HW-002 — Sleep, lid, network, and service availability

Setup: tray running on each applicable machine.

1. Sleep for at least one minute, resume, then select Refresh.
2. On a laptop, close and reopen the lid using the machine's existing power policy; do not change policy.
3. Disconnect Wi-Fi/Ethernet using normal controls, select Refresh, then reconnect.
4. On an approved disposable machine only, stop `FieldOpsAgent`, refresh, then start it again.

Expected: no tray crash; SCM state remains honest; local health does not depend on external network; stopped service is not shown as running; unavailable health is distinct from restart authorization.

Evidence: timestamps, screenshots, service state, and observed recovery time.

Cleanup: reconnect network, start the service, and restore normal power state.

Pass: honest recovery without credential exposure. Block unsafe service-stop or lid tests.

### HW-003 — Slow health and idle resources

Slow health setup: only an approved disposable harness capable of delaying the fixed loopback health response. Do not redirect the endpoint or alter credential security. If no approved fixture is available, leave this slice **NOT RUN** and record the fixture dependency; use **BLOCK** only when this slice is required for the current closure decision and the dependency prevents that decision.

Expected slow-health result: the tray/helper remains bounded by the five-second HTTP timeout and reports unavailable rather than success.

Idle-resource measurement:

```powershell
$process = Get-Process FieldOps.TrayPrototype
$startCpu = $process.CPU
Start-Sleep -Seconds 300
$process.Refresh()
[pscustomobject]@{
    CpuSecondsInFiveMinutes = $process.CPU - $startCpu
    WorkingSetMB = [math]::Round($process.WorkingSet64 / 1MB, 1)
    PrivateMemoryMB = [math]::Round($process.PrivateMemorySize64 / 1MB, 1)
}
```

Expected: no sustained CPU growth or unexplained memory growth while idle. This spike has no final production budget, so record measured values and flag surprising behavior for review rather than inventing a threshold.

Evidence: measurement output from every available hardware class.

Cleanup: stop the harness, restore healthy service, and exit tray.

Pass: bounded health behavior where testable and stable idle measurements. Block the slow-health portion without a safe harness.

Recorded DEV-01 idle-resource result, 2026-07-29: **PASS**. Tray PID `16412` remained responsive for 300.42 seconds. Working set changed from 41.20 MB to 40.94 MB (-0.26 MB), private memory changed from 9.13 MB to 9.05 MB (-0.08 MB), and total processor time remained 0.3125 seconds (CPU delta 0). Exactly one icon was present; Refresh showed **Service: Running** and **Health: Unavailable**; no UAC prompt, helper, crash, unresponsive behavior, or duplicate icon occurred. The service remained `Running`, and cleanup left zero tray and helper processes.

Recorded slow-health result: **NOT RUN**. No approved delay fixture was available, and slow behavior was not manufactured on DEV-01. This remains dependent on an approved disposable fixture that preserves the fixed health endpoint and credential boundary.

## Final cleanup

From elevated PowerShell on every test machine:

```powershell
Get-Process FieldOps.TrayPrototype,FieldOps.ServiceControlPrototype -ErrorAction SilentlyContinue | Stop-Process -Force
schtasks.exe /Delete /TN 'FieldOpsProtoLocalService' /F 2>$null
schtasks.exe /Delete /TN 'FieldOpsProtoLocalSystem' /F 2>$null
Remove-LocalGroupMember -Group 'FieldOps Prototype Operators' -Member 'FieldOpsProtoOperator' -ErrorAction SilentlyContinue
Remove-LocalUser -Name 'FieldOpsProtoOperator' -ErrorAction SilentlyContinue
Remove-LocalUser -Name 'FieldOpsProtoOther' -ErrorAction SilentlyContinue
Remove-LocalGroup -Name 'FieldOps Prototype Operators' -ErrorAction SilentlyContinue
Start-Service FieldOpsAgent -ErrorAction SilentlyContinue
```

Confirm no scheduled task, temporary account/group, prototype process, password, token, or unsanitized evidence remains. Delete the disposable validation copy only after retaining approved sanitized evidence.

## Completion classification

Choose exactly one after review:

- **Field validation passed**
- **Field validation passed with production follow-up**
- **Architecture revision required**
- **Validation blocked**

Recorded DEV-01 classification, 2026-07-29: **Field validation passed with production follow-up for all safely runnable DEV-01 cases**. Matrix totals are 12 `PASS`, 1 `FAIL`, 1 `BLOCK`, and 12 `NOT RUN`. The TRAY-003 repeated-launch failure requires production single-instance behavior. UAC-005 is blocked by the lack of a genuine standard-user identity. Remaining cases depend on other identities/sessions, approved fixtures, network peers, built-in-identity infrastructure, or representative hardware.

Do not mark Task 2.3-03 complete. The authoritative Roadmap requires authenticated tray health and stopped/unhealthy-service recovery. The Engineering Backlog still classifies the task as partially implemented and identifies native health-client provisioning and real multi-identity ACL validation as active prerequisites, with production UI, packaging, startup, and hardware validation incomplete. Production native health, provisioning, packaging, startup, signing, single-instance behavior, and supported-hardware acceptance remain separate work.
