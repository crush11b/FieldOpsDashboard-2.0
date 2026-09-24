using System.Diagnostics;
using System.IO.Ports;
using System.Text.Json;
using FieldOps.Agent.Serial;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Location;

public sealed class SerialNmeaLocationProvider : ILocationProvider, IHostedService, IDisposable
{
    private static readonly JsonSerializerOptions SettingsJsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private const int DefaultNoDataTimeoutSeconds = 10;
    private readonly ILogger<SerialNmeaLocationProvider> logger;
    private string portName;
    private int baudRate;
    private readonly TimeSpan retryDelay;
    private readonly TimeSpan noDataTimeout;
    private readonly Func<string, int, INmeaSerialReader> readerFactory;
    private readonly Func<IReadOnlyList<string>> portEnumerator;
    private readonly Func<IReadOnlyList<SerialPortInfo>> inventoryReader;
    private GnssDeviceIdentity? deviceIdentity;
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
    private CancellationToken lifetimeCancellationToken;
    private readonly string settingsPath;

    public SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, IConfiguration configuration, ISerialPortEnumerator serialPortEnumerator)
        : this(logger, ReadSettings(configuration, serialPortEnumerator, out var configuredPort, out var configuredBaud, out var configuredIdentity), configuredBaud, TimeSpan.FromSeconds(2), noDataTimeout: TimeSpan.FromSeconds(ParseNoDataTimeoutSeconds(configuration["Agent:Location:NmeaNoDataTimeoutSeconds"])), settingsPathOverride: GetSettingsPath(configuration), inventoryReader: () => serialPortEnumerator.Enumerate(CancellationToken.None).Ports, initialIdentity: configuredIdentity) { }

    internal SerialNmeaLocationProvider(ILogger<SerialNmeaLocationProvider> logger, string portName, int baudRate, TimeSpan retryDelay, Func<INmeaSerialReader>? readerFactory = null, TimeSpan? noDataTimeout = null, Func<IReadOnlyList<string>>? portEnumerator = null, Func<string, int, INmeaSerialReader>? candidateReaderFactory = null, string? settingsPathOverride = null, Func<IReadOnlyList<SerialPortInfo>>? inventoryReader = null, GnssDeviceIdentity? initialIdentity = null)
    {
        this.logger = logger;
        this.portName = portName;
        this.baudRate = baudRate;
        this.retryDelay = retryDelay;
        this.noDataTimeout = noDataTimeout ?? TimeSpan.FromSeconds(DefaultNoDataTimeoutSeconds);
        this.readerFactory = candidateReaderFactory ?? ((port, baud) => readerFactory?.Invoke() ?? new SerialPortNmeaReader(port, baud));
        this.portEnumerator = portEnumerator ?? (() => SerialPort.GetPortNames());
        this.inventoryReader = inventoryReader ?? (() => this.portEnumerator().Select(name => new SerialPortInfo(name, null, null, null, null, null, null, null, null, null, null, true)).ToArray());
        settingsPath = settingsPathOverride ?? GetDefaultSettingsPath();
        deviceIdentity = initialIdentity;
        if (settingsPathOverride is not null) LoadPersistedSettings(settingsPath);
        diagnostics = GnssSerialDiagnostics.Stopped(this.portName, this.baudRate);
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        lock (stateLock)
        {
            if (disposed) throw new ObjectDisposedException(nameof(SerialNmeaLocationProvider));
            if (sessionTask is not null) return Task.CompletedTask;
            lifetimeCancellationToken = cancellationToken;
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

    public async Task<GnssSerialDiagnostics> ConfigureAsync(string requestedPort, int requestedBaud, CancellationToken cancellationToken)
    {
        var port = requestedPort.Trim().ToUpperInvariant();
        var selected = port == "AUTO_DETECT" ? null : inventoryReader().FirstOrDefault(candidate => candidate.PortName.Equals(port, StringComparison.OrdinalIgnoreCase));
        if (port != "AUTO_DETECT" && (!System.Text.RegularExpressions.Regex.IsMatch(port, "^COM[1-9][0-9]*$") || selected is null)) throw new ArgumentException("The selected serial port is not currently detected.", nameof(requestedPort));
        if (requestedBaud is not (4800 or 9600 or 19200 or 38400 or 57600 or 115200)) throw new ArgumentException("The selected baud rate is unsupported.", nameof(requestedBaud));
        await StopAsync(cancellationToken);
        lock (stateLock) { portName = port; baudRate = requestedBaud; deviceIdentity = selected is null ? null : GnssDeviceIdentity.From(selected); diagnostics = GnssSerialDiagnostics.Stopped(portName, baudRate) with { DeviceName = selected?.FriendlyName, InterfaceIdentity = deviceIdentity?.InterfaceIdentity, DeviceInstanceId = deviceIdentity?.DeviceInstanceId }; }
        PersistSettings(port, requestedBaud, deviceIdentity);
        await StartAsync(lifetimeCancellationToken);
        return GetDiagnostics();
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
                var selectedPort = await ResolvePortAsync(cancellationToken);
                lock (stateLock) { portName = selectedPort.PortName; deviceIdentity = selectedPort.Identity; diagnostics = diagnostics with { PortName = selectedPort.PortName, DeviceName = selectedPort.Info.FriendlyName, InterfaceIdentity = selectedPort.Identity?.InterfaceIdentity, DeviceInstanceId = selectedPort.Identity?.DeviceInstanceId }; }
                using var port = readerFactory(selectedPort.PortName, baudRate);
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
            catch (AutoDetectFailureException ex) { SetUnavailable(); SetFailure(GnssSerialState.OpenFailed, GnssSerialFailureCategory.SerialSilence, ex); logger.LogWarning("AUTO_DETECT found no valid NMEA serial port; awaiting explicit configuration."); }
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

    private sealed record ResolvedPort(string PortName, SerialPortInfo Info, GnssDeviceIdentity? Identity);
    private sealed record PersistedSettings(GnssDeviceIdentity? DeviceIdentity, string? Port, int Baud);
    internal sealed record GnssDeviceIdentity(string? DeviceInstanceId, string? InterfaceIdentity, string? FriendlyName)
    {
        public static GnssDeviceIdentity? From(SerialPortInfo info) => string.IsNullOrWhiteSpace(info.DeviceInstanceId) && string.IsNullOrWhiteSpace(info.InterfaceIdentity) ? null : new(info.DeviceInstanceId, info.InterfaceIdentity, info.FriendlyName);
    }

    private static string ReadSettings(IConfiguration configuration, ISerialPortEnumerator serialPortEnumerator, out string port, out int baud, out GnssDeviceIdentity? identity)
    {
        port = configuration["Agent:Location:NmeaPort"] ?? "AUTO_DETECT";
        baud = int.TryParse(configuration["Agent:Location:NmeaBaud"], out var configuredBaud) ? configuredBaud : 9600;
        identity = null;
        var file = GetSettingsPath(configuration);
        try
        {
            if (File.Exists(file))
            {
                var persisted = JsonSerializer.Deserialize<PersistedSettings>(File.ReadAllText(file), SettingsJsonOptions);
                if (persisted?.Baud > 0) baud = persisted.Baud;
                var persistedIdentity = persisted?.DeviceIdentity;
                identity = persistedIdentity;
                if (persistedIdentity is not null)
                {
                    var ports = serialPortEnumerator.Enumerate(CancellationToken.None).Ports;
                    var match = ports.FirstOrDefault(candidate => candidate.DeviceInstanceId?.Equals(persistedIdentity.DeviceInstanceId, StringComparison.OrdinalIgnoreCase) == true)
                        ?? ports.FirstOrDefault(candidate => candidate.InterfaceIdentity?.Equals(persistedIdentity.InterfaceIdentity, StringComparison.OrdinalIgnoreCase) == true && (string.IsNullOrWhiteSpace(persistedIdentity.FriendlyName) || candidate.FriendlyName?.Equals(persistedIdentity.FriendlyName, StringComparison.OrdinalIgnoreCase) == true));
                    if (match is not null) port = match.PortName;
                }
                else if (!string.IsNullOrWhiteSpace(persisted?.Port)) port = persisted.Port!;
            }
        }
        catch { }
        return port;
    }

    private static string GetDefaultSettingsPath() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FieldOpsDashboard", "agent-location.json");
    private static string GetSettingsPath(IConfiguration configuration) => configuration["Agent:Location:SettingsPath"] is { Length: > 0 } configuredPath ? configuredPath : GetDefaultSettingsPath();
    private void LoadPersistedSettings(string file)
    {
        try
        {
            if (!File.Exists(file)) return;
            var persisted = JsonSerializer.Deserialize<PersistedSettings>(File.ReadAllText(file), SettingsJsonOptions);
            if (persisted?.Baud > 0) this.baudRate = persisted.Baud;
            this.deviceIdentity = persisted?.DeviceIdentity;
            if (!string.IsNullOrWhiteSpace(persisted?.Port)) this.portName = persisted.Port!;
            if (this.deviceIdentity is not null)
            {
                var match = inventoryReader().FirstOrDefault(candidate => candidate.DeviceInstanceId?.Equals(this.deviceIdentity.DeviceInstanceId, StringComparison.OrdinalIgnoreCase) == true)
                    ?? inventoryReader().FirstOrDefault(candidate => candidate.InterfaceIdentity?.Equals(this.deviceIdentity.InterfaceIdentity, StringComparison.OrdinalIgnoreCase) == true && (string.IsNullOrWhiteSpace(this.deviceIdentity.FriendlyName) || candidate.FriendlyName?.Equals(this.deviceIdentity.FriendlyName, StringComparison.OrdinalIgnoreCase) == true));
                if (match is not null) this.portName = match.PortName;
            }
        }
        catch { }
    }

    private void PersistSettings(string port, int baud, GnssDeviceIdentity? identity)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
        var temporary = $"{settingsPath}.{Environment.ProcessId}.{DateTime.UtcNow.Ticks}.tmp";
        try { File.WriteAllText(temporary, JsonSerializer.Serialize(identity is null ? new PersistedSettings(null, port, baud) : new PersistedSettings(identity, null, baud), SettingsJsonOptions)); File.Move(temporary, settingsPath, true); } finally { try { File.Delete(temporary); } catch { } }
    }

    private void SetUnavailable() => SetLatest(LocationObservation.WithoutTelemetry(LocationStatus.Unavailable));

    private async Task<ResolvedPort> ResolvePortAsync(CancellationToken cancellationToken)
    {
        var inventory = inventoryReader();
        lock (stateLock)
        {
            if (deviceIdentity is not null)
            {
                var exact = inventory.FirstOrDefault(candidate => candidate.DeviceInstanceId?.Equals(deviceIdentity.DeviceInstanceId, StringComparison.OrdinalIgnoreCase) == true)
                    ?? inventory.FirstOrDefault(candidate => candidate.InterfaceIdentity?.Equals(deviceIdentity.InterfaceIdentity, StringComparison.OrdinalIgnoreCase) == true && (string.IsNullOrWhiteSpace(deviceIdentity.FriendlyName) || candidate.FriendlyName?.Equals(deviceIdentity.FriendlyName, StringComparison.OrdinalIgnoreCase) == true));
                if (exact is not null) return new(exact.PortName, exact, GnssDeviceIdentity.From(exact));
            }
            if (!portName.Equals("AUTO_DETECT", StringComparison.OrdinalIgnoreCase))
            {
                var manual = inventory.FirstOrDefault(candidate => candidate.PortName.Equals(portName, StringComparison.OrdinalIgnoreCase));
                if (manual is not null) return new(manual.PortName, manual, manual.InterfaceIdentity is null ? null : GnssDeviceIdentity.From(manual));
            }
        }
        var knownPorts = inventory.Select(item => item.PortName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var candidate in inventory.Where(SerialPortIdentityRules.IsAutomaticGnssCandidate).Select(item => item.PortName).Concat(portEnumerator().Where(name => !knownPorts.Contains(name))).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var probe = readerFactory(candidate, baudRate);
            try
            {
                probe.Open();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(2));
                while (!timeout.IsCancellationRequested)
                {
                    var line = await probe.ReadLineAsync(timeout.Token);
                    if (line is not null && NmeaParser.TryParse(line.Trim(), out _))
                    {
                        var info = inventory.FirstOrDefault(item => item.PortName.Equals(candidate, StringComparison.OrdinalIgnoreCase)) ?? new SerialPortInfo(candidate, null, null, null, null, null, null, null, null, null, null, true);
                        return new(candidate, info, info.InterfaceIdentity is null ? null : GnssDeviceIdentity.From(info));
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception exception) { logger.LogDebug(exception, "AUTO_DETECT probe failed for {PortName}.", candidate); }
        }
        throw new AutoDetectFailureException("AUTO_DETECT found no serial port producing valid NMEA data.");
    }
    private sealed class AutoDetectFailureException(string message) : Exception(message);
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
