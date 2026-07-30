using FieldOps.NativeHealth;

namespace FieldOps.Agent.Health;

internal sealed class NativeHealthSnapshotProvider(
    ServiceIdentity identity,
    TimeProvider timeProvider) : INativeHealthSnapshotProvider
{
    public ValueTask<NativeHealthSnapshot?> ReadAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var checkedAt = timeProvider.GetUtcNow();
        NativeHealthSnapshot snapshot = new(
            Status: "ok",
            Service: ServiceIdentity.Name,
            Version: identity.Version,
            StartedAt: identity.StartedAt,
            CheckedAt: checkedAt,
            UptimeSeconds: Math.Max(0, (long)(checkedAt - identity.StartedAt).TotalSeconds));
        return ValueTask.FromResult<NativeHealthSnapshot?>(snapshot);
    }
}
