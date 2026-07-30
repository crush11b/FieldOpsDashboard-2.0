using FieldOps.NativeHealth;

namespace FieldOps.Agent.Health;

internal interface INativeHealthSnapshotProvider
{
    ValueTask<NativeHealthSnapshot?> ReadAsync(CancellationToken cancellationToken);
}
