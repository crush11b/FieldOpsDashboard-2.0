using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

public sealed class NmeaParserTests
{
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
}
