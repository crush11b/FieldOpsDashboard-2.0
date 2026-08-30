using FieldOps.Agent.Location;
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
}
