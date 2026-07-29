namespace FieldOps.Agent.Telemetry.Delivery;

internal interface ITelemetryDestination
{
    ValueTask SendAsync(
        TelemetryEnvelope envelope,
        CancellationToken cancellationToken = default);
}
