using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using System.Threading.Channels;

namespace FieldOps.Agent.Tests;

public sealed class GnssRecoveryTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,0,00,99.9,545.4,M,46.9,M,,";

    [Fact]
    public async Task AcceptedCommandWithoutNewSerialDataIsNotRecovery()
    {
        using var provider = SilentProvider();
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => provider.GetDiagnostics().LastFailureCategory == GnssSerialFailureCategory.SerialSilence);
        var at = new FakeAtPort("OK");
        var coordinator = Coordinator(provider, at);

        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(40));
        var result = await coordinator.RecoverAsync(cancellation.Token);

        Assert.True(at.Opened);
        Assert.Equal(GnssRecoveryState.Cancelled, result.State);
        Assert.False(result.SerialActivityRecovered);
        Assert.True(at.Commands.Single() == GnssRecoveryCoordinator.RecoveryCommand);
        await provider.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task NewSerialDataAfterAcceptedCommandProvesNmeaRecovery()
    {
        var reader = new TestReader();
        using var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(5), () => reader, TimeSpan.FromMilliseconds(10));
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => provider.GetDiagnostics().LastFailureCategory == GnssSerialFailureCategory.SerialSilence);
        var at = new FakeAtPort("OK", () => reader.Enqueue(Gga));
        var result = await Coordinator(provider, at).RecoverAsync(CancellationToken.None);

        Assert.Equal(GnssRecoveryState.NmeaRecovered, result.State);
        Assert.True(result.CommandAccepted);
        Assert.True(result.SerialActivityRecovered);
        Assert.True(result.NmeaActivityRecovered);
        Assert.Equal(LocationStatus.NoFix, result.FixStatus);
        await provider.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task SuccessfulRecoveryLogsCorrelatedStagesAndResult()
    {
        var reader = new TestReader();
        using var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(5), () => reader, TimeSpan.FromMilliseconds(10));
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => provider.GetDiagnostics().LastFailureCategory == GnssSerialFailureCategory.SerialSilence);
        using var loggerProvider = new CapturingLoggerProvider();
        using var loggerFactory = LoggerFactory.Create(builder => builder.AddProvider(loggerProvider));
        var at = new FakeAtPort("OK", () => reader.Enqueue(Gga));
        var result = await new GnssRecoveryCoordinator(provider, true, GnssRecoveryCoordinator.SupportedProvider, "COM7", 115200, (_, _) => at, loggerFactory.CreateLogger<GnssRecoveryCoordinator>()).RecoverAsync(CancellationToken.None);

        Assert.Equal(GnssRecoveryState.NmeaRecovered, result.State);
        Assert.NotEmpty(loggerProvider.Entries);
        var correlationIds = loggerProvider.Entries
            .Select(entry => entry.Split("CorrelationId=", StringSplitOptions.None).Skip(1).FirstOrDefault()?.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault())
            .Where(value => value is not null)
            .Distinct()
            .ToArray();
        Assert.Single(correlationIds);
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("operation started", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("COM7 open succeeded", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("Category=OK", StringComparison.Ordinal));
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("observation phase started", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("newer serial evidence detected", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("newer NMEA evidence detected", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(loggerProvider.Entries, entry => entry.Contains("final result", StringComparison.OrdinalIgnoreCase));
        await provider.StopAsync(CancellationToken.None);
    }

    private static SerialNmeaLocationProvider SilentProvider() => new(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(5), () => new TestReader(), TimeSpan.FromMilliseconds(10));
    private static GnssRecoveryCoordinator Coordinator(SerialNmeaLocationProvider provider, FakeAtPort at) => new(provider, true, GnssRecoveryCoordinator.SupportedProvider, "COM7", 115200, (_, _) => at, NullLogger<GnssRecoveryCoordinator>.Instance);
    private static async Task Eventually(Func<bool> condition) { for (var attempt = 0; attempt < 100 && !condition(); attempt++) await Task.Delay(5); Assert.True(condition()); }

    private sealed class FakeAtPort(string response, Action? onExecute = null) : IAtCommandPort
    {
        public string PortName => "COM7";
        public int BaudRate => 115200;
        public bool Opened { get; private set; }
        public List<string> Commands { get; } = [];
        public void Open() => Opened = true;
        public Task<string> ExecuteAsync(string command, CancellationToken cancellationToken) { Commands.Add(command); onExecute?.Invoke(); return Task.FromResult(response); }
        public void Dispose() { }
    }

    private sealed class TestReader : INmeaSerialReader
    {
        private readonly Channel<string> lines = Channel.CreateUnbounded<string>();
        public void Open() { }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        public void Dispose() { }
        public void Enqueue(string line) => lines.Writer.TryWrite(line);
        public async Task<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            await Task.Delay(15, cancellationToken);
            return lines.Reader.TryRead(out var line) ? line : null;
        }
    }

    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        public List<string> Entries { get; } = [];
        public ILogger CreateLogger(string categoryName) => new CapturingLogger(Entries);
        public void Dispose() { }
    }

    private sealed class CapturingLogger(List<string> entries) : ILogger
    {
        public IDisposable BeginScope<TState>(TState state) where TState : notnull => new NoopScope();
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) => entries.Add(formatter(state, exception));
        private sealed class NoopScope : IDisposable { public void Dispose() { } }
    }
}
