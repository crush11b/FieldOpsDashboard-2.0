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
$publishRoot = Join-Path $repoRoot 'agent\artifacts\publish\win-x64'

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

Assert-Elevated
Assert-ToughBook
if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { throw "Repository '$repoRoot' was not found." }
foreach ($path in @($publishScript, $installerScript)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required deployment file '$path' was not found." } }
Assert-Command 'npm'
Assert-Command 'robocopy.exe'

Write-Host '[1/6] Publishing Agent and Tray...' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $publishScript -OutputRoot $publishRoot -SourceRevision (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "Native artifact publish failed with exit code $LASTEXITCODE." }
$agentPublish = Join-Path $publishRoot 'agent'
$trayPublish = Join-Path $publishRoot 'tray'
foreach ($path in @((Join-Path $agentPublish 'FieldOps.Agent.exe'), (Join-Path $trayPublish 'FieldOps.Tray.exe'))) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Published artifact '$path' is missing." } }
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

Write-Host '[6/6] Deployment summary' -ForegroundColor Cyan
Write-Host '✓ Agent published' -ForegroundColor Green
Write-Host '✓ Tray published' -ForegroundColor Green
Write-Host '✓ Source updated' -ForegroundColor Green
Write-Host '✓ Agent installed' -ForegroundColor Green
Write-Host '✓ Dashboard built' -ForegroundColor Green
Write-Host "Ready to launch: Set-Location '$InstallPath'; npm start" -ForegroundColor Green
Write-Host 'Development helper only. Production updating remains a separate workflow.' -ForegroundColor Yellow
