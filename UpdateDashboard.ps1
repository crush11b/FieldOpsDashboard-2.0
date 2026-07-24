# FieldOps Dashboard - Safe Auto-Updater Script
[CmdletBinding()]
param()

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
$ProgressPreference = 'SilentlyContinue'

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " FieldOps Dashboard - Safe Auto-Update Utility " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location | Select-Object -ExpandProperty Path }

# Step 1: Force stop any active Node / tsx / npm / vite processes holding file locks
Write-Host "[1/5] Stopping active Node/TSX server processes to release file locks..." -ForegroundColor Yellow
Get-Process -Name "node","tsx","npm","vite" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Step 2: Clear read-only flags and flatten legacy subfolders
Write-Host "[2/5] Preparing target directory ($scriptDir)..." -ForegroundColor Yellow

# Clean up legacy GitHub subfolder if it was accidentally created
$legacyNestedDir = Join-Path $scriptDir "FieldOpsDashboard-2.0-main"
if (Test-Path $legacyNestedDir) {
    Write-Host " -> Cleaning legacy nested folder: $legacyNestedDir" -ForegroundColor Gray
    try {
        Get-ChildItem -Path "$legacyNestedDir\*" -Exclude "node_modules" -ErrorAction SilentlyContinue | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination "$scriptDir" -Recurse -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $legacyNestedDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {}
}

Get-ChildItem -Path "$scriptDir" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        if ($_.Attributes -band [System.IO.FileAttributes]::ReadOnly) {
            $_.Attributes = $_.Attributes -bxor [System.IO.FileAttributes]::ReadOnly
        }
    } catch {}
}

# Step 3: Download latest zip archive
$zipPath = Join-Path $env:TEMP "FieldOpsDashboard_Update.zip"
$extractPath = Join-Path $env:TEMP "FieldOpsDashboard_Extract"

if (Test-Path $extractPath) { Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue }

$downloadUrls = @(
    "https://ais-dev-mtof6szn6a4fcorkvc4en4-469962103239.us-east1.run.app/api/download-project-zip",
    "https://github.com/stickman563/FieldOpsDashboard-2.0/archive/refs/heads/main.zip",
    "https://github.com/stickman563/FieldOpsDashboard-2.0/archive/refs/heads/master.zip"
)

Write-Host "[3/5] Downloading latest application code..." -ForegroundColor Yellow
$downloadSuccess = $false

foreach ($url in $downloadUrls) {
    try {
        Write-Host " -> Attempting download from: $url" -ForegroundColor Gray
        if (Get-Command "curl.exe" -ErrorAction SilentlyContinue) {
            & curl.exe -s -L -f -o "$zipPath" "$url"
        } else {
            (New-Object System.Net.WebClient).DownloadFile($url, $zipPath)
        }
        
        if ((Test-Path $zipPath) -and ((Get-Item $zipPath).Length -gt 5000)) {
            Write-Host "[✓] Downloaded update archive successfully ($([math]::Round((Get-Item $zipPath).Length / 1KB, 1)) KB)" -ForegroundColor Green
            $downloadSuccess = $true
            break
        }
    } catch {
        Write-Host " [!] Source unavailable or network error." -ForegroundColor DarkGray
    }
}

if (-not $downloadSuccess) {
    Write-Host "[X] ERROR: Unable to download update package. Check network connection." -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

# Step 4: Extract & Overwrite
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
        Write-Host "[✓] All files successfully updated and overwritten in $scriptDir!" -ForegroundColor Green
    } else {
        Write-Host "[X] ERROR: Downloaded archive missing package.json." -ForegroundColor Red
    }
} catch {
    Write-Host "[X] Update copy failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Cleanup temp files
Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -Path $extractPath -Recurse -Force -ErrorAction SilentlyContinue

# Step 5: Launch Server
Write-Host "[5/5] Starting Dashboard Server..." -ForegroundColor Green
Set-Location -Path "$scriptDir"
npm run dev
