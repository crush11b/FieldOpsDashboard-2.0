using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

public sealed class NmeaParserTests
{
    private static string Gga(string lat = "4807.038", string ns = "N", string lon = "01131.000", string ew = "E", string quality = "1", string altitude = "545.4", string sats = "08", string hdop = "0.9") => $"$GPGGA,123519.00,{lat},{ns},{lon},{ew},{quality},{sats},{hdop},{altitude},M,46.9,M,,";
    [Fact]
    public void ParsesGnGgaWithChecksumAndSouthernWesternCoordinates()
    {
        Assert.True(NmeaParser.TryParse("$GNGGA,123519.00,4807.038,S,01131.000,W,1,08,0.9,545.4,M,46.9,M,,", out var fix));
        Assert.Equal(-48.1173, fix.Latitude!.Value, 4);
        Assert.Equal(-11.5167, fix.Longitude!.Value, 4);
        Assert.Equal(545.4, fix.Altitude);
        Assert.Equal(8, fix.Satellites);
        Assert.True(fix.HasFix);
    }

    [Fact]
    public void RejectsInvalidChecksumAndMalformedCoordinates()
    {
        Assert.False(NmeaParser.TryParse("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*00", out _));
        Assert.False(NmeaParser.TryParse("$GPRMC,123519,A,9999.000,N,01131.000,E,022.4,084.4,230394,,,A*00", out _));
    }

    [Fact]
    public void ParsesValidRmcAndPreservesZeroCoordinates()
    {
        Assert.True(NmeaParser.TryParse("$GPRMC,123519.00,A,0000.000,N,00000.000,E,000.0,000.0,230394,,,A", out var fix));
        Assert.Equal(0, fix.Latitude);
        Assert.Equal(0, fix.Longitude);
        Assert.Equal(0, fix.Speed);
        Assert.True(fix.HasFix);
    }

    [Fact] public void SupportsGpAndGnTalkers() { Assert.True(NmeaParser.TryParse(Gga(), out _)); Assert.True(NmeaParser.TryParse(Gga().Replace("GPGGA", "GNGGA"), out _)); Assert.True(NmeaParser.TryParse("$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A", out _)); Assert.True(NmeaParser.TryParse("$GNRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A", out _)); }
    [Fact] public void ParsesGnsModeAsFixWithoutInventingNumericFixQuality() { Assert.True(NmeaParser.TryParse("$GNGNS,123519.00,4807.038,N,01131.000,E,AA,08,0.9,545.4,M,0.0", out var fix)); Assert.True(fix.HasFix); Assert.Null(fix.FixQuality); }
    [Fact] public void RejectsGnsNoFixModeWithoutFabricatingPositionValidity() { Assert.True(NmeaParser.TryParse("$GNGNS,123519.00,4807.038,N,01131.000,E,N,08,0.9,545.4,M,0.0", out var fix)); Assert.False(fix.HasFix); }
    [Fact] public void EnforcesCoordinateBoundsAndHemisphere() { Assert.True(NmeaParser.TryParse(Gga("9000.000"), out _), "lat90"); Assert.True(NmeaParser.TryParse(Gga(lon: "18000.000"), out _), "lon180"); Assert.False(NmeaParser.TryParse(Gga("9000.001"), out _), "lat>90"); Assert.False(NmeaParser.TryParse(Gga(lon: "18000.001"), out _), "lon>180"); Assert.False(NmeaParser.TryParse(Gga(ns: "E"), out _), "lat hemi"); Assert.False(NmeaParser.TryParse(Gga(ew: "N"), out _), "lon hemi"); Assert.False(NmeaParser.TryParse(Gga(lat: "4860.000"), out _), "minutes"); }
    [Fact] public void HandlesStatusesZerosOptionalFieldsAndGgaTimestamp() { Assert.True(NmeaParser.TryParse(Gga(quality: "0", altitude: "0", sats: "0", hdop: "0"), out var gga)); Assert.False(gga.HasFix); Assert.Null(gga.TimestampUtc); Assert.True(NmeaParser.TryParse("$GPRMC,123519.00,V,4807.038,N,01131.000,E,000.0,000.0,230394,,,A", out var rmc)); Assert.False(rmc.HasFix); Assert.Equal(0, rmc.Speed); Assert.Equal(0, rmc.Heading); }
    [Fact] public void RejectsMalformedNumericFields() { Assert.False(NmeaParser.TryParse(Gga(lat: "bad"), out _)); Assert.False(NmeaParser.TryParse(Gga(hdop: "NaN"), out _)); }
    [Fact] public void ValidatesChecksumsAndAllowsMissingChecksum() { Assert.True(NmeaParser.TryParse("$GPGLL,1", out _) == false); Assert.True(NmeaParser.TryParse(Gga(), out _)); Assert.False(NmeaParser.TryParse(Gga()+"*00", out _)); Assert.False(NmeaParser.TryParse(Gga()+"*ZZ", out _)); }
    [Fact] public void ParsesRmcUtcDateTime() { Assert.True(NmeaParser.TryParse("$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,230394,,,A", out var fix)); Assert.Equal(new DateTimeOffset(1994, 3, 23, 12, 35, 19, TimeSpan.Zero), fix.TimestampUtc!.Value); }
}
