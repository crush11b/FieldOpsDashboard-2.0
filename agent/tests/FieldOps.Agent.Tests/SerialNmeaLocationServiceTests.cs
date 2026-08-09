using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SerialNmeaLocationServiceTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";

    [Fact]
    public async Task ConcurrentCallersSerializeSingleTransport()
    {
        var reader = new Reader(Gga); var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(40), () => reader); using var service = new SerialNmeaLocationService(provider);
        var results = await Task.WhenAll(service.AcquireAsync(CancellationToken.None), service.AcquireAsync(CancellationToken.None));
        Assert.Contains(results, r => r.Status == LocationStatus.Available); Assert.Equal(2, reader.OpenCount); Assert.Equal(1, reader.MaxConcurrentOpen);
    }

    [Fact]
    public async Task CancellationDoesNotPoisonSubsequentAcquisition()
    {
        var reader = new Reader(); var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(40), () => reader); using var service = new SerialNmeaLocationService(provider); using var cts = new CancellationTokenSource(); cts.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.AcquireAsync(cts.Token)); Assert.Equal(LocationStatus.NoFix, (await service.AcquireAsync(CancellationToken.None)).Status);
    }

    private sealed class Reader(params string[] values) : INmeaSerialReader
    { private readonly Queue<string> lines = new(values); private int active; public int OpenCount { get; private set; } public int MaxConcurrentOpen { get; private set; } public void Open() { OpenCount++; MaxConcurrentOpen = Math.Max(MaxConcurrentOpen, Interlocked.Increment(ref active)); } public Task<string?> ReadLineAsync(CancellationToken token) { Interlocked.Decrement(ref active); return Task.FromResult<string?>(lines.Count > 0 ? lines.Dequeue() : null); } public void Dispose() { } }
}
