using Microsoft.Extensions.Logging;
using System.Diagnostics;

namespace FieldOps.Agent.Location;

public sealed class SerialNmeaLocationProvider : ILocationProvider
{
    private readonly ILogger<SerialNmeaLocationProvider> logger;
    private readonly string portName;
    private readonly int baudRate;
    private readonly TimeSpan timeout;

    public SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, IConfiguration configuration)
        : this(logger, configuration["Agent:Location:NmeaPort"] ?? "COM6", int.TryParse(configuration["Agent:Location:NmeaBaud"], out var baud) ? baud : 9600, TimeSpan.FromSeconds(5)) { }

    internal SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, string portName, int baudRate, TimeSpan timeout, Func<INmeaSerialReader>? readerFactory = null)
    { this.logger = logger; this.portName = portName; this.baudRate = baudRate; this.timeout = timeout; this.readerFactory = readerFactory ?? (() => new SerialPortNmeaReader(portName, baudRate)); }
    private readonly Func<INmeaSerialReader> readerFactory;

    public async Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var port = readerFactory(); port.Open(); logger.LogInformation("NMEA port opened: {PortName}", portName);
            var clock = Stopwatch.StartNew(); TimeSpan? complementEnd = null; NmeaFix? latest = null; var sawGga = false; var sawRmc = false;
            while (clock.Elapsed < timeout)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var line = await port.ReadLineAsync(cancellationToken);
                if (line is not null && NmeaParser.TryParse(line.Trim(), out var parsed))
                {
                    latest = Merge(latest, parsed);
                    sawGga |= parsed.IsGga && parsed.HasFix; sawRmc |= parsed.IsRmc && parsed.HasFix;
                    if (parsed.HasFix && complementEnd is null) complementEnd = clock.Elapsed + TimeSpan.FromMilliseconds(750);
                    if (sawGga && sawRmc) return ToObservation(latest);
                }
                // Check the complementary deadline even when the reader timed out or data was malformed.
                if (latest is { HasFix: true } && complementEnd is not null && clock.Elapsed >= complementEnd) return ToObservation(latest);
            }
            if (latest is not null && latest.HasFix) return ToObservation(latest);
            logger.LogInformation("NMEA acquisition timeout");
            return LocationObservation.WithoutTelemetry(LocationStatus.NoFix) with { Source = "SerialNmea" };
        }
        catch (OperationCanceledException) { throw; }
        catch (UnauthorizedAccessException ex) { logger.LogInformation(ex, "NMEA port unavailable or in use"); return LocationObservation.WithoutTelemetry(LocationStatus.Unavailable) with { Source = "SerialNmea" }; }
        catch (IOException ex) { logger.LogInformation(ex, "NMEA port unavailable or in use"); return LocationObservation.WithoutTelemetry(LocationStatus.Unavailable) with { Source = "SerialNmea" }; }
        catch (Exception ex) { logger.LogInformation(ex, "Unexpected NMEA reader failure"); return LocationObservation.WithoutTelemetry(LocationStatus.Error) with { Source = "SerialNmea" }; }
    }

    // Each supported sentence is authoritative for fix validity; fields absent from it are retained
    // from the same acquisition cycle. This makes contradictory streams deterministic and honest.
    private static NmeaFix Merge(NmeaFix? old, NmeaFix n) => old is null ? n : n with {
        Latitude = n.Latitude ?? old.Latitude, Longitude = n.Longitude ?? old.Longitude, Altitude = n.Altitude ?? old.Altitude,
        Speed = n.Speed ?? old.Speed, Heading = n.Heading ?? old.Heading, TimestampUtc = n.TimestampUtc ?? old.TimestampUtc,
        Satellites = n.Satellites ?? old.Satellites, Hdop = n.Hdop ?? old.Hdop, FixQuality = n.FixQuality ?? old.FixQuality, HasFix = n.HasFix };
    private static LocationObservation ToObservation(NmeaFix f) => new(f.Latitude, f.Longitude, f.Altitude, null, f.Speed, f.Heading, f.TimestampUtc, LocationStatus.Available, f.Satellites, f.Hdop, f.FixQuality, "SerialNmea");
}
