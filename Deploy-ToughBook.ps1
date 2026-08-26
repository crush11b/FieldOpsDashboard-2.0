[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\FieldOpsDashboard',
    [string]$OperatorAccount = '.\stick',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$publishScript = Join-Path $repoRoot 'agent\scripts\Publish-FieldOpsArtifacts.ps1'
$installerScript = Join-Path $repoRoot 'agent\scripts\Install-FieldOpsAgent.ps1'
$metadataPath = Join-Path $repoRoot 'product-metadata.json'
$deploymentManifestPath = Join-Path $InstallPath 'deployment-manifest.json'
$nativeInstallRoot = Join-Path $env:ProgramFiles 'FieldOpsDashboard'
$agentInstallPath = Join-Path $nativeInstallRoot 'Agent\FieldOps.Agent.exe'
$trayInstallPath = Join-Path $nativeInstallRoot 'Tray\FieldOps.Tray.exe'
$operationId = [Guid]::NewGuid().ToString('N')
$publishRoot = Join-Path ([IO.Path]::GetTempPath()) "fieldops-deploy-$operationId"

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Required command '$Name' was not found." }
}

function Assert-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run Deploy-ToughBook.ps1 from an elevated PowerShell window.' }
}

function Assert-ToughBook {
    if ($Force) { Write-Warning 'ToughBook model check bypassed with -Force.'; return }
    $model = (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).Model
    if ($model -notmatch 'ToughBook|ToughPad') { throw "This machine is not identified as a ToughBook/ToughPad ('$model'). Use -Force only for controlled development." }
}

function Resolve-RepositoryHead {
    $head = @(& git -C $repoRoot rev-parse --verify 'HEAD^{commit}')
    if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1 -or ([string]$head[0]).Trim() -notmatch '^[0-9a-fA-F]{40}$') {
        throw 'Could not resolve the current repository HEAD to a full commit SHA.'
    }
    return ([string]$head[0]).Trim().ToLowerInvariant()
}

function Assert-CleanRepository {
    $dirty = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the repository worktree.' }
    if ($dirty.Count -gt 0) { throw 'Deployment requires a clean repository worktree so copied source corresponds exactly to HEAD.' }
}

function Get-EmbeddedRevision {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Component)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Component executable '$Path' is missing." }
    $productVersion = [string](Get-Item -LiteralPath $Path).VersionInfo.ProductVersion
    if ($productVersion -notmatch '\+([0-9a-fA-F]{40})$') {
        throw "$Component executable '$Path' does not expose a full informational revision; observed ProductVersion '$productVersion'."
    }
    return $matches[1].ToLowerInvariant()
}

function Assert-Revision {
    param([Parameter(Mandatory = $true)][string]$Component, [Parameter(Mandatory = $true)][string]$Observed, [Parameter(Mandatory = $true)][string]$Expected)
    if (-not [string]::Equals($Observed, $Expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Revision parity failed for $Component. Expected '$Expected'; observed '$Observed'."
    }
}

function Assert-DeploymentParity {
    param([Parameter(Mandatory = $true)][string]$ExpectedRevision, [Parameter(Mandatory = $true)][string]$ExpectedInformationalVersion)
    $manifest = Get-Content -LiteralPath $deploymentManifestPath -Raw | ConvertFrom-Json
    Assert-Revision 'deployment manifest sourceRevision' ([string]$manifest.sourceRevision) $ExpectedRevision
    Assert-Revision 'deployment manifest nativeRevision' ([string]$manifest.nativeRevision) $ExpectedRevision
    if ([string]$manifest.informationalVersion -ne $ExpectedInformationalVersion) {
        throw "Revision parity failed for deployment manifest informationalVersion. Expected '$ExpectedInformationalVersion'; observed '$($manifest.informationalVersion)'."
    }
    Assert-Revision 'installed Agent' (Get-EmbeddedRevision $agentInstallPath 'Agent') $ExpectedRevision
    Assert-Revision 'installed Tray' (Get-EmbeddedRevision $trayInstallPath 'Tray') $ExpectedRevision
}

function Assert-DashboardParity {
    param([Parameter(Mandatory = $true)][string]$ExpectedRevision)
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $node) { $node = Get-Command node -ErrorAction SilentlyContinue }
    if ($null -eq $node) { throw 'Node.js executable was not found on PATH for Dashboard parity validation.' }
    $serverPath = Join-Path $InstallPath 'dist\server.cjs'
    $dashboardProcess = $null
    try {
        $dashboardProcess = Start-Process -FilePath $node.Source -ArgumentList @($serverPath) -WorkingDirectory $InstallPath -PassThru -WindowStyle Hidden
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do {
            try {
                $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/version' -UseBasicParsing -TimeoutSec 2
                if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) {
                    $version = $response.Content | ConvertFrom-Json
                    Assert-Revision 'Dashboard /api/version sourceRevision' ([string]$version.sourceRevision) $ExpectedRevision
                    Assert-Revision 'Dashboard /api/version nativeRevision' ([string]$version.nativeRevision) $ExpectedRevision
                    return
                }
            } catch { }
            if ($dashboardProcess.HasExited) { throw "Dashboard parity process exited with code $($dashboardProcess.ExitCode) before /api/version returned the deployed identity." }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $deadline)
        throw 'Dashboard /api/version did not prove revision parity within 30 seconds.'
    } finally {
        if ($null -ne $dashboardProcess -and -not $dashboardProcess.HasExited) {
            Stop-Process -Id $dashboardProcess.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

Assert-Elevated
Assert-ToughBook
if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { throw "Repository '$repoRoot' was not found." }
foreach ($path in @($publishScript, $installerScript)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required deployment file '$path' was not found." } }
Assert-Command 'npm'
Assert-Command 'robocopy.exe'
$expectedRevision = Resolve-RepositoryHead
Assert-CleanRepository
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$expectedInformationalVersion = "{0}+{1}" -f ([string]$metadata.version), $expectedRevision

try {
Write-Host "[1/6] Publishing Agent and Tray for HEAD $expectedRevision..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $publishScript -OutputRoot $publishRoot -SourceRevision $expectedRevision
if ($LASTEXITCODE -ne 0) { throw "Native artifact publish failed with exit code $LASTEXITCODE." }
$agentPublish = Join-Path $publishRoot 'agent'
$trayPublish = Join-Path $publishRoot 'tray'
foreach ($path in @((Join-Path $agentPublish 'FieldOps.Agent.exe'), (Join-Path $trayPublish 'FieldOps.Tray.exe'))) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Published artifact '$path' is missing." } }
Assert-Revision 'published Agent' (Get-EmbeddedRevision (Join-Path $agentPublish 'FieldOps.Agent.exe') 'Agent') $expectedRevision
Assert-Revision 'published Tray' (Get-EmbeddedRevision (Join-Path $trayPublish 'FieldOps.Tray.exe') 'Tray') $expectedRevision
Write-Host '[OK] Agent and Tray published.' -ForegroundColor Green

Write-Host '[2/6] Updating dashboard source...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
& robocopy.exe $repoRoot $InstallPath /E /XD '.git' 'node_modules' 'dist' 'bin' 'obj' 'artifacts' /XF '.env' '.env.*' /R:1 /W:1 /COPY:DAT /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw "Dashboard source copy failed with exit code $LASTEXITCODE." }
Write-Host '[OK] Source updated without renaming or mirroring the installation.' -ForegroundColor Green

Write-Host '[3/6] Installing Agent and Tray...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $InstallPath 'agent\scripts\Install-FieldOpsAgent.ps1') -PublishPath $agentPublish -TrayPublishPath $trayPublish -OperatorAccount $OperatorAccount
if ($LASTEXITCODE -ne 0) { throw "Agent installation failed with exit code $LASTEXITCODE." }
Write-Host '[OK] Agent installed.' -ForegroundColor Green

Push-Location -LiteralPath $InstallPath
try {
    Write-Host '[4/6] Installing dashboard dependencies...' -ForegroundColor Cyan
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
    Write-Host '[5/6] Building dashboard...' -ForegroundColor Cyan
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Dashboard build failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

Write-Host '[6/6] Validating deployment revision parity...' -ForegroundColor Cyan
$nativeManifest = Get-Content -LiteralPath (Join-Path $publishRoot 'artifact-manifest.json') -Raw | ConvertFrom-Json
if ([string]$nativeManifest.sourceRevision -ne $expectedRevision) { throw "Published artifact manifest revision '$($nativeManifest.sourceRevision)' does not equal expected revision '$expectedRevision'." }
$deploymentManifest = [ordered]@{
    sourceRevision = $expectedRevision
    nativeRevision = $expectedRevision
    informationalVersion = [string]$nativeManifest.informationalVersion
    deployedAtUtc = [DateTime]::UtcNow.ToString('O')
}
if ([string]$deploymentManifest.informationalVersion -ne $expectedInformationalVersion) { throw "Published informational version '$($deploymentManifest.informationalVersion)' does not equal expected '$expectedInformationalVersion'." }
[IO.File]::WriteAllText($deploymentManifestPath, ($deploymentManifest | ConvertTo-Json -Depth 3) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Assert-DeploymentParity -ExpectedRevision $expectedRevision -ExpectedInformationalVersion $expectedInformationalVersion
Assert-DashboardParity -ExpectedRevision $expectedRevision

Write-Host '[OK] Revision parity proven across repository, manifest, Dashboard, Agent, and Tray.' -ForegroundColor Green
Write-Host '[6/6] Deployment summary' -ForegroundColor Cyan
Write-Host '✓ Agent published' -ForegroundColor Green
Write-Host '✓ Tray published' -ForegroundColor Green
Write-Host '✓ Source updated' -ForegroundColor Green
Write-Host '✓ Agent installed' -ForegroundColor Green
Write-Host '✓ Dashboard built' -ForegroundColor Green
Write-Host "Ready to launch: Set-Location '$InstallPath'; npm start" -ForegroundColor Green
Write-Host 'Development helper only. Production updating remains a separate workflow.' -ForegroundColor Yellow
} finally {
    if (Test-Path -LiteralPath $publishRoot) { Remove-Item -LiteralPath $publishRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
