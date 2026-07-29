# FieldOps Dashboard - validated transactional updater
[CmdletBinding()]
param(
    [string]$InstallPath = $PSScriptRoot,
    [string[]]$PackageUrls = @(
        'https://github.com/crush11b/FieldOpsDashboard-2.0/archive/refs/heads/feature/E1-telemetry-foundation.zip'
    ),
    [switch]$SkipLaunch,
    [switch]$SkipProcessStop,
    [switch]$SimulateCopyFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$requiredPackageFiles = @(
    'package.json',
    'agent\publish\win-x64\FieldOps.Agent.exe'
)
$requiredDeploymentFiles = @(
    'package.json',
    'server.ts',
    'agent\publish\win-x64\FieldOps.Agent.exe'
)

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
    Write-Host '[OK] Deployment verified.' -ForegroundColor Green

    $deploymentStarted = $false
    Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue

    if (-not $SkipLaunch) {
        Write-Host '[5/5] Starting Dashboard Server...' -ForegroundColor Green
        Set-Location -LiteralPath $resolvedInstallPath
        npm run dev
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
            Write-Host "[X] Rollback failed: $($_.Exception.ToString())" -ForegroundColor Red
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
