[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount,
    [int]$TimeoutSeconds = 15,
    [switch]$SourceTokenProbe,
    [switch]$DuplicateTokenProbe,
    [scriptblock]$OperatorResolver = { param($Account) Resolve-FieldOpsInteractiveOperator -OperatorAccount $Account },
    [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
    [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
    [scriptblock]$LaunchInvoker = { param($Path, $Account, $Sid, $Timeout) Start-FieldOpsTray -TrayPath $Path -OperatorAccount $Account -OperatorSid $Sid -SessionProvider $SessionProvider -TrayProcessProvider $TrayProcessProvider -TimeoutSeconds $Timeout },
    [scriptblock]$PrivilegeProvider = { Get-FieldOpsCallerPrivilegeState },
    [scriptblock]$TokenInspectionProvider = { param($ProcessId) [FieldOpsDashboard.Deployment.InteractiveProcess]::InspectToken([uint32]$ProcessId) },
    [scriptblock]$TokenProbeInvoker = { param($Path, $WorkingDirectory, $SourceProcessId, $UseDuplicate) if ($UseDuplicate) { [FieldOpsDashboard.Deployment.InteractiveProcess]::ProbeDuplicatedToken($Path, $WorkingDirectory, [uint32]$SourceProcessId) } else { [FieldOpsDashboard.Deployment.InteractiveProcess]::ProbeSourceToken($Path, $WorkingDirectory, [uint32]$SourceProcessId) } }
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($SourceTokenProbe -and $DuplicateTokenProbe) {
    throw 'Select only one token probe: -SourceTokenProbe or -DuplicateTokenProbe.'
}

$scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$operatorResolutionModule = Join-Path $scriptDirectory '..\agent\scripts\FieldOps.OperatorResolution.psm1'
$trayLaunchModule = Join-Path $scriptDirectory '..\agent\scripts\FieldOps.TrayLaunch.psm1'
Import-Module $operatorResolutionModule -Force
Import-Module $trayLaunchModule -Force

function Resolve-FieldOpsDiagnosticSession {
    param(
        [Parameter(Mandatory = $true)]$Operator,
        [Parameter(Mandatory = $true)][scriptblock]$Provider
    )

    $sessions = @(& $Provider | Where-Object {
        [string]::Equals([string]$_.Sid, [string]$Operator.Sid, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Account, [string]$Operator.Account, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($sessions.Count -ne 1) {
        throw "Expected exactly one interactive Explorer session for '$($Operator.Account)' (SID $($Operator.Sid)); found $($sessions.Count)."
    }
    return $sessions[0]
}

function Write-FieldOpsDiagnosticProcessState {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Processes)

    if ($Processes.Count -eq 0) {
        Write-Output 'Tray pre-state: not running.'
        return
    }
    foreach ($process in $Processes) {
        Write-Output ('Tray pre-state: PID {0}; owner {1}; SID {2}; session {3}; path {4}' -f `
            $process.ProcessId, $process.Account, $process.Sid, $process.SessionId, $process.ExecutablePath)
    }
}

function Write-FieldOpsPrivilegeState {
    param([Parameter(Mandatory = $false)]$States)

    $items = @($States)
    if ($items.Count -eq 0) {
        Write-Output '  unavailable: privilege preparation did not produce a state result.'
        return
    }
    foreach ($item in $items) {
        if ($null -eq $item) {
            Write-Output '  unavailable: privilege preparation did not produce a state result.'
            continue
        }
        try { $name = [string]$item.Name } catch { $name = [string]$item.Privilege }
        if ([string]::IsNullOrWhiteSpace($name)) { $name = [string]$item.Privilege }
        Write-Output ('  {0}: {1}' -f $name, $item.State)
    }
}

function Write-FieldOpsTokenSummary {
    param([Parameter(Mandatory = $true)]$Summary)

    Write-Output ('{0}: type {1}; session {2}; SID {3}; integrity {4}; elevation type {5}; elevated {6}; virtualization allowed {7}; virtualization enabled {8}; restricted {9}; linked token {10}; requested access 0x{11:X8}; handle acquired {12}' -f `
        $Summary.Label, $Summary.TokenType, $Summary.SessionId, $Summary.UserSid, $Summary.IntegrityLevel, $Summary.ElevationType, `
        $Summary.IsElevated, $Summary.VirtualizationAllowed, $Summary.VirtualizationEnabled, $Summary.IsRestricted, $Summary.HasLinkedToken, `
        $Summary.RequestedAccessMask, $Summary.HandleAcquired)
}

function Invoke-FieldOpsInteractiveTrayLaunchDiagnostic {
    $trayPath = Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe'
    Write-Output ('Dashboard install path: {0}' -f ([IO.Path]::GetFullPath($InstallPath)))
    Write-Output ('Tray executable path: {0}' -f $trayPath)
    Write-Output ('Tray executable exists: {0}' -f (Test-Path -LiteralPath $trayPath -PathType Leaf))
    if (-not (Test-Path -LiteralPath $trayPath -PathType Leaf)) {
        throw "FieldOps tray executable was not found at '$trayPath'."
    }

    $operator = & $OperatorResolver $OperatorAccount
    Write-Output ('FieldOps operator: {0}' -f $operator.Account)
    Write-Output ('SID: {0}' -f $operator.Sid)
    Write-Output ('Operator resolution source: {0}' -f $operator.Source)

    $session = Resolve-FieldOpsDiagnosticSession -Operator $operator -Provider $SessionProvider
    Write-Output ('Diagnostic PowerShell session ID: {0}' -f ([Diagnostics.Process]::GetCurrentProcess().SessionId))
    Write-Output 'Launch API: CreateProcessWithTokenW'
    Write-Output ('Target Explorer session ID: {0}' -f $session.SessionId)
    Write-Output ('Target Explorer/source PID: {0}' -f $session.ProcessId)
    $callerSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    if ($callerSessionId -ne [int]$session.SessionId) {
        throw "Resolved operator '$($operator.Account)' is in interactive session $($session.SessionId), but the diagnostic caller is in session $callerSessionId. This single-operator deployment path does not support cross-session Tray launch."
    }
    $tokenInspection = & $TokenInspectionProvider ([uint32]$session.ProcessId)
    Write-Output ('Source Explorer process session ID: {0}' -f $tokenInspection.SourceProcessSessionId)
    Write-Output ('Source token requested access: 0x{0:X8}' -f [uint32][FieldOpsDashboard.Deployment.InteractiveProcess]::SourceTokenAccessMask)
    Write-Output ('DuplicateTokenEx requested access: 0x{0:X8}' -f [uint32][FieldOpsDashboard.Deployment.InteractiveProcess]::DuplicateTokenAccessMask)
    Write-FieldOpsTokenSummary -Summary $tokenInspection.SourceToken
    Write-FieldOpsTokenSummary -Summary $tokenInspection.DuplicatedToken
    Write-Output ('Granted access diagnostic: {0}' -f $tokenInspection.GrantedAccessNote)
    Write-Output 'Direct source-token CreateProcessWithTokenW probe: not attempted; it would create a diagnostic child process. Launch uses the duplicated primary token only.'
    Write-Output 'Caller privilege diagnostics (read-only):'
    Write-FieldOpsPrivilegeState -States (& $PrivilegeProvider)

    $allTrayProcesses = @(& $TrayProcessProvider)
    Write-Output ('Detected FieldOps.Tray instances: {0}' -f $allTrayProcesses.Count)
    Write-FieldOpsDiagnosticProcessState -Processes $allTrayProcesses
    $existing = @($allTrayProcesses | Where-Object {
        [string]::Equals([string]$_.ExecutablePath, [string]$trayPath, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Sid, [string]$operator.Sid, [StringComparison]::OrdinalIgnoreCase) -and
        [int]$_.SessionId -eq [int]$session.SessionId
    })
    if ($existing.Count -gt 0) {
        Write-Output 'Diagnostic result: success; the correct Tray is already running. No launch was attempted.'
        return
    }

    if ($SourceTokenProbe -or $DuplicateTokenProbe) {
        $useDuplicate = [bool]$DuplicateTokenProbe
        if ($useDuplicate) {
            Write-Output 'Token probe: DuplicateTokenEx primary token'
        } else {
            Write-Output 'Token probe: Explorer source primary token'
        }
        try {
            $probeProcessId = [int](& $TokenProbeInvoker $trayPath (Split-Path -Parent $trayPath) ([uint32]$session.ProcessId) $useDuplicate)
            $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
            while ([DateTime]::UtcNow -lt $deadline) {
                $running = @(& $TrayProcessProvider | Where-Object {
                    [string]::Equals([string]$_.ExecutablePath, [string]$trayPath, [StringComparison]::OrdinalIgnoreCase) -and
                    [string]::Equals([string]$_.Sid, [string]$operator.Sid, [StringComparison]::OrdinalIgnoreCase) -and
                    [int]$_.SessionId -eq [int]$session.SessionId
                })
                if ($running.Count -eq 1) {
                    Write-Output ('CreateProcessWithTokenW result: Running, PID {0}, session {1}' -f $running[0].ProcessId, $running[0].SessionId)
                    return
                }
                if ($running.Count -gt 1) {
                    throw "Multiple FieldOps Tray instances appeared during the selected token probe."
                }
                Start-Sleep -Milliseconds 100
            }
            throw "CreateProcessWithTokenW returned PID $probeProcessId, but the Tray did not appear in session $($session.SessionId) within $TimeoutSeconds seconds."
        } catch {
            Write-Output ('CreateProcessWithTokenW result: {0}' -f $_.Exception.Message)
            throw
        }
    }

    try {
        $result = & $LaunchInvoker $trayPath $operator.Account $operator.Sid $TimeoutSeconds
        Write-Output 'Caller privilege state after launch (read-only):'
        Write-FieldOpsPrivilegeState -States (& $PrivilegeProvider)
        Write-Output ('Diagnostic result: {0}' -f $result.Status)
        Write-Output ('Launched/observed Tray PID: {0}; session {1}; account {2}; SID {3}; path {4}' -f `
            $result.ProcessId, $result.SessionId, $result.Account, $result.Sid, $result.TrayPath)
    } catch {
        Write-Output 'Caller privilege state after launch attempt (read-only):'
        Write-FieldOpsPrivilegeState -States (& $PrivilegeProvider)
        Write-Output ('Diagnostic result: failure: {0}' -f $_.Exception.Message)
        throw
    }
}

Invoke-FieldOpsInteractiveTrayLaunchDiagnostic