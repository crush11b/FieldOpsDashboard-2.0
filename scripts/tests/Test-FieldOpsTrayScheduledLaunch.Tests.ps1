$modulePath = Join-Path $PSScriptRoot '..\..\agent\scripts\FieldOps.TrayScheduledLaunch.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'
Import-Module $modulePath -Force

Describe 'FieldOps scheduled interactive-token Tray launch' {
    BeforeEach {
        $script:trayPath = Join-Path $TestDrive 'FieldOps.Tray.exe'
        New-Item -ItemType File -Path $script:trayPath -Force | Out-Null
        $script:operator = 'DESKTOP-88DQ68K\stick'
        $script:sid = 'S-1-5-21-100-200-300-1001'
        $script:session = [pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = 1; ProcessId = 701 }
        $script:processes = @()
        $script:task = [pscustomobject]@{ RegisterCount = 0; RunCount = 0; DeleteCount = 0; Exists = $false }
        $script:sessionProvider = { $script:session }
        $script:processProvider = { $script:processes }
        $script:registerer = {
            param($TaskName, $Account, $Path, $WorkingDirectory)
            $script:task.RegisterCount++
            $script:task.Exists = $true
            [pscustomobject]@{ TaskName = $TaskName; Folder = 'folder'; RegisteredTask = 'task' }
        }
        $script:runner = {
            param($Context)
            $script:task.RunCount++
            $script:processes = @([pscustomobject]@{ Sid = $script:sid; SessionId = 1; ProcessId = 702; ExecutablePath = $script:trayPath })
        }
        $script:deleter = { param($Context) $script:task.DeleteCount++; $script:task.Exists = $false }
        $script:existsChecker = { param($Context) $script:task.Exists }
    }

    It 'launches through an interactive-token task without credentials and cleans it up' {
        $result = Start-FieldOpsTrayScheduledLaunch -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -TaskRegisterer $script:registerer `
            -TaskRunner $script:runner -TaskDeleter $script:deleter -TaskExistsChecker $script:existsChecker -TimeoutSeconds 1

        $result.Status | Should Be 'Running'
        $result.LogonType | Should Be 'InteractiveToken'
        $result.PasswordSupplied | Should Be $false
        $result.SessionId | Should Be 1
        $script:task.RegisterCount | Should Be 1
        $script:task.RunCount | Should Be 1
        $script:task.DeleteCount | Should Be 1
        $script:task.Exists | Should Be $false
    }

    It 'treats one matching existing Tray as satisfied' {
        $script:processes = @([pscustomobject]@{ Sid = $script:sid; SessionId = 1; ProcessId = 703; ExecutablePath = $script:trayPath })
        $result = Start-FieldOpsTrayScheduledLaunch -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -TaskRegisterer $script:registerer

        $result.Status | Should Be 'AlreadyRunning'
        $script:task.RegisterCount | Should Be 0
    }

    It 'cleans up when task execution fails' {
        $failure = { param($Context) throw 'HRESULT 0x8004131F: invalid task.' }
        { Start-FieldOpsTrayScheduledLaunch -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -TaskRegisterer $script:registerer `
            -TaskRunner $failure -TaskDeleter $script:deleter -TaskExistsChecker $script:existsChecker } | Should Throw 'HRESULT 0x8004131F'
        $script:task.DeleteCount | Should Be 1
        $script:task.Exists | Should Be $false
    }

    It 'requires exactly one matching interactive session' {
        { Start-FieldOpsTrayScheduledLaunch -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider { @() } -TrayProcessProvider $script:processProvider } | Should Throw 'Expected exactly one interactive session'
    }

    It 'keeps the updater on the shared helper and preserves startup registration' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Match 'FieldOps\.TrayScheduledLaunch\.psm1'
        $updater | Should Match 'Start-FieldOpsTrayScheduledLaunch'
        $updater | Should Match 'interactive FieldOps Tray availability could not be verified'
        $updater | Should Not Match 'Start-FieldOpsTray\s*`'
        $updater.IndexOf('Ensure-FieldOpsTelemetryCredentials') | Should BeLessThan $updater.IndexOf('Start-FieldOpsTrayScheduledLaunch')
        $installer = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\agent\scripts\Install-FieldOpsAgent.ps1') -Raw
        $installer | Should Match 'Register-FieldOpsTrayStartup'
    }

    It 'restores the Tray from the deployment helper through the interactive-token path' {
        $deployment = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\Deploy-ToughBook.ps1') -Raw
        $deployment | Should Match 'FieldOps\.TrayScheduledLaunch\.psm1'
        $deployment | Should Match 'Start-FieldOpsTrayScheduledLaunch'
        $deployment | Should Match 'Tray running/restored'
        $deployment | Should Match 'interactive Tray restoration failed'
        $deployment | Should Not Match 'Start-Process.*FieldOps\.Tray\.exe'
    }
}
