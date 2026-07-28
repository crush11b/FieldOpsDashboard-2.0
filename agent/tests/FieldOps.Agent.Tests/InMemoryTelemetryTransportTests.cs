using System.Text.Json;
using FieldOps.Agent.Telemetry;
using FieldOps.Agent.Telemetry.Transport;
using Microsoft.Extensions.DependencyInjection;

namespace FieldOps.Agent.Tests;

public sealed class InMemoryTelemetryTransportTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PendingObservationWindow = TimeSpan.FromMilliseconds(100);

    [Fact]
    public async Task DequeuesHeterogeneousEnvelopesInFifoOrder()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 3);
        var observedAt = new DateTimeOffset(2026, 7, 28, 12, 0, 0, TimeSpan.Zero);
        await transport.EnqueueAsync(Envelope("battery", new { percent = 73 }, observedAt));
        await transport.EnqueueAsync(Envelope("gps", new { latitude = 37.5407 }, observedAt.AddSeconds(1)));
        await transport.EnqueueAsync(Envelope("weather", new { temperatureC = 28.4 }, observedAt.AddSeconds(2)));

        var actual = new[]
        {
            await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout),
            await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout),
            await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout),
        };

        Assert.Collection(
            actual,
            envelope => AssertEnvelope(envelope, "battery", observedAt, "percent", 73),
            envelope => AssertEnvelope(envelope, "gps", observedAt.AddSeconds(1), "latitude", 37.5407),
            envelope => AssertEnvelope(envelope, "weather", observedAt.AddSeconds(2), "temperatureC", 28.4));
    }

    [Fact]
    public async Task EmptyQueueReadWaitsAndCanBeCancelled()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        using var cancellation = new CancellationTokenSource();
        var pendingRead = transport.DequeueAsync(cancellation.Token).AsTask();

        await AssertRemainsPendingAsync(pendingRead);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await pendingRead.WaitAsync(TestTimeout));
    }

    [Fact]
    public async Task FullQueueWriteWaitsAndCanBeCancelled()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        await transport.EnqueueAsync(Envelope("first", new { value = 1 }));
        using var cancellation = new CancellationTokenSource();
        var pendingWrite = transport.EnqueueAsync(
            Envelope("second", new { value = 2 }),
            cancellation.Token).AsTask();

        await AssertRemainsPendingAsync(pendingWrite);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await pendingWrite.WaitAsync(TestTimeout));
    }

    [Fact]
    public async Task BlockedWriterCompletesWithoutDroppingItemsAfterReadFreesCapacity()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        await transport.EnqueueAsync(Envelope("first", new { value = 1 }));
        var pendingWrite = transport.EnqueueAsync(Envelope("second", new { value = 2 })).AsTask();

        await AssertRemainsPendingAsync(pendingWrite);
        var first = await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout);
        await pendingWrite.WaitAsync(TestTimeout);
        var second = await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout);

        AssertEnvelope(first, "first", first.Timestamps.ObservedAt, "value", 1);
        AssertEnvelope(second, "second", second.Timestamps.ObservedAt, "value", 2);
    }

    [Fact]
    public async Task QueueOwnsAllJsonElementsAfterOriginatingDocumentsAreDisposed()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        TelemetryEnvelope original;

        using (var payload = JsonDocument.Parse("{\"reading\":42}"))
        using (var sourceMetadata = JsonDocument.Parse("{\"port\":\"COM6\"}"))
        using (var envelopeMetadata = JsonDocument.Parse("{\"sequence\":7}"))
        using (var errorDetails = JsonDocument.Parse("{\"nativeCode\":123}"))
        {
            var now = new DateTimeOffset(2026, 7, 28, 12, 0, 0, TimeSpan.Zero);
            original = new TelemetryEnvelope(
                TelemetryStatus.Error,
                new TelemetrySource("serial-gps", "serial_nmea", Metadata: sourceMetadata.RootElement),
                new TelemetryTimestamps(now, now),
                payload.RootElement,
                new TelemetryError("GPS_READ_FAILED", "GPS read failed.", true, errorDetails.RootElement),
                envelopeMetadata.RootElement);

            await transport.EnqueueAsync(original);
        }

        var queued = await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout);

        Assert.NotSame(original, queued);
        Assert.Equal(42, queued.Data!.Value.GetProperty("reading").GetInt32());
        Assert.Equal("COM6", queued.Source.Metadata!.Value.GetProperty("port").GetString());
        Assert.Equal(7, queued.Metadata!.Value.GetProperty("sequence").GetInt32());
        Assert.Equal(123, queued.Error!.Details!.Value.GetProperty("nativeCode").GetInt32());
    }

    [Fact]
    public async Task DefaultCapacityAppliesBackpressureAt256Items()
    {
        var transport = new InMemoryTelemetryTransport();
        for (var index = 0; index < InMemoryTelemetryTransport.DefaultCapacity; index++)
        {
            await transport.EnqueueAsync(Envelope($"source-{index}", new { index }));
        }

        var pendingWrite = transport.EnqueueAsync(Envelope("source-256", new { index = 256 })).AsTask();
        await AssertRemainsPendingAsync(pendingWrite);

        var first = await transport.DequeueAsync().AsTask().WaitAsync(TestTimeout);
        await pendingWrite.WaitAsync(TestTimeout);

        Assert.Equal("source-0", first.Source.Id);
        Assert.Equal(0, first.Data!.Value.GetProperty("index").GetInt32());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void ConstructorRejectsNonPositiveCapacity(int capacity)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new InMemoryTelemetryTransport(capacity));
    }

    [Fact]
    public void DependencyInjectionResolvesOneSharedTransportInstance()
    {
        var services = new ServiceCollection();
        services.AddTelemetryTransportFoundation();
        using var provider = services.BuildServiceProvider();

        var first = provider.GetRequiredService<ITelemetryTransport>();
        var second = provider.GetRequiredService<ITelemetryTransport>();

        Assert.Same(first, second);
        Assert.IsType<InMemoryTelemetryTransport>(first);
    }

    private static async Task AssertRemainsPendingAsync(Task operation)
    {
        await Assert.ThrowsAsync<TimeoutException>(
            async () => await operation.WaitAsync(PendingObservationWindow));
    }

    private static void AssertEnvelope(
        TelemetryEnvelope envelope,
        string sourceId,
        DateTimeOffset observedAt,
        string payloadProperty,
        double expectedValue)
    {
        Assert.Equal(sourceId, envelope.Source.Id);
        Assert.Equal(TelemetryStatus.Ok, envelope.Status);
        Assert.Equal(observedAt, envelope.Timestamps.ObservedAt);
        Assert.Equal(expectedValue, envelope.Data!.Value.GetProperty(payloadProperty).GetDouble());
    }

    private static TelemetryEnvelope Envelope(
        string sourceId,
        object payload,
        DateTimeOffset? observedAt = null)
    {
        var timestamp = observedAt ?? new DateTimeOffset(2026, 7, 28, 12, 0, 0, TimeSpan.Zero);
        return new TelemetryEnvelope(
            TelemetryStatus.Ok,
            new TelemetrySource(sourceId, "test"),
            new TelemetryTimestamps(timestamp, timestamp),
            JsonSerializer.SerializeToElement(payload));
    }
}
