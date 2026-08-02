[CmdletBinding()]
param([string]$OutputPath = (Join-Path $PSScriptRoot '..\artifacts\packages\fieldops-native-win-x64.zip'))
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'agent\scripts\Publish-FieldOpsArtifacts.ps1') -AllowDirty
if ($LASTEXITCODE -ne 0) { throw "Native publish failed with exit code $LASTEXITCODE." }
$source = Join-Path $root 'agent\artifacts\publish\win-x64'
foreach ($relative in @('agent\FieldOps.Agent.exe','tray\FieldOps.Tray.exe','artifact-manifest.json')) { if (-not (Test-Path (Join-Path $source $relative))) { throw "Published output is missing '$relative'." } }
$output = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
if (Test-Path $output) { Remove-Item $output -Force }
Compress-Archive -Path (Join-Path $source 'agent'),(Join-Path $source 'tray'),(Join-Path $source 'artifact-manifest.json') -DestinationPath $output
Write-Host "Created native package '$output'."
