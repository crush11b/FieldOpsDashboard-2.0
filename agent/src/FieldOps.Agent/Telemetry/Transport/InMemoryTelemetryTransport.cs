using System.Threading.Channels;

namespace FieldOps.Agent.Telemetry.Transport;

internal sealed class InMemoryTelemetryTransport : ITelemetryTransport
{
    internal const int DefaultCapacity = 256;

    private readonly Channel<TelemetryEnvelope> channel;

    public InMemoryTelemetryTransport()
        : this(DefaultCapacity)
    {
    }

    internal InMemoryTelemetryTransport(int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);

        channel = Channel.CreateBounded<TelemetryEnvelope>(new BoundedChannelOptions(capacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleWriter = false,
            SingleReader = true,
            AllowSynchronousContinuations = false,
        });
    }

    public ValueTask EnqueueAsync(
        TelemetryEnvelope envelope,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        var ownedEnvelope = envelope.CreateOwnedCopy();
        return channel.Writer.WriteAsync(ownedEnvelope, cancellationToken);
    }

    public ValueTask<TelemetryEnvelope> DequeueAsync(
        CancellationToken cancellationToken = default) =>
        channel.Reader.ReadAsync(cancellationToken);
}
