param(
    [string]$ComPort = 'COM6',
    [int]$BaudRate = 9600,
    [int]$PublishIntervalSec = 5,
    [int]$StaleAfterSec = 30,
    [string[]]$Endpoints = @(
        'http://localhost:3000/api/system/gps/telemetry',
        'https://ais-dev-mtof6szn6a4fcorkvc4en4-469962103239.us-east1.run.app/api/system/gps/telemetry'
    )
)

# FieldOps Toughbook GNSS producer. Reads real RMC/GGA NMEA sentences and
# never substitutes default coordinates when COM6 is unavailable or lacks a fix.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$culture = [Globalization.CultureInfo]::InvariantCulture

function Test-NmeaChecksum([string]$Sentence) {
    if ($Sentence -notmatch '^\$(?<Body>[^*]+)\*(?<Checksum>[0-9A-Fa-f]{2})$') { return $false }
    [int]$value = 0
    foreach ($ch in $Matches.Body.ToCharArray()) { $value = $value -bxor [int][char]$ch }
    return $value -eq [Convert]::ToInt32($Matches.Checksum, 16)
}

function ConvertFrom-NmeaCoordinate([string]$Value, [string]$Hemisphere) {
    [double]$raw = 0
    if (-not [double]::TryParse($Value, [Globalization.NumberStyles]::Float, $culture, [ref]$raw)) {
        throw "Invalid NMEA coordinate '$Value'."
    }
    $degrees = [math]::Floor($raw / 100)
    $decimal = $degrees + (($raw - ($degrees * 100)) / 60)
    if ($Hemisphere -in @('S', 'W')) { return -$decimal }
    if ($Hemisphere -notin @('N', 'E')) { throw "Invalid hemisphere '$Hemisphere'." }
    return $decimal
}

function ConvertTo-MaidenheadGrid([double]$Latitude, [double]$Longitude) {
    $lon = $Longitude + 180.0
    $lat = $Latitude + 90.0
    return ('{0}{1}{2}{3}{4}{5}' -f
        [char](65 + [math]::Floor($lon / 20)),
        [char](65 + [math]::Floor($lat / 10)),
        [math]::Floor(($lon % 20) / 2),
        [math]::Floor($lat % 10),
        [char](97 + [math]::Floor(($lon % 2) * 12)),
        [char](97 + [math]::Floor(($lat % 1) * 24)))
}

function Get-GgaFixType([int]$Quality) {
    switch ($Quality) {
        1 { '3D GPS Fix' }
        2 { '3D DGPS Fix' }
        4 { 'RTK Fixed' }
        5 { 'RTK Float' }
        6 { 'Estimated Fix' }
        default { "GNSS Fix (Quality $Quality)" }
    }
}

function ConvertFrom-NmeaSentence([string]$Sentence) {
    $line = $Sentence.Trim()
    if (-not (Test-NmeaChecksum $line)) { return $null }

    $body = $line.Substring(1, $line.IndexOf('*') - 1)
    $f = $body.Split(',')
    $type = $f[0].Substring([math]::Max(0, $f[0].Length - 3))

    if ($type -eq 'RMC') {
        if ($f.Count -lt 10 -or $f[2] -ne 'A' -or [string]::IsNullOrWhiteSpace($f[3]) -or [string]::IsNullOrWhiteSpace($f[5])) {
            return [pscustomobject]@{ Type = 'RMC'; HasFix = $false; ReceivedAt = [DateTime]::UtcNow }
        }
        [double]$knots = 0
        [void][double]::TryParse($f[7], [Globalization.NumberStyles]::Float, $culture, [ref]$knots)
        return [pscustomobject]@{
            Type = 'RMC'; HasFix = $true; ReceivedAt = [DateTime]::UtcNow
            Latitude = ConvertFrom-NmeaCoordinate $f[3] $f[4]
            Longitude = ConvertFrom-NmeaCoordinate $f[5] $f[6]
            SpeedKmh = [math]::Round($knots * 1.852, 1)
        }
    }

    if ($type -eq 'GGA') {
        [int]$quality = 0; [int]$sats = 0; [double]$altitude = 0
        if ($f.Count -gt 6) { [void][int]::TryParse($f[6], [ref]$quality) }
        if ($quality -le 0 -or $f.Count -lt 10 -or [string]::IsNullOrWhiteSpace($f[2]) -or [string]::IsNullOrWhiteSpace($f[4])) {
            return [pscustomobject]@{ Type = 'GGA'; HasFix = $false; ReceivedAt = [DateTime]::UtcNow }
        }
        [void][int]::TryParse($f[7], [ref]$sats)
        [void][double]::TryParse($f[9], [Globalization.NumberStyles]::Float, $culture, [ref]$altitude)
        return [pscustomobject]@{
            Type = 'GGA'; HasFix = $true; ReceivedAt = [DateTime]::UtcNow
            Latitude = ConvertFrom-NmeaCoordinate $f[2] $f[3]
            Longitude = ConvertFrom-NmeaCoordinate $f[4] $f[5]
            SatCount = $sats; AltitudeM = [math]::Round($altitude, 1)
            FixType = Get-GgaFixType $quality
        }
    }

    return $null
}

function Send-Json([hashtable]$Payload) {
    $json = $Payload | ConvertTo-Json -Compress
    $success = $false
    foreach ($endpoint in $Endpoints) {
        try {
            $null = Invoke-RestMethod -Uri $endpoint -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
            Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] Posted live fix to $endpoint" -ForegroundColor Green
            $success = $true
        } catch {
            Write-Warning "POST failed for $endpoint`: $($_.Exception.Message)"
        }
    }
    return $success
}

function Clear-GpsTelemetry {
    $json = @{ clear = $true; source = 'toughbook_agent' } | ConvertTo-Json -Compress
    foreach ($endpoint in $Endpoints) {
        try { $null = Invoke-RestMethod -Uri $endpoint -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5 }
        catch { Write-Verbose "Clear failed for $endpoint`: $($_.Exception.Message)" }
    }
}

Write-Host '=======================================================' -ForegroundColor Cyan
Write-Host ' FieldOps Toughbook Live GNSS Telemetry Producer       ' -ForegroundColor Cyan
Write-Host " $ComPort @ $BaudRate baud | publish every ${PublishIntervalSec}s" -ForegroundColor Yellow
Write-Host ' Real NMEA only; no hardcoded or simulated coordinates.' -ForegroundColor Green
Write-Host '=======================================================' -ForegroundColor Cyan

$port = $null
$latestRmc = $null
$latestGga = $null
$lastPost = [DateTime]::MinValue
$hasPublishedFix = $false
$clearedForOutage = $false

try {
    while ($true) {
        if ($null -eq $port -or -not $port.IsOpen) {
            try {
                $port = [IO.Ports.SerialPort]::new($ComPort, $BaudRate, [IO.Ports.Parity]::None, 8, [IO.Ports.StopBits]::One)
                $port.ReadTimeout = 2000
                $port.NewLine = "`r`n"
                $port.Open()
                Write-Host "Opened $ComPort; waiting for valid RMC/GGA data." -ForegroundColor Green
                $clearedForOutage = $false
            } catch {
                if (-not $clearedForOutage) { Clear-GpsTelemetry; $clearedForOutage = $true }
                Write-Warning "Cannot open $ComPort. Another app may own it (for example BktTimeSync or GPS Viewer). Retrying in 5 seconds. $($_.Exception.Message)"
                if ($null -ne $port) { $port.Dispose(); $port = $null }
                Start-Sleep 5
                continue
            }
        }

        try {
            $parsed = ConvertFrom-NmeaSentence $port.ReadLine()
            if ($null -eq $parsed) { continue }
            if ($parsed.Type -eq 'RMC') { $latestRmc = $parsed } else { $latestGga = $parsed }

            $now = [DateTime]::UtcNow
            $freshRmc = $null -ne $latestRmc -and (($now - $latestRmc.ReceivedAt).TotalSeconds -le $StaleAfterSec)
            $freshGga = $null -ne $latestGga -and (($now - $latestGga.ReceivedAt).TotalSeconds -le $StaleAfterSec)
            $validRmc = $freshRmc -and $latestRmc.HasFix
            $validGga = $freshGga -and $latestGga.HasFix

            if (-not ($validRmc -or $validGga)) {
                # Do not refresh old coordinates. A prior fix naturally becomes stale;
                # a receiver that never produced a fix remains unavailable.
                if (-not $hasPublishedFix -and -not $clearedForOutage) { Clear-GpsTelemetry; $clearedForOutage = $true }
                continue
            }
            if (($now - $lastPost).TotalSeconds -lt $PublishIntervalSec) { continue }

            $position = if ($validGga) { $latestGga } else { $latestRmc }
            $lat = [double]$position.Latitude
            $lon = [double]$position.Longitude
            $payload = @{
                lat = $lat; lon = $lon
                gridSquare = ConvertTo-MaidenheadGrid $lat $lon
                altitudeM = if ($validGga) { [double]$latestGga.AltitudeM } else { 0 }
                speedKmh = if ($validRmc) { [double]$latestRmc.SpeedKmh } else { 0 }
                satCount = if ($validGga) { [int]$latestGga.SatCount } else { 0 }
                fixType = if ($validGga) { [string]$latestGga.FixType } else { 'GNSS Fix (RMC)' }
                lockTime = $now.ToString('HH:mm:ss') + ' UTC'
                mode = 'auto'
                deviceName = "Sierra Wireless GNSS ($ComPort)"
                comPort = $ComPort; baudRate = $BaudRate
                source = 'toughbook_agent'
            }

            if (Send-Json $payload) {
                $lastPost = $now
                $hasPublishedFix = $true
                $clearedForOutage = $false
            }
        } catch [TimeoutException] {
            # Silence is not a fix. Do not post; existing telemetry will age stale.
        } catch {
            Write-Warning "Serial read failed on $ComPort`: $($_.Exception.Message). Reopening port."
            if ($null -ne $port) { try { $port.Close() } catch {}; $port.Dispose(); $port = $null }
            Start-Sleep 2
        }
    }
} finally {
    if ($null -ne $port) { try { $port.Close() } catch {}; $port.Dispose() }
    Write-Host 'GNSS telemetry producer stopped.' -ForegroundColor Yellow
}
