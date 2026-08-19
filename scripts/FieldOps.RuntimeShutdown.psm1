Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
    $dashboardPattern = [regex]::Escape($dashboardPath) + '(?=[\\/"''\s]|$)'
    $dashboardProcessNames = @('node.exe', 'tsx.exe', 'npm.exe', 'vite.exe', 'cmd.exe')
    $nativeProcessNames = @('FieldOps.Agent.exe', 'FieldOps.Tray.exe')

    foreach ($process in @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)) {
        $name = [string]$process.Name
        $executablePath = if ([string]::IsNullOrWhiteSpace([string]$process.ExecutablePath)) { '' } else { ConvertTo-FieldOpsNormalizedPath -Path ([string]$process.ExecutablePath) }
        $commandLine = [string]$process.CommandLine
        $isNative = ($name -ieq 'FieldOps.Agent.exe' -and $executablePath -eq $agentPath) -or
            ($name -ieq 'FieldOps.Tray.exe' -and $executablePath -eq $trayPath)
        $isDashboard = $dashboardProcessNames -contains $name.ToLowerInvariant() -and
            -not [string]::IsNullOrWhiteSpace($commandLine) -and
            $commandLine -match $dashboardPattern

        if ($isNative -or $isDashboard) {
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
        [Parameter(Mandatory = $true)][string]$ServiceName
    )

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Service = $service
        Processes = @(Get-FieldOpsOwnedRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot)
    }
}

function Wait-FieldOpsServiceStopped {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][TimeSpan]$Timeout,
        [int]$PollMilliseconds = 100
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

function Stop-FieldOpsRuntimeProcesses {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot
    )

    $processes = @(Get-FieldOpsOwnedRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot)
    foreach ($process in $processes) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
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
        [int]$PollMilliseconds = 100
    )

    $deadline = [DateTime]::UtcNow.Add($Timeout)
    do {
        $state = Get-FieldOpsRuntimeState -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot -ServiceName $ServiceName
        $serviceRunning = $null -ne $state.Service -and $state.Service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped
        if (-not $serviceRunning -and $state.Processes.Count -eq 0) {
            return $state
        }
        if ([DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)

    $remaining = @($state.Processes | ForEach-Object { "$($_.Name) PID $($_.ProcessId) [$($_.ExecutablePath)]" })
    $serviceDetail = if ($null -eq $state.Service) { 'absent' } else { [string]$state.Service.Status }
    $processDetail = if ($remaining.Count -eq 0) { 'none' } else { $remaining -join '; ' }
    throw "FieldOps runtime did not become quiescent before the $([int]$Timeout.TotalSeconds)-second deadline. Service '$ServiceName': $serviceDetail. Remaining processes: $processDetail."
}

function Invoke-FieldOpsRuntimeShutdown {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [string]$ServiceName = 'FieldOpsAgent',
        [TimeSpan]$Timeout = [TimeSpan]::FromSeconds(30),
        [switch]$SkipProcessStop
    )

    if ($SkipProcessStop) {
        return [pscustomobject]@{ Status = 'skipped'; Service = $null; Processes = @() }
    }

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($null -ne $service -and $service.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
        Stop-Service -Name $ServiceName -Force -ErrorAction Stop
        Wait-FieldOpsServiceStopped -ServiceName $ServiceName -Timeout $Timeout
    }

    $stoppedProcesses = @(Stop-FieldOpsRuntimeProcesses -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot)
    $state = Wait-FieldOpsRuntimeQuiescent -DashboardRoot $DashboardRoot -NativeRoot $NativeRoot -ServiceName $ServiceName -Timeout $Timeout
    return [pscustomobject]@{ Status = 'quiescent'; Service = $service; Processes = $stoppedProcesses; FinalState = $state }
}

Export-ModuleMember -Function Get-FieldOpsOwnedRuntimeProcesses, Get-FieldOpsRuntimeState, Wait-FieldOpsServiceStopped, Stop-FieldOpsRuntimeProcesses, Wait-FieldOpsRuntimeQuiescent, Invoke-FieldOpsRuntimeShutdown
