[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\', '/')
$publishScript = Join-Path $PSScriptRoot 'Publish-FieldOpsArtifacts.ps1'
$metadataPath = Join-Path $repositoryRoot 'product-metadata.json'
$sourceRevision = (& git -C $repositoryRoot rev-parse --verify 'HEAD^{commit}').Trim()
if ($LASTEXITCODE -ne 0 -or $sourceRevision -notmatch '^[0-9a-f]{40}$') {
    throw 'Could not resolve a full source revision for publish validation.'
}
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$expectedProductVersion = [string]$metadata.version
if ($expectedProductVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Canonical product version '$expectedProductVersion' is not numeric major.minor.patch metadata."
}
$expectedInformationalVersion = "$expectedProductVersion+$sourceRevision"

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("fieldops-publish-test-{0}" -f [Guid]::NewGuid().ToString('N'))
$firstOutput = Join-Path $testRoot 'first'
$secondOutput = Join-Path $testRoot 'second'
$dirtyOutput = Join-Path $testRoot 'dirty'

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

function Assert-RejectedAndPreserved {
    param(
        [Parameter(Mandatory = $true)][string]$Revision,
        [switch]$AllowDirty
    )

    $before = Get-OutputSnapshot $firstOutput
    $failedAsExpected = $false
    try {
        if ($AllowDirty) {
            & $publishScript -OutputRoot $firstOutput -SourceRevision $Revision -AllowDirty
        } else {
            & $publishScript -OutputRoot $firstOutput -SourceRevision $Revision
        }
    } catch {
        $failedAsExpected = $true
    }
    if (-not $failedAsExpected) {
        throw "Source revision '$Revision' was not rejected as expected."
    }

    $after = Get-OutputSnapshot $firstOutput
    if (Compare-Object $before $after -Property RelativePath, Size, Sha256) {
        throw "Rejected source revision '$Revision' replaced or modified the prior successful output."
    }
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
    & $publishScript -OutputRoot $firstOutput
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
        $manifest.productVersion -ne $expectedProductVersion -or
        $manifest.sourceRevision -ne $sourceRevision -or
        -not $manifest.releaseStyle -or
        $manifest.informationalVersion -ne $expectedInformationalVersion) {
        throw 'The artifact manifest does not match the approved release-style schema and identity.'
    }
    if ($manifestText.IndexOf($repositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $manifestText.IndexOf([Environment]::UserName, [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
        $manifestText.IndexOf([Environment]::MachineName, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        throw 'The artifact manifest contains machine-specific identity or an absolute repository path.'
    }
    foreach ($bundle in $manifest.bundles) {
        foreach ($file in $bundle.files) {
            if ([IO.Path]::IsPathRooted([string]$file.relativePath) -or
                ([string]$file.relativePath).IndexOf('..', [StringComparison]::Ordinal) -ge 0) {
                throw "Manifest path '$($file.relativePath)' is not a safe relative path."
            }
        }
    }

    $differentCommit = (& git -C $repositoryRoot rev-parse --verify 'HEAD~1^{commit}').Trim()
    if ($LASTEXITCODE -ne 0 -or $differentCommit -notmatch '^[0-9a-f]{40}$' -or $differentCommit -eq $sourceRevision) {
        throw 'Could not resolve a different repository commit for provenance validation.'
    }
    $nonCommitObject = (& git -C $repositoryRoot rev-parse --verify 'HEAD:product-metadata.json').Trim()
    if ($LASTEXITCODE -ne 0 -or $nonCommitObject -notmatch '^[0-9a-f]{40}$') {
        throw 'Could not resolve a non-commit Git object for provenance validation.'
    }

    Assert-RejectedAndPreserved 'not-a-commit'
    Assert-RejectedAndPreserved '0000000000000000000000000000000000000000'
    Assert-RejectedAndPreserved $sourceRevision.Substring(0, 12)
    Assert-RejectedAndPreserved $nonCommitObject
    Assert-RejectedAndPreserved $differentCommit

    $dirtyMarker = Join-Path $repositoryRoot ('.fieldops-publish-dirty-test-{0}' -f [Guid]::NewGuid().ToString('N'))
    try {
        [IO.File]::WriteAllText($dirtyMarker, 'publish provenance validation', [Text.UTF8Encoding]::new($false))
        & $publishScript -OutputRoot $dirtyOutput -SourceRevision $sourceRevision -AllowDirty
        $dirtyManifest = Get-Content -LiteralPath (Join-Path $dirtyOutput 'artifact-manifest.json') -Raw |
            ConvertFrom-Json
        if ($dirtyManifest.sourceRevision -ne $sourceRevision -or
            $dirtyManifest.releaseStyle -or
            $dirtyManifest.productVersion -ne $expectedProductVersion -or
            $dirtyManifest.informationalVersion -ne "$expectedInformationalVersion.dirty") {
            throw 'Dirty development output does not truthfully identify the checked-out HEAD and canonical version.'
        }
        Assert-RejectedAndPreserved $differentCommit -AllowDirty
    } finally {
        if (Test-Path -LiteralPath $dirtyMarker) {
            Remove-Item -LiteralPath $dirtyMarker -Force
        }
    }

    $required = @(
        'agent/FieldOps.Agent.exe',
        'tray/FieldOps.Tray.exe',
        'tray/FieldOps.ServiceControl.exe',
        'tray/FieldOps.NativeHealth.dll',
        'p533-assets/manifest.json',
        'p533-assets/NOTICE.txt',
        'p533-assets/runtime/provenance.json'
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
    $p533Bundle = @($manifest.bundles | Where-Object { $_.name -eq 'p533' })
    if ($p533Bundle.Count -ne 1) {
        throw 'The published artifact manifest does not contain exactly one P.533 bundle.'
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
