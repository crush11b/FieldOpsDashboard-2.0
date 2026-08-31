$launcherPath = Join-Path $PSScriptRoot '..\..\FieldOpsDevelopmentUpdater.ps1'
$batchPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.bat'
$setupPath = Join-Path $PSScriptRoot '..\Install-FieldOpsDevelopmentUpdater.ps1'

Describe 'FieldOps CF-20 development updater' {
    BeforeAll {
        $script:launcher = Get-Content -LiteralPath $launcherPath -Raw
        $script:batch = Get-Content -LiteralPath $batchPath -Raw
        $script:setup = Get-Content -LiteralPath $setupPath -Raw
    }

    It 'uses the explicit development branch and GitHub HTTPS resolution' {
        $script:launcher | Should Match "feature/2\.7-connected-operations"
        $script:launcher | Should Match 'api\.github\.com/repos/\$RepositoryName/commits/\$BranchName'
        $script:launcher | Should Match 'curl\.exe --fail --silent --show-error --location'
    }

    It 'accepts a full SHA override without resolving the branch' {
        $script:launcher | Should Match 'ExplicitRevision'
        $script:launcher | Should Match 'Assert-FullSha -Value \$ExplicitRevision'
        $script:launcher | Should Match 'if \(-not \[string\]::IsNullOrWhiteSpace\(\$ExplicitRevision\)\)'
    }

    It 'uses the resolved SHA for updater download, invocation, and identity verification' {
        $script:launcher | Should Match 'raw\.githubusercontent\.com/\$RepositoryName/\$ResolvedRevision/\$\(\$relativePath\.Replace'
        $script:launcher | Should Match 'FieldOps\.BackupRetention\.psm1'
        $script:launcher | Should Match '-Revision \$resolvedRevision'
        $script:launcher | Should Match 'Get-InstalledVersion -ExpectedRevision \$resolvedRevision'
        $script:launcher | Should Match 'sourceRevision.*ExpectedRevision'
        $script:launcher | Should Match 'nativeRevision.*ExpectedRevision'
    }

    It 'passes the exact source SHA to the SHA-keyed native artifact workflow' {
        $script:launcher | Should Match 'releases/download/native-\$resolvedRevision/fieldops-native-win-x64\.zip'
    }

    It 'keeps native artifact retrieval immutable and rejects stale or mismatched artifacts' {
        $updater = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1') -Raw
        $updater | Should Match 'NativeArtifactUrl'
        $updater | Should Match 'Native artifact download failed'
        $updater | Should Match 'Native artifact revision.*does not match requested source revision'
        $updater | Should Match 'Deployment was not activated'
    }

    It 'packages and validates every native artifact path required by the updater' {
        $workflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\.github\workflows\native-artifacts.yml') -Raw
        $workflow | Should Match 'publish/win-x64/p533-assets'
        $workflow | Should Match 'Test-FieldOpsNativePackage.ps1'
        $validator = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\agent\scripts\Test-FieldOpsNativePackage.ps1') -Raw
        foreach ($relative in @('artifact-manifest.json','agent\FieldOps.Agent.exe','tray\FieldOps.Tray.exe','p533-assets\manifest.json','p533-assets\runtime\provenance.json')) {
            $validator | Should Match ([regex]::Escape($relative))
        }
    }

    It 'constructs a public native release URL tied to the requested SHA' {
        $revision = '996d747ade70c37e71d6db12872832dff3af5490'
        $script:launcher | Should Match 'NativeArtifactUrl.*releases/download/native-\$resolvedRevision/fieldops-native-win-x64\.zip'
        $expectedUrl = "https://github.com/crush11b/FieldOpsDashboard-2.0/releases/download/native-$revision/fieldops-native-win-x64.zip"
        $expectedUrl | Should Match "native-$revision/fieldops-native-win-x64\.zip$"
    }

    It 'has no old revision or moving-branch fallback' {
        $script:launcher | Should Not Match 'REVISION='
        $script:launcher | Should Not Match 'Branch.*main'
        $script:launcher | Should Not Match 'latest downloaded updater|previous build|previous revision'
        $script:launcher | Should Match 'throw "Could not resolve development branch'
        $script:launcher | Should Match 'Assert-FullSha -Value \(\[string\]\$response\.sha\)'
    }

    It 'preserves downloaded updater bootstrap validation and deployment failures' {
        $script:launcher | Should Match 'Parser\]::ParseFile'
        $script:launcher | Should Match "@\('Revision', 'OperatorAccount', 'EnableCf20GnssRecovery'\)"
        $script:launcher | Should Match 'UpdateDashboard\.ps1 failed with exit code'
        $script:launcher | Should Match 'FIELDOPS DEVELOPMENT UPDATE FAILED'
        $script:launcher | Should Match 'exit 1'
    }

    It 'enables CF-20 recovery only through the explicit deployment switch' {
        $updater = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1') -Raw
        $script:launcher | Should Match '-EnableCf20GnssRecovery'
        $updater | Should Match 'EnableCf20GnssRecovery'
        $updater | Should Match 'Agent__Location__Recovery__Enabled=true'
        $updater | Should Match 'Agent__Location__Recovery__Provider=SierraEm7455B'
        $updater | Should Match 'Agent__Location__Recovery__ControlPort=COM7'
        $updater | Should Match 'Agent__Location__Recovery__ControlBaud=115200'
        $updater | Should Match 'AdditionalServiceEnvironment'
    }

    It 'passes the production recovery configuration through the installer boundary under Windows PowerShell' {
        $powershell = Get-Command powershell.exe -ErrorAction Stop
        $scriptPath = Join-Path $PSScriptRoot '..\..\UpdateDashboard.ps1'
        $tokens = $null
        $parseErrors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
        $helper = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-FieldOpsAgentInstaller' }, $true)
        $stage = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-FieldOpsAgentInstallStage' }, $true)
        $probeRoot = Join-Path $env:TEMP ('fieldops-installer-binding-' + [Guid]::NewGuid().ToString('N'))
        $probePath = Join-Path $probeRoot 'probe.ps1'
        $runnerPath = Join-Path $probeRoot 'runner.ps1'
        $outputPath = Join-Path $probeRoot 'result.jsonl'
        New-Item -ItemType Directory -Path $probeRoot -Force | Out-Null
        @'
param(
    [string]$PublishPath,
    [string]$TrayPublishPath,
    [Parameter(Mandatory = $true)][string]$OperatorAccount,
    [AllowEmptyCollection()][string[]]$AdditionalServiceEnvironment = @()
)
[ordered]@{
    bound = $PSBoundParameters.ContainsKey('AdditionalServiceEnvironment')
    values = @($AdditionalServiceEnvironment)
} | ConvertTo-Json -Compress | Add-Content -LiteralPath $env:FIELDOPS_BINDING_OUTPUT
'@ | Set-Content -LiteralPath $probePath
        $runner = @"
$($helper.Extent.Text)
$($stage.Extent.Text)

`$env:FIELDOPS_BINDING_OUTPUT = '$($outputPath.Replace("'", "''"))'
Invoke-FieldOpsAgentInstallStage -InstallerPath '$($probePath.Replace("'", "''"))' -PublishPath 'agent' -TrayPublishPath 'tray' -OperatorAccount 'operator' -EnableCf20GnssRecovery
Invoke-FieldOpsAgentInstallStage -InstallerPath '$($probePath.Replace("'", "''"))' -PublishPath 'agent' -TrayPublishPath 'tray' -OperatorAccount 'operator'
"@
        Set-Content -LiteralPath $runnerPath -Value $runner
        try {
            $runnerOutput = @(& $powershell.Source -NoProfile -ExecutionPolicy Bypass -File $runnerPath 2>&1)
            if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell production-path regression failed: $($runnerOutput -join [Environment]::NewLine)" }
            $records = @(Get-Content -LiteralPath $outputPath | ForEach-Object { $_ | ConvertFrom-Json })
            $records.Count | Should Be 2
            $records[0].bound | Should Be $true
            @($records[0].values) | Should Be @('Agent__Location__Recovery__Enabled=true', 'Agent__Location__Recovery__Provider=SierraEm7455B', 'Agent__Location__Recovery__ControlPort=COM7', 'Agent__Location__Recovery__ControlBaud=115200')
            $records[1].bound | Should Be $false
            @($records[1].values).Count | Should Be 0
        } finally {
            Remove-Item -LiteralPath $probeRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'self elevates once and preserves command arguments' {
        $script:batch | Should Match 'fltmc'
        $script:batch | Should Match "Start-Process -FilePath '%~f0' -Verb RunAs"
        $script:batch | Should Match "Start-Process -FilePath '%~f0' -ArgumentList '%\*' -Verb RunAs"
        $script:batch | Should Match '%\*'
        $script:batch | Should Match 'exit /b'
    }

    It 'keeps the BAT as the only deployment entry point and installs one obvious desktop shortcut' {
        $script:batch | Should Match 'FieldOpsDevelopmentUpdater\.ps1'
        $script:setup | Should Match "Deploy FieldOps Development\.lnk"
        $script:setup | Should Match 'UpdateDashboard\.bat'
        $script:setup | Should Match 'SHELL32\.dll'
        $script:setup | Should Not Match 'Deploy-ToughBook\.ps1'
    }

    It 'executes shortcut setup without RepositoryRoot and targets the copied BAT' {
        $destination = Join-Path $env:TEMP ('fieldops-updater-test-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destination | Out-Null
        try {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setupPath -DesktopPath $destination
            $LASTEXITCODE | Should Be 0
            $shortcutPath = Join-Path $destination 'Deploy FieldOps Development.lnk'
            Test-Path -LiteralPath $shortcutPath | Should Be $true
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath | Should Be (Join-Path $destination 'UpdateDashboard.bat')
            Test-Path -LiteralPath (Join-Path $destination 'FieldOpsDevelopmentUpdater.ps1') | Should Be $true
        } finally {
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'downloads and validates the complete bootstrap tree from one exact SHA' {
        . $launcherPath
        $destination = Join-Path $env:TEMP ('fieldops-bootstrap-test-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destination | Out-Null
        $revision = '996d747ade70c37e71d6db12872832dff3af5490'
        $script:bootstrapCalls = @()
        try {
            $files = Invoke-DevelopmentBootstrapDownload -RepositoryName 'crush11b/FieldOpsDashboard-2.0' -ResolvedRevision $revision -BootstrapRoot $destination -DownloadInvoker {
                param($Url, $Path)
                $script:bootstrapCalls += $Url
                $relative = $Url.Substring($Url.IndexOf($revision) + $revision.Length + 1)
                $source = Join-Path (Split-Path $launcherPath -Parent) 'scripts\FieldOps.BackupRetention.psm1'
                if ($relative -eq 'UpdateDashboard.ps1') { $source = Join-Path (Split-Path $launcherPath -Parent) 'UpdateDashboard.ps1' }
                Copy-Item -LiteralPath $source -Destination $Path
            }
            @($files).Count | Should Be 2
            Test-Path -LiteralPath (Join-Path $destination 'UpdateDashboard.ps1') | Should Be $true
            Test-Path -LiteralPath (Join-Path $destination 'scripts\FieldOps.BackupRetention.psm1') | Should Be $true
            @($script:bootstrapCalls).Count | Should Be 2
            $script:bootstrapCalls | ForEach-Object { $_ | Should Match ([regex]::Escape("/$revision/")) }
        } finally {
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'keeps every updater pre-install dependency in the explicit bootstrap contract' {
        . $launcherPath
        $updater = Get-Content -LiteralPath (Join-Path (Split-Path $launcherPath -Parent) 'UpdateDashboard.ps1') -Raw
        $bootstrapFiles = @(Get-DevelopmentBootstrapFiles)
        $updater | Should Match 'Join-Path \$PSScriptRoot ''scripts\\FieldOps\.BackupRetention\.psm1'''
        (($bootstrapFiles -contains 'UpdateDashboard.ps1')) | Should Be $true
        (($bootstrapFiles -contains 'scripts\FieldOps.BackupRetention.psm1')) | Should Be $true
    }

    It 'fails a missing current companion download even when stale content exists' {
        . $launcherPath
        $destination = Join-Path $env:TEMP ('fieldops-bootstrap-stale-test-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path (Join-Path $destination 'scripts') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $destination 'scripts\FieldOps.BackupRetention.psm1') -Value 'stale content'
        $script:downloaded = @()
        try {
            $caught = $false
            try {
                Invoke-DevelopmentBootstrapDownload -RepositoryName 'crush11b/FieldOpsDashboard-2.0' -ResolvedRevision ('a' * 40) -BootstrapRoot $destination -DownloadInvoker {
                    param($Url, $Path)
                    $script:downloaded += $Url
                    if ($Path -match 'BackupRetention') { throw 'simulated companion download failure' }
                    Set-Content -LiteralPath $Path -Value (Get-Content -LiteralPath $launcherPath -Raw)
                }
            } catch { $caught = $true }
            $caught | Should Be $true
            @($script:downloaded).Count | Should Be 2
            (Get-Content -LiteralPath (Join-Path $destination 'scripts\FieldOps.BackupRetention.psm1') -Raw).Trim() | Should Be 'stale content'
        } finally {
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'executes the BAT elevation construction with a spaced path and preserves arguments' {
        $destination = Join-Path $env:TEMP ('FieldOps Updater Test ' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destination | Out-Null
        $batCopy = Join-Path $destination 'Deploy FieldOps Development.bat'
        Copy-Item -LiteralPath $batchPath -Destination $batCopy
        try {
            $env:FIELDOPS_UPDATER_ELEVATION_TEST = '1'
            $probeOutput = Join-Path $destination 'probe.txt'
            $env:FIELDOPS_UPDATER_PROBE_OUTPUT = $probeOutput
            & cmd.exe /d /c "`"$batCopy`" 20ec56a120d4f38f4e39dd9fc676dcbdbfcf5972"
            $LASTEXITCODE | Should Be 0
            $probe = Get-Content -LiteralPath $probeOutput -Raw
            $probe | Should Match ([regex]::Escape("ELEVATION_PROBE_PATH=$batCopy"))
            $probe | Should Match 'ELEVATION_PROBE_ARGS=--fieldops-elevation-probe 20ec56a120d4f38f4e39dd9fc676dcbdbfcf5972'
        } finally {
            Remove-Item Env:FIELDOPS_UPDATER_ELEVATION_TEST -ErrorAction SilentlyContinue
            Remove-Item Env:FIELDOPS_UPDATER_PROBE_OUTPUT -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'executes the BAT elevation construction without arguments' {
        $destination = Join-Path $env:TEMP ('FieldOps Updater No Arg Test ' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destination | Out-Null
        $batCopy = Join-Path $destination 'Deploy FieldOps Development.bat'
        Copy-Item -LiteralPath $batchPath -Destination $batCopy
        try {
            $env:FIELDOPS_UPDATER_ELEVATION_TEST = '1'
            $probeOutput = Join-Path $destination 'probe.txt'
            $env:FIELDOPS_UPDATER_PROBE_OUTPUT = $probeOutput
            & cmd.exe /d /c "`"$batCopy`""
            $LASTEXITCODE | Should Be 0
            $probe = Get-Content -LiteralPath $probeOutput -Raw
            $probe | Should Match 'ELEVATION_PROBE_PATH='
            (($probe -split "`r?`n") -contains 'ELEVATION_PROBE_ARGS=--fieldops-elevation-probe') | Should Be $true
        } finally {
            Remove-Item Env:FIELDOPS_UPDATER_ELEVATION_TEST -ErrorAction SilentlyContinue
            Remove-Item Env:FIELDOPS_UPDATER_PROBE_OUTPUT -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    It 'recognizes an already-elevated BAT without relaunching' {
        $destination = Join-Path $env:TEMP ('FieldOps Updater Elevated Test ' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $destination | Out-Null
        $batCopy = Join-Path $destination 'Deploy FieldOps Development.bat'
        Copy-Item -LiteralPath $batchPath -Destination $batCopy
        try {
            $probeOutput = Join-Path $destination 'probe.txt'
            $env:FIELDOPS_UPDATER_ELEVATED_PROBE = '1'
            $env:FIELDOPS_UPDATER_PROBE_OUTPUT = $probeOutput
            & cmd.exe /d /c "`"$batCopy`""
            $LASTEXITCODE | Should Be 0
            (Get-Content -LiteralPath $probeOutput -Raw) | Should Match ([regex]::Escape("ELEVATED_PATH=$batCopy"))
        } finally {
            Remove-Item Env:FIELDOPS_UPDATER_ELEVATED_PROBE -ErrorAction SilentlyContinue
            Remove-Item Env:FIELDOPS_UPDATER_PROBE_OUTPUT -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
