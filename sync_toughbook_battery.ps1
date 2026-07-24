# ToughBook Dual Battery Live Telemetry Sync Utility for FieldOps Dashboard
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

$u = 'https://ais-dev-mtof6szn6a4fcorkvc4en4-469962103239.us-east1.run.app/api/system/battery/telemetry'

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " ToughBook Dual Battery Telemetry Sync Active " -ForegroundColor Cyan
Write-Host " Endpoint: $u " -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor Cyan

while ($true) {
    try {
        $b = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue)
        $p1 = 100
        $p2 = $null
        if ($b.Count -gt 0 -and $b[0].EstimatedChargeRemaining -ne $null) {
            $p1 = [int]$b[0].EstimatedChargeRemaining
        }
        if ($b.Count -gt 1 -and $b[1].EstimatedChargeRemaining -ne $null) {
            $p2 = [int]$b[1].EstimatedChargeRemaining
        }
        
        $payload = @{
            b1 = $p1
            mainTabletPercent = $p1
        }
        if ($p2 -ne $null) {
            $payload['b2'] = $p2
            $payload['keyboardDockPercent'] = $p2
        }
        
        $json = $payload | ConvertTo-Json -Compress
        $res = Invoke-RestMethod -Uri $u -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
        
        $timeStr = Get-Date -Format 'HH:mm:ss'
        $b2Str = if ($p2 -ne $null) { "$p2%" } else { 'N/A' }
        Write-Host "[$timeStr] Synced Main Tablet: $p1% | Keyboard Dock: $b2Str" -ForegroundColor Green
    } catch {
        $timeStr = Get-Date -Format 'HH:mm:ss'
        Write-Host "[$timeStr] Sync Notice: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Start-Sleep -Seconds 5
}
