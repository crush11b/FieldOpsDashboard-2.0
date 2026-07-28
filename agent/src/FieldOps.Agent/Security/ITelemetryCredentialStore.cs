namespace FieldOps.Agent.Security;

internal interface ITelemetryCredentialStore
{
    ValueTask<string?> ReadAsync(CancellationToken cancellationToken = default);
}
