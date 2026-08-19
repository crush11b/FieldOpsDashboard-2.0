Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$trayDiscoveryModule = Join-Path $PSScriptRoot '..\agent\scripts\FieldOps.TrayProcessDiscovery.psm1'
Import-Module $trayDiscoveryModule -Force

function ConvertTo-FieldOpsReadinessPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ([IO.Path]::GetFullPath($Path)).TrimEnd('\', '/').ToLowerInvariant()
}

function Get-FieldOpsServiceExecutablePath {
    param([Parameter(Mandatory = $true)][string]$PathName)
    if ($PathName -match '^\s*"([^"]+)"') { return $matches[1] }
    if ($PathName -match '^\s*(\S+)') { return $matches[1] }
    return $null
}

function Get-FieldOpsStartupRunValue {
    param(
        [Parameter(Mandatory = $true)][string]$OperatorSid,
        [Parameter(Mandatory = $true)][string]$RegistryPath,
        [Parameter(Mandatory = $true)][string]$ValueName
    )

    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::Users,
        [Microsoft.Win32.RegistryView]::Registry64)
    try {
        $key = $baseKey.OpenSubKey("$OperatorSid\$RegistryPath", $false)
        try {
            if ($null -eq $key) { return $null }
            return [string]$key.GetValue($ValueName, $null)
        } finally {
            if ($null -ne $key) { $key.Dispose() }
        }
    } finally {
        $baseKey.Dispose()
    }
}

function New-FieldOpsReadinessCheck {
    param(
        [Parameter(Mandatory = $true)][string]$Status,
        [string]$Detail,
        [string]$Path,
        [int]$ProcessId,
        [string]$SessionId
    )
    return [pscustomobject]@{
        Status = $Status
        Detail = $Detail
        Path = $Path
        ProcessId = $ProcessId
        SessionId = $SessionId
    }
}

function Wait-FieldOpsReadinessCondition {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Condition,
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [Parameter(Mandatory = $true)][int]$PollMilliseconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $value = & $Condition
        if ($null -ne $value -and $value -ne $false) { return $value }
        if ([DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds $PollMilliseconds
    } while ($true)
    throw "$Description was not ready within $TimeoutSeconds seconds."
}

function Test-FieldOpsAgentReadiness {
    param(
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [scriptblock]$ServiceProvider = { param($Name) Get-CimInstance Win32_Service -Filter "Name = '$Name'" -ErrorAction SilentlyContinue },
        [scriptblock]$ProcessProvider = { Get-CimInstance Win32_Process -Filter "Name = 'FieldOps.Agent.exe'" -ErrorAction SilentlyContinue },
        [int]$TimeoutSeconds = 15,
        [int]$PollMilliseconds = 100
    )

    $expectedPath = ConvertTo-FieldOpsReadinessPath (Join-Path $NativeRoot 'Agent\FieldOps.Agent.exe')
    try {
        $state = Wait-FieldOpsReadinessCondition -Description 'FieldOpsAgent service and process' -TimeoutSeconds $TimeoutSeconds -PollMilliseconds $PollMilliseconds -Condition {
            $service = @(& $ServiceProvider 'FieldOpsAgent') | Select-Object -First 1
            $processes = @(& $ProcessProvider | Where-Object {
                (ConvertTo-FieldOpsReadinessPath ([string]$_.ExecutablePath)) -eq $expectedPath
            })
            if ($null -eq $service) { return $false }
            if ([string]$service.State -ne 'Running' -or [string]$service.StartMode -ne 'Auto') { return $false }
            if ($processes.Count -ne 1) { return $false }
            return [pscustomobject]@{ Service = $service; Process = $processes[0] }
        }
        $servicePath = Get-FieldOpsServiceExecutablePath -PathName ([string]$state.Service.PathName)
        if ([string]::IsNullOrWhiteSpace($servicePath) -or (ConvertTo-FieldOpsReadinessPath $servicePath) -ne $expectedPath) {
            throw "FieldOpsAgent service executable path '$servicePath' does not equal '$expectedPath'."
        }
        return New-FieldOpsReadinessCheck -Status 'Passed' -Detail 'Running / Automatic' -Path $expectedPath -ProcessId ([int]$state.Process.ProcessId)
    } catch {
        return New-FieldOpsReadinessCheck -Status 'Failed' -Detail $_.Exception.Message -Path $expectedPath
    }
}

function Test-FieldOpsTrayReadiness {
    param(
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$OperatorSid,
        [scriptblock]$SessionProvider = { Get-FieldOpsInteractiveSessionCandidates },
        [scriptblock]$TrayProcessProvider = { Get-FieldOpsTrayProcessCandidates },
        [scriptblock]$StartupProvider = { param($Sid, $RegistryPath, $ValueName) Get-FieldOpsStartupRunValue -OperatorSid $Sid -RegistryPath $RegistryPath -ValueName $ValueName },
        [int]$TimeoutSeconds = 15,
        [int]$PollMilliseconds = 100
    )

    $expectedPath = ConvertTo-FieldOpsReadinessPath $TrayPath
    try {
        $state = Wait-FieldOpsReadinessCondition -Description 'FieldOps Tray' -TimeoutSeconds $TimeoutSeconds -PollMilliseconds $PollMilliseconds -Condition {
            $sessions = @(& $SessionProvider | Where-Object {
                [string]::Equals([string]$_.Account, $OperatorAccount, [StringComparison]::OrdinalIgnoreCase) -and
                [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase)
            })
            if ($sessions.Count -ne 1) { return $false }
            $processes = @(& $TrayProcessProvider | Where-Object {
                (ConvertTo-FieldOpsReadinessPath ([string]$_.ExecutablePath)) -eq $expectedPath -and
                [string]::Equals([string]$_.Sid, $OperatorSid, [StringComparison]::OrdinalIgnoreCase) -and
                [int]$_.SessionId -eq [int]$sessions[0].SessionId
            })
            if ($processes.Count -ne 1) { return $false }
            return [pscustomobject]@{ Session = $sessions[0]; Process = $processes[0] }
        }
        $startup = & $StartupProvider $OperatorSid 'Software\Microsoft\Windows\CurrentVersion\Run' 'FieldOpsDashboardTray'
        $expectedCommand = '"{0}"' -f $TrayPath
        if ([string]$startup -ne $expectedCommand) {
            throw "FieldOps Tray startup registration '$startup' does not equal '$expectedCommand'."
        }
        return New-FieldOpsReadinessCheck -Status 'Passed' -Detail ("Running for {0} in session {1}" -f $OperatorAccount, $state.Session.SessionId) -Path $expectedPath -ProcessId ([int]$state.Process.ProcessId) -SessionId ([string]$state.Session.SessionId)
    } catch {
        return New-FieldOpsReadinessCheck -Status 'Failed' -Detail $_.Exception.Message -Path $expectedPath
    }
}

function Test-FieldOpsDashboardReadiness {
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedRevision,
        [scriptblock]$ProcessProvider = { Get-CimInstance Win32_Process -ErrorAction SilentlyContinue },
        [scriptblock]$HttpProvider = { param($Uri) Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2 },
        [int]$TimeoutSeconds = 15,
        [int]$PollMilliseconds = 100,
        [switch]$SkipLaunch
    )

    if ($SkipLaunch) {
        return New-FieldOpsReadinessCheck -Status 'Skipped' -Detail 'Dashboard launch was skipped by -SkipLaunch.'
    }

    $expectedServerPath = ConvertTo-FieldOpsReadinessPath (Join-Path $DashboardRoot 'dist\server.cjs')
    try {
        $state = Wait-FieldOpsReadinessCondition -Description 'FieldOps Dashboard server and /api/version' -TimeoutSeconds $TimeoutSeconds -PollMilliseconds $PollMilliseconds -Condition {
            $processes = @(& $ProcessProvider | Where-Object {
                [string]$_.Name -in @('node.exe', 'node') -and
                [string]$_.CommandLine -match [regex]::Escape($expectedServerPath)
            })
            if ($processes.Count -ne 1) { return $false }
            try {
                $response = & $HttpProvider 'http://127.0.0.1:3000/api/version'
                if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { return $false }
                $body = if ($response.Content -is [string]) { $response.Content | ConvertFrom-Json } else { $response.Content }
                if ($null -eq $body) { return $false }
                return [pscustomobject]@{ Process = $processes[0]; Version = $body }
            } catch {
                return $false
            }
        }
        foreach ($name in @('sourceRevision', 'nativeRevision', 'informationalVersion')) {
            if ([string]::IsNullOrWhiteSpace([string]$state.Version.$name)) { throw "/api/version response is missing '$name'." }
        }
        foreach ($name in @('sourceRevision', 'nativeRevision')) {
            if ([string]$state.Version.$name -notmatch '^[0-9a-fA-F]{40}$') { throw "/api/version '$name' is not a full SHA: '$($state.Version.$name)'." }
            if (-not [string]::Equals([string]$state.Version.$name, $ExpectedRevision, [StringComparison]::OrdinalIgnoreCase)) { throw "/api/version '$name' '$($state.Version.$name)' does not equal expected revision '$ExpectedRevision'." }
        }
        return New-FieldOpsReadinessCheck -Status 'Passed' -Detail 'http://127.0.0.1:3000/api/version ready' -Path $expectedServerPath -ProcessId ([int]$state.Process.ProcessId)
    } catch {
        return New-FieldOpsReadinessCheck -Status 'Failed' -Detail $_.Exception.Message -Path $expectedServerPath
    }
}

function Test-FieldOpsRuntimeReadiness {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$DashboardRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][string]$TrayPath,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [Parameter(Mandatory = $true)][string]$OperatorSid,
        [Parameter(Mandatory = $true)][string]$ExpectedRevision,
        [scriptblock]$ServiceProvider,
        [scriptblock]$AgentProcessProvider,
        [scriptblock]$SessionProvider,
        [scriptblock]$TrayProcessProvider,
        [scriptblock]$StartupProvider,
        [scriptblock]$DashboardProcessProvider,
        [scriptblock]$HttpProvider,
        [int]$TimeoutSeconds = 15,
        [int]$PollMilliseconds = 100,
        [switch]$SkipLaunch
    )

    $agentParameters = @{ NativeRoot = $NativeRoot; TimeoutSeconds = $TimeoutSeconds; PollMilliseconds = $PollMilliseconds }
    if ($PSBoundParameters.ContainsKey('ServiceProvider')) { $agentParameters.ServiceProvider = $ServiceProvider }
    if ($PSBoundParameters.ContainsKey('AgentProcessProvider')) { $agentParameters.ProcessProvider = $AgentProcessProvider }
    $trayParameters = @{ TrayPath = $TrayPath; OperatorAccount = $OperatorAccount; OperatorSid = $OperatorSid; TimeoutSeconds = $TimeoutSeconds; PollMilliseconds = $PollMilliseconds }
    foreach ($entry in @(@('SessionProvider', $SessionProvider), @('TrayProcessProvider', $TrayProcessProvider), @('StartupProvider', $StartupProvider))) {
        if ($PSBoundParameters.ContainsKey($entry[0])) { $trayParameters[$entry[0]] = $entry[1] }
    }
    $dashboardParameters = @{ DashboardRoot = $DashboardRoot; ExpectedRevision = $ExpectedRevision; TimeoutSeconds = $TimeoutSeconds; PollMilliseconds = $PollMilliseconds; SkipLaunch = $SkipLaunch }
    if ($PSBoundParameters.ContainsKey('DashboardProcessProvider')) { $dashboardParameters.ProcessProvider = $DashboardProcessProvider }
    if ($PSBoundParameters.ContainsKey('HttpProvider')) { $dashboardParameters.HttpProvider = $HttpProvider }

    $agent = Test-FieldOpsAgentReadiness @agentParameters
    $tray = Test-FieldOpsTrayReadiness @trayParameters
    $dashboard = Test-FieldOpsDashboardReadiness @dashboardParameters
    $warnings = @()
    if ($dashboard.Status -eq 'Skipped') { $warnings += $dashboard.Detail }
    $failures = @()
    foreach ($check in @($agent, $tray, $dashboard)) {
        if ($check.Status -eq 'Failed') { $failures += [string]$check.Detail }
    }
    return [pscustomobject]@{
        Status = if ($failures.Count -eq 0) { 'Passed' } else { 'Failed' }
        Revision = $ExpectedRevision
        Agent = $agent
        Tray = $tray
        Dashboard = $dashboard
        Warnings = @($warnings)
        Failures = @($failures)
    }
}

Export-ModuleMember -Function Test-FieldOpsRuntimeReadiness, Test-FieldOpsAgentReadiness, Test-FieldOpsTrayReadiness, Test-FieldOpsDashboardReadiness
