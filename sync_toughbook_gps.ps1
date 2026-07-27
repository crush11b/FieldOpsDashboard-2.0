param(
    [string]$ComPort = "COM6",
    [int]$BaudRate = 9600,
    [int]$PublishIntervalSec = 5,
    [int]$StaleAfterSec = 30,
    [string[]]$Endpoints = @(
        'http://localhost:3000/api/system/gps/telemetry',
        'https://ais-dev-mtof6szn6a4fcorkvc4en4-469962103239.us-east1.run.app/api/system/gps/telemetry'
    )
)

# Toughbook GNSS telemetry producer for FieldOps Dashboard.
# Reads live NMEA data from the Sierra Wireless GNSS serial port. It never
# substitutes default coordinates when the receiver is unavailable or lacks a fix.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13
$invariantCulture = [Globalization.CultureInfo]::InvariantCulture

function Test-NmeaChecksum {
    param([Parameter(Mandatory)][string]$Sentence)

    if ($Sentence -notmatch '^\$(?<body>[^*]+)\*(?<checksum>[0-9A-Fa-f]{2})$') {
        return $false
    }

    [int]$calculated = 0
    foreach ($character in $Matches.body.ToCharArray()) {
        $calculated = $calculated -bxor [int][char]$character
    }

    return $calculated -eq [Convert]::ToInt32($Matches.checksum, 16)
}

function ConvertFrom-NmeaCoordinate {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][string]$Hemisphere
    )

    [double]$raw = 0
    if (-not [double]::TryParse($Value, [Globalization.NumberStyles]::Float, $invariantCulture, [ref]$raw)) {
        throw "Invalid NMEA coordinate '$Value'."
    }

    $degrees = [math]::Floor($raw / 100)
    $minutes = $raw - ($degrees * 100)
    $decimal = $degrees + ($minutes / 60)

    if ($Hemisphere -in @('S', 'W')) {
        $decimal *= -1
    } elseif ($Hemisphere -notin @('N', 'E')) {
        throw "Invalid NMEA hemisphere '$Hemisphere'."
    }

    return $decimal
}

function ConvertTo-MaidenheadGrid {
    param(
        [Parameter(Mandatory)][double]$Latitude,
        [Parameter(Mandatory)][double]$Longitude
    )

    $lon = $Longitude + 180.0
    $lat = $Latitude + 90.0

    $fieldLon = [math]::Floor($lon / 20)
    $fieldLat = [math]::Floor($lat / 10)
    $squareLon = [math]::Floor(($lon % 20) / 2)
    $squareLat = [math]::Floor($lat % 10)
    $subLon = [math]::Floor((($lon % 2) * 12))
    $subLat = [math]::Floor((($lat % 1) * 24))

    return ('{0}{1}{2}{3}{4}{5}' -f
        [char](65 + $fieldLon),
        [char](65 + $fieldLat),
        $squareLon,
        $squareLat,
        [char](97 + $subLon),
        [char](97 + $subLat))
}

function Get-GgaFixType {
    param([int]$Quality)

    switch ($Quality) {
        0 { return 'No Fix' }
        1 { return '3D GPS Fix' }
        2 { return '3D DGPS Fix' }
        4 { return 'RTK Fixed' }
        5 { return 'RTK Float' }
        6 { return 'Estimated Fix' }
        default { return "GNSS Fix (Quality $Quality)" }
    }
}

function ConvertFrom-NmeaSentence {
    param([Parameter(Mandatory)][string]$Sentence)

    $trimmed = $Sentence.Trim()
    if (-not (Test-NmeaChecksum -Sentence $trimmed)) {
        return $null
    }

    $body = $trimmed.Substring(1, $trimmed.IndexOf('*') - 1)
    $fields = $body.Split(',')
    $sentenceType = $fields[0].Substring([math]::Max(0, $fields[0].Length - 3))

    switch ($sentenceType) {
        'RMC' {
            if ($fields.Count -lt 10 -or [string]::IsNullOrWhiteSpace($fields[3]) -or [string]::IsNullOrWhiteSpace($fields[5])) {
                return $null
            }

            [double]$speedKnots = 0
            if (-not [string]::IsNullOrWhiteSpace($fields[7])) {
                [void][double]::TryParse($fields[7], [Globalization.NumberStyles]::Float, $invariantCulture, [ref]$speedKnots)
            }

            return [pscustomobject]@{
                Type = 'RMC'
                ReceivedAt = [DateTime]::UtcNow
                HasFix = $fields[2] -eq 'A'
                Latitude = ConvertFrom-NmeaCoordinate -Value $fields[3] -Hemisphere $fields[4]
                Longitude = ConvertFrom-NmeaCoordinate -Value $fields[5] -Hemisphere $fields[6]
                SpeedKmh = [math]::Round($speedKnots * 1.852, 1)
                UtcTime = $fields[1]
            }
        }
        'GGA' {
            if ($fields.Count -lt 10 -or [string]::IsNullOrWhiteSpace($fields[2]) -or [string]::IsNullOrWhiteSpace($fields[4])) {
                return $null
            }

            [int]$quality = 0
            [int]$satellites = 0
            [double]$altitude = 0
            [void][int]::TryParse($fields[6], [ref]$quality)
            [void][int]::TryParse($fields[7], [ref]$satellites)
            [void][double]::TryParse($fields[9], [Globalization.NumberStyles]::Float, $invariantCulture, [ref]$altitude)

            return [pscustomobject]@{
                Type = 'GGA'
                ReceivedAt = [DateTime]::UtcNow
                HasFix = $quality -gt 0
                Latitude = ConvertFrom-NmeaCoordinate -Value $fields[2] -Hemisphere $fields[3]
                Longitude = ConvertFrom-NmeaCoordinate -Value $fields[4] -Hemisphere $fields[5]
                FixQuality = $quality
                FixType = Get-GgaFixType -Quality $quality
                SatCount = $satellites
                AltitudeM = [math]::Round($altitude, 1)
                UtcTime = $fields[1]
            }
        }
        default { return $null }
    }
}

function Send-GpsPayload {
    param([Parameter(Mandatory)][hashtable]$Payload)

    $json = $Payload | ConvertTo-Json -Compress
    $posted = $false

    foreach ($endpoint in $Endpoints) {
        try {
            $null = Invoke-RestMethod -Uri $endpoint -Method POST -Body $json -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
            Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] Posted live GNSS fix to $endpoint" -ForegroundColor Green
            $posted = $true
        } catch {
            Write-Warning "GPS telemetry post failed for $endpoint`: $($_.Exception.Message)"
        }
    }

    return $posted
}

function Clear-GpsTelemetry {
    $payload = @{ clear = $true; source = 'toughbook_gnss_nmea' } | ConvertTo-Json -Compress
    foreach ($endpoint in $Endpoints) {
        try {
            $null = Invoke-RestMethod -Uri $endpoint -Method POST -Body $payload -ContentType 'application/json' -UseBasicParsing -TimeoutSec 5
        } catch {
            Write-Verbose "Unable to clear GPS telemetry at $endpoint`: $($_.Exception.Message)"
        }
    }
}

Write-Host '=======================================================' -ForegroundColor Cyan
Write-Host ' FieldOps Toughbook Live GNSS Telemetry Producer       ' -ForegroundColor Cyan
Write-Host " Port: $ComPort @ $BaudRate baud" -ForegroundColor Yellow
Write-Host " Publish: ${PublishIntervalSec}s | Stale: ${StaleAfterSec}s" -ForegroundColor Yellow
Write-Host ' No hardcoded coordinates or simulated fixes are used. ' -ForegroundColor Green
Write-Host '=======================================================' -ForegroundColor Cyan

$serialPort = $null
$latestRmc = $null
$latestGga = $null
$lastPublishedAt = [DateTime]::MinValue
$hasPublishedRealFix = $false
$telemetryClearedForOutage = $false

try {
    while ($true) {
        if ($null -eq $serialPort -or -not $serialPort.IsOpen) {
            try {
                $serialPort = [System.IO.Ports.SerialPort]::new($ComPort, $BaudRate, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
                $serialPort.ReadTimeout = 2000
                $serialPort.NewLine = "`r`n"
                $serialPort.Open()
                Write-Host "Opened $ComPort. Waiting for valid RMC/GGA sentences..." -ForegroundColor Green
                $telemetryClearedForOutage = $false
            } catch {
                if (-not $telemetryClearedForOutage) {
                    Clear-GpsTelemetry
                    $telemetryClearedForOutage = $true
                }
                Write-Warning "Cannot open $ComPort. It may be occupied by BktTimeSync, GPS Viewer, or another application. Retrying in 5 seconds. $($_.Exception.Message)"
                if ($null -ne $serialPort) {
                    $serialPort.Dispose()
                    $serialPort = $null
                }
                Start-Sleep -Seconds 5
                continue
            }
        }

        try {
            $sentence = $serialPort.ReadLine()
            $parsed = ConvertFrom-NmeaSentence -Sentence $sentence
            if ($null -eq $parsed) {
                continue
            }

            if ($parsed.Type -eq 'RMC') {
                $latestRmc = $parsed
            } elseif ($parsed.Type -eq 'GGA') {
                $latestGga = $parsed
            }

            $now = [DateTime]::UtcNow
            $candidate = if ($null -ne $latestGga) { $latestGga } else { $latestRmc }
            $fixIsFresh = $null -ne $candidate -and (($now - $candidate.ReceivedAt).TotalSeconds -le $StaleAfterSec)
            $hasValidFix = $fixIsFresh -and $candidate.HasFix

            if ($null -ne $latestRmc -and (($now - $latestRmc.ReceivedAt).TotalSeconds -le $StaleAfterSec)) {
                $hasValidFix = $hasValidFix -and $latestRmc.HasFix
            }

            if (-not $hasValidFix) {
                # Do not refresh the endpoint. A previously published fix will age into
                # the server's stale state; a receiver with no prior fix remains unavailable.
                if (-not $hasPublishedRealFix -and -not $telemetryClearedForOutage) {
                    Clear-GpsTelemetry
                    $telemetryClearedForOutage = $true
                }
                continue
            }

            if (($now - $lastPublishedAt).TotalSeconds -lt $PublishIntervalSec) {
                continue
            }

            $latitude = [double]$candidate.Latitude
            $longitude = [double]$candidate.Longitude
            $satCount = if ($null -ne $latestGga) { [int]$latestGga.SatCount } else { 0 }
            $fixType = if ($null -ne $latestGga) { [string]$latestGga.FixType } else { 'GNSS Fix (RMC)' }
            $altitudeM = if ($null -ne $latestGga) { [double]$latestGga.AltitudeM } else { 0 }
            $speedKmh = if ($null -ne $latestRmc) { [double]$latestRmc.SpeedKmh } else { 0 }

            $payload = @{
                lat = $latitude
                lon = $longitude
                gridSquare = ConvertTo-MaidenheadGrid -Latitude $latitude -Longitude $longitude
                altitudeM = $altitudeM
                speedKmh = $speedKmh
                satCount = $satCount
                fixType = $fixType
                lockTime = $now.ToString('HH:mm:ss') + ' UTC'
                mode = 'auto'
                deviceName = "Sierra Wireless GNSS ($ComPort)"
                comPort = $ComPort
                baudRate = $BaudRate
                source = 'toughbook_gnss_nmea'
            }

            if (Send-GpsPayload -Payload $payload) {
                $lastPublishedAt = $now
                $hasPublishedRealFix = $true
                $telemetryClearedForOutage = $false
            }
        } catch [System.TimeoutException] {
            # No complete NMEA line arrived. Do not post; existing telemetry will become stale.
            continue
        } catch {
            Write-Warning "Serial read failed on $ComPort`: $($_.Exception.Message). Reopening port."
            if ($null -ne $serialPort) {
                try { $serialPort.Close() } catch {}
                $serialPort.Dispose()
                $serialPort = $null
            }
            Start-Sleep -Seconds 2
        }
    }
} finally {
    if ($null -ne $serialPort) {
        try { $serialPort.Close() } catch {}
        $serialPort.Dispose()
    }
    Write-Host 'GNSS telemetry producer stopped.' -ForegroundColor Yellow
}
