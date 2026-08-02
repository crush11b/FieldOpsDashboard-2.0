[CmdletBinding()]
param(
    [string]$OutputRoot,
    [string]$SourceRevision,
    [switch]$AllowDirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\', '/')
$workspaceRoot = [IO.Path]::GetFullPath((Split-Path $repositoryRoot -Parent)).TrimEnd('\', '/')
$defaultOutputRoot = Join-Path $repositoryRoot 'agent\artifacts\publish\win-x64'
$metadataPath = Join-Path $repositoryRoot 'product-metadata.json'
$solutionPath = Join-Path $repositoryRoot 'agent\FieldOps.Agent.sln'
$agentProject = Join-Path $repositoryRoot 'agent\src\FieldOps.Agent\FieldOps.Agent.csproj'
$trayProject = Join-Path $repositoryRoot 'agent\src\FieldOps.TrayPrototype\FieldOps.TrayPrototype.csproj'
$outputRootSupplied = $PSBoundParameters.ContainsKey('OutputRoot')

function Get-CanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw 'Output root must not be empty.'
    }

    try {
        return [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    } catch {
        throw "Output root '$Path' could not be resolved."
    }
}

function Test-IsSameOrDescendant {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    return $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or
        $Path.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeOutputRoot {
    param([Parameter(Mandatory = $true)][string]$Path)

    $driveRoot = [IO.Path]::GetPathRoot($Path).TrimEnd('\', '/')
    if ($Path.Equals($driveRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Output root '$Path' must not be a drive root."
    }

    if ($Path.Equals($repositoryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $Path.Equals($workspaceRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Output root '$Path' must not be the repository or workspace root."
    }

    if (Test-IsSameOrDescendant -Path $repositoryRoot -Root $Path) {
        throw "Output root '$Path' must not contain the repository."
    }

    foreach ($programFilesRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not [string]::IsNullOrWhiteSpace($programFilesRoot)) {
            $canonicalProgramFiles = Get-CanonicalPath $programFilesRoot
            if (Test-IsSameOrDescendant -Path $Path -Root $canonicalProgramFiles) {
                throw "Output root '$Path' must not be Program Files or one of its descendants."
            }
        }
    }
}

function Invoke-DotNet {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & dotnet @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "dotnet $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function Resolve-GitCommit {
    param([Parameter(Mandatory = $true)][string]$Revision)

    $resolved = @(& git -C $repositoryRoot rev-parse --verify "$Revision^{commit}" 2>$null)
    if ($LASTEXITCODE -ne 0 -or $resolved.Count -ne 1) {
        throw "Source revision '$Revision' does not resolve to a Git commit."
    }

    $commit = ([string]$resolved[0]).Trim()
    if ($commit -notmatch '^[0-9a-f]{40}$') {
        throw "Git resolved '$Revision' to an invalid canonical commit SHA."
    }

    return $commit
}

function Get-RelativeFileInventory {
    param([Parameter(Mandatory = $true)][string]$BundlePath)

    return @(
        Get-ChildItem -LiteralPath $BundlePath -File -Recurse |
            ForEach-Object {
                $canonicalBundle = [IO.Path]::GetFullPath($BundlePath).TrimEnd('\', '/')
                $canonicalFile = [IO.Path]::GetFullPath($_.FullName)
                $requiredPrefix = $canonicalBundle + [IO.Path]::DirectorySeparatorChar
                if (-not $canonicalFile.StartsWith($requiredPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "Published file '$canonicalFile' is outside bundle '$canonicalBundle'."
                }
                $relativePath = $canonicalFile.Substring($requiredPrefix.Length).Replace('\', '/')
                [ordered]@{
                    relativePath = $relativePath
                    size = $_.Length
                    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                }
            } |
            Sort-Object { $_.relativePath }
    )
}

function Assert-OwnedPriorOutput {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $item = Get-Item -LiteralPath $Path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Existing output '$Path' is not a safe FieldOps artifact directory."
    }

    $expectedNames = @('agent', 'artifact-manifest.json', 'tray')
    $actualNames = @(Get-ChildItem -LiteralPath $Path -Force | ForEach-Object Name | Sort-Object)
    if (Compare-Object $expectedNames $actualNames) {
        throw "Existing output '$Path' contains stale or unexpected content."
    }

    $manifestPath = Join-Path $Path 'artifact-manifest.json'
    try {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    } catch {
        throw "Existing output '$Path' does not contain a valid FieldOps artifact manifest."
    }
    if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne 'FieldOps Dashboard') {
        throw "Existing output '$Path' is not owned by the expected FieldOps artifact contract."
    }
}

if ($outputRootSupplied -and [string]::IsNullOrWhiteSpace($OutputRoot)) {
    throw 'A supplied output root must not be empty.'
}
if (-not $outputRootSupplied) {
    $OutputRoot = $defaultOutputRoot
}
$resolvedOutputRoot = Get-CanonicalPath $OutputRoot
Assert-SafeOutputRoot $resolvedOutputRoot
Assert-OwnedPriorOutput $resolvedOutputRoot

$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$productVersion = [string]$metadata.version
if ($productVersion -notmatch '^\d+\.\d+\.\d+$') { throw "Canonical product version '$productVersion' is not numeric major.minor.patch metadata." }
$gitDirectory = Join-Path $repositoryRoot '.git'
$hasGitMetadata = Test-Path -LiteralPath $gitDirectory
$isDirty = $false
if ($hasGitMetadata) {
    $headRevision = Resolve-GitCommit 'HEAD'
    if ([string]::IsNullOrWhiteSpace($SourceRevision)) {
        $SourceRevision = $headRevision
    } else {
        if ($SourceRevision -notmatch '^[0-9a-fA-F]{40}$') { throw 'Source revision must be a full 40-character Git commit SHA.' }
        $SourceRevision = Resolve-GitCommit ($SourceRevision.ToLowerInvariant())
        if (-not $SourceRevision.Equals($headRevision, [StringComparison]::Ordinal)) { throw "Source revision '$SourceRevision' does not match checked-out HEAD '$headRevision'." }
    }
    $dirtyPaths = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Git worktree.' }
    $isDirty = $dirtyPaths.Count -gt 0
    if ($isDirty -and -not $AllowDirty) { throw 'Release-style publishing requires a clean worktree. Use -AllowDirty only for explicitly non-release development output.' }

} else {
    if (-not [string]::IsNullOrWhiteSpace($SourceRevision)) { throw 'SourceRevision is supported only for Git checkouts.' }
    $SourceRevision = 'source-archive'
}
$numericVersion = "$productVersion.0"
$informationalVersion = if ($isDirty) {
    "$productVersion+$SourceRevision.dirty"
} else {
    "$productVersion+$SourceRevision"
}

$outputParent = Split-Path $resolvedOutputRoot -Parent
if ([string]::IsNullOrWhiteSpace($outputParent)) {
    throw "Output root '$resolvedOutputRoot' does not have a safe parent."
}
[IO.Directory]::CreateDirectory($outputParent) | Out-Null
$outputLeaf = Split-Path $resolvedOutputRoot -Leaf
$operationId = [Guid]::NewGuid().ToString('N')
$stagingRoot = Join-Path $outputParent ".$outputLeaf.stage-$operationId"
$backupRoot = Join-Path $outputParent ".$outputLeaf.backup-$operationId"
$promoted = $false
$priorMoved = $false

try {
    [IO.Directory]::CreateDirectory($stagingRoot) | Out-Null
    $agentOutput = Join-Path $stagingRoot 'agent'
    $trayOutput = Join-Path $stagingRoot 'tray'
    [IO.Directory]::CreateDirectory($agentOutput) | Out-Null
    [IO.Directory]::CreateDirectory($trayOutput) | Out-Null

    Invoke-DotNet @('restore', $solutionPath, '--locked-mode')
    $versionProperties = @(
        "-p:Version=$productVersion",
        "-p:AssemblyVersion=$numericVersion",
        "-p:FileVersion=$numericVersion",
        "-p:ProductVersion=$productVersion",
        "-p:InformationalVersion=$informationalVersion",
        '-p:IncludeSourceRevisionInInformationalVersion=false',
        '-p:ContinuousIntegrationBuild=true',
        '-p:Deterministic=true'
    )
    Invoke-DotNet (@('build', $solutionPath, '-c', 'Release', '--no-restore') + $versionProperties)
    Invoke-DotNet (@(
        'publish', $agentProject, '-c', 'Release', '-r', 'win-x64',
        '--self-contained', 'true', '--no-restore', '-o', $agentOutput
    ) + $versionProperties)
    Invoke-DotNet (@(
        'publish', $trayProject, '-c', 'Release', '-r', 'win-x64',
        '--self-contained', 'true', '--no-restore', '-o', $trayOutput
    ) + $versionProperties)

    $requiredFiles = @(
        (Join-Path $agentOutput 'FieldOps.Agent.exe'),
        (Join-Path $trayOutput 'FieldOps.Tray.exe'),
        (Join-Path $trayOutput 'FieldOps.ServiceControl.exe'),
        (Join-Path $trayOutput 'FieldOps.NativeHealth.dll')
    )
    foreach ($requiredFile in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Required production artifact '$requiredFile' was not published."
        }
    }

    $prototypeExecutables = @(Get-ChildItem -LiteralPath $stagingRoot -File -Recurse -Filter '*.exe' |
        Where-Object Name -Match 'Prototype')
    if ($prototypeExecutables.Count -gt 0) {
        throw "Prototype-named executable was published: $($prototypeExecutables.Name -join ', ')."
    }

    $trayExecutable = Join-Path $trayOutput 'FieldOps.Tray.exe'
    $helperExecutable = Join-Path $trayOutput 'FieldOps.ServiceControl.exe'
    if (-not [IO.Path]::GetDirectoryName($trayExecutable).Equals(
            [IO.Path]::GetDirectoryName($helperExecutable),
            [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The restart helper is not co-located with the tray executable.'
    }

    $manifest = [ordered]@{
        schemaVersion = 1
        product = [string]$metadata.productName
        configuration = 'Release'
        targetFramework = 'net8.0-windows'
        runtimeIdentifier = 'win-x64'
        selfContained = $true
        productVersion = $productVersion
        informationalVersion = $informationalVersion
        sourceRevision = $SourceRevision
        releaseStyle = -not $isDirty
        bundles = @(
            [ordered]@{
                name = 'agent'
                entryPoint = 'FieldOps.Agent.exe'
                files = Get-RelativeFileInventory $agentOutput
            },
            [ordered]@{
                name = 'tray'
                entryPoint = 'FieldOps.Tray.exe'
                files = Get-RelativeFileInventory $trayOutput
            }
        )
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText(
        (Join-Path $stagingRoot 'artifact-manifest.json'),
        $manifestJson + [Environment]::NewLine,
        [Text.UTF8Encoding]::new($false))

    if (Test-Path -LiteralPath $resolvedOutputRoot) {
        Move-Item -LiteralPath $resolvedOutputRoot -Destination $backupRoot
        $priorMoved = $true
    }
    Move-Item -LiteralPath $stagingRoot -Destination $resolvedOutputRoot
    $promoted = $true
    if ($priorMoved) {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
        $priorMoved = $false
    }

    Write-Host "Published FieldOps $productVersion artifacts to '$resolvedOutputRoot'."
    if ($isDirty) {
        Write-Warning 'The manifest identifies this as dirty, non-release development output.'
    }
} catch {
    $failure = $_
    if ($priorMoved) {
        if (Test-Path -LiteralPath $resolvedOutputRoot) {
            Remove-Item -LiteralPath $resolvedOutputRoot -Recurse -Force
        }
        Move-Item -LiteralPath $backupRoot -Destination $resolvedOutputRoot
        $priorMoved = $false
    }
    throw $failure
} finally {
    if (-not $promoted -and (Test-Path -LiteralPath $stagingRoot)) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $backupRoot) {
        throw "Publish cleanup left unexpected backup output at '$backupRoot'."
    }
}
