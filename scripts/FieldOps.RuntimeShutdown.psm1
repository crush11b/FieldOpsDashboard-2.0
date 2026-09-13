Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$readinessModule = Join-Path $PSScriptRoot 'FieldOps.RuntimeReadiness.psm1'
Import-Module $readinessModule -Force

function ConvertTo-FieldOpsNormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ([IO.Path]::GetFullPath($Path)).TrimEnd('\').ToLowerInvariant()
}

function Get-FieldOpsOwnedRuntimeProcesses {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot
    )

    $dashboardPath = ConvertTo-FieldOpsNormalizedPath -Path $DashboardRoot
    $nativePath = ConvertTo-FieldOpsNormalizedPath -Path $NativeRoot
    $agentPath = Join-Path $nativePath 'Agent\FieldOps.Agent.exe'
    $trayPath = Join-Path $nativePath 'Tray\FieldOps.Tray.exe'
    $legacyWrapperPattern = [regex]::Escape($dashboardPath) + '(?=[\\/"''\s]|$)'
    $legacyWrapperNames = @('tsx.exe', 'npm.exe', 'vite.exe', 'cmd.exe')
    $nativeProcessNames = @('FieldOps.Agent.exe', 'FieldOps.Tray.exe')

    $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)
    $dashboardProcesses = @(Get-FieldOpsDashboardProcessCandidates -DashboardRoot $DashboardRoot -ProcessProvider { $processes })
    foreach ($process in ($processes | Sort-Object @{ Expression = { if ([string]$_.Name -ieq 'node.exe' -or [string]$_.Name -ieq 'node') { 0 } else { 1 } } }, ProcessId)) {
        $name = [string]$process.Name
        $executablePath = if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) { '' } else { ConvertTo-FieldOpsNormalizedPath -Path ([string]$process.ExecutablePath) }
        $commandLine = [string]$process.CommandLine
        $isNative = ($name -ieq 'FieldOps.Agent.exe' -and $executablePath -eq $agentPath) -or
            ($name -ieq 'FieldOps.Tray.exe' -and $executablePath -eq $trayPath)
        $isDashboard = $legacyWrapperNames -contains $name.ToLowerInvariant() -and
            -not [string]::IsNullOrWhiteSpace($commandLine) -and
            $commandLine -match $legacyWrapperPattern

        $directDashboard = @($dashboardProcesses | Where-Object ProcessId -eq ([int]$process.ProcessId)).Count -gt 0
        if ($isNative -or $isDashboard -or $directDashboard) {
            [pscustomobject]@{
                Name = $name
                ProcessId = [int]$process.ProcessId
                ExecutablePath = [string]$process.ExecutablePath
                CommandLine = $commandLine
                Ownership = if ($isNative) { 'native' } else { 'dashboard' }
            }
        }
    }
}

function Get-FieldOpsRuntimeState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [scriptblock]$PortListenerProvider = { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue },
        [scriptblock]$ListenerProcessProvider = { Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue }
    )

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Service = $service
        Processes = @(Get-FieldOpsOwnedRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot)
        PortListeners = @(Get-FieldOpsPort3000Listeners -PortListenerProvider $PortListenerProvider -ProcessProvider $ListenerProcessProvider)
    }
}

function Get-FieldOpsPort3000Listeners {
    param(
        [scriptblock]$PortListenerProvider = { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue },
        [scriptblock]$ProcessProvider = { Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue }
    )

    $processes = @(& $ProcessProvider)
    foreach ($listener in @(& $PortListenerProvider)) {
        $processId = [int]$listener.OwningProcess
        $process = $processes | Where-Object { [int]$_.ProcessId -eq $processId } | Select-Object -First 1
        [pscustomobject]@{
            ProcessId = $processId
            CommandLine = if ($null -eq $process) { '<unavailable>' } else { [string]$process.CommandLine }
        }
    }
}

function Test-FieldOpsProcessMissingError {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][System.Management.Automation.ErrorRecord]$ErrorRecord
    )

    $missingProcessError = [string]$ErrorRecord.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*' -or
        [string]$ErrorRecord.Exception.Message -match "process identifier\s+$ProcessId\b"
    if (-not $missingProcessError) {
        return $false
    }

    return $null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Wait-FieldOpsServiceStopped {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][TimeSpan]$Timeout,
        [int]$PollMilliseconds = 100,
        [scriptblock]$PortListenerProvider = { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue },
        [scriptblock]$ListenerProcessProvider = { Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue }
    )

    $deadline = [DateTime]::UtcNow.Add($Timeout)
    do {
        $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($null -eq $service -or $service.Status -eq [ServiceProcess.ServiceControllerStatus]::Stopped) {
            return
        }
        if ([DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)

    throw "FieldOps service '$ServiceName' did not reach Stopped before the $([int]$Timeout.TotalSeconds)-second deadline. Current status: $($service.Status)."
}

function Wait-FieldOpsAgentProcessExit {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][TimeSpan]$Timeout,
        [int]$PollMilliseconds = 100
    )

    $expectedPath = ConvertTo-FieldOpsNormalizedPath -Path (Join-Path $NativeRoot 'Agent\FieldOps.Agent.exe')
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $remaining = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            [int]$_.ProcessId -eq $ProcessId -and
            [string]$_.Name -ieq 'FieldOps.Agent.exe' -and
            -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
            (ConvertTo-FieldOpsNormalizedPath -Path ([string]$_.ExecutablePath)) -eq $expectedPath
        })
        if ($remaining.Count -eq 0) {
            return $timer.Elapsed
        }
        if ($timer.Elapsed -ge $Timeout) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)

    throw "FieldOps Agent process PID $ProcessId did not exit naturally within the $([int]$Timeout.TotalSeconds)-second deadline. The update was aborted before file replacement."
}

function Stop-FieldOpsRuntimeProcesses {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [switch]$ExcludeAgent
    )

    $processes = @(Get-FieldOpsOwnedRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot | Where-Object {
        -not ($ExcludeAgent -and [string]$_.Name -ieq 'FieldOps.Agent.exe')
    })
    foreach ($process in $processes) {
        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        } catch {
            if (-not (Test-FieldOpsProcessMissingError -ProcessId $process.ProcessId -ErrorRecord $_)) {
                throw
            }
        }
    }
    return $processes
}

function Wait-FieldOpsRuntimeQuiescent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][TimeSpan]$Timeout,
        [int]$PollMilliseconds = 100,
        [scriptblock]$PortListenerProvider = { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue },
        [scriptblock]$ListenerProcessProvider = { Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue }
    )

    $deadline = [DateTime]::UtcNow.Add($Timeout)
    do {
        $state = Get-FieldOpsRuntimeState -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot -ServiceName $ServiceName -PortListenerProvider $PortListenerProvider -ListenerProcessProvider $ListenerProcessProvider
        $serviceRunning = $null -ne $state.Service -and $state.Service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped
        if (-not $serviceRunning -and $state.Processes.Count -eq 0 -and $state.PortListeners.Count -eq 0) {
            return $state
        }
        if ([DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)

    $remaining = @($state.Processes | ForEach-Object { "$($_.Name) PID $($_.ProcessId) [$($_.ExecutablePath)]" })
    $serviceDetail = if ($null -eq $state.Service) { 'absent' } else { [string]$state.Service.Status }
    $processDetail = if ($remaining.Count -eq 0) { 'none' } else { $remaining -join '; ' }
    $listenerDetail = if ($state.PortListeners.Count -eq 0) { 'none' } else { ($state.PortListeners | ForEach-Object { "PID $($_.ProcessId) CommandLine=[$($_.CommandLine)]" }) -join '; ' }
    throw "FieldOps runtime did not become quiescent before the $([int]$Timeout.TotalSeconds)-second deadline. Service '$ServiceName': $serviceDetail. Remaining processes: $processDetail. Port 3000 listeners: $listenerDetail."
}

function Invoke-FieldOpsRuntimeShutdown {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [string]$ServiceName = 'FieldOpsAgent',
        [TimeSpan]$Timeout = [TimeSpan]::FromSeconds(30),
        [switch]$SkipProcessStop,
        [scriptblock]$PortListenerProvider = { Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue },
        [scriptblock]$ListenerProcessProvider = { Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue }
    )

    if ($SkipProcessStop) {
        return [pscustomobject]@{ Status = 'skipped'; Service = $null; Processes = @() }
    }

    $initialProcesses = @(Get-FieldOpsOwnedRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot)
    $agentProcesses = @($initialProcesses | Where-Object { [string]$_.Name -ieq 'FieldOps.Agent.exe' })
    if ($agentProcesses.Count -gt 1) {
        throw "Multiple FieldOps Agent processes were found before shutdown: $($agentProcesses.ProcessId -join ', '). The update was aborted before file replacement."
    }
    $agentProcessId = if ($agentProcesses.Count -eq 1) { [int]$agentProcesses[0].ProcessId } else { $null }

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
        Stop-Service -Name $ServiceName -Force -ErrorAction Stop
        Wait-FieldOpsServiceStopped -ServiceName $ServiceName -Timeout $Timeout
        Write-Host "[OK] FieldOps service '$ServiceName' reached Stopped."
    }

    $agentExitElapsed = $null
    if ($null -ne $agentProcessId) {
        $agentExitElapsed = Wait-FieldOpsAgentProcessExit -ProcessId $agentProcessId -NativeRoot $NativeRoot -Timeout $Timeout
        Write-Host ("[OK] FieldOps Agent PID {0} disappeared naturally {1:N0} ms after service stopped." -f $agentProcessId, $agentExitElapsed.TotalMilliseconds)
    }

    $stoppedProcesses = @(Stop-FieldOpsRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot -ExcludeAgent)
    $state = Wait-FieldOpsRuntimeQuiescent -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot -ServiceName $ServiceName -Timeout $Timeout -PortListenerProvider $PortListenerProvider -ListenerProcessProvider $ListenerProcessProvider
    return [pscustomobject]@{ Status = 'quiescent'; Service = $service; AgentProcessId = $agentProcessId; AgentExitElapsed = $agentExitElapsed; Processes = $stoppedProcesses; FinalState = $state }
}

Export-ModuleMember -Function Get-FieldOpsOwnedRuntimeProcesses, Get-FieldOpsRuntimeState, Get-FieldOpsPort3000Listeners, Wait-FieldOpsServiceStopped, Wait-FieldOpsAgentProcessExit, Stop-FieldOpsRuntimeProcesses, Wait-FieldOpsRuntimeQuiescent, Invoke-FieldOpsRuntimeShutdown
