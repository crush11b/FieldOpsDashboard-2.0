# Tray Companion Windows Identity Validation

## Purpose and safety boundary

This procedure validates the disposable Task 2.3-03 Named Pipe authorization and restart-helper architecture with real Windows identities. It does not install the Tray prototype, register startup, change `FieldOpsAgent`, activate telemetry, or broaden the production health-token ACL.

Run only on an approved disposable VM or representative field-validation machine. Creating local test accounts and groups changes Windows security state. Complete the cleanup section before returning the machine to service.

## Prerequisites

1. Copy the repository to a local path readable by the test identities, such as `C:\FieldOpsValidation\FieldOpsDashboard-2.0`.
2. Install a supported .NET SDK capable of building `net8.0-windows`.
3. Open elevated PowerShell and set the repository path explicitly:

```powershell
$validationRoot = 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
Set-Location -LiteralPath $validationRoot
dotnet restore .\agent\FieldOps.Agent.sln --locked-mode
dotnet build .\agent\FieldOps.Agent.sln -c Release --no-restore
```

Do not use the production installer for these identity tests.

## Create disposable identities

In elevated PowerShell, choose unique temporary passwords interactively and create a dedicated group plus two standard users:

```powershell
$operatorPassword = Read-Host 'Temporary FieldOps operator password' -AsSecureString
$otherPassword = Read-Host 'Temporary unauthorized-user password' -AsSecureString
New-LocalGroup -Name 'FieldOps Prototype Operators' -Description 'Disposable ADR-003 validation group'
New-LocalUser -Name 'FieldOpsProtoOperator' -Password $operatorPassword -PasswordNeverExpires
New-LocalUser -Name 'FieldOpsProtoOther' -Password $otherPassword -PasswordNeverExpires
Add-LocalGroupMember -Group 'FieldOps Prototype Operators' -Member 'FieldOpsProtoOperator'
```

Sign out and sign in once as each new user before testing. Windows group-membership changes are reflected in newly created logon tokens; restarting only an already-running application may be insufficient after membership changes.

## Baseline automated Windows tests

From a normal, non-elevated PowerShell session under each identity:

```powershell
Set-Location -LiteralPath 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj `
  -c Release --no-build --filter 'Category=WindowsIntegration' `
  --logger 'trx;LogFileName=pipe-current-user.trx'
```

Expected under a standard user:

- The explicitly permitted current-operator connection succeeds.
- A DACL naming a different operator denies the client before any command is accepted.
- No ACL contains Builtin Users, Everyone, Anonymous, or Network.
- A pre-created pipe name causes the legitimate `FirstPipeInstance` server to fail; it never connects to the squatted instance.
- Empty/malformed correlations, unsupported commands, oversized frames, timeouts, and concurrent operations are rejected.

## Administrator token behavior

Sign in with an administrator account. Run the Windows tests once from non-elevated PowerShell and once from an elevated PowerShell window:

```powershell
whoami /groups
dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj `
  -c Release --no-build --filter 'Category=WindowsIntegration' `
  --logger 'trx;LogFileName=pipe-admin-token.trx'
```

Expected:

- The elevated token contains an enabled `BUILTIN\Administrators` SID and is authorized by the administrator ACE.
- A filtered, non-elevated administrator token must not be assumed to have effective administrator access. Production non-elevated use requires explicit membership in the future `FieldOps Operators` group.

Record `whoami /groups` with each TRX result.

## LocalService behavior

Use Task Scheduler from elevated PowerShell to run the Windows integration tests as LocalService. Replace the time below with a time at least two minutes in the future and keep the paths exact:

```powershell
$validationRoot = 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
$resultPath = 'C:\FieldOpsValidation\localservice-pipe-test.txt'
$runAt = (Get-Date).AddMinutes(2).ToString('HH:mm')
$testCommand = 'cmd.exe /c cd /d "{0}" && dotnet test .\agent\tests\FieldOps.TrayPrototype.Tests\FieldOps.TrayPrototype.Tests.csproj -c Release --no-build --filter "Category=WindowsIntegration" > "{1}" 2>&1' -f $validationRoot, $resultPath
schtasks.exe /Create /TN 'FieldOpsPrototypeLocalServiceTest' /SC ONCE /ST $runAt /RU 'NT AUTHORITY\LOCAL SERVICE' /TR $testCommand /F
schtasks.exe /Run /TN 'FieldOpsPrototypeLocalServiceTest'
```

After completion:

```powershell
Get-Content -LiteralPath 'C:\FieldOpsValidation\localservice-pipe-test.txt'
schtasks.exe /Delete /TN 'FieldOpsPrototypeLocalServiceTest' /F
```

Expected: the LocalService ACE permits the authorization probe. If the SDK or validation directory is inaccessible to LocalService, fix only the disposable validation-directory read/execute ACL; do not change production credential or installer ACLs.

## Anonymous and network identities

The automated ACL-policy tests verify that Anonymous (`S-1-5-7`), Network (`S-1-5-2`), Everyone, and Builtin Users receive no allow ACE. Validate from a second machine that the local-only pipe is not remotely reachable; do not enable named-pipe sharing, SMB exceptions, or anonymous pipe access for this test.

Expected: the remote connection cannot open the local pipe. A failed remote connection is the success condition. Do not weaken the DACL or Windows network policy to obtain a protocol response.

## Restart-helper validation

Only on a machine with the approved disposable or representative `FieldOpsAgent` installation:

```powershell
Set-Location -LiteralPath 'C:\FieldOpsValidation\FieldOpsDashboard-2.0'
$helper = '.\agent\src\FieldOps.ServiceControlPrototype\bin\Release\net8.0-windows\win-x64\FieldOps.ServiceControlPrototype.exe'
& $helper unexpectedArgument
$LASTEXITCODE # expected 19; no service operation occurs
& $helper
$LASTEXITCODE
```

For the no-argument run, accept UAC only on the approved validation machine. Expected success is exit code `0` only after the old service stops, SCM reports `Running` for the new instance, and authenticated health reports `ok`. Exercise UAC cancellation from the Tray prototype and verify it reports cancellation rather than success.

## Evidence to retain

- Windows version and build from `winver` or `Get-ComputerInfo`.
- Hardware model and architecture.
- .NET SDK output from `dotnet --info`.
- `whoami /all` for each permitted and denied token.
- TRX files and LocalService output.
- Exact helper exit codes.
- Event Log entries and timestamps where available.
- Confirmation that telemetry registration remained absent.

Do not retain passwords, health tokens, exact operational coordinates, or unrelated diagnostic content.

## Cleanup

Run in elevated PowerShell:

```powershell
schtasks.exe /Delete /TN 'FieldOpsPrototypeLocalServiceTest' /F 2>$null
Remove-LocalGroupMember -Group 'FieldOps Prototype Operators' -Member 'FieldOpsProtoOperator' -ErrorAction SilentlyContinue
Remove-LocalUser -Name 'FieldOpsProtoOperator' -ErrorAction SilentlyContinue
Remove-LocalUser -Name 'FieldOpsProtoOther' -ErrorAction SilentlyContinue
Remove-LocalGroup -Name 'FieldOps Prototype Operators' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'C:\FieldOpsValidation\localservice-pipe-test.txt' -ErrorAction SilentlyContinue
```

Delete the disposable validation copy only after confirming it contains no unique logs or evidence required by the test record. Do not delete or alter the production installation.
