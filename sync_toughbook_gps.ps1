# ToughBook GPS & Maidenhead Location Telemetry Sync Utility for FieldOps Dashboard
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

param(
    [double]$Latitude = 37.5407,
    [double]$Longitude = -77.4360,
    [string]$GridSquare = "",
    [string]$ComPort = "COM6"
)

$endpoints = @(
    'http://localhost:3000/api/system/gps/telemetry',
    'https://ais-dev-mtof6szn6a4fcorkvc4en4-469962103239.us-east1.run.app/api/system/gps/telemetry'
)

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " ToughBook GPS & Grid Location Telemetry Sync Active  " -ForegroundColor Cyan
Write-Host " Target Coordinates: $Latitude, $Longitude             " -ForegroundColor Yellow
Write-Host "=======================================================" -ForegroundColor Cyan

$payload = @{
    lat = $Latitude
    lon = $Longitude
    gridSquare = $GridSquare
    mode = "locked"
    deviceName = "ToughBook GNSS ($ComPort)"
    source = "powershell_sync"
}

$json = $payload | ConvertTo-Json -Compress

foreach ($u in $endpoints) {
    try {
        $res = Invoke-RestMethod -Uri $u -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
        Write-Host "Successfully synced location to dashboard: $($res | ConvertTo-Json -Compress)" -ForegroundColor Green
    } catch {
        Write-Host "Failed to sync to $u : $($_.Exception.Message)" -ForegroundColor Red
    }
}
