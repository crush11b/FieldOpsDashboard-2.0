Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$readinessModule = Join-Path $PSScriptRoot 'FieldOps.RuntimeReadiness.psm1'
$trayLaunchModule = Join-Path $PSScriptRoot '..\agent\scripts\FieldOps.TrayScheduledLaunch.psm1'
Import-Module $readinessModule -Force
Import-Module $trayLaunchModule -Force

function Get-FieldOpsRollbackDashboardProcesses {
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][scriptblock]$ProcessProvider
    )

    $expectedPath = ([IO.Path]::GetFullPath((Join-Path $DashboardRoot 'dist\server.cjs'))).ToLowerInvariant()
    return @(& $ProcessProvider | Where-Object {
        [string]$_.Name -in @('node.exe', 'node') -and
        [string]$_.CommandLine -match [regex]::Escape($expectedPath)
    })
}

function Get-FieldOpsRollbackVersion {
    param([Parameter(Mandatory = $true)][scriptblock]$HttpProvider)

    try {
        $response = @(& $HttpProvider 'http://127.0.0.1:3000/api/version') | Select-Object -First 1
        if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { return $null }
        $content = [string]$response.Content
        if ([string]::IsNullOrWhiteSpace($content)) { return $null }
        if ($response.Content -is [string]) { return ($content | ConvertFrom-Json) }
        return $response.Content
    } catch {
        return $null
    }
}

function Get-FieldOpsRuntimeSnapshot {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$OperatorSid,
        [scriptblock]$ServiceProvider = { param($Name) Get-CimInstance Win32_Service -Filter "Name = '$Name'" -ErrorAction SilentlyContinue },
        [scriptblock]$AgentProcessProvider = { Get-CimInstance Win32_Process -Filter "Name = 'FieldOps.Agent.exe'" -ErrorAction SilentlyContinue },
        [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
        [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
        [scriptblock]$DashboardProcessProvider = { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue },
        [scriptblock]$HttpProvider = { param($Uri) Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2 }
    )

    $service = @(& $ServiceProvider 'FieldOpsAgent') | Select-Object -First 1
    $agentPath = ([IO.Path]::GetFullPath((Join-Path $NativeRoot 'Agent\FieldOps.Agent.exe'))).ToLowerInvariant()
    $agentProcesses = @(& $AgentProcessProvider | Where-Object { ([IO.Path]::GetFullPath([string]$_.ExecutablePath)).ToLowerInvariant() -eq $agentPath })
    $sessions = @(& $SessionProvider | Where-Object {
        [string]::Equals([string]$_.Account, $OperatorAccount, [StringComparison]::OrdinalIgnoreCase) -and
        [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase)
    })
    $trayPathNormalized = ([IO.Path]::GetFullPath($TrayPath)).ToLowerInvariant()
    $trayProcesses = @(& $TrayProcessProvider | Where-Object {
        ([IO.Path]::GetFullPath([string]$_.ExecutablePath)).ToLowerInvariant() -eq $trayPathNormalized -and
        [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
        $sessions.Count -eq 1 -and [int]$_.SessionId -eq [int]$sessions[0].SessionId
    })
    $dashboardProcesses = @(Get-FieldOpsRollbackDashboardProcesses -DashboardRoot $DashboardRoot -ProcessProvider $DashboardProcessProvider)
    $version = Get-FieldOpsRollbackVersion -HttpProvider $HttpProvider
    $revision = if ($null -ne $version -and
        [string]$version.sourceRevision -match '^[0-9a-fA-F]{40}$' -and
        [string]$version.nativeRevision -match '^[0-9a-fA-F]{40}$') {
        [pscustomobject]@{
            SourceRevision = [string]$version.sourceRevision
            NativeRevision = [string]$version.nativeRevision
            InformationalVersion = [string]$version.informationalVersion
        }
    } else { $null }

    return [pscustomobject]@{
        Agent = [pscustomobject]@{
            Exists = $null -ne $service
            Running = $null -ne $service -and [string]$service.State -eq 'Running'
            StartMode = if ($null -eq $service) { $null } else { [string]$service.StartMode }
            Path = if ($null -eq $service) { $null } else { [string]$service.PathName }
            ProcessRunning = $agentProcesses.Count -eq 1
        }
        Tray = [pscustomobject]@{
            Running = $trayProcesses.Count -eq 1
            Account = $OperatorAccount
            Sid = $OperatorSid
            SessionId = if ($sessions.Count -eq 1) { [int]$sessions[0].SessionId } else { $null }
            Path = $TrayPath
        }
        Dashboard = [pscustomobject]@{
            Running = $dashboardProcesses.Count -eq 1
            ProcessCount = $dashboardProcesses.Count
            Processes = @($dashboardProcesses)
            Path = ([IO.Path]::GetFullPath((Join-Path $DashboardRoot 'dist\server.cjs')))
        }
        Revision = $revision
    }
}

function New-FieldOpsRollbackComponentResult {
    param([string]$Status, [string]$Detail)
    return [pscustomobject]@{ Status = $Status; Detail = $Detail }
}

function Restore-FieldOpsRuntimeState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Snapshot,
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$ExpectedOperatorAccount,
        [Parameter(Mandatory = $true)][string]$ExpectedOperatorSid,
        [string]$ExpectedRevision,
        [scriptblock]$ServiceStarter = { Start-Service -Name 'FieldOpsAgent' },
        [scriptblock]$DashboardStarter = { param($Root) Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $Root },
        [scriptblock]$TrayStarter = { param($Path, $Account, $Sid) Start-FieldOpsTrayScheduledLaunch -TrayPath $Path -OperatorAccount $Account -OperatorSid $Sid },
        [scriptblock]$AgentReadiness = { param($Root) Test-FieldOpsAgentReadiness -NativeRoot $Root },
        [scriptblock]$TrayReadiness = { param($Path, $Account, $Sid) Test-FieldOpsTrayReadiness -TrayPath $Path -OperatorAccount $Account -OperatorSid $Sid },
        [scriptblock]$DashboardReadiness = { param($Root, $Revision) if ([string]::IsNullOrWhiteSpace($Revision)) { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/version' -UseBasicParsing -TimeoutSec 2; if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { throw 'Dashboard endpoint was not ready.' }; [pscustomobject]@{ Status = 'Passed'; Detail = 'Dashboard endpoint ready.' } } else { Test-FieldOpsDashboardReadiness -DashboardRoot $Root -ExpectedRevision $Revision } },
        [scriptblock]$RevisionReader = { param($Root) Get-Content -LiteralPath (Join-Path $Root 'deployment-manifest.json') -Raw | ConvertFrom-Json }
    )

    $results = [ordered]@{}
    if ($Snapshot.Agent.Running) {
        try {
            & $ServiceStarter
            $agent = & $AgentReadiness $NativeRoot
            if ($agent.Status -ne 'Passed') { throw $agent.Detail }
            $results.Agent = New-FieldOpsRollbackComponentResult 'Passed' 'Running restored.'
        } catch { $results.Agent = New-FieldOpsRollbackComponentResult 'Failed' $_.Exception.Message }
    } elseif ($Snapshot.Agent.Exists) {
        $results.Agent = New-FieldOpsRollbackComponentResult 'Passed' 'Previously stopped; left stopped.'
    } else {
        $results.Agent = New-FieldOpsRollbackComponentResult 'Passed' 'Previously absent; left absent.'
    }

    if ($Snapshot.Tray.Running) {
        try {
            & $TrayStarter $TrayPath $ExpectedOperatorAccount $ExpectedOperatorSid | Out-Null
            $tray = & $TrayReadiness $TrayPath $ExpectedOperatorAccount $ExpectedOperatorSid
            if ($tray.Status -ne 'Passed') { throw $tray.Detail }
            $capturedSessionId = if ($Snapshot.Tray.PSObject.Properties['SessionId']) { $Snapshot.Tray.SessionId } else { $null }
            if ($null -ne $capturedSessionId -and [string]$tray.SessionId -ne [string]$capturedSessionId) {
                throw "Tray restored in session $($tray.SessionId), expected captured session $capturedSessionId."
            }
            $results.Tray = New-FieldOpsRollbackComponentResult 'Passed' ("Running restored for {0}." -f $ExpectedOperatorAccount)
        } catch { $results.Tray = New-FieldOpsRollbackComponentResult 'Failed' $_.Exception.Message }
    } else {
        $results.Tray = New-FieldOpsRollbackComponentResult 'Passed' 'Previously stopped; left stopped.'
    }

    if ($Snapshot.Dashboard.Running) {
        try {
            & $DashboardStarter $DashboardRoot | Out-Null
            $dashboard = & $DashboardReadiness $DashboardRoot $ExpectedRevision
            if ($dashboard.Status -ne 'Passed') { throw $dashboard.Detail }
            $results.Dashboard = New-FieldOpsRollbackComponentResult 'Passed' 'Dashboard restored and ready.'
        } catch { $results.Dashboard = New-FieldOpsRollbackComponentResult 'Failed' $_.Exception.Message }
    } else {
        $results.Dashboard = New-FieldOpsRollbackComponentResult 'Passed' 'Previously stopped; left stopped.'
    }

    if ($null -ne $Snapshot.Revision) {
        try {
            $restored = & $RevisionReader $DashboardRoot
            if ([string]$restored.sourceRevision -ne [string]$Snapshot.Revision.SourceRevision -or
                [string]$restored.nativeRevision -ne [string]$Snapshot.Revision.NativeRevision) {
                throw "Restored source/native revision '$($restored.sourceRevision)'/'$($restored.nativeRevision)' does not match captured '$($Snapshot.Revision.SourceRevision)'/'$($Snapshot.Revision.NativeRevision)'."
            }
            $results.Revision = New-FieldOpsRollbackComponentResult 'Passed' ("Previous revision restored: {0}." -f $Snapshot.Revision.SourceRevision)
        } catch { $results.Revision = New-FieldOpsRollbackComponentResult 'Failed' $_.Exception.Message }
    } else {
        $results.Revision = New-FieldOpsRollbackComponentResult 'Warning' 'Prior revision was unavailable before shutdown; verification was unavailable.'
    }

    $failures = @($results.Values | Where-Object Status -eq 'Failed')
    return [pscustomobject]@{
        Status = if ($failures.Count -eq 0) { 'Passed' } else { 'Degraded' }
        Agent = $results.Agent
        Tray = $results.Tray
        Dashboard = $results.Dashboard
        Revision = $results.Revision
        Failures = @($failures | ForEach-Object Detail)
    }
}

Export-ModuleMember -Function Get-FieldOpsRuntimeSnapshot, Restore-FieldOpsRuntimeState
