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

# FieldOps Toughbook GNSS telemetry producer.
# Reads real NMEA RMC/GGA sentences from the Sierra Wireless GNSS serial port.
# It never substitutes default coordinates or reports a simulated live fix.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$InvariantCulture = [Globalization.CultureInfo]::InvariantCulture

function Test-NmeaChecksum {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sentence
    )

    if ($Sentence -notmatch '^\$(?<Body>[^*]+)\*(?<Checksum>[0-9A-Fa-f]{2})$') {
        return $false
    }

    [int]$Calculated = 0
    foreach ($Character in $Matches.Body.ToCharArray()) {
        $Calculated = $Calculated -bxor [int][char]$Character
    }

    return $Calculated -eq [Convert]::ToInt32($Matches.Checksum, 16)
}

function ConvertFrom-NmeaCoordinate {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Hemisphere
    )

    [double]$Raw = 0
    $Parsed = [double]::TryParse(
        $Value,
        [Globalization.NumberStyles]::Float,
        $InvariantCulture,
        [ref]$Raw
    )

    if (-not $Parsed) {
        throw "Invalid NMEA coordinate '$Value'."
    }

    $Degrees = [math]::Floor($Raw / 100)
    $Minutes = $Raw - ($Degrees * 100)
    $Decimal = $Degrees + ($Minutes / 60)

    switch ($Hemisphere.ToUpperInvariant()) {
        'N' { return $Decimal }
        'E' { return $Decimal }
        'S' { return -$Decimal }
        'W' { return -$Decimal }
        default { throw "Invalid NMEA hemisphere '$Hemisphere'." }
    }
}

function ConvertTo-MaidenheadGrid {
    param(
        [Parameter(Mandatory = $true)]
        [double]$Latitude,

        [Parameter(Mandatory = $true)]
        [double]$Longitude
    )

    $AdjustedLongitude = $Longitude + 180.0
    $AdjustedLatitude = $Latitude + 90.0

    $FieldLongitude = [math]::Floor($AdjustedLongitude / 20)
    $FieldLatitude = [math]::Floor($AdjustedLatitude / 10)
    $SquareLongitude = [math]::Floor(($AdjustedLongitude % 20) / 2)
    $SquareLatitude = [math]::Floor($AdjustedLatitude % 10)
    $SubsquareLongitude = [math]::Floor(($AdjustedLongitude % 2) * 12)
    $SubsquareLatitude = [math]::Floor(($AdjustedLatitude % 1) * 24)

    return ('{0}{1}{2}{3}{4}{5}' -f
        [char](65 + $FieldLongitude),
        [char](65 + $FieldLatitude),
        $SquareLongitude,
        $SquareLatitude,
        [char](97 + $SubsquareLongitude),
        [char](97 + $SubsquareLatitude))
}

function Get-GgaFixType {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Quality
    )

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
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sentence
    )

    $Line = $Sentence.Trim()
    if (-not (Test-NmeaChecksum -Sentence $Line)) {
        return $null
    }

    $AsteriskIndex = $Line.IndexOf('*')
    if ($AsteriskIndex -le 1) {
        return $null
    }

    $Body = $Line.Substring(1, $AsteriskIndex - 1)
    $Fields = $Body.Split(',')
    if ($Fields.Count -eq 0 -or $Fields[0].Length -lt 3) {
        return $null
    }

    $SentenceType = $Fields[0].Substring($Fields[0].Length - 3)
    $ReceivedAt = [DateTime]::UtcNow

    switch ($SentenceType) {
        'RMC' {
            if ($Fields.Count -lt 10) {
                return $null
            }

            $HasFix = $Fields[2] -eq 'A'
            if (-not $HasFix) {
                return [pscustomobject]@{
                    Type = 'RMC'
                    HasFix = $false
                    ReceivedAt = $ReceivedAt
                }
            }

            if ([string]::IsNullOrWhiteSpace($Fields[3]) -or
                [string]::IsNullOrWhiteSpace($Fields[4]) -or
                [string]::IsNullOrWhiteSpace($Fields[5]) -or
                [string]::IsNullOrWhiteSpace($Fields[6])) {
                return $null
            }

            [double]$SpeedKnots = 0
            if (-not [string]::IsNullOrWhiteSpace($Fields[7])) {
                [void][double]::TryParse(
                    $Fields[7],
                    [Globalization.NumberStyles]::Float,
                    $InvariantCulture,
                    [ref]$SpeedKnots
                )
            }

            return [pscustomobject]@{
                Type = 'RMC'
                HasFix = $true
                ReceivedAt = $ReceivedAt
                Latitude = ConvertFrom-NmeaCoordinate -Value $Fields[3] -Hemisphere $Fields[4]
                Longitude = ConvertFrom-NmeaCoordinate -Value $Fields[5] -Hemisphere $Fields[6]
                SpeedKmh = [math]::Round($SpeedKnots * 1.852, 1)
            }
        }

        'GGA' {
            if ($Fields.Count -lt 10) {
                return $null
            }

            [int]$FixQuality = 0
            [int]$SatelliteCount = 0
            [double]$AltitudeM = 0

            [void][int]::TryParse($Fields[6], [ref]$FixQuality)
            [void][int]::TryParse($Fields[7], [ref]$SatelliteCount)

            if (-not [string]::IsNullOrWhiteSpace($Fields[9])) {
                [void][double]::TryParse(
                    $Fields[9],
                    [Globalization.NumberStyles]::Float,
                    $InvariantCulture,
                    [ref]$AltitudeM
                )
            }

            if ($FixQuality -le 0) {
                return [pscustomobject]@{
                    Type = 'GGA'
                    HasFix = $false
                    ReceivedAt = $ReceivedAt
                    SatCount = $SatelliteCount
                    FixType = 'No Fix'
                }
            }

            if ([string]::IsNullOrWhiteSpace($Fields[2]) -or
                [string]::IsNullOrWhiteSpace($Fields[3]) -or
                [string]::IsNullOrWhiteSpace($Fields[4]) -or
                [string]::IsNullOrWhiteSpace($Fields[5])) {
                return $null
            }

            return [pscustomobject]@{
                Type = 'GGA'
                HasFix = $true
                ReceivedAt = $ReceivedAt
                Latitude = ConvertFrom-NmeaCoordinate -Value $Fields[2] -Hemisphere $Fields[3]
                Longitude = ConvertFrom-NmeaCoordinate -Value $Fields[4] -Hemisphere $Fields[5]
                SatCount = $SatelliteCount
                AltitudeM = [math]::Round($AltitudeM, 1)
                FixType = Get-GgaFixType -Quality $FixQuality
            }
        }

        default {
            return $null
        }
    }
}

function Send-GpsTelemetry {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Payload
    )

    $Json = $Payload | ConvertTo-Json -Compress
    $AnySucceeded = $false

    foreach ($Endpoint in $Endpoints) {
        try {
            $null = Invoke-RestMethod `
                -Uri $Endpoint `
                -Method Post `
                -Body $Json `
                -ContentType 'application/json' `
                -UseBasicParsing `
                -TimeoutSec 5

            Write-Host "[$([DateTime]::Now.ToString('HH:mm:ss'))] Posted live GNSS fix to $Endpoint" -ForegroundColor Green
            $AnySucceeded = $true
        }
        catch {
            Write-Warning "GPS telemetry POST failed for $Endpoint`: $($_.Exception.Message)"
        }
    }

    return $AnySucceeded
}

Write-Host '=======================================================' -ForegroundColor Cyan
Write-Host ' FieldOps Toughbook Live GNSS Telemetry Producer       ' -ForegroundColor Cyan
Write-Host " Port: $ComPort @ $BaudRate baud" -ForegroundColor Yellow
Write-Host " Publish interval: ${PublishIntervalSec}s" -ForegroundColor Yellow
Write-Host " Stale threshold: ${StaleAfterSec}s" -ForegroundColor Yellow
Write-Host ' Real NMEA only; no hardcoded or simulated coordinates.' -ForegroundColor Green
Write-Host '=======================================================' -ForegroundColor Cyan

$SerialPort = $null
$LatestRmc = $null
$LatestGga = $null
$LastPublishedAt = [DateTime]::MinValue

try {
    while ($true) {
        if ($null -eq $SerialPort -or -not $SerialPort.IsOpen) {
            try {
                $SerialPort = New-Object System.IO.Ports.SerialPort(
                    $ComPort,
                    $BaudRate,
                    [System.IO.Ports.Parity]::None,
                    8,
                    [System.IO.Ports.StopBits]::One
                )
                $SerialPort.ReadTimeout = 2000
                $SerialPort.NewLine = "`r`n"
                $SerialPort.Open()

                Write-Host "Opened $ComPort. Waiting for valid RMC/GGA sentences..." -ForegroundColor Green
            }
            catch {
                Write-Warning "Cannot open $ComPort. It may be occupied by BktTimeSync, Panasonic GPS Viewer, or another application. Retrying in 5 seconds. $($_.Exception.Message)"

                if ($null -ne $SerialPort) {
                    try { $SerialPort.Dispose() } catch {}
                    $SerialPort = $null
                }

                Start-Sleep -Seconds 5
                continue
            }
        }

        try {
            $Sentence = $SerialPort.ReadLine()
            $Parsed = ConvertFrom-NmeaSentence -Sentence $Sentence

            if ($null -eq $Parsed) {
                continue
            }

            if ($Parsed.Type -eq 'RMC') {
                $LatestRmc = $Parsed
            }
            elseif ($Parsed.Type -eq 'GGA') {
                $LatestGga = $Parsed
            }

            $Now = [DateTime]::UtcNow
            $FreshRmc = $null -ne $LatestRmc -and (($Now - $LatestRmc.ReceivedAt).TotalSeconds -le $StaleAfterSec)
            $FreshGga = $null -ne $LatestGga -and (($Now - $LatestGga.ReceivedAt).TotalSeconds -le $StaleAfterSec)
            $ValidRmc = $FreshRmc -and $LatestRmc.HasFix
            $ValidGga = $FreshGga -and $LatestGga.HasFix

            if (-not ($ValidRmc -or $ValidGga)) {
                # Do not refresh old coordinates. Existing telemetry will age into
                # the server's stale state; with no prior producer it remains unavailable.
                continue
            }

            if (($Now - $LastPublishedAt).TotalSeconds -lt $PublishIntervalSec) {
                continue
            }

            if ($ValidGga) {
                $Position = $LatestGga
            }
            else {
                $Position = $LatestRmc
            }

            $Latitude = [double]$Position.Latitude
            $Longitude = [double]$Position.Longitude

            if ($ValidGga) {
                $AltitudeM = [double]$LatestGga.AltitudeM
                $SatelliteCount = [int]$LatestGga.SatCount
                $FixType = [string]$LatestGga.FixType
            }
            else {
                $AltitudeM = 0
                $SatelliteCount = 0
                $FixType = 'GNSS Fix (RMC)'
            }

            if ($ValidRmc) {
                $SpeedKmh = [double]$LatestRmc.SpeedKmh
            }
            else {
                $SpeedKmh = 0
            }

            $Payload = @{
                lat = $Latitude
                lon = $Longitude
                gridSquare = ConvertTo-MaidenheadGrid -Latitude $Latitude -Longitude $Longitude
                altitudeM = $AltitudeM
                speedKmh = $SpeedKmh
                satCount = $SatelliteCount
                fixType = $FixType
                lockTime = $Now.ToString('HH:mm:ss') + ' UTC'
                mode = 'auto'
                deviceName = "Sierra Wireless GNSS ($ComPort)"
                comPort = $ComPort
                baudRate = $BaudRate
                source = 'toughbook_agent'
            }

            if (Send-GpsTelemetry -Payload $Payload) {
                $LastPublishedAt = $Now
            }
        }
        catch [System.TimeoutException] {
            # No complete NMEA sentence arrived. Do not post anything; the server
            # will mark the last real fix stale after its freshness window expires.
            continue
        }
        catch {
            Write-Warning "Serial read failed on $ComPort`: $($_.Exception.Message). Reopening the port."

            if ($null -ne $SerialPort) {
                try { $SerialPort.Close() } catch {}
                try { $SerialPort.Dispose() } catch {}
                $SerialPort = $null
            }

            Start-Sleep -Seconds 2
        }
    }
}
finally {
    if ($null -ne $SerialPort) {
        try { $SerialPort.Close() } catch {}
        try { $SerialPort.Dispose() } catch {}
    }

    Write-Host 'GNSS telemetry producer stopped.' -ForegroundColor Yellow
}
