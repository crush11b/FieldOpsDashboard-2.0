[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [string]$DesktopPath = [Environment]::GetFolderPath('Desktop')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    $scriptPath = $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrWhiteSpace($scriptPath)) { throw 'Could not determine the development updater setup script path.' }
    $RepositoryRoot = Split-Path -Parent (Split-Path -Parent $scriptPath)
}
$repositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
$desktop = [IO.Path]::GetFullPath($DesktopPath)
$launcherFiles = @('UpdateDashboard.bat', 'FieldOpsDevelopmentUpdater.ps1')
foreach ($file in $launcherFiles) {
    $source = Join-Path $repositoryRoot $file
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required launcher file '$source' is missing." }
    Copy-Item -LiteralPath $source -Destination (Join-Path $desktop $file) -Force
}

$batPath = Join-Path $desktop 'UpdateDashboard.bat'
$shell = New-Object -ComObject WScript.Shell
$shortcutDefinitions = @(
    @{ Name = 'Deploy FieldOps Development.lnk'; Arguments = ''; Description = 'FieldOps CF-20 development updater; resolves and verifies one exact Git revision.' },
    @{ Name = 'Validate FieldOps Rollback.lnk'; Arguments = '-ValidateRollback'; Description = 'Safely exercise FieldOps transactional rollback and verify the current installation is restored.' }
)
foreach ($definition in $shortcutDefinitions) {
    $shortcut = $shell.CreateShortcut((Join-Path $desktop $definition.Name))
    $shortcut.TargetPath = $batPath
    $shortcut.Arguments = $definition.Arguments
    $shortcut.WorkingDirectory = $desktop
    $shortcut.Description = $definition.Description
    $shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,3"
    $shortcut.Save()
}

Write-Host "Installed FieldOps development update and rollback-validation shortcuts on $desktop."
Write-Host 'The update shortcut tracks main and verifies an exact revision before deployment.'
