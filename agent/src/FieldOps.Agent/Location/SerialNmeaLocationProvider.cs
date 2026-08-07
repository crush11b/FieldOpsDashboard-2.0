using System.IO.Ports;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Location;

public sealed class SerialNmeaLocationProvider : ILocationProvider
{
    private readonly ILogger<SerialNmeaLocationProvider> logger;
    private readonly string portName;
    private readonly int baudRate;
    private readonly TimeSpan timeout;

    public SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, IConfiguration configuration)
        : this(logger, configuration["Agent:Location:NmeaPort"] ?? "COM6", int.TryParse(configuration["Agent:Location:NmeaBaud"], out var baud) ? baud : 9600, TimeSpan.FromSeconds(5)) { }

    internal SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, string portName, int baudRate, TimeSpan timeout)
    { this.logger = logger; this.portName = portName; this.baudRate = baudRate; this.timeout = timeout; }

    public async Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var port = new SerialPort(portName, baudRate, Parity.None, 8, StopBits.One) { Handshake = Handshake.None, ReadTimeout = 250 };
            port.Open(); logger.LogInformation("NMEA port opened: {PortName}", portName);
            var end = DateTime.UtcNow + timeout; NmeaFix? latest = null;
            while (DateTime.UtcNow < end)
            {
                cancellationToken.ThrowIfCancellationRequested();
                string line; try { line = await Task.Run(port.ReadLine, cancellationToken); } catch (TimeoutException) { continue; }
                if (!NmeaParser.TryParse(line.Trim(), out var parsed)) continue;
                latest = Merge(latest, parsed);
                if (latest.HasFix) return ToObservation(latest);
            }
            logger.LogInformation("NMEA acquisition timeout");
            return LocationObservation.WithoutTelemetry(LocationStatus.NoFix) with { Source = "SerialNmea" };
        }
        catch (OperationCanceledException) { throw; }
        catch (UnauthorizedAccessException ex) { logger.LogInformation(ex, "NMEA port unavailable or in use"); return LocationObservation.WithoutTelemetry(LocationStatus.Unavailable) with { Source = "SerialNmea" }; }
        catch (Exception ex) { logger.LogInformation(ex, "Unexpected NMEA reader failure"); return LocationObservation.WithoutTelemetry(LocationStatus.Error) with { Source = "SerialNmea" }; }
    }

    private static NmeaFix Merge(NmeaFix? old, NmeaFix n) => old is null ? n : n with {
        Latitude = n.Latitude ?? old.Latitude, Longitude = n.Longitude ?? old.Longitude, Altitude = n.Altitude ?? old.Altitude,
        Speed = n.Speed ?? old.Speed, Heading = n.Heading ?? old.Heading, TimestampUtc = n.TimestampUtc ?? old.TimestampUtc,
        Satellites = n.Satellites ?? old.Satellites, Hdop = n.Hdop ?? old.Hdop, FixQuality = n.FixQuality ?? old.FixQuality };
    private static LocationObservation ToObservation(NmeaFix f) => new(f.Latitude, f.Longitude, f.Altitude, null, f.Speed, f.Heading, f.TimestampUtc, LocationStatus.Available, f.Satellites, f.Hdop, f.FixQuality, "SerialNmea");
}
