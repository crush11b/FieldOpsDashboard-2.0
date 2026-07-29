using System.Collections.Concurrent;
using System.Text.Json;
using FieldOps.Agent.Telemetry;
using FieldOps.Agent.Telemetry.Delivery;
using FieldOps.Agent.Telemetry.Transport;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Tests;

public sealed class TelemetrySenderServiceTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PendingObservationWindow = TimeSpan.FromMilliseconds(100);

    [Fact]
    public async Task DeliversHeterogeneousEnvelopesInFifoOrder()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 3);
        await transport.EnqueueAsync(Envelope("battery", new { percent = 74 }));
        await transport.EnqueueAsync(Envelope("gps", new { latitude = 37.5407 }));
        await transport.EnqueueAsync(Envelope("radio", new { frequencyHz = 146520000 }));
        var delivered = new ConcurrentQueue<TelemetryEnvelope>();
        var allDelivered = NewSignal();
        var destination = new DelegateDestination((envelope, _) =>
        {
            delivered.Enqueue(envelope);
            if (delivered.Count == 3)
            {
                allDelivered.TrySetResult();
            }
            return ValueTask.CompletedTask;
        });
        var service = CreateService(transport, destination);

        await service.StartAsync(CancellationToken.None).WaitAsync(TestTimeout);
        await allDelivered.Task.WaitAsync(TestTimeout);
        await service.StopAsync(CancellationToken.None).WaitAsync(TestTimeout);

        Assert.Collection(
            delivered,
            envelope => AssertEnvelope(envelope, "battery", "percent", 74),
            envelope => AssertEnvelope(envelope, "gps", "latitude", 37.5407),
            envelope => AssertEnvelope(envelope, "radio", "frequencyHz", 146520000));
    }

    [Fact]
    public async Task AwaitsCurrentDeliveryBeforeStartingNext()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 2);
        await transport.EnqueueAsync(Envelope("first", new { value = 1 }));
        await transport.EnqueueAsync(Envelope("second", new { value = 2 }));
        var firstStarted = NewSignal();
        var releaseFirst = NewSignal();
        var secondStarted = NewSignal();
        var calls = 0;
        var destination = new DelegateDestination(async (_, cancellationToken) =>
        {
            var call = Interlocked.Increment(ref calls);
            if (call == 1)
            {
                firstStarted.TrySetResult();
                await releaseFirst.Task.WaitAsync(cancellationToken);
            }
            else if (call == 2)
            {
                secondStarted.TrySetResult();
            }
        });
        var service = CreateService(transport, destination);

        await service.StartAsync(CancellationToken.None).WaitAsync(TestTimeout);
        await firstStarted.Task.WaitAsync(TestTimeout);
        await AssertRemainsPendingAsync(secondStarted.Task);
        Assert.Equal(1, Volatile.Read(ref calls));

        releaseFirst.TrySetResult();
        await secondStarted.Task.WaitAsync(TestTimeout);
        Assert.Equal(2, Volatile.Read(ref calls));
        await service.StopAsync(CancellationToken.None).WaitAsync(TestTimeout);
    }

    [Fact]
    public async Task StopsCleanlyWhileQueueIsEmpty()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        var calls = 0;
        var destination = new DelegateDestination((_, _) =>
        {
            Interlocked.Increment(ref calls);
            return ValueTask.CompletedTask;
        });
        var service = CreateService(transport, destination);

        await service.StartAsync(CancellationToken.None).WaitAsync(TestTimeout);
        await service.StopAsync(CancellationToken.None).WaitAsync(TestTimeout);

        Assert.Equal(0, Volatile.Read(ref calls));
        Assert.True(service.ExecuteTask!.IsCompletedSuccessfully);
    }

    [Fact]
    public async Task ShutdownCancelsBlockedDeliveryAndLogsUnconfirmedEnvelope()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        await transport.EnqueueAsync(Envelope("blocked-source", new { secret = "do-not-log" }));
        var sendStarted = NewSignal();
        var cancellationObserved = NewSignal();
        var destination = new DelegateDestination(async (_, cancellationToken) =>
        {
            sendStarted.TrySetResult();
            try
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                cancellationObserved.TrySetResult();
                throw;
            }
        });
        var logger = new RecordingLogger<TelemetrySenderService>();
        var service = CreateService(transport, destination, logger);

        await service.StartAsync(CancellationToken.None).WaitAsync(TestTimeout);
        await sendStarted.Task.WaitAsync(TestTimeout);
        await service.StopAsync(CancellationToken.None).WaitAsync(TestTimeout);
        await cancellationObserved.Task.WaitAsync(TestTimeout);

        Assert.True(service.ExecuteTask!.IsCompletedSuccessfully);
        var warning = Assert.Single(logger.Entries, entry => entry.Level == LogLevel.Warning);
        AssertSafeContext(warning, "blocked-source", TelemetryStatus.Ok);
        Assert.DoesNotContain("do-not-log", warning.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task DeliveryFailureFaultsWorkerAndDoesNotSendNextEnvelope()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 2);
        await transport.EnqueueAsync(Envelope("failed-source", new { secret = "TOP-SECRET" }));
        await transport.EnqueueAsync(Envelope("second-source", new { value = 2 }));
        var expected = new InvalidOperationException("Destination unavailable.");
        var calls = 0;
        var destination = new DelegateDestination(async (_, _) =>
        {
            Interlocked.Increment(ref calls);
            await Task.Yield();
            throw expected;
        });
        var logger = new RecordingLogger<TelemetrySenderService>();
        var service = CreateService(transport, destination, logger);

        await service.StartAsync(CancellationToken.None).WaitAsync(TestTimeout);
        var actual = await Assert.ThrowsAsync<InvalidOperationException>(
            async () => await service.ExecuteTask!.WaitAsync(TestTimeout));

        Assert.Same(expected, actual);
        Assert.Equal(1, Volatile.Read(ref calls));
        var error = Assert.Single(logger.Entries, entry => entry.Level == LogLevel.Error);
        Assert.Same(expected, error.Exception);
        AssertSafeContext(error, "failed-source", TelemetryStatus.Ok);
        Assert.DoesNotContain("TOP-SECRET", error.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(error.Properties.Values, value => string.Equals(value?.ToString(), "TOP-SECRET", StringComparison.Ordinal));
    }

    [Fact]
    public async Task DestinationCancellationWithoutShutdownFaultsWorkerAndLogsError()
    {
        var transport = new InMemoryTelemetryTransport(capacity: 1);
        await transport.EnqueueAsync(Envelope("cancelled-source", new { value = 1 }));
        var destination = new DelegateDestination(async (_, _) =>
        {
            await Task.Yield();
            throw new OperationCanceledException("Destination cancelled independently.");
        });
        var logger = new RecordingLogger<TelemetrySenderService>();
        var service = CreateService(transport, destination, logger);

        await service.StartAsync(CancellationToken.None).WaitAsync(TestTimeout);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await service.ExecuteTask!.WaitAsync(TestTimeout));

        var error = Assert.Single(logger.Entries, entry => entry.Level == LogLevel.Error);
        Assert.IsType<OperationCanceledException>(error.Exception);
        AssertSafeContext(error, "cancelled-source", TelemetryStatus.Ok);
    }

    private static TelemetrySenderService CreateService(
        ITelemetryTransport transport,
        ITelemetryDestination destination,
        ILogger<TelemetrySenderService>? logger = null) =>
        new(transport, destination, logger ?? new RecordingLogger<TelemetrySenderService>());

    private static async Task AssertRemainsPendingAsync(Task operation)
    {
        await Assert.ThrowsAsync<TimeoutException>(
            async () => await operation.WaitAsync(PendingObservationWindow));
    }

    private static void AssertEnvelope(
        TelemetryEnvelope envelope,
        string sourceId,
        string payloadProperty,
        double expectedValue)
    {
        Assert.Equal(sourceId, envelope.Source.Id);
        Assert.Equal(TelemetryStatus.Ok, envelope.Status);
        Assert.Equal(expectedValue, envelope.Data!.Value.GetProperty(payloadProperty).GetDouble());
    }

    private static void AssertSafeContext(
        LogEntry entry,
        string sourceId,
        TelemetryStatus status)
    {
        Assert.Equal(sourceId, entry.Properties["SourceId"]);
        Assert.Equal("test", entry.Properties["SourceType"]);
        Assert.Equal(status, entry.Properties["TelemetryStatus"]);
    }

    private static TelemetryEnvelope Envelope(string sourceId, object payload)
    {
        var now = new DateTimeOffset(2026, 7, 28, 12, 0, 0, TimeSpan.Zero);
        return new TelemetryEnvelope(
            TelemetryStatus.Ok,
            new TelemetrySource(sourceId, "test"),
            new TelemetryTimestamps(now, now),
            JsonSerializer.SerializeToElement(payload));
    }

    private static TaskCompletionSource NewSignal() =>
        new(TaskCreationOptions.RunContinuationsAsynchronously);

    private sealed class DelegateDestination(
        Func<TelemetryEnvelope, CancellationToken, ValueTask> sendAsync) : ITelemetryDestination
    {
        public ValueTask SendAsync(
            TelemetryEnvelope envelope,
            CancellationToken cancellationToken = default) =>
            sendAsync(envelope, cancellationToken);
    }

    private sealed record LogEntry(
        LogLevel Level,
        Exception? Exception,
        string Message,
        IReadOnlyDictionary<string, object?> Properties);

    private sealed class RecordingLogger<T> : ILogger<T>
    {
        private readonly ConcurrentQueue<LogEntry> entries = new();

        public IReadOnlyCollection<LogEntry> Entries => entries;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var properties = state is IEnumerable<KeyValuePair<string, object?>> structuredState
                ? structuredState.ToDictionary(pair => pair.Key, pair => pair.Value)
                : new Dictionary<string, object?>();
            entries.Enqueue(new LogEntry(logLevel, exception, formatter(state, exception), properties));
        }
    }
}
