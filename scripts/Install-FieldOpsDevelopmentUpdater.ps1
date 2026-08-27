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

$shortcutPath = Join-Path $desktop 'Deploy FieldOps Development.lnk'
$batPath = Join-Path $desktop 'UpdateDashboard.bat'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $batPath
$shortcut.WorkingDirectory = $desktop
$shortcut.Description = 'FieldOps CF-20 development updater; resolves and verifies one exact Git revision.'
$shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,3"
$shortcut.Save()

Write-Host "Installed 'Deploy FieldOps Development' on $desktop."
Write-Host 'The shortcut tracks the Version 2.7 development branch and verifies an exact revision before deployment.'
