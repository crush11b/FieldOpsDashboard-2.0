# FieldOps Dashboard - validated transactional updater
[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount,
    [string]$Repository = 'crush11b/FieldOpsDashboard-2.0',
    [string]$Branch = 'main',
    [ValidatePattern('^[0-9a-fA-F]{40}$')][string]$Revision,
    [switch]$SkipLaunch,
    [string]$NativeArtifactPath,
    [string]$NativeArtifactUrl = 'https://github.com/crush11b/FieldOpsDashboard-2.0/releases/download/mvp-native/fieldops-native-win-x64.zip',
    [switch]$SkipProcessStop,
    [switch]$SimulateCopyFailure,
    [switch]$EnableCf20GnssRecovery
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$requiredPackageFiles = @(
    'package.json',
    'agent\scripts\Publish-FieldOpsArtifacts.ps1',
    'agent\scripts\Install-FieldOpsAgent.ps1',
    'agent\scripts\FieldOps.OperatorProvisioning.psm1',
    'agent\scripts\FieldOps.OperatorResolution.psm1',
    'agent\scripts\FieldOps.TrayProcessDiscovery.psm1',
    'agent\scripts\FieldOps.TrayScheduledLaunch.psm1',
    'agent\scripts\Provision-FieldOpsTelemetryCredential.ps1',
    'scripts\FieldOps.RuntimeShutdown.psm1',
    'scripts\FieldOps.RuntimeReadiness.psm1',
    'scripts\FieldOps.RuntimeRollback.psm1',
    'scripts\FieldOps.BackupRetention.psm1',
    'p533-assets\manifest.json'
)
$requiredDeploymentFiles = @(
    'package.json',
    'server.ts',
    'p533-assets\manifest.json',
    'p533-assets\runtime\provenance.json'
)

function Assert-NativeArtifact {
    param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][string]$ExpectedRevision)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required native artifact '$Path' is unavailable for revision '$ExpectedRevision'." }
    $root = Join-Path $downloadRoot 'native'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop }
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Path, $root)
    $manifestPath = Join-Path $root 'artifact-manifest.json'
    if (-not (Test-Path $manifestPath)) { throw "Native artifact '$Path' has no artifact-manifest.json." }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$manifest.sourceRevision)) { throw 'Native artifact manifest has no source revision.' }
    if ($manifest.sourceRevision -ne $ExpectedRevision) { throw "Native artifact revision '$($manifest.sourceRevision)' does not match requested source revision '$ExpectedRevision'. Deployment was not activated." }
    foreach ($relative in @('agent\FieldOps.Agent.exe','tray\FieldOps.Tray.exe','p533-assets\manifest.json','p533-assets\runtime\provenance.json')) { if (-not (Test-Path (Join-Path $root $relative))) { throw "Native artifact is missing '$relative'." } }
    $prototypeExecutables = @(Get-ChildItem -LiteralPath $root -File -Recurse -Filter '*.exe' | Where-Object Name -Match 'Prototype')
    if ($prototypeExecutables.Count -gt 0) { throw "Native artifact contains prototype executable(s): $($prototypeExecutables.Name -join ', ')." }
    return $root
}

function Resolve-DeploymentRevision {
    param([string]$Repository, [string]$Branch, [string]$Revision)
    if (-not [string]::IsNullOrWhiteSpace($Revision)) { return $Revision.ToLowerInvariant() }
    $apiUrl = "https://api.github.com/repos/$Repository/commits/$Branch"
    $response = Invoke-RestMethod -Uri $apiUrl -Headers @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'FieldOpsDashboard-Updater' } -UseBasicParsing
    if ([string]::IsNullOrWhiteSpace([string]$response.sha) -or $response.sha -notmatch '^[0-9a-fA-F]{40}$') { throw "GitHub did not return a valid commit revision for branch '$Branch'." }
    return ([string]$response.sha).ToLowerInvariant()
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

    throw 'Downloaded package did not contain exactly one repository root with package.json.'
}

function Expand-GitHubTarGz {
    param([Parameter(Mandatory = $true)][string]$ArchivePath, [Parameter(Mandatory = $true)][string]$DestinationPath)
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if (-not $tar) { throw 'Windows tar.exe is required to extract the dashboard package.' }
    New-Item -ItemType Directory -Path $DestinationPath -Force | Out-Null
    & $tar.Source @('-xzf', $ArchivePath, '-C', $DestinationPath)
    if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE while extracting the dashboard package." }
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

function Assert-P533RuntimeArtifact {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRoot,
        [Parameter(Mandatory = $true)][string]$NativeRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedRevision
    )

    $sourceManifestPath = Join-Path $PackageRoot 'p533-assets\manifest.json'
    $artifactManifestPath = Join-Path $NativeRoot 'p533-assets\manifest.json'
    $artifactContractManifestPath = Join-Path $NativeRoot 'artifact-manifest.json'
    $runtimeRoot = Join-Path $NativeRoot 'p533-assets\runtime'
    $sourceManifest = Get-Content -LiteralPath $sourceManifestPath -Raw | ConvertFrom-Json
    $artifactManifest = Get-Content -LiteralPath $artifactManifestPath -Raw | ConvertFrom-Json
    $artifactContractManifest = Get-Content -LiteralPath $artifactContractManifestPath -Raw | ConvertFrom-Json
    $sourceManifestIdentity = $sourceManifest | ConvertTo-Json -Depth 10 -Compress
    $artifactManifestIdentity = $artifactManifest | ConvertTo-Json -Depth 10 -Compress
    if ($sourceManifestIdentity -ne $artifactManifestIdentity) {
        throw "P.533 artifact manifest does not match source revision '$ExpectedRevision'. Deployment was not activated."
    }
    $provenance = Get-Content -LiteralPath (Join-Path $runtimeRoot 'provenance.json') -Raw | ConvertFrom-Json
    if ($provenance.modelVersion -ne $sourceManifest.modelVersion -or $provenance.dataVersion -ne $sourceManifest.dataVersion -or $provenance.runtimeNetworkRequired -ne $false) {
        throw 'P.533 runtime provenance does not match the tracked P.533 manifest. Deployment was not activated.'
    }
    $required = @('p533.mjs', 'p533.wasm') + @($sourceManifest.dataFiles | ForEach-Object { $_.runtimeName })
    foreach ($fileName in $required) {
        $filePath = Join-Path $runtimeRoot $fileName
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "P.533 runtime artifact is missing '$fileName'. Deployment was not activated." }
        $expectedHash = if ($fileName -eq 'p533.mjs') { $sourceManifest.p533MjsSha256 } elseif ($fileName -eq 'p533.wasm') { $sourceManifest.p533WasmSha256 } else { $provenance.installedFiles.$fileName }
        if ([string]::IsNullOrWhiteSpace([string]$expectedHash) -or (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$expectedHash).ToLowerInvariant()) {
            throw "P.533 runtime artifact hash mismatch for '$fileName'. Deployment was not activated."
        }
    }
    $p533Bundle = @($artifactContractManifest.bundles | Where-Object name -eq 'p533')
    if ($p533Bundle.Count -ne 1) { throw 'Native artifact manifest does not contain exactly one P.533 bundle. Deployment was not activated.' }
    return $runtimeRoot
}

function Remove-TemporaryCandidate {
    param(
        [Parameter(Mandatory = $true)][string]$CandidatePath,
        [Parameter(Mandatory = $true)][string]$DownloadRootPath
    )

    $candidate = [IO.Path]::GetFullPath($CandidatePath).TrimEnd('\', '/')
    $root = [IO.Path]::GetFullPath($DownloadRootPath).TrimEnd('\', '/')
    if ($candidate.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or -not $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing temporary candidate cleanup outside updater download root: '$CandidatePath'."
    }
    try {
        Remove-Item -LiteralPath $candidate -Recurse -Force -ErrorAction Stop
    } catch {
        $primaryError = $_
        Write-Warning "PowerShell cleanup failed for temporary candidate '$candidate': $($primaryError.Exception.Message)"
        & cmd.exe /c rmdir /s /q "$candidate" 2>$null
        if ($LASTEXITCODE -ne 0 -and (Test-Path -LiteralPath $candidate)) { Write-Warning "Temporary candidate cleanup fallback also failed for '$candidate'." }
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
    $diagnosticRelativePaths = @(
        Join-Path 'agent\scripts' ('FieldOps.' + 'TrayLaunch.psm1')
        Join-Path 'scripts' ('Test-FieldOpsInteractive' + 'TrayLaunch.ps1')
    )
    foreach ($relative in $diagnosticRelativePaths) {
        $diagnosticPath = Join-Path $Destination $relative
        if (Test-Path -LiteralPath $diagnosticPath) {
            Remove-Item -LiteralPath $diagnosticPath -Force -ErrorAction Stop
        }
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

function Stop-FieldOpsLauncherWrappers {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)
    $normalizedRoot = ([IO.Path]::GetFullPath($InstallRoot)).TrimEnd('\').ToLowerInvariant()
    $rootPattern = [regex]::Escape($normalizedRoot) + '(?=[\\/"''\s]|$)'
    $wrappers = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $commandLine = [string]$_.CommandLine
        $commandLine -and $commandLine -match $rootPattern
    })
    foreach ($wrapper in $wrappers) {
        Stop-Process -Id ([int]$wrapper.ProcessId) -Force -ErrorAction Stop
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        $remaining = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" -ErrorAction SilentlyContinue | Where-Object {
            ([string]$_.CommandLine) -match $rootPattern
        })
        if ($remaining.Count -eq 0) { return }
        Start-Sleep -Milliseconds 100
    }
    throw "FieldOps launcher process still owns '$InstallRoot' after bounded shutdown."
}

function Get-FieldOpsRollbackLockingProcesses {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $normalizedRoot = ([IO.Path]::GetFullPath($InstallRoot)).TrimEnd('\').ToLowerInvariant()
    $rootPattern = [regex]::Escape($normalizedRoot) + '(?=[\\/"''\s]|$)'
    foreach ($process in @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)) {
        $commandLine = [string]$process.CommandLine
        $executablePath = [string]$process.ExecutablePath
        $normalizedExecutablePath = if ([string]::IsNullOrWhiteSpace($executablePath)) { '' } else { ([IO.Path]::GetFullPath($executablePath)).TrimEnd('\').ToLowerInvariant() }
        if (($commandLine -and $commandLine.ToLowerInvariant() -match $rootPattern) -or
            ($normalizedExecutablePath -and ($normalizedExecutablePath -eq $normalizedRoot -or $normalizedExecutablePath.StartsWith($normalizedRoot + '\')))) {
            [pscustomobject]@{
                ProcessId = [int]$process.ProcessId
                Name = [string]$process.Name
                CommandLine = $commandLine
                ExecutablePath = $executablePath
            }
        }
    }
}

function Ensure-FieldOpsTelemetryCredentials {
    $receiverPath = Join-Path $env:ProgramData 'FieldOpsDashboard\Dashboard\telemetry-credentials.json'
    $agentPath = Join-Path $env:ProgramData 'FieldOpsDashboard\Agent\telemetry-write-token.dat'
    $receiverExists = Test-Path -LiteralPath $receiverPath -PathType Leaf
    $agentExists = Test-Path -LiteralPath $agentPath -PathType Leaf
    if ($receiverExists -and $agentExists) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallPath 'agent\scripts\Provision-FieldOpsTelemetryCredential.ps1') -AgentId 'FieldOpsDashboard' -ValidateOnly
        if ($LASTEXITCODE -ne 0) { throw 'Existing telemetry credentials are invalid or corrupt; repair is required.' }
        Write-Host '[OK] Existing telemetry credentials preserved.' -ForegroundColor Green
        return
    }
    if ($receiverExists -or $agentExists) { throw 'Telemetry credential state is incomplete; repair is required.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $resolvedInstallPath 'agent\scripts\Provision-FieldOpsTelemetryCredential.ps1') -AgentId 'FieldOpsDashboard'
    if ($LASTEXITCODE -ne 0) { throw "Telemetry credential provisioning failed with exit code $LASTEXITCODE." }
}

function Invoke-FieldOpsAgentInstaller {
    param(
        [Parameter(Mandatory = $true)][string]$InstallerPath,
        [Parameter(Mandatory = $true)][string]$PublishPath,
        [Parameter(Mandatory = $true)][string]$TrayPublishPath,
        [Parameter(Mandatory = $true)][string]$OperatorAccount,
        [AllowEmptyCollection()][string[]]$AdditionalServiceEnvironment = @()
    )

    $arguments = @{
        PublishPath = $PublishPath
        TrayPublishPath = $TrayPublishPath
        OperatorAccount = $OperatorAccount
    }
    [string[]]$normalizedServiceEnvironment = @($AdditionalServiceEnvironment)
    if ($normalizedServiceEnvironment.Count -gt 0) {
        $arguments.Add('AdditionalServiceEnvironment', $normalizedServiceEnvironment)
    }
    & $InstallerPath @arguments
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
$runtimeReadinessFailed = $false
$runtimeShutdownStarted = $false
$runtimeSnapshot = $null
$runtimeRollbackResult = $null
$filesystemRollbackSucceeded = $false
$runtimeMayHaveStarted = $false
$rollbackQuiescenceSucceeded = $true
$safeWorkingDirectory = $installParent
$backupRetentionModule = Join-Path $PSScriptRoot 'scripts\FieldOps.BackupRetention.psm1'
Import-Module $backupRetentionModule -Force

try {
    $existingBackups = @(Get-FieldOpsRecoveryBackups -ParentPath $installParent -InstallName $installName -ExcludedPaths @($resolvedInstallPath, $stagePath, $downloadRoot, $failedPath))
    if ($existingBackups.Count -gt 0) {
        Write-Host "[!] Recovery backups found: $($existingBackups.Count); cleanup will run after successful deployment." -ForegroundColor Yellow
    }
    New-Item -ItemType Directory -Path $downloadRoot | Out-Null

    Write-Host '[1/8] Downloading and validating update candidates...' -ForegroundColor Yellow
    $deploymentRevision = Resolve-DeploymentRevision -Repository $Repository -Branch $Branch -Revision $Revision
    $url = "https://github.com/$Repository/archive/$deploymentRevision.tar.gz"
    for ($index = 0; $index -lt 1; $index++) {
        $archivePath = Join-Path $downloadRoot "candidate-$index.tar.gz"
        $extractPath = Join-Path $downloadRoot "candidate-$index"

        try {
            Write-Host " -> Trying $url" -ForegroundColor Gray
            if (Test-Path -LiteralPath $url -PathType Leaf) {
                Copy-Item -LiteralPath $url -Destination $archivePath
            } else {
                Invoke-WebRequest -Uri $url -OutFile $archivePath -UseBasicParsing
            }

            Expand-GitHubTarGz -ArchivePath $archivePath -DestinationPath $extractPath
            $candidateRoot = Get-PackageRoot -ExtractPath $extractPath
            Assert-RequiredFiles -Root $candidateRoot -RequiredFiles $requiredPackageFiles -Description 'Downloaded package'
            $packageRoot = $candidateRoot
            Write-Host "[OK] Validated update package from $url" -ForegroundColor Green
            break
        } catch {
            $candidateError = $_
            Write-Host " [!] Rejected candidate: $($candidateError.Exception.Message)" -ForegroundColor DarkYellow
            if (Test-Path -LiteralPath $extractPath) {
                try { Remove-TemporaryCandidate -CandidatePath $extractPath -DownloadRootPath $downloadRoot } catch { Write-Warning "Rejected candidate cleanup was not completed: $($_.Exception.Message)" }
            }
        }
    }

    if (-not $packageRoot) {
        throw 'No download candidate contained a valid FieldOps Dashboard deployment package.'
    }

    Import-Module (Join-Path $packageRoot 'agent\scripts\FieldOps.OperatorResolution.psm1') -Force
    $resolvedOperator = Resolve-FieldOpsInteractiveOperator -OperatorAccount $OperatorAccount
    $OperatorAccount = $resolvedOperator.Account
    $operatorSource = if ($resolvedOperator.Source -eq 'explicit') { 'explicit' } else { 'interactive' }
    Write-Host "[OK] FieldOps operator: $($resolvedOperator.Account) ($operatorSource)" -ForegroundColor Green
    Write-Host "     SID: $($resolvedOperator.Sid)" -ForegroundColor Gray

    if ([string]::IsNullOrWhiteSpace($NativeArtifactPath)) {
        $NativeArtifactPath = Join-Path $downloadRoot 'fieldops-native-win-x64.zip'
        $artifactUrl = $NativeArtifactUrl
        try {
            Invoke-WebRequest -Uri $artifactUrl -OutFile $NativeArtifactPath -UseBasicParsing
        } catch { throw "Native artifact download failed from '$artifactUrl': $($_.Exception.Message)" }
    }
    $nativeRoot = Assert-NativeArtifact -Path $NativeArtifactPath -ExpectedRevision $deploymentRevision
    $p533RuntimeRoot = Assert-P533RuntimeArtifact -PackageRoot $packageRoot -NativeRoot $nativeRoot -ExpectedRevision $deploymentRevision

    Write-Host '[2/8] Staging validated package...' -ForegroundColor Yellow
    Copy-PackageTree -Source $packageRoot -Destination $stagePath
    $stagedRuntimeRoot = Join-Path $stagePath 'p533-assets\runtime'
    New-Item -ItemType Directory -Path $stagedRuntimeRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $p533RuntimeRoot '*') -Destination $stagedRuntimeRoot -Recurse -Force
    Assert-RequiredFiles -Root $stagePath -RequiredFiles $requiredDeploymentFiles -Description 'Staged deployment'

    Write-Host '[3/8] Stopping FieldOps and dashboard processes...' -ForegroundColor Yellow
    Import-Module (Join-Path $stagePath 'scripts\FieldOps.RuntimeRollback.psm1') -Force
    $runtimeSnapshot = Get-FieldOpsRuntimeSnapshot `
        -DashboardRoot $resolvedInstallPath `
        -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
        -TrayPath (Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe') `
        -OperatorAccount $OperatorAccount `
        -OperatorSid $resolvedOperator.Sid
    Import-Module (Join-Path $stagePath 'scripts\FieldOps.RuntimeShutdown.psm1') -Force
    if ($SkipProcessStop) {
        Write-Warning 'Process shutdown and the activation quiescence gate were skipped by -SkipProcessStop.'
    }
    else {
        $runtimeShutdownStarted = $true
        Stop-FieldOpsLauncherWrappers -InstallRoot $resolvedInstallPath
        Invoke-FieldOpsRuntimeShutdown `
            -DashboardRoot $resolvedInstallPath `
            -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
            -Timeout ([TimeSpan]::FromSeconds(30)) | Out-Null
    }
    Write-Host '[4/8] Activating staged deployment...' -ForegroundColor Yellow
    # Ensure the updater is not running from the directory it is about to move.
    Set-Location -LiteralPath $installParent
    if (-not $SkipProcessStop) {
        Wait-FieldOpsRuntimeQuiescent `
            -DashboardRoot $resolvedInstallPath `
            -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
            -ServiceName 'FieldOpsAgent' `
            -Timeout ([TimeSpan]::FromSeconds(30)) | Out-Null
    }
    Remove-Module FieldOps.RuntimeShutdown -Force -ErrorAction SilentlyContinue
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
    $deploymentManifest = [ordered]@{
        sourceRevision = $deploymentRevision
        nativeRevision = $deploymentRevision
        informationalVersion = $null
        deployedAtUtc = [DateTime]::UtcNow.ToString('O')
    }
    $nativeManifest = Get-Content -LiteralPath (Join-Path $nativeRoot 'artifact-manifest.json') -Raw | ConvertFrom-Json
    $deploymentManifest.informationalVersion = [string]$nativeManifest.informationalVersion
    $manifestJson = $deploymentManifest | ConvertTo-Json -Depth 3
    [IO.File]::WriteAllText((Join-Path $resolvedInstallPath 'deployment-manifest.json'), $manifestJson, (New-Object Text.UTF8Encoding($false)))
    Write-Host '[5/8] Restoring dependencies and building production dashboard...' -ForegroundColor Yellow
    Set-Location -LiteralPath $resolvedInstallPath
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required for the production dashboard build.' }
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }

    Write-Host '[6/8] Publishing and installing the Local Agent and tray...' -ForegroundColor Yellow
    $artifactRoot = Join-Path $resolvedInstallPath 'agent\artifacts\publish\win-x64'
    New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $nativeRoot 'agent') -Destination $artifactRoot -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $nativeRoot 'tray') -Destination $artifactRoot -Recurse -Force
    $runtimeMayHaveStarted = $true
    $serviceEnvironment = if ($EnableCf20GnssRecovery) { @(
        'Agent__Location__Recovery__Enabled=true',
        'Agent__Location__Recovery__Provider=SierraEm7455B',
        'Agent__Location__Recovery__ControlPort=COM7',
        'Agent__Location__Recovery__ControlBaud=115200'
    ) } else { @() }
    Invoke-FieldOpsAgentInstaller `
        -InstallerPath (Join-Path $resolvedInstallPath 'agent\scripts\Install-FieldOpsAgent.ps1') `
        -PublishPath (Join-Path $artifactRoot 'agent') `
        -TrayPublishPath (Join-Path $artifactRoot 'tray') `
        -OperatorAccount $OperatorAccount `
        -AdditionalServiceEnvironment $serviceEnvironment
    if ($LASTEXITCODE -ne 0) { throw "FieldOps agent/tray installation failed with exit code $LASTEXITCODE." }
    Ensure-FieldOpsTelemetryCredentials

    Import-Module (Join-Path $resolvedInstallPath 'agent\scripts\FieldOps.TrayScheduledLaunch.psm1') -Force
    Write-Host "[6/8] Starting FieldOps Tray for $OperatorAccount through an interactive scheduled task..." -ForegroundColor Yellow
    try {
        $trayResult = Start-FieldOpsTrayScheduledLaunch `
            -TrayPath (Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe') `
            -OperatorAccount $OperatorAccount `
            -OperatorSid $resolvedOperator.Sid
        if ($trayResult.Status -eq 'AlreadyRunning') {
            Write-Host "[OK] FieldOps Tray already running for '$OperatorAccount'." -ForegroundColor Green
        } else {
            Write-Host "[OK] FieldOps Tray running in interactive session $($trayResult.SessionId)." -ForegroundColor Green
        }
    } catch {
        Write-Host "[!] Installation succeeded, but interactive FieldOps Tray availability could not be verified: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Write-Host '[OK] Deployment installed; runtime verification completed with the result above.' -ForegroundColor Green

    if (-not $SkipLaunch) {
        Write-Host '[7/8] Starting production Dashboard Server...' -ForegroundColor Green
        Set-Location -LiteralPath $resolvedInstallPath
        Import-Module (Join-Path $resolvedInstallPath 'scripts\FieldOps.RuntimeReadiness.psm1') -Force
        Start-FieldOpsDashboardProcess -DashboardRoot $resolvedInstallPath | Out-Null
    } else {
        Write-Host '[7/8] Dashboard launch skipped.' -ForegroundColor Gray
    }

    Write-Host '[8/8] Verifying FieldOps runtime...' -ForegroundColor Yellow
    Import-Module (Join-Path $resolvedInstallPath 'scripts\FieldOps.RuntimeReadiness.psm1') -Force
    $readiness = Test-FieldOpsRuntimeReadiness `
        -DashboardRoot $resolvedInstallPath `
        -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
        -TrayPath (Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe') `
        -OperatorAccount $OperatorAccount `
        -OperatorSid $resolvedOperator.Sid `
        -ExpectedRevision $deploymentRevision `
        -SkipLaunch:$SkipLaunch
    if ($readiness.Agent.Status -eq 'Passed') {
        Write-Host "[OK] Agent: $($readiness.Agent.Detail)" -ForegroundColor Green
        Write-Host "[OK] Agent PID after restart: $($readiness.Agent.ProcessId)" -ForegroundColor Green
    } else {
        Write-Host "[X] Agent: $($readiness.Agent.Detail)" -ForegroundColor Red
    }
    if ($readiness.Tray.Status -eq 'Passed') {
        Write-Host "[OK] Tray: $($readiness.Tray.Detail)" -ForegroundColor Green
    } else {
        Write-Host "[X] Tray: $($readiness.Tray.Detail)" -ForegroundColor Red
    }
    if ($readiness.Dashboard.Status -eq 'Passed') {
        Write-Host "[OK] Dashboard: $($readiness.Dashboard.Detail)" -ForegroundColor Green
    } elseif ($readiness.Dashboard.Status -eq 'Skipped') {
        Write-Host "[!] Dashboard: $($readiness.Dashboard.Detail)" -ForegroundColor Yellow
    } else {
        Write-Host "[X] Dashboard: $($readiness.Dashboard.Detail)" -ForegroundColor Red
    }
    if ($readiness.Status -eq 'Passed') {
        Write-Host "[OK] Revision: $($readiness.Revision) source/native match" -ForegroundColor Green
        $cleanup = Invoke-FieldOpsRecoveryBackupCleanup `
            -ParentPath $installParent `
            -InstallName $installName `
            -CurrentTransactionBackupPath $backupPath `
            -ExcludedPaths @($resolvedInstallPath, $stagePath, $downloadRoot, $failedPath) `
            -CleanupCurrentTransactionBackup
        foreach ($failure in $cleanup.Failures) {
            Write-Host "[!] Backup cleanup: could not remove $($failure.Name): $($failure.Detail)" -ForegroundColor Yellow
        }
        if ($cleanup.Failures.Count -eq 0 -and $cleanup.RemovedCount -eq 0 -and $cleanup.RetainedCount -eq 0) {
            Write-Host '[OK] Recovery backups: none require cleanup.' -ForegroundColor Green
        } else {
            Write-Host "[OK] Recovery backups: retained $($cleanup.RetainedCount), removed $($cleanup.RemovedCount)." -ForegroundColor Green
        }
        Write-Host '[OK] FieldOps Dashboard update complete.' -ForegroundColor Green
        $deploymentStarted = $false
    } else {
        $runtimeReadinessFailed = $true
        $readinessFailureMessage = ($readiness.Failures -join '; ')
        Write-Host '[!] Installation completed, but runtime readiness verification failed:' -ForegroundColor Yellow
        foreach ($failure in $readiness.Failures) { Write-Host "    $failure" -ForegroundColor Yellow }
        throw "Runtime readiness verification failed after installation: $readinessFailureMessage"
    }
} catch {
    $updateError = $_

    Write-UpdateError -ErrorRecord $updateError

    if ($deploymentStarted -and $runtimeMayHaveStarted -and -not $SkipProcessStop) {
        try {
            Import-Module (Join-Path $resolvedInstallPath 'scripts\FieldOps.RuntimeShutdown.psm1') -Force
            Write-Host '[ROLLBACK] Quiescing newly started FieldOps runtime before filesystem restore...' -ForegroundColor Yellow
            Invoke-FieldOpsRuntimeShutdown `
                -DashboardRoot $resolvedInstallPath `
                -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
                -Timeout ([TimeSpan]::FromSeconds(30)) | Out-Null
            Wait-FieldOpsRuntimeQuiescent `
                -DashboardRoot $resolvedInstallPath `
                -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
                -ServiceName 'FieldOpsAgent' `
                -Timeout ([TimeSpan]::FromSeconds(30)) | Out-Null
            Write-Host '[OK] Newly started FieldOps runtime is quiescent.' -ForegroundColor Yellow
        } catch {
            $rollbackQuiescenceSucceeded = $false
            Write-Host "[X] Rollback quiescence failed; filesystem restore was not attempted: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    if ($deploymentStarted -and $rollbackQuiescenceSucceeded -and (Test-Path -LiteralPath $backupPath -PathType Container)) {
        try {
            Set-Location -LiteralPath $safeWorkingDirectory
            $newNodeModules = Join-Path $resolvedInstallPath 'node_modules'
            if ((Test-Path -LiteralPath $newNodeModules -PathType Container) -and
                -not (Test-Path -LiteralPath (Join-Path $backupPath 'node_modules'))) {
                Move-Item -LiteralPath $newNodeModules -Destination (Join-Path $backupPath 'node_modules')
            }
            if (Test-Path -LiteralPath $resolvedInstallPath) {
                Move-Item -LiteralPath $resolvedInstallPath -Destination $failedPath
            }
            Move-Item -LiteralPath $backupPath -Destination $resolvedInstallPath
            $filesystemRollbackSucceeded = $true
            Write-Host '[OK] Previous installation restored.' -ForegroundColor Yellow
        } catch {
            $lockedPath = if (Test-Path -LiteralPath $resolvedInstallPath) { $resolvedInstallPath } else { $backupPath }
            $lockingProcesses = @(Get-FieldOpsRollbackLockingProcesses -InstallRoot $resolvedInstallPath)
            $lockHint = if ($lockingProcesses.Count -gt 0) { ($lockingProcesses | ForEach-Object { "PID $($_.ProcessId) $($_.Name) CommandLine=[$($_.CommandLine)] ExecutablePath=[$($_.ExecutablePath)]" }) -join '; ' } else { 'undetermined' }
            Write-Host "[X] Rollback failed while handling '$lockedPath'. Likely locking process: $lockHint. Partial state: dashboard activation may remain at '$resolvedInstallPath' and backup may remain at '$backupPath'." -ForegroundColor Red
            Write-Host "[X] Rollback error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    if ($runtimeShutdownStarted -and $null -ne $runtimeSnapshot -and ($filesystemRollbackSucceeded -or -not $deploymentStarted)) {
        Write-Host '[ROLLBACK] Restoring previous runtime state...' -ForegroundColor Yellow
        try {
            $runtimeRollbackResult = Restore-FieldOpsRuntimeState `
                -Snapshot $runtimeSnapshot `
                -DashboardRoot $resolvedInstallPath `
                -NativeRoot (Join-Path $env:ProgramFiles 'FieldOpsDashboard') `
                -TrayPath (Join-Path $env:ProgramFiles 'FieldOpsDashboard\Tray\FieldOps.Tray.exe') `
                -ExpectedOperatorAccount $OperatorAccount `
                -ExpectedOperatorSid $resolvedOperator.Sid `
                -ExpectedRevision $(if ($null -eq $runtimeSnapshot.Revision) { '' } else { [string]$runtimeSnapshot.Revision.SourceRevision })
            foreach ($component in @('Agent', 'Tray', 'Dashboard', 'Revision')) {
                $result = $runtimeRollbackResult.$component
                $color = if ($result.Status -eq 'Passed') { 'Green' } elseif ($result.Status -eq 'Warning') { 'Yellow' } else { 'Red' }
                Write-Host "[$(if ($result.Status -eq 'Passed') { 'OK' } else { '!' })] $component restored: $($result.Detail)" -ForegroundColor $color
            }
            if ($runtimeRollbackResult.Status -ne 'Passed') {
                Write-Host '[!] Previous installation restored, but runtime restoration had problems:' -ForegroundColor Yellow
                foreach ($failure in $runtimeRollbackResult.Failures) { Write-Host "    $failure" -ForegroundColor Yellow }
            }
        } catch {
            Write-Host "[!] Previous installation restored, but runtime restoration failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    if ($runtimeReadinessFailed) { Write-Host '[!] Installation completed, but runtime readiness verification failed. Rollback was attempted.' -ForegroundColor Yellow }
    exit 1
} finally {
    Set-Location -LiteralPath $safeWorkingDirectory
    foreach ($path in @($downloadRoot, $stagePath, $failedPath)) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
