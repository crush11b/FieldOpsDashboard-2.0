using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Location;

public sealed class SerialNmeaLocationProvider : ILocationProvider, IHostedService, IDisposable
{
    private const int DefaultNoDataTimeoutSeconds = 10;
    private readonly ILogger<SerialNmeaLocationProvider> logger;
    private readonly string portName;
    private readonly int baudRate;
    private readonly TimeSpan retryDelay;
    private readonly TimeSpan noDataTimeout;
    private readonly Func<INmeaSerialReader> readerFactory;
    private readonly object stateLock = new();
    private LocationObservation latest = LocationObservation.WithoutTelemetry(LocationStatus.Initializing) with { Source = "SerialNmea" };
    private GnssSerialDiagnostics diagnostics;
    private NmeaTimeEvidence latestTime = new(NmeaTimeStatus.Unavailable, null, "RMC");
    private long latestTimeReceivedAt;
    private NmeaTimeEvidence? priorTime;
    private CancellationTokenSource? sessionCancellation;
    private Task? sessionTask;
    private INmeaSerialReader? activeReader;
    private bool disposed;

    public SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, IConfiguration configuration)
        : this(logger, configuration["Agent:Location:NmeaPort"] ?? "COM6", int.TryParse(configuration["Agent:Location:NmeaBaud"], out var baud) ? baud : 9600, TimeSpan.FromSeconds(2), noDataTimeout: TimeSpan.FromSeconds(ParseNoDataTimeoutSeconds(configuration["Agent:Location:NmeaNoDataTimeoutSeconds"]))) { }

    internal SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, string portName, int baudRate, TimeSpan retryDelay, Func<INmeaSerialReader>? readerFactory = null, TimeSpan? noDataTimeout = null)
    { this.logger = logger; this.portName = portName; this.baudRate = baudRate; this.retryDelay = retryDelay; this.noDataTimeout = noDataTimeout ?? TimeSpan.FromSeconds(DefaultNoDataTimeoutSeconds); this.readerFactory = readerFactory ?? (() => new SerialPortNmeaReader(portName, baudRate)); diagnostics = GnssSerialDiagnostics.Stopped(portName, baudRate); }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        lock (stateLock)
        {
            if (disposed) throw new ObjectDisposedException(nameof(SerialNmeaLocationProvider));
            if (sessionTask is not null) return Task.CompletedTask;
            latest = LocationObservation.WithoutTelemetry(LocationStatus.Initializing) with { Source = "SerialNmea" };
            latestTime = new NmeaTimeEvidence(NmeaTimeStatus.Unavailable, null, "RMC");
            latestTimeReceivedAt = 0;
            priorTime = null;
            diagnostics = diagnostics with { State = GnssSerialState.Opening };
            sessionCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            sessionTask = RunSessionAsync(sessionCancellation.Token);
        }
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        Task? task;
        CancellationTokenSource? cancellation;
        INmeaSerialReader? reader;
        lock (stateLock)
        {
            cancellation = sessionCancellation;
            task = sessionTask;
            reader = activeReader;
            cancellation?.Cancel();
        }
        reader?.Dispose();
        if (task is null) return;
        await task.WaitAsync(cancellationToken);
        lock (stateLock)
        {
            if (ReferenceEquals(sessionTask, task))
            {
                sessionTask = null;
                sessionCancellation = null;
                cancellation?.Dispose();
            }
        }
    }

    public Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (stateLock) return Task.FromResult(latest);
    }

    public GnssSerialDiagnostics GetDiagnostics()
    {
        lock (stateLock) return diagnostics;
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
            var sessionOpened = false;
            try
            {
                var attemptUtc = DateTimeOffset.UtcNow;
                lock (stateLock)
                {
                    diagnostics = diagnostics with { State = GnssSerialState.Opening, SessionGeneration = diagnostics.SessionGeneration + 1, LastOpenAttemptUtc = attemptUtc };
                }
                using var port = readerFactory();
                lock (stateLock) activeReader = port;
                port.Open();
                sessionOpened = true;
                SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.NoFix));
                lock (stateLock)
                {
                    diagnostics = diagnostics with { State = GnssSerialState.Open, LastSuccessfulOpenUtc = DateTimeOffset.UtcNow };
                }
                logger.LogInformation("NMEA port opened: {PortName}", portName);
                NmeaFix? current = null;
                var lastSerialDataReceived = Stopwatch.GetTimestamp();
                while (!cancellationToken.IsCancellationRequested)
                {
                    var line = await port.ReadLineAsync(cancellationToken);
                    if (line is null)
                    {
                        if (Stopwatch.GetElapsedTime(lastSerialDataReceived) >= noDataTimeout) throw new NmeaSilenceException(noDataTimeout);
                        continue;
                    }
                    lastSerialDataReceived = Stopwatch.GetTimestamp();
                    lock (stateLock) diagnostics = diagnostics with { State = GnssSerialState.Receiving, LastSerialDataUtc = DateTimeOffset.UtcNow };
                    logger.LogDebug("NMEA serial data received on {PortName}", portName);
                    try { UpdateTimeEvidence(NmeaParser.ParseTime(line.Trim())); }
                    catch (Exception ex) { logger.LogInformation(ex, "GNSS time evidence evaluation failed; location telemetry remains independent."); }
                    if (!NmeaParser.TryParse(line.Trim(), out var parsed)) continue;
                    lock (stateLock)
                    {
                        var observedUtc = DateTimeOffset.UtcNow;
                        diagnostics = diagnostics with { LastValidNmeaUtc = observedUtc, LastFixUtc = parsed.HasFix ? observedUtc : diagnostics.LastFixUtc };
                    }
                    current = Merge(current, parsed);
                    if (!parsed.HasFix) logger.LogDebug("NMEA traffic is active while GNSS fix remains unavailable on {PortName}", portName);
                    SetLatest(parsed.HasFix ? ToObservation(current) : LocationObservation.WithoutTelemetry(LocationStatus.NoFix));
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (NmeaSilenceException ex) { SetUnavailable(); SetFailure(GnssSerialState.Silent, GnssSerialFailureCategory.SerialSilence, ex); logger.LogWarning("NMEA port {PortName} received no serial data for {TimeoutSeconds} seconds; reconnecting.", portName, noDataTimeout.TotalSeconds); logger.LogDebug(ex, "NMEA silent-session watchdog expired"); }
            catch (UnauthorizedAccessException ex) { SetUnavailable(); SetFailure(GnssSerialState.OpenFailed, GnssSerialFailureCategory.AccessDenied, ex); logger.LogInformation(ex, "NMEA port unavailable or in use"); }
            catch (IOException ex) { SetUnavailable(); SetFailure(GnssSerialState.OpenFailed, GnssSerialFailureCategory.IoError, ex); logger.LogInformation(ex, "NMEA port unavailable or in use"); }
            catch (Exception ex) { SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.Error)); SetFailure(sessionOpened ? GnssSerialState.Reconnecting : GnssSerialState.OpenFailed, GnssSerialFailureCategory.UnexpectedError, ex); logger.LogInformation(ex, "Unexpected NMEA reader failure"); }
            finally
            {
                lock (stateLock) activeReader = null;
            }

            if (!cancellationToken.IsCancellationRequested)
            {
                lock (stateLock) diagnostics = diagnostics with { State = GnssSerialState.Reconnecting, ReconnectCount = diagnostics.ReconnectCount + 1 };
                try { await Task.Delay(retryDelay, cancellationToken); }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            }
        }
        lock (stateLock) diagnostics = diagnostics with { State = GnssSerialState.Stopped };
    }

    private static int ParseNoDataTimeoutSeconds(string? configuredValue)
        => int.TryParse(configuredValue, out var seconds) && seconds > 0 ? seconds : DefaultNoDataTimeoutSeconds;

    private sealed class NmeaSilenceException(TimeSpan timeout) : IOException($"No NMEA serial data received for {timeout.TotalSeconds} seconds.");

    private void SetUnavailable() => SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.Unavailable));
    private void SetFailure(GnssSerialState state, GnssSerialFailureCategory category, Exception exception)
    {
        lock (stateLock)
        {
            diagnostics = diagnostics with
            {
                State = state,
                LastFailureUtc = DateTimeOffset.UtcNow,
                LastFailureCategory = category,
                LastFailureMessage = exception.Message.Length > 240 ? exception.Message[..240] : exception.Message,
            };
        }
    }
    private void UpdateTimeEvidence(NmeaTimeEvidence time)
    {
        if (time.Status == NmeaTimeStatus.Unavailable) return;
        var receivedAt = Stopwatch.GetTimestamp();
        lock (stateLock)
        {
            var timestampDelta = priorTime?.TimestampUtc is DateTimeOffset prior && time.TimestampUtc is DateTimeOffset observedUtc ? (observedUtc - prior).TotalSeconds : (double?)null;
            var receiptElapsed = priorTime?.ReceivedAtMonotonicTimestamp > 0 ? Stopwatch.GetElapsedTime(priorTime.ReceivedAtMonotonicTimestamp, receivedAt).TotalSeconds : (double?)null;
            var coherent = time.Status == NmeaTimeStatus.Available
                && timestampDelta is > 0 and <= 10
                && receiptElapsed is > 0
                && Math.Abs(timestampDelta.Value - receiptElapsed.Value) <= 0.5;
            var reason = time.Status != NmeaTimeStatus.Available ? time.Error : coherent ? null : priorTime is null ? "At least two sequential UTC observations are required." : timestampDelta is <= 0 ? "GNSS UTC did not advance monotonically." : "GNSS UTC elapsed time does not match receipt elapsed time.";
            var observed = time with { ReceivedAtUtc = DateTimeOffset.UtcNow, ReceivedAtMonotonicTimestamp = receivedAt, PriorTimestampUtc = priorTime?.TimestampUtc, TimestampDeltaSeconds = timestampDelta, ReceiptElapsedSeconds = receiptElapsed, TemporalCoherent = coherent, RejectionReason = reason };
            latestTime = observed;
            if (time.Status == NmeaTimeStatus.Available) priorTime = observed;
            latestTimeReceivedAt = receivedAt;
        }
    }

    private void SetLatest(LocationObservation observation)
    {
        lock (stateLock) latest = observation with { Source = "SerialNmea" };
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        CancellationTokenSource? cancellation;
        INmeaSerialReader? reader;
        lock (stateLock)
        {
            cancellation = sessionCancellation;
            reader = activeReader;
            cancellation?.Cancel();
        }
        reader?.Dispose();
        if (sessionTask?.IsCompleted == true)
        {
            lock (stateLock)
            {
                if (ReferenceEquals(sessionCancellation, cancellation))
                {
                    sessionCancellation = null;
                    sessionTask = null;
                    cancellation?.Dispose();
                }
            }
        }
    }

    // Each supported sentence is authoritative for fix validity; fields absent from it are retained
    // from the same acquisition cycle. This makes contradictory streams deterministic and honest.
    private static NmeaFix Merge(NmeaFix? old, NmeaFix n) => old is null ? n : n with {
        Latitude = n.Latitude ?? old.Latitude, Longitude = n.Longitude ?? old.Longitude, Altitude = n.Altitude ?? old.Altitude,
        Speed = n.Speed ?? old.Speed, Heading = n.Heading ?? old.Heading, TimestampUtc = n.TimestampUtc ?? old.TimestampUtc,
        Satellites = n.Satellites ?? old.Satellites, Hdop = n.Hdop ?? old.Hdop, FixQuality = n.FixQuality ?? old.FixQuality, HasFix = n.HasFix };
    private static LocationObservation ToObservation(NmeaFix f) => new(f.Latitude, f.Longitude, f.Altitude, null, f.Speed, f.Heading, f.TimestampUtc, LocationStatus.Available, f.Satellites, f.Hdop, f.FixQuality, "SerialNmea");
}
