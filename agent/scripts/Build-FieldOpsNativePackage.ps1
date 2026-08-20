[CmdletBinding()]
param([string]$OutputPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [IO.Path]::GetFullPath((Join-Path $scriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $scriptRoot '..\artifacts\packages\fieldops-native-win-x64.zip' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'agent\scripts\Publish-FieldOpsArtifacts.ps1')
if ($LASTEXITCODE -ne 0) { throw "Native publish failed with exit code $LASTEXITCODE." }
$source = Join-Path $root 'agent\artifacts\publish\win-x64'
foreach ($relative in @('agent\FieldOps.Agent.exe','tray\FieldOps.Tray.exe','p533-assets\manifest.json','p533-assets\NOTICE.txt','p533-assets\runtime\provenance.json','artifact-manifest.json')) { if (-not (Test-Path (Join-Path $source $relative))) { throw "Published output is missing '$relative'." } }
$output = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path $output) -Force | Out-Null
if (Test-Path $output) { Remove-Item $output -Force }
Compress-Archive -Path (Join-Path $source 'agent'),(Join-Path $source 'tray'),(Join-Path $source 'p533-assets'),(Join-Path $source 'artifact-manifest.json') -DestinationPath $output
Write-Host "Created native package '$output'."
