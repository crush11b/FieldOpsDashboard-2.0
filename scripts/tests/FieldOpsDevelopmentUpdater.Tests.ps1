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
        $script:batch | Should Match 'Start-Process -FilePath \$bat -Verb RunAs'
        $script:batch | Should Match 'Start-Process -FilePath \$bat -ArgumentList \$arguments -Verb RunAs'
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
}
