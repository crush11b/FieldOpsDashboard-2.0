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
        $script:launcher | Should Match 'raw\.githubusercontent\.com/\$Repository/\$resolvedRevision/UpdateDashboard\.ps1'
        $script:launcher | Should Match '-Revision \$resolvedRevision'
        $script:launcher | Should Match 'Get-InstalledVersion -ExpectedRevision \$resolvedRevision'
        $script:launcher | Should Match 'sourceRevision.*ExpectedRevision'
        $script:launcher | Should Match 'nativeRevision.*ExpectedRevision'
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
        $script:launcher | Should Match "@\('Revision', 'OperatorAccount'\)"
        $script:launcher | Should Match 'UpdateDashboard\.ps1 failed with exit code'
        $script:launcher | Should Match 'FIELDOPS DEVELOPMENT UPDATE FAILED'
        $script:launcher | Should Match 'exit 1'
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
