$modulePath = Join-Path $PSScriptRoot '..\FieldOps.TrayLaunch.psm1'
$updaterPath = Join-Path $PSScriptRoot '..\..\..\UpdateDashboard.ps1'

Describe 'FieldOps direct-token diagnostics' {
    It 'does not remain in the updater production launch path' {
        $updater = Get-Content -LiteralPath $updaterPath -Raw
        $updater | Should Not Match 'FieldOps\.TrayLaunch\.psm1'
        $updater | Should Not Match 'Start-FieldOpsTray\s*`'
        $updater | Should Match 'FieldOps\.TrayScheduledLaunch\.psm1'
        $updater | Should Match 'Start-FieldOpsTrayScheduledLaunch'
    }

    It 'keeps historical direct-token diagnostics free of unrelated process termination' {
        $module = Get-Content -LiteralPath $modulePath -Raw
        $module | Should Not Match 'Stop-Process'
        $module | Should Not Match 'WebView2'
        $module | Should Not Match 'Get-Process.*node'
    }

    It 'parses under Windows PowerShell 5.1' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $module = (Resolve-Path $modulePath).Path
        $command = "[System.Management.Automation.Language.Parser]::ParseFile('$module', [ref]`$null, [ref]`$null) | Out-Null; 'parse-ok'"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $output = & $powershell.Source -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded 2>&1
        $LASTEXITCODE | Should Be 0
        ($output -join "`n") | Should Match 'parse-ok'
    }
}
