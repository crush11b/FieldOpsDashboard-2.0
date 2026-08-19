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
}
