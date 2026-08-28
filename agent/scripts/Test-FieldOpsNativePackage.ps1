[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackagePath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedRevision
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) { throw "Native package '$PackagePath' is unavailable." }
$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ('fieldops-native-package-' + [Guid]::NewGuid().ToString('N'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $PackagePath).Path, $extractRoot)
    $required = @(
        'artifact-manifest.json',
        'agent\FieldOps.Agent.exe',
        'tray\FieldOps.Tray.exe',
        'p533-assets\manifest.json',
        'p533-assets\runtime\provenance.json'
    )
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $extractRoot $relative) -PathType Leaf)) {
            throw "Native package is missing '$relative'."
        }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $extractRoot 'artifact-manifest.json') -Raw | ConvertFrom-Json
    if ([string]$manifest.sourceRevision -ne $ExpectedRevision.ToLowerInvariant()) {
        throw "Native package revision '$($manifest.sourceRevision)' does not match expected revision '$ExpectedRevision'."
    }
    $p533Manifest = Get-Content -LiteralPath (Join-Path $extractRoot 'p533-assets\manifest.json') -Raw | ConvertFrom-Json
    if ($p533Manifest.modelName -ne 'ITU-R P.533' -or $p533Manifest.modelVersion -ne 'v14.3') {
        throw 'Native package P.533 manifest has unexpected model identity.'
    }
    $prototypeExecutables = @(Get-ChildItem -LiteralPath $extractRoot -File -Recurse -Filter '*.exe' | Where-Object Name -Match 'Prototype')
    if ($prototypeExecutables.Count -gt 0) { throw "Native package contains prototype executable(s): $($prototypeExecutables.Name -join ', ')." }
    Write-Host "Native package is complete for revision $ExpectedRevision."
} finally {
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
}