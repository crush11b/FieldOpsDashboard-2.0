namespace FieldOps.Agent.Telemetry.Delivery;

internal interface ITelemetryRequestAuthenticator
{
    ValueTask AuthenticateAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken = default);
}
