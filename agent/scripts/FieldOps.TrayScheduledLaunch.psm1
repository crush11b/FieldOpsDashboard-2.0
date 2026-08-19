Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$discoveryModule = Join-Path $PSScriptRoot 'FieldOps.TrayProcessDiscovery.psm1'
Import-Module $discoveryModule -Force

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
    $definition.RegistrationInfo.Description = 'Temporary FieldOpsDashboard interactive-token Tray launch task.'
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

function Start-FieldOpsTrayScheduledLaunch {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$OperatorSid,
        [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
        [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
        [scriptblock]$TaskRegisterer = { param($TaskName, $Account, $Path, $WorkingDirectory) New-FieldOpsInteractiveTokenTask -TaskName $TaskName -OperatorAccount $Account -TrayPath $Path -WorkingDirectory $WorkingDirectory },
        [scriptblock]$TaskRunner = { param($TaskContext) $TaskContext.RegisteredTask.Run($null) },
        [scriptblock]$TaskDeleter = { param($TaskContext) $TaskContext.Folder.DeleteTask($TaskContext.TaskName, 0) },
        [scriptblock]$TaskExistsChecker = { param($TaskContext) try { $null -ne $TaskContext.Folder.GetTask($TaskContext.TaskName, 0) } catch { $false } },
        [int]$TimeoutSeconds = 15,
        [int]$PollMilliseconds = 100
    )

    $resolvedTrayPath = (Resolve-Path -LiteralPath $TrayPath -ErrorAction Stop).Path
    if ([IO.Path]::GetFileName($resolvedTrayPath) -ne 'FieldOps.Tray.exe' -or
        -not (Test-Path -LiteralPath $resolvedTrayPath -PathType Leaf)) {
        throw "FieldOps tray executable was not found at '$TrayPath'."
    }

    $session = Resolve-FieldOpsScheduledSession -Operator ([pscustomobject]@{ Account = $OperatorAccount; Sid = $OperatorSid }) -Provider $SessionProvider
    $existing = @(& $TrayProcessProvider | Where-Object {
        [string]::Equals([string]$_.ExecutablePath, $resolvedTrayPath, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
        [int]$_.SessionId -eq [int]$session.SessionId
    })
    if ($existing.Count -gt 1) {
        throw "Multiple matching FieldOps Tray instances already run for '$OperatorAccount' in session $($session.SessionId)."
    }
    if ($existing.Count -eq 1) {
        return [pscustomobject]@{
            Status = 'AlreadyRunning'
            Account = $OperatorAccount
            Sid = $OperatorSid
            SessionId = [int]$session.SessionId
            ProcessId = [int]$existing[0].ProcessId
            TrayPath = $resolvedTrayPath
            TaskName = $null
            LogonType = 'InteractiveToken'
            PasswordSupplied = $false
            TaskRegistration = 'skipped'
            TaskRun = 'skipped'
            TaskCleanup = 'not-required'
        }
    }

    $taskName = 'FieldOpsDashboard-TrayLaunch-{0}' -f ([Guid]::NewGuid().ToString('N'))
    $taskContext = $null
    $taskRegistered = $false
    try {
        try {
            $taskContext = & $TaskRegisterer $taskName $OperatorAccount $resolvedTrayPath (Split-Path -Parent $resolvedTrayPath)
            $taskRegistered = $true
        } catch {
            throw "Task registration failed: $(Format-FieldOpsScheduledTaskError $_)"
        }
        try {
            & $TaskRunner $taskContext | Out-Null
        } catch {
            throw "Task run failed: $(Format-FieldOpsScheduledTaskError $_)"
        }

        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        while ([DateTime]::UtcNow -lt $deadline) {
            $running = @(& $TrayProcessProvider | Where-Object {
                [string]::Equals([string]$_.ExecutablePath, $resolvedTrayPath, [StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
                [int]$_.SessionId -eq [int]$session.SessionId
            })
            if ($running.Count -eq 1) {
                return [pscustomobject]@{
                    Status = 'Running'
                    Account = $OperatorAccount
                    Sid = $OperatorSid
                    SessionId = [int]$session.SessionId
                    ProcessId = [int]$running[0].ProcessId
                    TrayPath = $resolvedTrayPath
                    TaskName = $taskName
                    LogonType = 'InteractiveToken'
                    PasswordSupplied = $false
                    TaskRegistration = 'success'
                    TaskRun = 'success'
                    TaskCleanup = 'success'
                }
            }
            if ($running.Count -gt 1) {
                throw "Multiple matching FieldOps Tray instances appeared in session $($session.SessionId)."
            }
            Start-Sleep -Milliseconds $PollMilliseconds
        }
        throw "Task run succeeded, but the correct FieldOps Tray did not appear for '$OperatorAccount' in session $($session.SessionId) within $TimeoutSeconds seconds."
    } finally {
        if ($taskRegistered -and $null -ne $taskContext) {
            try {
                & $TaskDeleter $taskContext
                if (& $TaskExistsChecker $taskContext) {
                    throw 'Temporary scheduled task still exists after cleanup.'
                }
            } catch {
                throw "Task cleanup failed: $(Format-FieldOpsScheduledTaskError $_)"
            }
        }
    }
}

Export-ModuleMember -Function Start-FieldOpsTrayScheduledLaunch, New-FieldOpsInteractiveTokenTask
