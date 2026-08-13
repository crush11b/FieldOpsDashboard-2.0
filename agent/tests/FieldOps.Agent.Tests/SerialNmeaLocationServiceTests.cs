using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SerialNmeaLocationServiceTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";

    [Fact]
    public async Task ConcurrentLocationRequestsSharePersistentTransport()
    {
        var reader = new Reader(Gga); var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(40), () => reader); using var service = new SerialNmeaLocationService(provider);
        await provider.StartAsync(CancellationToken.None); await Eventually(() => reader.OpenCount == 1);
        var results = await Task.WhenAll(service.AcquireAsync(CancellationToken.None), service.AcquireAsync(CancellationToken.None));
        Assert.All(results, r => Assert.Equal(LocationStatus.Available, r.Status)); Assert.Equal(1, reader.OpenCount); await provider.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task CancellationDoesNotPoisonSubsequentAcquisition()
    {
        var reader = new Reader(); var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(40), () => reader); using var service = new SerialNmeaLocationService(provider); using var cts = new CancellationTokenSource(); cts.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.AcquireAsync(cts.Token)); await provider.StartAsync(CancellationToken.None); await Eventually(() => reader.OpenCount == 1); Assert.Equal(LocationStatus.NoFix, (await service.AcquireAsync(CancellationToken.None)).Status); await provider.StopAsync(CancellationToken.None);
    }

    private static async Task Eventually(Func<bool> condition) { for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(5); Assert.True(condition()); }
    private sealed class Reader(params string[] values) : INmeaSerialReader
    { private readonly Queue<string> lines = new(values); private readonly SemaphoreSlim signal = new(values.Length); public int OpenCount { get; private set; } public void Open() => OpenCount++; public async Task<string?> ReadLineAsync(CancellationToken token) { await signal.WaitAsync(token); return lines.Dequeue(); } public void Dispose() { } }
}
