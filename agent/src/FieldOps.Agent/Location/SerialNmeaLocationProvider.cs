using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Location;

public sealed class SerialNmeaLocationProvider : ILocationProvider, IHostedService, IDisposable
{
    private readonly ILogger<SerialNmeaLocationProvider> logger;
    private readonly string portName;
    private readonly int baudRate;
    private readonly TimeSpan retryDelay;
    private readonly Func<INmeaSerialReader> readerFactory;
    private readonly object stateLock = new();
    private LocationObservation latest = LocationObservation.WithoutTelemetry(LocationStatus.Initializing) with { Source = "SerialNmea" };
    private NmeaTimeEvidence latestTime = new(NmeaTimeStatus.Unavailable, null, "RMC");
    private long latestTimeReceivedAt;
    private CancellationTokenSource? sessionCancellation;
    private Task? sessionTask;
    private bool disposed;

    public SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, IConfiguration configuration)
        : this(logger, configuration["Agent:Location:NmeaPort"] ?? "COM6", int.TryParse(configuration["Agent:Location:NmeaBaud"], out var baud) ? baud : 9600, TimeSpan.FromSeconds(2)) { }

    internal SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, string portName, int baudRate, TimeSpan retryDelay, Func<INmeaSerialReader>? readerFactory = null)
    { this.logger = logger; this.portName = portName; this.baudRate = baudRate; this.retryDelay = retryDelay; this.readerFactory = readerFactory ?? (() => new SerialPortNmeaReader(portName, baudRate)); }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        lock (stateLock)
        {
            if (sessionTask is not null) return Task.CompletedTask;
            sessionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            sessionTask = RunSessionAsync(sessionCancellation.Token);
        }
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Task? task;
        lock (stateLock) { sessionCancellation?.Cancel(); task = sessionTask; }
        if (task is not null) await task.WaitAsync(cancellationToken);
    }

    public Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (stateLock) return Task.FromResult(latest);
    }

    public Task<NmeaTimeEvidence> GetTimeEvidenceAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (stateLock)
        {
            if (latestTime.Status == NmeaTimeStatus.Available && Stopwatch.GetElapsedTime(latestTimeReceivedAt) > TimeSpan.FromSeconds(15))
                return Task.FromResult(latestTime with { Status = NmeaTimeStatus.Unavailable, Error = "GNSS UTC evidence is stale." });
            return Task.FromResult(latestTime);
        }
    }

    private async Task RunSessionAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var port = readerFactory();
                port.Open();
                SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.NoFix));
                logger.LogInformation("NMEA port opened: {PortName}", portName);
                NmeaFix? current = null;
                while (!cancellationToken.IsCancellationRequested)
                {
                    var line = await port.ReadLineAsync(cancellationToken);
                    if (line is null) continue;
                    var time = NmeaParser.ParseTime(line.Trim());
                    if (time.Status != NmeaTimeStatus.Unavailable) lock (stateLock) { latestTime = time; latestTimeReceivedAt = Stopwatch.GetTimestamp(); }
                    if (!NmeaParser.TryParse(line.Trim(), out var parsed)) continue;
                    current = Merge(current, parsed);
                    SetLatest(parsed.HasFix ? ToObservation(current) : LocationObservation.WithoutTelemetry(LocationStatus.NoFix));
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (UnauthorizedAccessException ex) { SetUnavailable(); logger.LogInformation(ex, "NMEA port unavailable or in use"); }
            catch (IOException ex) { SetUnavailable(); logger.LogInformation(ex, "NMEA port unavailable or in use"); }
            catch (Exception ex) { SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.Error)); logger.LogInformation(ex, "Unexpected NMEA reader failure"); }

            if (!cancellationToken.IsCancellationRequested)
            {
                try { await Task.Delay(retryDelay, cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            }
        }
    }

    private void SetUnavailable() => SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.Unavailable));
    private void SetLatest(LocationObservation observation)
    {
        lock (stateLock) latest = observation with { Source = "SerialNmea" };
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        sessionCancellation?.Cancel();
        sessionCancellation?.Dispose();
    }

    // Each supported sentence is authoritative for fix validity; fields absent from it are retained
    // from the same acquisition cycle. This makes contradictory streams deterministic and honest.
    private static NmeaFix Merge(NmeaFix? old, NmeaFix n) => old is null ? n : n with {
        Latitude = n.Latitude ?? old.Latitude, Longitude = n.Longitude ?? old.Longitude, Altitude = n.Altitude ?? old.Altitude,
        Speed = n.Speed ?? old.Speed, Heading = n.Heading ?? old.Heading, TimestampUtc = n.TimestampUtc ?? old.TimestampUtc,
        Satellites = n.Satellites ?? old.Satellites, Hdop = n.Hdop ?? old.Hdop, FixQuality = n.FixQuality ?? old.FixQuality, HasFix = n.HasFix };
    private static LocationObservation ToObservation(NmeaFix f) => new(f.Latitude, f.Longitude, f.Altitude, null, f.Speed, f.Heading, f.TimestampUtc, LocationStatus.Available, f.Satellites, f.Hdop, f.FixQuality, "SerialNmea");
}
