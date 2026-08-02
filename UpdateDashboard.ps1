# FieldOps Dashboard - validated transactional updater
[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string[]]$PackageUrls = @(
        # Development source; change to main after feature/2.3-mvp-02-tray-usability merges.
        'https://github.com/crush11b/FieldOpsDashboard-2.0/archive/refs/heads/feature/2.3-mvp-02-tray-usability.zip'
    ),
    [switch]$SkipLaunch,
    [string]$NativeArtifactPath,
    [switch]$SkipProcessStop,
    [switch]$SimulateCopyFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$requiredPackageFiles = @(
    'package.json',
    'agent\scripts\Publish-FieldOpsArtifacts.ps1',
    'agent\scripts\Install-FieldOpsAgent.ps1',
    'agent\scripts\Provision-FieldOpsTelemetryCredential.ps1'
)
$requiredDeploymentFiles = @(
    'package.json',
    'server.ts'
)

function Assert-NativeArtifact {
    param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][string]$ExpectedRevision)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required native artifact '$Path' is unavailable for revision '$ExpectedRevision'." }
    $root = Join-Path $downloadRoot 'native'
    Expand-Archive -LiteralPath $Path -DestinationPath $root -Force
    $manifestPath = Join-Path $root 'artifact-manifest.json'
    if (-not (Test-Path $manifestPath)) { throw "Native artifact '$Path' has no artifact-manifest.json." }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.sourceRevision -ne $ExpectedRevision) { throw "Native artifact revision '$($manifest.sourceRevision)' does not match dashboard revision '$ExpectedRevision'." }
    foreach ($relative in @('agent\FieldOps.Agent.exe','tray\FieldOps.Tray.exe')) { if (-not (Test-Path (Join-Path $root $relative))) { throw "Native artifact is missing '$relative'." } }
    return $root
}

function Get-PackageRoot {
    param([Parameter(Mandatory = $true)][string]$ExtractPath)

    if (Test-Path -LiteralPath (Join-Path $ExtractPath 'package.json') -PathType Leaf) {
        return $ExtractPath
    }

    $children = @(Get-ChildItem -LiteralPath $ExtractPath -Directory)
    if ($children.Count -eq 1 -and
        (Test-Path -LiteralPath (Join-Path $children[0].FullName 'package.json') -PathType Leaf)) {
        return $children[0].FullName
    }

    return $ExtractPath
}

function Assert-RequiredFiles {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string[]]$RequiredFiles,
        [Parameter(Mandatory = $true)][string]$Description
    )

    $missing = @($RequiredFiles | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $Root $_) -PathType Leaf)
    })
    if ($missing.Count -gt 0) {
        throw "$Description is missing required file(s): $($missing -join ', ')."
    }
}

function Copy-PackageTree {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination | Out-Null
    & robocopy.exe $Source $Destination /E /XD node_modules /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    $robocopyExitCode = $LASTEXITCODE
    if ($robocopyExitCode -gt 7) {
        throw "robocopy failed with exit code $robocopyExitCode while copying '$Source' to '$Destination'."
    }
}

function Write-UpdateError {
    param([Parameter(Mandatory = $true)]$ErrorRecord)

    Write-Host "[X] Update failed: $($ErrorRecord.Exception.Message)" -ForegroundColor Red
    if ($ErrorRecord.InvocationInfo -and $ErrorRecord.InvocationInfo.PositionMessage) {
        Write-Host $ErrorRecord.InvocationInfo.PositionMessage -ForegroundColor DarkRed
    }
    if ($ErrorRecord.ScriptStackTrace) {
        Write-Host "Stack: $($ErrorRecord.ScriptStackTrace)" -ForegroundColor DarkRed
    }
    Write-Host $ErrorRecord.Exception.ToString() -ForegroundColor DarkRed
}

Write-Host '=======================================================' -ForegroundColor Cyan
Write-Host ' FieldOps Dashboard - Validated Auto-Update Utility ' -ForegroundColor Cyan
Write-Host '=======================================================' -ForegroundColor Cyan

$resolvedInstallPath = [IO.Path]::GetFullPath($InstallPath)
$installParent = Split-Path -Parent $resolvedInstallPath
$installName = Split-Path -Leaf $resolvedInstallPath
$transactionId = [Guid]::NewGuid().ToString('N')
$downloadRoot = Join-Path $env:TEMP "FieldOpsDashboard_Download_$transactionId"
$stagePath = Join-Path $installParent ".$installName-stage-$transactionId"
$backupPath = Join-Path $installParent ".$installName-backup-$transactionId"
$failedPath = Join-Path $installParent ".$installName-failed-$transactionId"
$packageRoot = $null
$deploymentStarted = $false

try {
    New-Item -ItemType Directory -Path $downloadRoot | Out-Null

    Write-Host '[1/5] Downloading and validating update candidates...' -ForegroundColor Yellow
    for ($index = 0; $index -lt $PackageUrls.Count; $index++) {
        $url = $PackageUrls[$index]
        $archivePath = Join-Path $downloadRoot "candidate-$index.zip"
        $extractPath = Join-Path $downloadRoot "candidate-$index"

        try {
            Write-Host " -> Trying $url" -ForegroundColor Gray
            if (Test-Path -LiteralPath $url -PathType Leaf) {
                Copy-Item -LiteralPath $url -Destination $archivePath
            } else {
                Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
            }

            Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
            $candidateRoot = Get-PackageRoot -ExtractPath $extractPath
            Assert-RequiredFiles -Root $candidateRoot -RequiredFiles $requiredPackageFiles -Description 'Downloaded package'
            $packageRoot = $candidateRoot
            Write-Host "[OK] Validated update package from $url" -ForegroundColor Green
            break
        } catch {
            Write-Host " [!] Rejected candidate: $($_.Exception.Message)" -ForegroundColor DarkYellow
            if (Test-Path -LiteralPath $extractPath) {
                Remove-Item -LiteralPath $extractPath -Recurse -Force
            }
        }
    }

    if (-not $packageRoot) {
        throw 'No download candidate contained a valid FieldOps Dashboard deployment package.'
    }

    if ([string]::IsNullOrWhiteSpace($NativeArtifactPath)) { throw 'NativeArtifactPath is required; download the matching GitHub Actions native artifact before running the updater.' }
    $nativeRoot = Assert-NativeArtifact -Path $NativeArtifactPath -ExpectedRevision 'source-archive'

    Write-Host '[2/5] Staging validated package...' -ForegroundColor Yellow
    Copy-PackageTree -Source $packageRoot -Destination $stagePath
    Assert-RequiredFiles -Root $stagePath -RequiredFiles $requiredDeploymentFiles -Description 'Staged deployment'

    Write-Host '[3/5] Stopping dashboard processes...' -ForegroundColor Yellow
    if (-not $SkipProcessStop) {
        Get-Process -Name 'node','tsx','npm','vite' -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction Stop
    }

    Write-Host '[4/5] Activating staged deployment...' -ForegroundColor Yellow
    Set-Location -LiteralPath $installParent
    Move-Item -LiteralPath $resolvedInstallPath -Destination $backupPath
    $deploymentStarted = $true

    if ($SimulateCopyFailure) {
        throw 'Simulated deployment failure.'
    }

    Move-Item -LiteralPath $stagePath -Destination $resolvedInstallPath

    $oldNodeModules = Join-Path $backupPath 'node_modules'
    if (Test-Path -LiteralPath $oldNodeModules -PathType Container) {
        Move-Item -LiteralPath $oldNodeModules -Destination (Join-Path $resolvedInstallPath 'node_modules')
    }

    Assert-RequiredFiles -Root $resolvedInstallPath -RequiredFiles $requiredDeploymentFiles -Description 'Deployed installation'
    Write-Host '[5/7] Restoring dependencies and building production dashboard...' -ForegroundColor Yellow
    Set-Location -LiteralPath $resolvedInstallPath
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required for the production dashboard build.' }
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }

    Write-Host '[6/7] Publishing and installing the Local Agent and tray...' -ForegroundColor Yellow
    $artifactRoot = Join-Path $resolvedInstallPath 'agent\artifacts\publish\win-x64'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $nativeRoot 'agent') -Destination $artifactRoot -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $nativeRoot 'tray') -Destination $artifactRoot -Recurse -Force
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallPath 'agent\scripts\Install-FieldOpsAgent.ps1')
    if ($LASTEXITCODE -ne 0) { throw "FieldOps agent/tray installation failed with exit code $LASTEXITCODE." }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallPath 'agent\scripts\Provision-FieldOpsTelemetryCredential.ps1') -AgentId 'FieldOpsDashboard'
    if ($LASTEXITCODE -ne 0) { throw "Telemetry credential provisioning failed with exit code $LASTEXITCODE." }
    Write-Host '[OK] Deployment verified.' -ForegroundColor Green

    $deploymentStarted = $false
    Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue

    if (-not $SkipLaunch) {
        Write-Host '[7/7] Starting production Dashboard Server...' -ForegroundColor Green
        Set-Location -LiteralPath $resolvedInstallPath
        Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $resolvedInstallPath
    } else {
        Write-Host '[5/5] Dashboard launch skipped.' -ForegroundColor Gray
    }
} catch {
    $updateError = $_

    if ($deploymentStarted -and (Test-Path -LiteralPath $backupPath -PathType Container)) {
        try {
            $newNodeModules = Join-Path $resolvedInstallPath 'node_modules'
            if ((Test-Path -LiteralPath $newNodeModules -PathType Container) -and
                -not (Test-Path -LiteralPath (Join-Path $backupPath 'node_modules'))) {
                Move-Item -LiteralPath $newNodeModules -Destination (Join-Path $backupPath 'node_modules')
            }
            if (Test-Path -LiteralPath $resolvedInstallPath) {
                Move-Item -LiteralPath $resolvedInstallPath -Destination $failedPath
            }
            Move-Item -LiteralPath $backupPath -Destination $resolvedInstallPath
            Write-Host '[OK] Previous installation restored.' -ForegroundColor Yellow
        } catch {
            $lockedPath = if (Test-Path -LiteralPath $resolvedInstallPath) { $resolvedInstallPath } else { $backupPath }
            $lockingProcesses = @(Get-Process -Name 'node','tsx','npm','vite' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName -Unique)
            $lockHint = if ($lockingProcesses.Count -gt 0) { $lockingProcesses -join ', ' } else { 'undetermined' }
            Write-Host "[X] Rollback failed while handling '$lockedPath'. Likely locking process: $lockHint. Partial state: dashboard activation may remain at '$resolvedInstallPath' and backup may remain at '$backupPath'." -ForegroundColor Red
            Write-Host "[X] Rollback error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    Write-UpdateError -ErrorRecord $updateError
    exit 1
} finally {
    Set-Location -LiteralPath $installParent
    foreach ($path in @($downloadRoot, $stagePath, $failedPath)) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
