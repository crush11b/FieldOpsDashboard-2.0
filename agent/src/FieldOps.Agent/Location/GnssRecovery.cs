using System.Diagnostics;
using System.IO.Ports;
using System.Text;
using System.Text.Json.Serialization;

namespace FieldOps.Agent.Location;

internal interface IAtCommandPort : IDisposable
{
    string PortName { get; }
    int BaudRate { get; }
    void Open();
    Task<string> ExecuteAsync(string command, CancellationToken cancellationToken);
}

internal sealed class SerialPortAtCommandPort(string portName, int baudRate) : IAtCommandPort
{
    private readonly SerialPort port = new(portName, baudRate, Parity.None, 8, StopBits.One)
    {
        Handshake = Handshake.None,
        ReadTimeout = 250,
        NewLine = "\r\n",
    };

    public string PortName => port.PortName;
    public int BaudRate => port.BaudRate;
    public void Open() => port.Open();

    public async Task<string> ExecuteAsync(string command, CancellationToken cancellationToken)
    {
        port.Write(Encoding.ASCII.GetBytes($"{command}\r"), 0, command.Length + 1);
        var response = new StringBuilder();
        var deadline = Stopwatch.GetTimestamp() + Stopwatch.Frequency * 5;
        while (Stopwatch.GetTimestamp() < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var chunk = port.ReadExisting();
            if (!string.IsNullOrEmpty(chunk))
            {
                response.Append(chunk);
                if (response.ToString().Contains("OK", StringComparison.OrdinalIgnoreCase)
                    || response.ToString().Contains("ERROR", StringComparison.OrdinalIgnoreCase)) return response.ToString();
            }
            await Task.Delay(50, cancellationToken);
        }
        throw new TimeoutException("The GNSS control port did not return a bounded response.");
    }

    public void Dispose() => port.Dispose();
}

public enum GnssRecoveryState
{
    Unsupported,
    Disabled,
    NotNeeded,
    Available,
    Running,
    CommandAccepted,
    NmeaRecovered,
    Recovered,
    Failed,
    TimedOut,
    Cancelled,
    PortUnavailable,
    UnexpectedResponse,
    AlreadyRunning,
}

public enum GnssRecoveryFailureCategory
{
    None,
    Unsupported,
    Disabled,
    InappropriateState,
    AccessDenied,
    IoError,
    ResponseTimeout,
    UnexpectedResponse,
    SerialSilence,
    Cancelled,
    UnexpectedError,
}

public sealed record GnssRecoveryResult(
    [property: JsonPropertyName("supported")] bool Supported,
    [property: JsonPropertyName("available")] bool Available,
    [property: JsonPropertyName("state")] GnssRecoveryState State,
    [property: JsonPropertyName("providerType")] string? ProviderType,
    [property: JsonPropertyName("controlPort")] string? ControlPort,
    [property: JsonPropertyName("operationStartedUtc")] DateTimeOffset? OperationStartedUtc,
    [property: JsonPropertyName("operationCompletedUtc")] DateTimeOffset? OperationCompletedUtc,
    [property: JsonPropertyName("commandAccepted")] bool CommandAccepted,
    [property: JsonPropertyName("serialActivityRecovered")] bool SerialActivityRecovered,
    [property: JsonPropertyName("nmeaActivityRecovered")] bool NmeaActivityRecovered,
    [property: JsonPropertyName("fixStatus")] LocationStatus? FixStatus,
    [property: JsonPropertyName("attemptCount")] int AttemptCount,
    [property: JsonPropertyName("failureCategory")] GnssRecoveryFailureCategory FailureCategory,
    [property: JsonPropertyName("failureMessage")] string? FailureMessage,
    [property: JsonPropertyName("lastSerialBeforeUtc")] DateTimeOffset? LastSerialBeforeUtc,
    [property: JsonPropertyName("lastSerialAfterUtc")] DateTimeOffset? LastSerialAfterUtc,
    [property: JsonPropertyName("lastNmeaAfterUtc")] DateTimeOffset? LastNmeaAfterUtc)
{
    public static GnssRecoveryResult Initial(bool enabled, string provider, string port) => new(
        provider.Equals("SierraEm7455B", StringComparison.OrdinalIgnoreCase), enabled, enabled ? GnssRecoveryState.Available : GnssRecoveryState.Disabled,
        provider, port, null, null, false, false, false, null, 0, enabled ? GnssRecoveryFailureCategory.None : GnssRecoveryFailureCategory.Disabled, enabled ? null : "GNSS recovery is disabled.", null, null, null);
}

public sealed class GnssRecoveryCoordinator
{
    public const string SupportedProvider = "SierraEm7455B";
    public const string RecoveryCommand = "AT!GPSEND=0,255";
    public static readonly TimeSpan MaximumOperationDuration = TimeSpan.FromSeconds(35);
    private static readonly TimeSpan ObservationInterval = TimeSpan.FromSeconds(1);
    private readonly SerialNmeaLocationProvider provider;
    private readonly bool enabled;
    private readonly string providerType;
    private readonly string controlPort;
    private readonly int controlBaud;
    private readonly Func<string, int, IAtCommandPort> portFactory;
    private readonly SemaphoreSlim operationGate = new(1, 1);
    private readonly object stateLock = new();
    private GnssRecoveryResult latest;

    public GnssRecoveryCoordinator(SerialNmeaLocationProvider provider, IConfiguration configuration, ILogger<GnssRecoveryCoordinator> logger)
        : this(provider,
            bool.TryParse(configuration["Agent:Location:Recovery:Enabled"], out var configuredEnabled) && configuredEnabled,
            configuration["Agent:Location:Recovery:Provider"] ?? string.Empty,
            configuration["Agent:Location:Recovery:ControlPort"] ?? string.Empty,
            int.TryParse(configuration["Agent:Location:Recovery:ControlBaud"], out var baud) ? baud : 0,
            (port, rate) => new SerialPortAtCommandPort(port, rate), logger) { }

    internal GnssRecoveryCoordinator(SerialNmeaLocationProvider provider, bool enabled, string providerType, string controlPort, int controlBaud, Func<string, int, IAtCommandPort> portFactory, ILogger<GnssRecoveryCoordinator> logger)
    {
        this.provider = provider;
        this.enabled = enabled;
        this.providerType = providerType;
        this.controlPort = controlPort;
        this.controlBaud = controlBaud;
        this.portFactory = portFactory;
        latest = GnssRecoveryResult.Initial(enabled, providerType, controlPort);
    }

    public GnssRecoveryResult GetStatus()
    {
        lock (stateLock) return latest;
    }

    public async Task<GnssRecoveryResult> RecoverAsync(CancellationToken cancellationToken)
    {
        var initial = provider.GetDiagnostics();
        var supported = providerType.Equals(SupportedProvider, StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrWhiteSpace(controlPort) && controlBaud > 0;
        if (!supported) return Set(Final(GnssRecoveryState.Unsupported, GnssRecoveryFailureCategory.Unsupported, "Configured GNSS recovery provider or control port is unsupported.", null, initial, null, false, false, false, null));
        if (!enabled) return Set(Final(GnssRecoveryState.Disabled, GnssRecoveryFailureCategory.Disabled, "GNSS recovery is disabled.", null, initial, null, false, false, false, null));
        if (initial.LastFailureCategory != GnssSerialFailureCategory.SerialSilence)
            return Set(Final(GnssRecoveryState.NotNeeded, GnssRecoveryFailureCategory.InappropriateState, "GNSS recovery is available only for a persistent serial-silence failure.", null, initial, null, false, false, false, null));
        if (!await operationGate.WaitAsync(0, cancellationToken))
            return Set(Final(GnssRecoveryState.AlreadyRunning, GnssRecoveryFailureCategory.InappropriateState, "A GNSS recovery operation is already running.", null, initial, null, false, false, false, null));

        var started = DateTimeOffset.UtcNow;
        var baselineSerial = initial.LastSerialDataUtc;
        var baselineNmea = initial.LastValidNmeaUtc;
        try
        {
            using var operationTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            operationTimeout.CancelAfter(MaximumOperationDuration);
            var token = operationTimeout.Token;
            Set(new GnssRecoveryResult(true, true, GnssRecoveryState.Running, providerType, controlPort, started, null, false, false, false, null, 1, GnssRecoveryFailureCategory.None, null, baselineSerial, null, baselineNmea));
            bool accepted;
            try
            {
                using var port = portFactory(controlPort, controlBaud);
                port.Open();
                var response = await port.ExecuteAsync(RecoveryCommand, token);
                accepted = response.Contains("OK", StringComparison.OrdinalIgnoreCase)
                    && !response.Contains("ERROR", StringComparison.OrdinalIgnoreCase);
            }
            catch (UnauthorizedAccessException ex) { return Set(Final(GnssRecoveryState.PortUnavailable, GnssRecoveryFailureCategory.AccessDenied, ex.Message, started, initial, null, false, false, false, baselineSerial)); }
            catch (IOException ex) { return Set(Fn(GnssRecoveryState.PortUnavailable, GnssRecoveryFailureCategory.IoError, ex.Message, started, initial, baselineSerial)); }
            catch (TimeoutException ex) { return Set(Fn(GnssRecoveryState.TimedOut, GnssRecoveryFailureCategory.ResponseTimeout, ex.Message, started, initial, baselineSerial)); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { return Set(Fn(cancellationToken.IsCancellationRequested ? GnssRecoveryState.Cancelled : GnssRecoveryState.TimedOut, GnssRecoveryFailureCategory.Cancelled, "GNSS recovery was cancelled or exceeded its bounded duration.", started, initial, baselineSerial)); }
            catch (Exception) { return Set(Fn(GnssRecoveryState.Failed, GnssRecoveryFailureCategory.UnexpectedError, "GNSS control operation failed.", started, initial, baselineSerial)); }
            if (!accepted) return Set(Fn(GnssRecoveryState.UnexpectedResponse, GnssRecoveryFailureCategory.UnexpectedResponse, "The GNSS control port did not accept the recovery command.", started, initial, baselineSerial));
            Set(new GnssRecoveryResult(true, true, GnssRecoveryState.CommandAccepted, providerType, controlPort, started, null, true, false, false, null, 1, GnssRecoveryFailureCategory.None, "GNSS session command accepted; waiting for NMEA data.", baselineSerial, null, baselineNmea));
            while (!token.IsCancellationRequested)
            {
                var diagnostics = provider.GetDiagnostics();
                var serialRecovered = IsNewer(diagnostics.LastSerialDataUtc, baselineSerial, started);
                var nmeaRecovered = IsNewer(diagnostics.LastValidNmeaUtc, baselineNmea, started);
                if (serialRecovered)
                {
                    var state = diagnostics.LastFixUtc is not null && IsNewer(diagnostics.LastFixUtc, baselineNmea, started) ? GnssRecoveryState.Recovered : GnssRecoveryState.NmeaRecovered;
                    return Set(new GnssRecoveryResult(true, true, state, providerType, controlPort, started, DateTimeOffset.UtcNow, true, true, nmeaRecovered, diagnostics.LastFixUtc is not null ? LocationStatus.Available : LocationStatus.NoFix, 1, GnssRecoveryFailureCategory.None, nmeaRecovered ? "NMEA data recovered; GPS fix state is reported separately." : "NMEA data recovered; acquiring GPS fix.", baselineSerial, diagnostics.LastSerialDataUtc, diagnostics.LastValidNmeaUtc));
                }
                await Task.Delay(ObservationInterval, token);
            }
            return Set(Fn(GnssRecoveryState.TimedOut, GnssRecoveryFailureCategory.SerialSilence, "GNSS recovery did not restore NMEA data.", started, initial, baselineSerial));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return Set(Fn(GnssRecoveryState.Cancelled, GnssRecoveryFailureCategory.Cancelled, "GNSS recovery was cancelled.", started, initial, baselineSerial));
        }
        finally { operationGate.Release(); }
    }

    private GnssRecoveryResult Final(GnssRecoveryState state, GnssRecoveryFailureCategory failure, string message, DateTimeOffset? started, GnssSerialDiagnostics before, DateTimeOffset? serialAfter, bool accepted, bool serial, bool nmea, DateTimeOffset? nmeaAfter) => new(
        state is not GnssRecoveryState.Unsupported and not GnssRecoveryState.Disabled, state == GnssRecoveryState.Available, state, providerType, controlPort, started, started is null ? null : DateTimeOffset.UtcNow, accepted, serial, nmea, null, 0, failure, message, before.LastSerialDataUtc, serialAfter, nmeaAfter);
    private GnssRecoveryResult Fn(GnssRecoveryState state, GnssRecoveryFailureCategory failure, string message, DateTimeOffset started, GnssSerialDiagnostics before, DateTimeOffset? serialAfter) => Final(state, failure, message, started, before, serialAfter, state == GnssRecoveryState.CommandAccepted, false, false, null);
    private GnssRecoveryResult Set(GnssRecoveryResult value) { lock (stateLock) latest = value; return value; }
    private static bool IsNewer(DateTimeOffset? value, DateTimeOffset? baseline, DateTimeOffset started) => value is not null && value > started && (baseline is null || value > baseline);
}