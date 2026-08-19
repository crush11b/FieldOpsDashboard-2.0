$scriptPath = Join-Path $PSScriptRoot '..\Test-FieldOpsInteractiveTrayLaunch.ps1'

function Invoke-DiagnosticScript {
    param([hashtable]$Parameters)
    if (-not $Parameters.ContainsKey('TokenInspectionProvider')) {
        $Parameters.TokenInspectionProvider = $script:tokenInspectionProvider
    }
    & $scriptPath @Parameters
}

Describe 'FieldOps focused interactive Tray launch diagnostic' {
    BeforeEach {
        $script:trayPath = Join-Path $TestDrive 'FieldOps.Tray.exe'
        New-Item -ItemType File -Path $script:trayPath -Force | Out-Null
        $script:operator = [pscustomobject]@{ Account = 'DESKTOP-88DQ68K\stick'; Sid = 'S-1-5-21-100-200-300-1001'; Source = 'interactive' }
        $script:session = [pscustomobject]@{ Account = $script:operator.Account; Sid = $script:operator.Sid; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; ProcessId = 701 }
        $operatorHolder = [pscustomobject]@{ Value = $script:operator }
        $sessionHolder = [pscustomobject]@{ Value = $script:session }
        $processHolder = [pscustomobject]@{ Value = @() }
        $launchHolder = [pscustomobject]@{ Count = 0 }
        $requestedAccountHolder = [pscustomobject]@{ Value = $null }
        $script:operatorHolder = $operatorHolder
        $script:processHolder = $processHolder
        $script:launchHolder = $launchHolder
        $script:requestedAccountHolder = $requestedAccountHolder
        $script:operatorResolver = { param($Account) $requestedAccountHolder.Value = $Account; $operatorHolder.Value }.GetNewClosure()
        $script:sessionProvider = { $sessionHolder.Value }.GetNewClosure()
        $script:processProvider = { $processHolder.Value }.GetNewClosure()
        $script:launcher = {
            param($Path, $Account, $Sid, $Timeout)
            $launchHolder.Count++
            [pscustomobject]@{ Status = 'Running'; ProcessId = 702; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; Account = $Account; Sid = $Sid; TrayPath = $Path }
        }.GetNewClosure()
        $script:privileges = { @([pscustomobject]@{ Privilege = 'SeAssignPrimaryTokenPrivilege'; State = 'Disabled' }, [pscustomobject]@{ Privilege = 'SeIncreaseQuotaPrivilege'; State = 'Disabled' }, [pscustomobject]@{ Privilege = 'SeImpersonatePrivilege'; State = 'Enabled' }) }
        $tokenInspectionHolder = [pscustomobject]@{ Value = [pscustomobject]@{
            SourceProcessSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
            SourceToken = [pscustomobject]@{ Label = 'Source Explorer token'; TokenType = 'Primary'; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; UserSid = $script:operator.Sid; IntegrityLevel = 'High'; ElevationType = 'Full'; IsElevated = $true; VirtualizationAllowed = $false; VirtualizationEnabled = $false; IsRestricted = $false; HasLinkedToken = $false; RequestedAccessMask = 11; HandleAcquired = $true }
            DuplicatedToken = [pscustomobject]@{ Label = 'Duplicated primary token'; TokenType = 'Primary'; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; UserSid = $script:operator.Sid; IntegrityLevel = 'High'; ElevationType = 'Full'; IsElevated = $true; VirtualizationAllowed = $false; VirtualizationEnabled = $false; IsRestricted = $false; HasLinkedToken = $false; RequestedAccessMask = 11; HandleAcquired = $true }
            GrantedAccessNote = 'injected diagnostic fixture'
        } }
        $script:tokenInspectionProvider = { $tokenInspectionHolder.Value }.GetNewClosure()
        $script:originalProgramFiles = $env:ProgramFiles
        $env:ProgramFiles = $TestDrive
        $script:expectedTray = Join-Path $TestDrive 'FieldOpsDashboard\Tray\FieldOps.Tray.exe'
        New-Item -ItemType Directory -Path (Split-Path $script:expectedTray) -Force | Out-Null
        Move-Item -LiteralPath $script:trayPath -Destination $script:expectedTray -Force
        $script:trayPath = $script:expectedTray
    }

    AfterEach {
        $env:ProgramFiles = $script:originalProgramFiles
    }

    It 'reuses automatic operator resolution and displays the target session' {
        $result = Invoke-DiagnosticScript @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; LaunchInvoker = $script:launcher; PrivilegeProvider = $script:privileges; TimeoutSeconds = 1 } 2>&1 | Out-String
        $script:requestedAccountHolder.Value | Should BeNullOrEmpty
        $result | Should Match 'FieldOps operator: DESKTOP-88DQ68K\\stick'
        $result | Should Match ('Target Explorer session ID: ' + [Diagnostics.Process]::GetCurrentProcess().SessionId)
        $result | Should Match 'Target Explorer/source PID: 701'
        $result | Should Match 'Launch API: CreateProcessWithTokenW'
        $result | Should Match 'SeImpersonatePrivilege: Enabled'
    }

    It 'reuses an explicit operator override' {
        Invoke-DiagnosticScript @{ OperatorAccount = 'DESKTOP-88DQ68K\stick'; OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; LaunchInvoker = $script:launcher; PrivilegeProvider = $script:privileges; TimeoutSeconds = 1 } | Out-Null
        $script:requestedAccountHolder.Value | Should Be 'DESKTOP-88DQ68K\stick'
    }

    It 'resolves the installed Tray path and reports a missing executable' {
        Remove-Item -LiteralPath $script:expectedTray -Force
        { Invoke-DiagnosticScript @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; LaunchInvoker = $script:launcher; PrivilegeProvider = $script:privileges } } | Should Throw 'FieldOps tray executable was not found'
    }

    It 'reports a correct existing Tray without launching' {
        $script:processHolder.Value = @([pscustomobject]@{ Account = $script:operator.Account; Sid = $script:operator.Sid; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; ProcessId = 703; ExecutablePath = $script:expectedTray })
        $result = Invoke-DiagnosticScript @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; LaunchInvoker = $script:launcher; PrivilegeProvider = $script:privileges } 2>&1 | Out-String
        $script:launchHolder.Count | Should Be 0
        $result | Should Match 'PID 703'
        $result | Should Match 'already running'
    }

    It 'calls the production launch path when Tray is absent and renders success' {
        $result = Invoke-DiagnosticScript @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; LaunchInvoker = $script:launcher; PrivilegeProvider = $script:privileges; TimeoutSeconds = 4 } 2>&1 | Out-String
        $script:launchHolder.Count | Should Be 1
        $result | Should Match 'Diagnostic result: Running'
        $result | Should Match 'Tray PID: 702'
    }

    It 'preserves the exact native Win32 error text' {
        $script:failure = { param($Path, $Account, $Sid, $Timeout) throw 'CreateProcessWithTokenW failed. Win32 error 1314: A required privilege is not held by the client.' }
        { Invoke-DiagnosticScript @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; LaunchInvoker = $script:failure; PrivilegeProvider = $script:privileges } } | Should Throw 'CreateProcessWithTokenW failed. Win32 error 1314'
    }

    It 'extracts source and duplicated token summaries with the documented access masks' {
        $inspection = [FieldOpsDashboard.Deployment.InteractiveProcess]::InspectToken([uint32]$PID)

        $inspection.SourceToken.TokenType | Should Be 'Primary'
        $inspection.DuplicatedToken.TokenType | Should Be 'Primary'
        $inspection.SourceToken.SessionId | Should Be ([Diagnostics.Process]::GetCurrentProcess().SessionId)
        $inspection.DuplicatedToken.SessionId | Should Be ([Diagnostics.Process]::GetCurrentProcess().SessionId)
        $inspection.SourceToken.UserSid | Should Not BeNullOrEmpty
        $inspection.DuplicatedToken.UserSid | Should Be $inspection.SourceToken.UserSid
        $inspection.SourceToken.IntegrityLevel | Should Not BeNullOrEmpty
        $inspection.DuplicatedToken.IntegrityLevel | Should Be $inspection.SourceToken.IntegrityLevel
        $inspection.SourceToken.RequestedAccessMask | Should Be 11
        $inspection.DuplicatedToken.RequestedAccessMask | Should Be 11
        $inspection.SourceToken.HandleAcquired | Should Be $true
        $inspection.DuplicatedToken.HandleAcquired | Should Be $true
    }

    It 'uses read-only privilege diagnostics and reports the selected launch API' {
        $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\agent\scripts\FieldOps.TrayLaunch.psm1') -Raw
        $diagnostic = Get-Content -LiteralPath $scriptPath -Raw
        $source | Should Match 'Get-FieldOpsCallerPrivilegeState'
        $source | Should Not Match 'EnableForCreateProcessAsUser|AdjustTokenPrivileges|CreateProcessAsUser'
        $diagnostic | Should Match 'Launch API: CreateProcessWithTokenW'
        $diagnostic | Should Match 'Caller privilege state after launch'
        $diagnostic | Should Match 'Source Explorer process session ID'
        $diagnostic | Should Match 'DuplicateTokenEx requested access'
        $diagnostic | Should Match 'Granted access diagnostic'
        $diagnostic | Should Match 'Direct source-token CreateProcessWithTokenW probe: not attempted'
    }

    It 'handles the documented privilege states and native cleanup contract' {
        $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\agent\scripts\FieldOps.TrayLaunch.psm1') -Raw
        $source | Should Match 'SeAssignPrimaryTokenPrivilege'
        $source | Should Match 'SeIncreaseQuotaPrivilege'
        $source | Should Match 'State = "NotAssigned"'
        $source | Should Match 'State = .*Enabled.*Disabled'
        $source | Should Match 'SeImpersonatePrivilege'
        $source | Should Not Match 'TOKEN_ADJUST_PRIVILEGES|TokenAdjustPrivileges|AdjustTokenPrivileges'
        $source | Should Match 'CloseHandle'
    }

    It 'does not contain updater, install, service, or process shutdown calls' {
        $source = Get-Content -LiteralPath $scriptPath -Raw
        $source | Should Not Match 'UpdateDashboard|Install-FieldOpsAgent|Stop-Service|Stop-Process|Start-Service|New-LocalGroup|Add-LocalGroupMember|Register-FieldOpsTrayStartup|Provision-FieldOpsTelemetryCredential'
    }

    It 'parses and executes under Windows PowerShell 5.1 without requiring PowerShell 7' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path (Join-Path $PSScriptRoot '..\..\agent\scripts\FieldOps.TrayLaunch.psm1')).Path
        $command = "Import-Module -Name '$module' -Force; if (`$null -eq ('FieldOpsDashboard.Deployment.InteractiveProcess' -as [type])) { throw 'InteractiveProcess type was not compiled.' }"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Not Match 'ParserError|Add-Type|; expected'
    }

    It 'executes the diagnostic entry point under Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -File $scriptPath -InstallPath 'C:\FieldOpsDashboard' 2>&1
        ($output -join "`n") | Should Match 'Tray executable path:'
        ($output -join "`n") | Should Not Match 'ParserError|Add-Type|; expected'
    }
}