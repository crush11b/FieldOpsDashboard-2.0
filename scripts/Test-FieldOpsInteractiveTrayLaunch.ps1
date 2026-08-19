[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount,
    [int]$TimeoutSeconds = 15,
    [scriptblock]$OperatorResolver = { param($Account) Resolve-FieldOpsInteractiveOperator -OperatorAccount $Account },
    [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
    [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
    [scriptblock]$LaunchInvoker = { param($Path, $Account, $Sid, $Timeout) Start-FieldOpsTray -TrayPath $Path -OperatorAccount $Account -OperatorSid $Sid -SessionProvider $SessionProvider -TrayProcessProvider $TrayProcessProvider -TimeoutSeconds $Timeout },
    [scriptblock]$PrivilegeProvider = { Get-FieldOpsCallerPrivilegeState },
    [scriptblock]$PreparedPrivilegeProvider = { Get-FieldOpsLastPreparedPrivilegeState }
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
    Write-Output ('Target Explorer session ID: {0}' -f $session.SessionId)
    Write-Output ('Target Explorer/source PID: {0}' -f $session.ProcessId)
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

    try {
        $result = & $LaunchInvoker $trayPath $operator.Account $operator.Sid $TimeoutSeconds
        Write-Output 'Privilege state after preparation:'
        Write-FieldOpsPrivilegeState -States (& $PreparedPrivilegeProvider)
        Write-Output ('Diagnostic result: {0}' -f $result.Status)
        Write-Output ('Launched/observed Tray PID: {0}; session {1}; account {2}; SID {3}; path {4}' -f `
            $result.ProcessId, $result.SessionId, $result.Account, $result.Sid, $result.TrayPath)
    } catch {
        Write-Output 'Privilege state after preparation:'
        Write-FieldOpsPrivilegeState -States (& $PreparedPrivilegeProvider)
        Write-Output ('Diagnostic result: failure: {0}' -f $_.Exception.Message)
        throw
    }
}

Invoke-FieldOpsInteractiveTrayLaunchDiagnostic