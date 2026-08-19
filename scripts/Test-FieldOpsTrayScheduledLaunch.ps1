[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount,
    [int]$TimeoutSeconds = 15,
    [scriptblock]$OperatorResolver = { param($Account) Resolve-FieldOpsInteractiveOperator -OperatorAccount $Account },
    [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
    [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
    [scriptblock]$TaskRegisterer = { param($TaskName, $Account, $Path, $WorkingDirectory) New-FieldOpsInteractiveTokenTask -TaskName $TaskName -OperatorAccount $Account -TrayPath $Path -WorkingDirectory $WorkingDirectory },
    [scriptblock]$TaskRunner = { param($TaskContext) $TaskContext.RegisteredTask.Run($null) },
    [scriptblock]$TaskDeleter = { param($TaskContext) $TaskContext.Folder.DeleteTask($TaskContext.TaskName, 0) },
    [scriptblock]$TaskExistsChecker = { param($TaskContext) try { $null -ne $TaskContext.Folder.GetTask($TaskContext.TaskName, 0) } catch { $false } }
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$operatorResolutionModule = Join-Path $scriptDirectory '..\agent\scripts\FieldOps.OperatorResolution.psm1'
$trayLaunchModule = Join-Path $scriptDirectory '..\agent\scripts\FieldOps.TrayLaunch.psm1'
Import-Module $operatorResolutionModule -Force
Import-Module $trayLaunchModule -Force

function Format-FieldOpsScheduledTaskError {
    param([Parameter(Mandatory = $true)]$ErrorRecord)

    $exception = $ErrorRecord.Exception
    $hresult = $exception.HResult.ToString('X8')
    return ('HRESULT 0x{0}: {1}' -f $hresult, $exception.Message)
}

function New-FieldOpsInteractiveTokenTask {
    param(
        [Parameter(Mandatory = $true)][string]$TaskName,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $service = New-Object -ComObject 'Schedule.Service'
    $service.Connect()
    $folder = $service.GetFolder('\')
    $definition = $service.NewTask(0)
    $definition.RegistrationInfo.Description = 'Temporary FieldOpsDashboard interactive-token diagnostic task.'
    $definition.Principal.UserId = $OperatorAccount
    $definition.Principal.LogonType = 3
    $definition.Principal.RunLevel = 0
    $definition.Settings.Enabled = $true
    $definition.Settings.StartWhenAvailable = $false
    $action = $definition.Actions.Create(0)
    $action.Path = $TrayPath
    $action.WorkingDirectory = $WorkingDirectory
    $registeredTask = $folder.RegisterTaskDefinition($TaskName, $definition, 6, $OperatorAccount, $null, 3, $null)
    return [pscustomobject]@{
        TaskName = $TaskName
        Folder = $folder
        Definition = $definition
        RegisteredTask = $registeredTask
        OperatorAccount = $OperatorAccount
        LogonType = 3
        PasswordSupplied = $false
        TrayPath = $TrayPath
    }
}

function Resolve-FieldOpsScheduledSession {
    param(
        [Parameter(Mandatory = $true)]$Operator,
        [Parameter(Mandatory = $true)][scriptblock]$Provider
    )

    $sessions = @(& $Provider | Where-Object {
        [string]::Equals([string]$_.Sid, [string]$Operator.Sid, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Account, [string]$Operator.Account, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($sessions.Count -ne 1) {
        throw "Expected exactly one interactive session for '$($Operator.Account)' (SID $($Operator.Sid)); found $($sessions.Count)."
    }
    return $sessions[0]
}

function Invoke-FieldOpsScheduledTrayLaunchDiagnostic {
    $trayPath = Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe'
    $workingDirectory = Split-Path -Parent $trayPath
    Write-Output ('Dashboard install path: {0}' -f ([IO.Path]::GetFullPath($InstallPath)))
    Write-Output ('Tray path: {0}' -f $trayPath)
    if (-not (Test-Path -LiteralPath $trayPath -PathType Leaf)) {
        throw "FieldOps tray executable was not found at '$trayPath'."
    }

    $operator = & $OperatorResolver $OperatorAccount
    $session = Resolve-FieldOpsScheduledSession -Operator $operator -Provider $SessionProvider
    Write-Output ('FieldOps operator: {0}' -f $operator.Account)
    Write-Output ('SID: {0}' -f $operator.Sid)
    Write-Output ('Interactive session: {0}' -f $session.SessionId)

    $existing = @(& $TrayProcessProvider | Where-Object {
        [string]::Equals([string]$_.ExecutablePath, $trayPath, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Sid, $operator.Sid, [StringComparison]::OrdinalIgnoreCase) -and
        [int]$_.SessionId -eq [int]$session.SessionId
    })
    if ($existing.Count -gt 0) {
        throw "The correct FieldOps Tray is already running for '$($operator.Account)' in session $($session.SessionId); stop it before running this probe."
    }

    $taskName = 'FieldOpsDashboard-DiagnosticTrayLaunch-{0}' -f ([Guid]::NewGuid().ToString('N'))
    Write-Output ('Temporary task: {0}' -f $taskName)
    Write-Output 'Logon type: InteractiveToken'
    Write-Output 'Password supplied/stored: False'
    $taskContext = $null
    $taskRegistered = $false
    try {
        try {
            $taskContext = & $TaskRegisterer $taskName $operator.Account $trayPath $workingDirectory
            $taskRegistered = $true
            Write-Output 'Task registration: success'
        } catch {
            Write-Output ('Task registration: failure: {0}' -f (Format-FieldOpsScheduledTaskError $_))
            throw
        }

        try {
            & $TaskRunner $taskContext | Out-Null
            Write-Output 'Task run: success'
        } catch {
            Write-Output ('Task run: failure: {0}' -f (Format-FieldOpsScheduledTaskError $_))
            throw
        }

        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while ([DateTime]::UtcNow -lt $deadline) {
            $running = @(& $TrayProcessProvider | Where-Object {
                [string]::Equals([string]$_.ExecutablePath, $trayPath, [StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$_.Sid, $operator.Sid, [StringComparison]::OrdinalIgnoreCase) -and
                [int]$_.SessionId -eq [int]$session.SessionId
            })
            if ($running.Count -eq 1) {
                Write-Output ('Observed Tray PID/session/SID: {0}/{1}/{2}' -f $running[0].ProcessId, $running[0].SessionId, $running[0].Sid)
                return
            }
            if ($running.Count -gt 1) {
                throw "Multiple matching FieldOps Tray instances appeared in session $($session.SessionId)."
            }
            Start-Sleep -Milliseconds 100
        }
        throw "Task run succeeded, but the correct FieldOps Tray did not appear in session $($session.SessionId) within $TimeoutSeconds seconds."
    } finally {
        if ($taskRegistered -and $null -ne $taskContext) {
            try {
                & $TaskDeleter $taskContext
                if (& $TaskExistsChecker $taskContext) {
                    Write-Output 'Temporary task cleanup: failure: task still exists after DeleteTask.'
                    throw 'Temporary scheduled task still exists after cleanup.'
                }
                Write-Output 'Temporary task cleanup: success'
            } catch {
                Write-Output ('Temporary task cleanup: failure: {0}' -f (Format-FieldOpsScheduledTaskError $_))
                throw
            }
        } else {
            Write-Output 'Temporary task cleanup: not required; registration did not succeed.'
        }
    }
}

Invoke-FieldOpsScheduledTrayLaunchDiagnostic
