[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\', '/')
$publishScript = Join-Path $PSScriptRoot 'Publish-FieldOpsArtifacts.ps1'
$sourceRevision = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRevision -notmatch '^[0-9a-f]{40}$') {
    throw 'Could not resolve a full source revision for publish validation.'
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("fieldops-publish-test-{0}" -f [Guid]::NewGuid().ToString('N'))
$firstOutput = Join-Path $testRoot 'first'
$secondOutput = Join-Path $testRoot 'second'

function Assert-UnsafeOutputRejected {
    param([AllowEmptyString()][Parameter(Mandatory = $true)][string]$Path)

    $rejected = $false
    try {
        & $publishScript -OutputRoot $Path -SourceRevision $sourceRevision
    } catch {
        $rejected = $true
    }
    if (-not $rejected) {
        throw "Unsafe output root '$Path' was not rejected."
    }
}

function Get-OutputSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)

    return @(
        Get-ChildItem -LiteralPath $Path -File -Recurse |
            ForEach-Object {
                $canonicalRoot = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
                $canonicalFile = [IO.Path]::GetFullPath($_.FullName)
                $requiredPrefix = $canonicalRoot + [IO.Path]::DirectorySeparatorChar
                if (-not $canonicalFile.StartsWith($requiredPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "Published file '$canonicalFile' is outside test output '$canonicalRoot'."
                }
                [PSCustomObject]@{
                    RelativePath = $canonicalFile.Substring($requiredPrefix.Length).Replace('\', '/')
                    Size = $_.Length
                    Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                }
            } |
            Sort-Object RelativePath
    )
}

try {
    [IO.Directory]::CreateDirectory($testRoot) | Out-Null
    Assert-UnsafeOutputRejected ''
    Assert-UnsafeOutputRejected $repositoryRoot
    Assert-UnsafeOutputRejected (Split-Path $repositoryRoot -Parent)
    Assert-UnsafeOutputRejected ([IO.Path]::GetPathRoot($repositoryRoot))
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        Assert-UnsafeOutputRejected $env:ProgramFiles
    }
    & $publishScript -OutputRoot $firstOutput -SourceRevision $sourceRevision
    & $publishScript -OutputRoot $secondOutput -SourceRevision $sourceRevision

    $firstSnapshot = Get-OutputSnapshot $firstOutput
    $secondSnapshot = Get-OutputSnapshot $secondOutput
    $differences = Compare-Object $firstSnapshot $secondSnapshot -Property RelativePath, Size, Sha256
    if ($differences) {
        throw "Repeat publishes produced different inventories or hashes:`n$($differences | Out-String)"
    }

    $manifestPath = Join-Path $firstOutput 'artifact-manifest.json'
    $manifestText = Get-Content -LiteralPath $manifestPath -Raw
    $manifest = $manifestText | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or
        $manifest.product -ne 'FieldOps Dashboard' -or
        $manifest.productVersion -ne '2.2.0' -or
        $manifest.sourceRevision -ne $sourceRevision -or
        -not $manifest.releaseStyle -or
        $manifest.informationalVersion -ne "2.2.0+$sourceRevision") {
        throw 'The artifact manifest does not match the approved release-style schema and identity.'
    }
    if ($manifestText.Contains($repositoryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $manifestText.Contains([Environment]::UserName, [StringComparison]::OrdinalIgnoreCase) -or
        $manifestText.Contains([Environment]::MachineName, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The artifact manifest contains machine-specific identity or an absolute repository path.'
    }
    foreach ($bundle in $manifest.bundles) {
        foreach ($file in $bundle.files) {
            if ([IO.Path]::IsPathRooted([string]$file.relativePath) -or
                ([string]$file.relativePath).Contains('..', [StringComparison]::Ordinal)) {
                throw "Manifest path '$($file.relativePath)' is not a safe relative path."
            }
        }
    }

    $priorSnapshot = Get-OutputSnapshot $firstOutput
    $failedAsExpected = $false
    try {
        & $publishScript -OutputRoot $firstOutput -SourceRevision 'not-a-commit'
    } catch {
        $failedAsExpected = $true
    }
    if (-not $failedAsExpected) {
        throw 'Invalid publish input did not fail as expected.'
    }
    $afterFailureSnapshot = Get-OutputSnapshot $firstOutput
    if (Compare-Object $priorSnapshot $afterFailureSnapshot -Property RelativePath, Size, Sha256) {
        throw 'A failed publish replaced or modified the prior successful output.'
    }

    $required = @(
        'agent/FieldOps.Agent.exe',
        'tray/FieldOps.Tray.exe',
        'tray/FieldOps.ServiceControl.exe',
        'tray/FieldOps.NativeHealth.dll'
    )
    $publishedPaths = @($firstSnapshot.RelativePath)
    foreach ($requiredPath in $required) {
        if ($requiredPath -notin $publishedPaths) {
            throw "Required artifact '$requiredPath' is absent."
        }
    }
    $prototypeExecutables = @($publishedPaths | Where-Object { $_ -match 'Prototype.*\.exe$' })
    if ($prototypeExecutables.Count -gt 0) {
        throw "Prototype-named executables were published: $($prototypeExecutables -join ', ')."
    }

    Write-Host 'FieldOps repeat-publish, manifest, naming, and failed-promotion validation passed.'
} finally {
    $canonicalTestRoot = [IO.Path]::GetFullPath($testRoot)
    $canonicalTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $canonicalTestRoot.StartsWith($canonicalTempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path $canonicalTestRoot -Leaf).StartsWith('fieldops-publish-test-', [StringComparison]::Ordinal)) {
        throw "Refusing to remove unexpected publish-test path '$canonicalTestRoot'."
    }
    if (Test-Path -LiteralPath $canonicalTestRoot) {
        Remove-Item -LiteralPath $canonicalTestRoot -Recurse -Force
    }
}
