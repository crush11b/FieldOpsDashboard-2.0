$modulePath = Join-Path $PSScriptRoot '..\FieldOps.RuntimeReadiness.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'
Import-Module $modulePath -Force

Describe 'FieldOps runtime readiness' {
    BeforeEach {
        $script:revision = '9a2f5bda21614ba66e667162a814cb6a886206fe'
        $script:nativeRoot = 'C:\Program Files\FieldOpsDashboard'
        $script:agentPath = 'C:\Program Files\FieldOpsDashboard\Agent\FieldOps.Agent.exe'
        $script:trayPath = 'C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe'
        $script:operator = 'DESKTOP-88DQ68K\stick'
        $script:sid = 'S-1-5-21-100-200-300-1001'
        $script:service = [pscustomobject]@{ State = 'Running'; StartMode = 'Auto'; PathName = '"C:\Program Files\FieldOpsDashboard\Agent\FieldOps.Agent.exe"' }
        $script:agentProcess = [pscustomobject]@{ ExecutablePath = $script:agentPath; ProcessId = 101 }
        $script:session = [pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = 1 }
        $script:trayProcess = [pscustomobject]@{ ExecutablePath = $script:trayPath; Sid = $script:sid; SessionId = 1; ProcessId = 102 }
        $script:version = [pscustomobject]@{ sourceRevision = $script:revision; nativeRevision = $script:revision; informationalVersion = '2.3.0+' + $script:revision }
        $script:serviceProvider = { param($Name) $script:service }
        $script:agentProvider = { $script:agentProcess }
        $script:sessionProvider = { $script:session }
        $script:trayProvider = { $script:trayProcess }
        $script:startupProvider = { param($Sid, $RegistryPath, $ValueName) '"C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe"' }
        $script:dashboardProvider = { [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs'; ProcessId = 103 } }
        $script:httpProvider = { param($Uri) [pscustomobject]@{ StatusCode = 200; Content = ($script:version | ConvertTo-Json) } }
    }

    It 'passes Agent Running Automatic with the exact installed executable' {
        $result = Test-FieldOpsAgentReadiness -NativeRoot $script:nativeRoot -ServiceProvider $script:serviceProvider -ProcessProvider $script:agentProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Passed'
        $result.Detail | Should Be 'Running / Automatic'
    }

    It 'fails when the Agent service is missing or stopped' {
        $script:service = $null
        (Test-FieldOpsAgentReadiness -NativeRoot $script:nativeRoot -ServiceProvider $script:serviceProvider -ProcessProvider $script:agentProvider -TimeoutSeconds 0).Status | Should Be 'Failed'
        $script:service = [pscustomobject]@{ State = 'Stopped'; StartMode = 'Auto'; PathName = $script:agentPath }
        (Test-FieldOpsAgentReadiness -NativeRoot $script:nativeRoot -ServiceProvider $script:serviceProvider -ProcessProvider $script:agentProvider -TimeoutSeconds 0).Status | Should Be 'Failed'
    }

    It 'fails when the Agent executable path is wrong' {
        $script:agentProcess = [pscustomobject]@{ ExecutablePath = 'C:\Other\FieldOps.Agent.exe'; ProcessId = 101 }
        $result = Test-FieldOpsAgentReadiness -NativeRoot $script:nativeRoot -ServiceProvider $script:serviceProvider -ProcessProvider $script:agentProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Failed'
    }

    It 'passes the correct Tray operator SID session path and startup registration' {
        $result = Test-FieldOpsTrayReadiness -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -StartupProvider $script:startupProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Passed'
        $result.Detail | Should Match 'session 1'
    }

    It 'fails when the Tray is missing or duplicated' {
        $script:trayProcess = @()
        (Test-FieldOpsTrayReadiness -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -StartupProvider $script:startupProvider -TimeoutSeconds 0).Status | Should Be 'Failed'
        $script:trayProcess = @(
            [pscustomobject]@{ ExecutablePath = $script:trayPath; Sid = $script:sid; SessionId = 1; ProcessId = 102 },
            [pscustomobject]@{ ExecutablePath = $script:trayPath; Sid = $script:sid; SessionId = 1; ProcessId = 103 }
        )
        (Test-FieldOpsTrayReadiness -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -StartupProvider $script:startupProvider -TimeoutSeconds 0).Status | Should Be 'Failed'
    }

    It 'fails when the Tray SID or session is wrong' {
        $script:trayProcess = [pscustomobject]@{ ExecutablePath = $script:trayPath; Sid = 'S-1-5-21-100-200-300-1002'; SessionId = 2; ProcessId = 102 }
        (Test-FieldOpsTrayReadiness -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -StartupProvider $script:startupProvider -TimeoutSeconds 0).Status | Should Be 'Failed'
    }

    It 'passes Dashboard HTTP and exact source/native revision identity' {
        $result = Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider $script:httpProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Passed'
    }

    It 'starts production Dashboard directly with node and an absolute server path' {
        $calls = [pscustomobject]@{ FilePath = $null; ArgumentList = $null; WorkingDirectory = $null }
        $process = New-Object psobject -Property @{ Id = 701; HasExited = $false; ExitCode = $null }
        $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
        $nodeProvider = { param($Name) [pscustomobject]@{ Source = 'C:\Program Files\nodejs\node.exe' } }
        $starter = { param($FilePath, $ArgumentList, $WorkingDirectory) $calls.FilePath = $FilePath; $calls.ArgumentList = @($ArgumentList); $calls.WorkingDirectory = $WorkingDirectory; $process }
        $result = Start-FieldOpsDashboardProcess -DashboardRoot 'C:\FieldOpsDashboard' -NodeProvider $nodeProvider -ProcessStarter $starter -SleepProvider { param($Milliseconds) }
        $result.Id | Should Be 701
        $calls.FilePath | Should Be 'C:\Program Files\nodejs\node.exe'
        $calls.ArgumentList[0] | Should Be 'C:\FieldOpsDashboard\dist\server.cjs'
        $calls.WorkingDirectory | Should Be 'C:\FieldOpsDashboard'
        (Get-Content -LiteralPath $updaterPath -Raw) | Should Not Match "Start-Process -FilePath 'npm\.cmd' -ArgumentList 'start'"
    }

    It 'reports an immediate production Node exit with launch diagnostics' {
        $process = New-Object psobject -Property @{ Id = 702; HasExited = $true; ExitCode = 17 }
        $process | Add-Member -MemberType ScriptMethod -Name Refresh -Value { }
        { Start-FieldOpsDashboardProcess -DashboardRoot 'C:\FieldOpsDashboard' -NodeProvider { param($Name) [pscustomobject]@{ Source = 'C:\node.exe' } } -ProcessStarter { param($FilePath, $ArgumentList, $WorkingDirectory) $process } -SleepProvider { param($Milliseconds) } } |
            Should Throw 'PID 702 exited before readiness'
    }

    It 'matches only the installed production server and excludes unrelated Node' {
        $processes = @(
            [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs'; ProcessId = 703 },
            [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\OtherApplication\server.cjs'; ProcessId = 704 },
            [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard2\dist\server.cjs'; ProcessId = 705 }
        )
        (Get-FieldOpsDashboardProcessCandidates -DashboardRoot 'C:\FieldOpsDashboard' -ProcessProvider { $processes }).Count | Should Be 1
    }

    It 'waits for HTTP after the Dashboard process appears' {
        $script:httpCalls = 0
        $delayedHttp = {
            param($Uri)
            $script:httpCalls++
            if ($script:httpCalls -lt 2) { throw 'connection refused while server initializes' }
            [pscustomobject]@{ StatusCode = 200; Content = ($script:version | ConvertTo-Json) }
        }
        $result = Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider $delayedHttp -TimeoutSeconds 1 -PollMilliseconds 1
        $result.Status | Should Be 'Passed'
        $script:httpCalls | Should BeGreaterThan 1
    }

    It 'reports process and HTTP state when Dashboard readiness times out' {
        $result = Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider { param($Uri) throw 'still starting' } -TimeoutSeconds 0
        $result.Status | Should Be 'Failed'
        $result.Detail | Should Match 'Process: appeared'
        $result.Detail | Should Match 'Last HTTP state: still starting'
    }

    It 'uses a 45-second default bounded Dashboard readiness window' {
        $readiness = Get-Content -LiteralPath $modulePath -Raw
        $readiness | Should Match '\$TimeoutSeconds = 45'
    }

    It 'fails when Dashboard endpoint times out or returns malformed identity' {
        $timeout = { param($Uri) throw 'connection refused' }
        (Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider $timeout -TimeoutSeconds 0).Status | Should Be 'Failed'
        $script:version = [pscustomobject]@{ sourceRevision = $script:revision; nativeRevision = 'not-a-sha'; informationalVersion = '2.3.0' }
        (Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider $script:httpProvider -TimeoutSeconds 0).Status | Should Be 'Failed'
    }

    It 'fails source and native revision mismatches' {
        $script:version.sourceRevision = ('0' * 40)
        $result = Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider $script:httpProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Failed'
        $result.Detail | Should Match 'does not equal expected revision'
    }

    It 'fails when only the native revision mismatches' {
        $script:version.nativeRevision = ('1' * 40)
        $result = Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $script:dashboardProvider -HttpProvider $script:httpProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Failed'
        $result.Detail | Should Match "nativeRevision.*does not equal expected revision"
    }

    It 'fails when duplicate production Dashboard server processes are present' {
        $duplicateProvider = {
            @(
                [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs'; ProcessId = 103 },
                [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs'; ProcessId = 104 }
            )
        }
        $result = Test-FieldOpsDashboardReadiness -DashboardRoot 'C:\FieldOpsDashboard' -ExpectedRevision $script:revision -ProcessProvider $duplicateProvider -HttpProvider $script:httpProvider -TimeoutSeconds 0
        $result.Status | Should Be 'Failed'
        $result.Detail | Should Match 'not ready within'
    }

    It 'treats SkipLaunch as an intentional Dashboard skip' {
        $result = Test-FieldOpsRuntimeReadiness -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ExpectedRevision $script:revision -ServiceProvider $script:serviceProvider -AgentProcessProvider $script:agentProvider -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -StartupProvider $script:startupProvider -SkipLaunch -TimeoutSeconds 0
        $result.Status | Should Be 'Passed'
        $result.Dashboard.Status | Should Be 'Skipped'
        $result.Warnings.Count | Should Be 1
    }

    It 'removes raw readiness object output from the updater success path' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'Invoke-FieldOpsRuntimeShutdown[\s\S]*\| Out-Null'
        $updater | Should Match '\[8/8\] Verifying FieldOps runtime'
        $updater | Should Not Match 'Format-Table|Status\s+Service\s+Processes'
    }

    It 'parses under Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "Import-Module '$module' -Force; 'import-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'import-ok'
    }
}
