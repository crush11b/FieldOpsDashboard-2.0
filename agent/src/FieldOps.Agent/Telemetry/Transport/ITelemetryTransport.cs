namespace FieldOps.Agent.Telemetry.Transport;

internal interface ITelemetryTransport
{
    ValueTask EnqueueAsync(
        TelemetryEnvelope envelope,
        CancellationToken cancellationToken = default);

    ValueTask<TelemetryEnvelope> DequeueAsync(
        CancellationToken cancellationToken = default);
}
