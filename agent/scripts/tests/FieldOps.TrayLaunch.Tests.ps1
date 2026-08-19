$modulePath = Join-Path $PSScriptRoot '..\FieldOps.TrayLaunch.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\..\UpdateDashboard.ps1'
$installerPath = Join-Path $PSScriptRoot '..\Install-FieldOpsAgent.ps1'
Import-Module $modulePath -Force

Describe 'FieldOps immediate Tray launch' {
    BeforeEach {
        $script:trayRoot = Join-Path $TestDrive ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $script:trayRoot -Force | Out-Null
        $script:trayPath = Join-Path $script:trayRoot 'FieldOps.Tray.exe'
        New-Item -ItemType File -Path $script:trayPath -Force | Out-Null
        $script:operator = 'DESKTOP-88DQ68K\stick'
        $script:sid = 'S-1-5-21-100-200-300-1001'
        $script:session = [pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; ProcessId = 401 }
        $script:processes = @()
        $script:launchCount = 0
        $script:launcher = {
            param($Session, $Path)
            $script:launchCount++
            $script:processes = @([pscustomobject]@{ Account = $Session.Account; Sid = $script:sid; SessionId = $Session.SessionId; ProcessId = 501; ExecutablePath = $Path })
            return 501
        }
        $script:sessionProvider = { $script:session }
        $script:processProvider = { $script:processes }
    }

    It 'launches in the resolved operator session using the resolved identity' {
        $result = Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -ProcessLauncher $script:launcher

        $result.Status | Should Be 'Running'
        $result.SessionId | Should Be ([Diagnostics.Process]::GetCurrentProcess().SessionId)
        $result.Sid | Should Be $script:sid
        $script:launchCount | Should Be 1
    }

    It 'does not use the elevated administrator identity for launch' {
        $elevated = 'DESKTOP-88DQ68K\Administrator'
        $captured = $null
        $launcher = {
            param($Session, $Path)
            $script:captured = $Session
            $script:processes = @([pscustomobject]@{ Account = $Session.Account; Sid = $Session.Sid; SessionId = $Session.SessionId; ProcessId = 502; ExecutablePath = $Path })
            return 502
        }

        Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -ProcessLauncher $launcher | Out-Null

        $script:captured.Account | Should Be $script:operator
        $script:captured.Account | Should Not Be $elevated
        $script:captured.Sid | Should Be $script:sid
    }

    It 'treats the correct existing Tray as satisfied' {
        $script:processes = @([pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; ProcessId = 601; ExecutablePath = $script:trayPath })

        $result = Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -ProcessLauncher $script:launcher

        $result.Status | Should Be 'AlreadyRunning'
        $script:launchCount | Should Be 0
    }

    It 'rejects an operator with no active session' {
        { Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider { @() } -TrayProcessProvider $script:processProvider -ProcessLauncher $script:launcher } |
            Should Throw 'No active interactive session'
    }

    It 'rejects an operator and session identity mismatch' {
        $wrongSession = { [pscustomobject]@{ Account = 'DESKTOP-88DQ68K\other'; Sid = 'S-1-5-21-100-200-300-1002'; SessionId = 2; ProcessId = 402 } }

        { Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $wrongSession -TrayProcessProvider $script:processProvider -ProcessLauncher $script:launcher } |
            Should Throw 'No active interactive session'
    }

    It 'rejects a missing Tray executable' {
        { Start-FieldOpsTray -TrayPath (Join-Path $script:trayRoot 'missing.exe') -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $script:processProvider -ProcessLauncher $script:launcher } |
            Should Throw 'Cannot find path'
    }

    It 'rejects a cross-session launch before invoking the launcher' {
        $crossSession = { [pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = ([Diagnostics.Process]::GetCurrentProcess().SessionId + 1); ProcessId = 402 } }
        $launcher = { param($Session, $Path) $script:launchCount++; return 505 }

        { Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $crossSession -TrayProcessProvider $script:processProvider -ProcessLauncher $launcher } |
            Should Throw 'does not support cross-session Tray launch'
        $script:launchCount | Should Be 0
    }

    It 'reports a bounded failure when the launched Tray never appears' {
        $launcher = { param($Session, $Path) $script:launchCount++; return 503 }

        { Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider { @() } -ProcessLauncher $launcher `
            -TimeoutSeconds 0 -PollMilliseconds 0 } |
            Should Throw 'did not appear'
        $script:launchCount | Should Be 1
    }

    It 'accepts a Tray that appears after launch' {
        $script:polls = 0
        $provider = {
            $script:polls++
            if ($script:polls -lt 2) { return @() }
            return @([pscustomobject]@{ Account = $script:operator; Sid = $script:sid; SessionId = 1; ProcessId = 504; ExecutablePath = $script:trayPath })
        }
        $launcher = { param($Session, $Path) return 504 }

        $result = Start-FieldOpsTray -TrayPath $script:trayPath -OperatorAccount $script:operator -OperatorSid $script:sid `
            -SessionProvider $script:sessionProvider -TrayProcessProvider $provider -ProcessLauncher $launcher `
            -TimeoutSeconds 2 -PollMilliseconds 0

        $result.Status | Should Be 'Running'
    }

    It 'does not terminate unrelated processes or WebView2' {
        $moduleSource = Get-Content -LiteralPath $modulePath -Raw
        $moduleSource | Should Not Match 'Stop-Process'
        $moduleSource | Should Not Match 'WebView2'
        $moduleSource | Should Not Match 'Get-Process.*node'
    }
}

Describe 'FieldOps immediate Tray launch integration' {
    $updater = Get-Content -LiteralPath $updaterPath -Raw
    $installer = Get-Content -LiteralPath $installerPath -Raw

    It 'imports and compiles the interop with Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "Import-Module -Name '$module' -Force; if (`$null -eq ('FieldOpsDashboard.Deployment.InteractiveProcess' -as [type])) { throw 'InteractiveProcess type was not compiled.' }"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1

        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Not Match 'Add-Type|ParserError|; expected'
    }

    It 'preserves the native Win32 error code and message in diagnostics' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "Import-Module -Name '$module' -Force; [FieldOpsDashboard.Deployment.InteractiveProcess]::FormatWin32Error(1314, 'CreateProcessWithTokenW')"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $diagnostic = (& $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1) -join "`n"

        $diagnostic | Should Match '^CreateProcessWithTokenW failed\. Win32 error 1314:'
        $diagnostic | Should Match 'A required privilege is not held by the client'
    }

    It 'preserves ERROR_ACCESS_DENIED diagnostics for CreateProcessWithTokenW' {
        [FieldOpsDashboard.Deployment.InteractiveProcess]::FormatWin32Error(5, 'CreateProcessWithTokenW') |
            Should Match '^CreateProcessWithTokenW failed\. Win32 error 5: Access is denied'
    }

    It 'loads the helper after installer completion and preserves startup registration' {
        $updater | Should Match 'FieldOps\.TrayLaunch\.psm1'
        $updater | Should Match 'Start-FieldOpsTray'
        $updater | Should Match '-OperatorAccount \$OperatorAccount'
        $updater | Should Match '-OperatorSid \$resolvedOperator\.Sid'
        $updater.IndexOf('Ensure-FieldOpsTelemetryCredentials') | Should BeLessThan $updater.IndexOf('Start-FieldOpsTray')
        $installer | Should Match 'Register-FieldOpsTrayStartup'
    }

    It 'uses explicit process identity APIs rather than the elevated updater token' {
        $module = Get-Content -LiteralPath $modulePath -Raw
        $module | Should Match 'CreateProcessWithTokenW'
        $module | Should Match 'ProbeSourceToken'
        $module | Should Match 'ProbeDuplicatedToken'
        $module | Should Match 'DuplicateTokenEx'
        $module | Should Match 'OpenProcessToken'
        $module | Should Not Match 'CreateProcessAsUser|winsta0\\\\default'
        $module | Should Not Match 'Start-Process'
    }

    It 'keeps the documented minimum token and process cleanup contract' {
        $module = Get-Content -LiteralPath $modulePath -Raw
        $module.Contains('TokenAssignPrimary = 0x0001') | Should Be $true
        $module.Contains('TokenDuplicate = 0x0002') | Should Be $true
        $module.Contains('TokenQuery = 0x0008') | Should Be $true
        $module.Contains('TokenAssignPrimary | TokenDuplicate | TokenQuery') | Should Be $true
        $module.Contains('CreateProcessWithTokenW(primaryToken, 0, executablePath, commandLine, 0, IntPtr.Zero') | Should Be $true
        $module.Contains('finally') | Should Be $true
        $module.Contains('CloseHandle(processInformation.thread)') | Should Be $true
        $module.Contains('CloseHandle(processInformation.process)') | Should Be $true
        $module.Contains('CloseHandle(primaryToken)') | Should Be $true
        $module.Contains('CloseHandle(sourceToken)') | Should Be $true
        $module.Contains('CloseHandle(process)') | Should Be $true
    }

    It 'keeps the production Launch path on the duplicated primary token' {
        $module = Get-Content -LiteralPath $modulePath -Raw
        $launchBody = $module.Substring($module.IndexOf('public static int Launch('), $module.IndexOf('public static int ProbeSourceToken(') - $module.IndexOf('public static int Launch('))
        $launchBody | Should Match 'DuplicateTokenEx\(sourceToken'
        $launchBody | Should Match 'CreateProcessWithTokenW\(primaryToken'
        $launchBody | Should Not Match 'ProbeSourceToken|ProbeDuplicatedToken'
    }
}
