$scriptPath = Join-Path $PSScriptRoot '..\Test-FieldOpsTrayScheduledLaunch.ps1'

function Invoke-ScheduledDiagnostic {
    param([hashtable]$Parameters)
    & $scriptPath @Parameters
}

Describe 'FieldOps scheduled interactive-token Tray diagnostic' {
    BeforeEach {
        $script:originalProgramFiles = $env:ProgramFiles
        $env:ProgramFiles = $TestDrive
        $script:trayPath = Join-Path $TestDrive 'FieldOpsDashboard\Tray\FieldOps.Tray.exe'
        New-Item -ItemType Directory -Path (Split-Path $script:trayPath) -Force | Out-Null
        New-Item -ItemType File -Path $script:trayPath -Force | Out-Null
        $script:operator = [pscustomobject]@{ Account = 'DESKTOP-88DQ68K\stick'; Sid = 'S-1-5-21-100-200-300-1001'; Source = 'interactive' }
        $trayPathHolder = [pscustomobject]@{ Value = $script:trayPath }
        $script:session = [pscustomobject]@{ Account = $script:operator.Account; Sid = $script:operator.Sid; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId; ProcessId = 701 }
        $operatorHolder = [pscustomobject]@{ Value = $script:operator }
        $sessionHolder = [pscustomobject]@{ Value = $script:session }
        $processHolder = [pscustomobject]@{ Value = @() }
        $taskHolder = [pscustomobject]@{ RegisterCount = 0; RunCount = 0; DeleteCount = 0; Exists = $false; TaskName = $null; Account = $null; Path = $null; Context = $null }
        $script:operatorHolder = $operatorHolder
        $script:sessionHolder = $sessionHolder
        $script:processHolder = $processHolder
        $script:trayPathHolder = $trayPathHolder
        $script:taskHolder = $taskHolder
        $script:operatorResolver = { param($Account) $operatorHolder.Value }.GetNewClosure()
        $script:sessionProvider = { $sessionHolder.Value }.GetNewClosure()
        $script:processProvider = { $processHolder.Value }.GetNewClosure()
        $script:registerer = {
            param($TaskName, $Account, $Path, $WorkingDirectory)
            $taskHolder.RegisterCount++
            $taskHolder.TaskName = $TaskName
            $taskHolder.Account = $Account
            $taskHolder.Path = $Path
            $taskHolder.Exists = $true
            $taskHolder.Context = [pscustomobject]@{ TaskName = $TaskName; Folder = 'fake-folder'; RegisteredTask = 'fake-task' }
            return $taskHolder.Context
        }.GetNewClosure()
        $script:runner = {
            param($Context)
            $taskHolder.RunCount++
            $processHolder.Value = @([pscustomobject]@{ Account = $operatorHolder.Value.Account; Sid = $operatorHolder.Value.Sid; SessionId = $sessionHolder.Value.SessionId; ProcessId = 702; ExecutablePath = $trayPathHolder.Value })
        }.GetNewClosure()
        $script:deleter = { param($Context) $taskHolder.DeleteCount++; $taskHolder.Exists = $false }.GetNewClosure()
        $script:existsChecker = { param($Context) $taskHolder.Exists }.GetNewClosure()
    }

    AfterEach {
        $env:ProgramFiles = $script:originalProgramFiles
    }

    It 'reuses operator resolution and selects an interactive-token task without credentials' {
        $result = Invoke-ScheduledDiagnostic @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; TaskRegisterer = $script:registerer; TaskRunner = $script:runner; TaskDeleter = $script:deleter; TaskExistsChecker = $script:existsChecker; TimeoutSeconds = 1 } 2>&1 | Out-String

        $taskHolder.Account | Should Be $script:operator.Account
        $taskHolder.Path | Should Be $script:trayPath
        $taskHolder.TaskName | Should Match '^FieldOpsDashboard-DiagnosticTrayLaunch-[0-9a-f]{32}$'
        $taskHolder.RunCount | Should Be 1
        $taskHolder.DeleteCount | Should Be 1
        $taskHolder.Exists | Should Be $false
        $result | Should Match 'FieldOps operator: DESKTOP-88DQ68K\\stick'
        $result | Should Match 'Logon type: InteractiveToken'
        $result | Should Match 'Password supplied/stored: False'
        $result | Should Match 'Task registration: success'
        $result | Should Match 'Task run: success'
        $result | Should Match 'Observed Tray PID/session/SID: 702/'
        $result | Should Match 'Temporary task cleanup: success'
    }

    It 'refuses an already-running correct Tray without registering a task' {
        $script:processHolder.Value = @([pscustomobject]@{ Account = $script:operator.Account; Sid = $script:operator.Sid; SessionId = $script:session.SessionId; ProcessId = 703; ExecutablePath = $script:trayPath })

        { Invoke-ScheduledDiagnostic @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; TaskRegisterer = $script:registerer; TaskRunner = $script:runner; TaskDeleter = $script:deleter; TaskExistsChecker = $script:existsChecker } } | Should Throw 'already running'
        $taskHolder.RegisterCount | Should Be 0
        $taskHolder.DeleteCount | Should Be 0
    }

    It 'cleans up a temporary task when task run fails and preserves the exact failure' {
        $failure = { param($Context) throw 'HRESULT 0x8004131F: The task XML contains a value which is incorrectly formatted or out of range.' }

        { Invoke-ScheduledDiagnostic @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; TaskRegisterer = $script:registerer; TaskRunner = $failure; TaskDeleter = $script:deleter; TaskExistsChecker = $script:existsChecker } } | Should Throw 'HRESULT 0x8004131F'
        $taskHolder.DeleteCount | Should Be 1
        $taskHolder.Exists | Should Be $false
    }

    It 'rejects an observed Tray with the wrong SID and session' {
        $script:runner = {
            param($Context)
            $taskHolder.RunCount++
            $processHolder.Value = @([pscustomobject]@{ Account = 'DESKTOP-88DQ68K\other'; Sid = 'S-1-5-21-100-200-300-1002'; SessionId = $sessionHolder.Value.SessionId + 1; ProcessId = 704; ExecutablePath = $script:trayPath })
        }.GetNewClosure()

        { Invoke-ScheduledDiagnostic @{ OperatorResolver = $script:operatorResolver; SessionProvider = $script:sessionProvider; TrayProcessProvider = $script:processProvider; TaskRegisterer = $script:registerer; TaskRunner = $script:runner; TaskDeleter = $script:deleter; TaskExistsChecker = $script:existsChecker; TimeoutSeconds = 0 } } | Should Throw 'did not appear'
        $taskHolder.DeleteCount | Should Be 1
    }

    It 'keeps scheduled probing separate from the production launch module' {
        $source = Get-Content -LiteralPath $scriptPath -Raw
        $source | Should Match 'Schedule\.Service'
        $source | Should Match 'LogonType = 3'
        $source | Should Match 'RegisterTaskDefinition'
        $source | Should Match 'DeleteTask'
        $source | Should Not Match 'UpdateDashboard|Install-FieldOpsAgent|Stop-Service|Stop-Process|Register-FieldOpsTrayStartup|Set-ItemProperty|New-LocalGroup|Add-LocalGroupMember'
        $source | Should Not Match 'TASK_LOGON_PASSWORD|TASK_LOGON_S4U|TASK_LOGON_INTERACTIVE_TOKEN_OR_PASSWORD'
    }

    It 'parses under Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $scriptFile = (Resolve-Path $scriptPath).Path
        $command = "`$ErrorActionPreference = 'Stop'; [System.Management.Automation.Language.Parser]::ParseFile('$scriptFile', [ref]`$null, [ref]`$null) | Out-Null; 'parse-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'parse-ok'
    }
}
