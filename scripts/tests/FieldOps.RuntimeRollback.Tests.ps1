$modulePath = Join-Path $PSScriptRoot '..\FieldOps.RuntimeRollback.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'
Import-Module $modulePath -Force

Describe 'FieldOps runtime rollback state' {
    BeforeEach {
        $script:dashboardRoot = 'C:\FieldOpsDashboard'
        $script:nativeRoot = 'C:\Program Files\FieldOpsDashboard'
        $script:trayPath = 'C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe'
        $script:operator = 'DESKTOP-88DQ68K\stick'
        $script:sid = 'S-1-5-21-100-200-300-1001'
        $script:revision = '9a2f5bda21614ba66e667162a814cb6a886206fe'
        $script:service = [pscustomobject]@{ State = 'Running'; StartMode = 'Auto'; PathName = '"C:\Program Files\FieldOpsDashboard\Agent\FieldOps.Agent.exe"' }
        $script:agentProcess = [pscustomobject]@{ ExecutablePath = 'C:\Program Files\FieldOpsDashboard\Agent\FieldOps.Agent.exe'; ProcessId = 101 }
        $script:session = [pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = 1 }
        $script:trayProcess = [pscustomobject]@{ ExecutablePath = $script:trayPath; Sid = $script:sid; SessionId = 1; ProcessId = 102 }
        $script:dashboardProcess = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs'; ProcessId = 103 }
        $script:version = [pscustomobject]@{ sourceRevision = $script:revision; nativeRevision = $script:revision; informationalVersion = '2.3.0+' + $script:revision }
        $script:serviceProvider = { param($Name) $script:service }
        $script:agentProvider = { $script:agentProcess }
        $script:sessionProvider = { $script:session }
        $script:trayProvider = { $script:trayProcess }
        $script:dashboardProvider = { $script:dashboardProcess }
        $script:httpProvider = { param($Uri) [pscustomobject]@{ StatusCode = 200; Content = ($script:version | ConvertTo-Json) } }
    }

    It 'captures running Agent and prior revision' {
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider $script:serviceProvider -AgentProcessProvider $script:agentProvider -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -DashboardProcessProvider $script:dashboardProvider -HttpProvider $script:httpProvider
        $snapshot.Agent.Exists | Should Be $true
        $snapshot.Agent.Running | Should Be $true
        $snapshot.Agent.StartMode | Should Be 'Auto'
        $snapshot.Tray.Running | Should Be $true
        $snapshot.Dashboard.Running | Should Be $true
        $snapshot.Revision.SourceRevision | Should Be $script:revision
        $snapshot.Revision.NativeRevision | Should Be $script:revision
    }

    It 'ignores Agent records with null, whitespace, and missing paths' {
        $script:agentProcess = @(
            [pscustomobject]@{ ExecutablePath = $null; ProcessId = 201 },
            [pscustomobject]@{ ExecutablePath = '   '; ProcessId = 202 },
            [pscustomobject]@{ ProcessId = 203 }
        )
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider { param($Name) $null } -AgentProcessProvider $script:agentProvider -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Agent.ProcessRunning | Should Be $false
    }

    It 'keeps a valid Agent match when invalid pathless records are present' {
        $script:agentProcess = @(
            [pscustomobject]@{ ExecutablePath = $null; ProcessId = 204 },
            [pscustomobject]@{ ProcessId = 205 },
            [pscustomobject]@{ ExecutablePath = 'C:\Other\FieldOps.Agent.exe'; ProcessId = 206 },
            [pscustomobject]@{ ExecutablePath = $script:nativeRoot + '\Agent\FieldOps.Agent.exe'; ProcessId = 207 }
        )
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider { param($Name) $null } -AgentProcessProvider $script:agentProvider -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Agent.ProcessRunning | Should Be $true
    }

    It 'keeps nonblank Agent provider failures visible' {
        $thrown = $false
        try { $ErrorActionPreference = 'Stop'; Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider { param($Name) $null } -AgentProcessProvider { throw 'Agent provider failed' } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' } | Out-Null } catch { $thrown = $true }
        $thrown | Should Be $true
    }

    It 'ignores Tray records with null, whitespace, and missing paths' {
        $script:trayProcess = @(
            [pscustomobject]@{ ExecutablePath = $null; Sid = $script:sid; SessionId = 1; ProcessId = 209 },
            [pscustomobject]@{ ExecutablePath = '   '; Sid = $script:sid; SessionId = 1; ProcessId = 210 },
            [pscustomobject]@{ Sid = $script:sid; SessionId = 1; ProcessId = 211 }
        )
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Tray.Running | Should Be $false
    }

    It 'keeps a valid Tray match when invalid pathless records are present' {
        $script:trayProcess = @(
            [pscustomobject]@{ ExecutablePath = $null; Sid = $script:sid; SessionId = 1; ProcessId = 212 },
            [pscustomobject]@{ ExecutablePath = '   '; Sid = $script:sid; SessionId = 1; ProcessId = 213 },
            [pscustomobject]@{ ExecutablePath = 'C:\Other\FieldOps.Tray.exe'; Sid = $script:sid; SessionId = 1; ProcessId = 214 },
            [pscustomobject]@{ ExecutablePath = $script:trayPath; Sid = $script:sid; SessionId = 1; ProcessId = 215 }
        )
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Tray.Running | Should Be $true
    }

    It 'keeps nonblank Tray provider failures visible' {
        $thrown = $false
        try { $ErrorActionPreference = 'Stop'; Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider $script:sessionProvider -TrayProcessProvider { throw 'Tray provider failed' } -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' } | Out-Null } catch { $thrown = $true }
        $thrown | Should Be $true
    }

    It 'captures stopped Agent and absent Tray and Dashboard' {
        $script:service = [pscustomobject]@{ State = 'Stopped'; StartMode = 'Auto'; PathName = '"C:\Program Files\FieldOpsDashboard\Agent\FieldOps.Agent.exe"' }
        $script:agentProcess = @()
        $script:trayProcess = @()
        $script:dashboardProcess = @()
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid -ServiceProvider $script:serviceProvider -AgentProcessProvider $script:agentProvider -SessionProvider $script:sessionProvider -TrayProcessProvider $script:trayProvider -DashboardProcessProvider $script:dashboardProvider -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Agent.Running | Should Be $false
        $snapshot.Agent.Exists | Should Be $true
        $snapshot.Tray.Running | Should Be $false
        $snapshot.Dashboard.Running | Should Be $false
        $snapshot.Revision | Should Be $null
    }

    It 'resolves default Tray discovery providers from the rollback module scope' {
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Tray | Should Not Be $null
        $snapshot.Tray.Running | Should Be $false
    }

    It 'captures one quoted case-variant production Dashboard and excludes unrelated Node' {
        $dashboardProvider = {
            @(
                [pscustomobject]@{ Name = 'node.exe'; CommandLine = '"C:\Program Files\nodejs\node.exe" "C:\FIELDOPSDASHBOARD\DIST\SERVER.CJS"'; ProcessId = 103 },
                [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node "C:\OtherApplication\server.cjs"'; ProcessId = 104 }
            )
        }
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider $dashboardProvider -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Dashboard.Running | Should Be $true
        $snapshot.Dashboard.ProcessCount | Should Be 1
        $snapshot.Dashboard.Processes[0].ProcessId | Should Be 103
    }

    It 'treats duplicate owned Dashboard servers as not running' {
        $dashboardProvider = {
            @(
                [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node C:\FieldOpsDashboard\dist\server.cjs'; ProcessId = 103 },
                [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node "C:/FieldOpsDashboard/dist/server.cjs"'; ProcessId = 104 }
            )
        }
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider $dashboardProvider -HttpProvider { param($Uri) throw 'offline' }
        $snapshot.Dashboard.Running | Should Be $false
        $snapshot.Dashboard.ProcessCount | Should Be 2
    }

    It 'captures revision from JSON string and PS5.1-like responses' {
        $json = $script:version | ConvertTo-Json
        $jsonResponse = { param($Uri) [pscustomobject]@{ StatusCode = 200; Content = $json } }
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider $jsonResponse
        $snapshot.Revision.SourceRevision | Should Be $script:revision
        $snapshot.Revision.NativeRevision | Should Be $script:revision
        $snapshot.Revision.InformationalVersion | Should Be $script:version.informationalVersion

        $ps51Response = { param($Uri) [pscustomobject]@{ StatusCode = [int]200; Content = [string]$json; Headers = @{}; RawContent = $json } }
        $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider $ps51Response
        $snapshot.Revision.SourceRevision | Should Be $script:revision
        $snapshot.Revision.NativeRevision | Should Be $script:revision
    }

    It 'leaves revision unavailable for malformed or offline responses' {
        foreach ($httpProvider in @(
            { param($Uri) [pscustomobject]@{ StatusCode = 200; Content = '{"sourceRevision":"bad"}' } },
            { param($Uri) throw 'connection refused' }
        )) {
            $snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
                -ServiceProvider { param($Name) $null } -AgentProcessProvider { @() } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider $httpProvider
            $snapshot.Revision | Should Be $null
        }
    }

    It 'restores only previously running components' {
        $snapshot = [pscustomobject]@{
            Agent = [pscustomobject]@{ Exists = $true; Running = $true }
            Tray = [pscustomobject]@{ Running = $true }
            Dashboard = [pscustomobject]@{ Running = $true }
            Revision = [pscustomobject]@{ SourceRevision = $script:revision; NativeRevision = $script:revision }
        }
        $calls = [pscustomobject]@{ Service = 0; Tray = 0; Dashboard = 0; Revision = 0 }
        $agentReady = { param($Root) [pscustomobject]@{ Status = 'Passed'; Detail = 'running' } }
        $trayReady = { param($Path, $Account, $Sid) [pscustomobject]@{ Status = 'Passed'; Detail = 'tray' } }
        $dashboardReady = { param($Root, $Revision) [pscustomobject]@{ Status = 'Passed'; Detail = 'dashboard' } }
        $result = Restore-FieldOpsRuntimeState -Snapshot $snapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -ExpectedOperatorAccount $script:operator -ExpectedOperatorSid $script:sid -ExpectedRevision $script:revision -ServiceStarter { $calls.Service++ } -TrayStarter { param($Path, $Account, $Sid) $calls.Tray++ } -DashboardStarter { param($Root) $calls.Dashboard++ } -AgentReadiness $agentReady -TrayReadiness $trayReady -DashboardReadiness $dashboardReady -RevisionReader { param($Root) $calls.Revision++; [pscustomobject]@{ sourceRevision = $script:revision; nativeRevision = $script:revision } }
        $result.Status | Should Be 'Passed'
        $calls.Service | Should Be 1
        $calls.Tray | Should Be 1
        $calls.Dashboard | Should Be 1
        $calls.Revision | Should Be 1
    }

    It 'leaves previously stopped components stopped' {
        $snapshot = [pscustomobject]@{
            Agent = [pscustomobject]@{ Exists = $true; Running = $false }
            Tray = [pscustomobject]@{ Running = $false }
            Dashboard = [pscustomobject]@{ Running = $false }
            Revision = $null
        }
        $calls = [pscustomobject]@{ Service = 0; Tray = 0; Dashboard = 0 }
        $result = Restore-FieldOpsRuntimeState -Snapshot $snapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -ExpectedOperatorAccount $script:operator -ExpectedOperatorSid $script:sid -ServiceStarter { $calls.Service++ } -TrayStarter { $calls.Tray++ } -DashboardStarter { $calls.Dashboard++ }
        $result.Status | Should Be 'Passed'
        $calls.Service | Should Be 0
        $calls.Tray | Should Be 0
        $calls.Dashboard | Should Be 0
        $result.Revision.Status | Should Be 'Warning'
    }

    It 'reports Tray restoration failure without replacing the primary result' {
        $snapshot = [pscustomobject]@{ Agent = [pscustomobject]@{ Exists = $false; Running = $false }; Tray = [pscustomobject]@{ Running = $true }; Dashboard = [pscustomobject]@{ Running = $false }; Revision = $null }
        $result = Restore-FieldOpsRuntimeState -Snapshot $snapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -ExpectedOperatorAccount $script:operator -ExpectedOperatorSid $script:sid -TrayStarter { throw 'scheduled task denied' }
        $result.Status | Should Be 'Degraded'
        $result.Tray.Status | Should Be 'Failed'
        $result.Failures[0] | Should Match 'scheduled task denied'
    }

    It 'reports Dashboard restoration failure without affecting restored files' {
        $snapshot = [pscustomobject]@{ Agent = [pscustomobject]@{ Exists = $false; Running = $false }; Tray = [pscustomobject]@{ Running = $false }; Dashboard = [pscustomobject]@{ Running = $true }; Revision = $null }
        $result = Restore-FieldOpsRuntimeState -Snapshot $snapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -ExpectedOperatorAccount $script:operator -ExpectedOperatorSid $script:sid -DashboardStarter { param($Root) } -DashboardReadiness { param($Root, $Revision) throw 'localhost unavailable' }
        $result.Status | Should Be 'Degraded'
        $result.Dashboard.Status | Should Be 'Failed'
        $result.Dashboard.Detail | Should Match 'localhost unavailable'
    }

    It 'uses the shared direct-node Dashboard starter for restoration' {
        $rollback = Get-Content -LiteralPath $modulePath -Raw
        $rollback | Should Match 'Start-FieldOpsDashboardProcess -DashboardRoot \$Root'
        $rollback | Should Not Match "Start-Process -FilePath 'npm\.cmd' -ArgumentList 'start'"
    }

    It 'reports prior source/native mismatch' {
        $snapshot = [pscustomobject]@{ Agent = [pscustomobject]@{ Exists = $false; Running = $false }; Tray = [pscustomobject]@{ Running = $false }; Dashboard = [pscustomobject]@{ Running = $false }; Revision = [pscustomobject]@{ SourceRevision = $script:revision; NativeRevision = $script:revision } }
        $result = Restore-FieldOpsRuntimeState -Snapshot $snapshot -DashboardRoot $script:dashboardRoot -NativeRoot $script:nativeRoot -TrayPath $script:trayPath -ExpectedOperatorAccount $script:operator -ExpectedOperatorSid $script:sid -RevisionReader { param($Root) [pscustomobject]@{ sourceRevision = $script:revision; nativeRevision = ('0' * 40) } }
        $result.Revision.Status | Should Be 'Failed'
    }

    It 'keeps original failure and rollback phases distinct in updater source' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match '\$updateError = \$_'
        $updater | Should Match '\[X\] Update failed:'
        $updater | Should Match 'Previous installation restored'
        $updater | Should Match 'Restore-FieldOpsRuntimeState'
        $updater | Should Match 'runtime restoration had problems'
    }

    It 'reports scoped process identity when filesystem rollback encounters a lock' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'Get-FieldOpsRollbackLockingProcesses'
        $updater | Should Match 'PID.*CommandLine.*ExecutablePath'
    }

    It 'does not leak the runtime shutdown object' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'Wait-FieldOpsRuntimeQuiescent[\s\S]*\| Out-Null'
        $updater | Should Not Match 'Status\s+Service\s+Processes'
    }

    It 'keeps rollback gated by activation and leaves backup cleanup for the next task' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match '\$deploymentStarted = \$true'
        $updater | Should Match '\$runtimeShutdownStarted -and \$null -ne \$runtimeSnapshot'
        $updater | Should Not Match 'Remove-Item -LiteralPath \$backupPath'
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

    It 'imports the direct tray discovery dependency under Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "Import-Module '$module' -Force; `$snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -TrayPath 'C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe' -OperatorAccount 'DESKTOP-88DQ68K\stick' -OperatorSid 'S-1-5-21-100-200-300-1001' -ServiceProvider { param(`$Name) `$null } -AgentProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider { param(`$Uri) throw 'offline' }; if (`$null -eq `$snapshot.Tray) { throw 'snapshot failed' }; 'discovery-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'discovery-ok'
    }

    It 'captures a local PS5.1-shaped version response in a Windows PowerShell 5.1 snapshot' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $json = ($script:version | ConvertTo-Json).Replace("'", "''")
        $command = "Import-Module '$module' -Force; `$snapshot = Get-FieldOpsRuntimeSnapshot -DashboardRoot 'C:\FieldOpsDashboard' -NativeRoot 'C:\Program Files\FieldOpsDashboard' -TrayPath 'C:\Program Files\FieldOpsDashboard\Tray\FieldOps.Tray.exe' -OperatorAccount 'DESKTOP-88DQ68K\stick' -OperatorSid 'S-1-5-21-100-200-300-1001' -ServiceProvider { param(`$Name) `$null } -AgentProcessProvider { @() } -SessionProvider { @() } -TrayProcessProvider { @() } -DashboardProcessProvider { @() } -HttpProvider { param(`$Uri) [pscustomobject]@{ StatusCode = [int]200; Content = '$json'; Headers = @{}; RawContent = '$json' } }; if (`$snapshot.Revision.SourceRevision -notmatch '^[0-9a-fA-F]{40}$') { throw 'revision unavailable' }; 'version-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'version-ok'
    }
}
