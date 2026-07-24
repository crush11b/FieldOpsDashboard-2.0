# FieldOps Dashboard - Safe Auto-Updater Script
[CmdletBinding()]
param()

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " FieldOps Dashboard - Safe Update & Sync Utility " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }

# Step 1: Force stop any active Node / tsx / npm / vite processes holding file locks
Write-Host "[1/5] Stopping active Node/TSX server processes to release Windows file locks..." -ForegroundColor Yellow
Get-Process -Name "node","tsx","npm","vite" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

# Step 2: Clear read-only flags on destination files
Write-Host "[2/5] Clearing file attributes in $scriptDir..." -ForegroundColor Yellow
Get-ChildItem -Path "$scriptDir" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        if ($_.Attributes -band [System.IO.FileAttributes]::ReadOnly) {
            $_.Attributes = $_.Attributes -bxor [System.IO.FileAttributes]::ReadOnly
        }
    } catch {}
}

# Step 3: Download latest zip package
$zipPath = Join-Path $env:TEMP "FieldOpsDashboard_Update.zip"
$extractPath = Join-Path $env:TEMP "FieldOpsDashboard_Extract"

$urls = @(
    "https://ais-dev-mtof6szn6a4fcorkvc4en4-469962103239.us-east1.run.app/api/download-project-zip",
    "https://github.com/stickman563/FieldOpsDashboard-2.0/archive/refs/heads/main.zip",
    "https://github.com/stickman563/FieldOpsDashboard-2.0/archive/refs/heads/master.zip"
)

Write-Host "[3/5] Downloading latest codebase archive..." -ForegroundColor Yellow
if (Test-Path $extractPath) { Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue }

$downloaded = $false
foreach ($url in $urls) {
    try {
        Write-Host " -> Trying download source: $url" -ForegroundColor Gray
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 30
        if ((Test-Path $zipPath) -and ((Get-Item $zipPath).Length -gt 2000)) {
            Write-Host "[✓] Download successful!" -ForegroundColor Green
            $downloaded = $true
            break
        }
    } catch {
        Write-Host " [!] Source unavailable" -ForegroundColor DarkGray
    }
}

if (-not $downloaded) {
    Write-Host "[X] ERROR: Could not download update zip from any server." -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

# Step 4: Extract and safely copy
Write-Host "[4/5] Extracting and updating local files..." -ForegroundColor Yellow
try {
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
    
    $subDirs = Get-ChildItem -Path $extractPath -Directory
    $sourceDir = $extractPath
    if ($subDirs.Count -eq 1 -and (Test-Path (Join-Path $subDirs[0].FullName "package.json"))) {
        $sourceDir = $subDirs[0].FullName
    }

    if (Test-Path (Join-Path $sourceDir "package.json")) {
        Get-ChildItem -Path "$sourceDir\*" -Exclude "node_modules" | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination "$scriptDir" -Recurse -Force
        }
        Write-Host "[✓] All files successfully updated and overwritten!" -ForegroundColor Green
    } else {
        Write-Host "[X] ERROR: Extracted package missing package.json." -ForegroundColor Red
    }
} catch {
    Write-Host "[X] Update copy failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Clean temp files
Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue

# Step 5: Launch server
Write-Host "[5/5] Launching Dashboard Server..." -ForegroundColor Green
Set-Location -Path "$scriptDir"
npm run dev

