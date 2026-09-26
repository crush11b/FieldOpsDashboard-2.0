using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

[CollectionDefinition("GNSS/Serial", DisableParallelization = true)]
public sealed class GnssSerialTestCollection;

public abstract class SerialNmeaTestBase : IAsyncLifetime
{
    private readonly List<SerialNmeaLocationProvider> providers = [];

    protected SerialNmeaLocationProvider Track(SerialNmeaLocationProvider provider)
    {
        providers.Add(provider);
        return provider;
    }

    protected static Func<IReadOnlyList<string>> TestPortEnumerator(string portName) => () => new[] { portName };

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var provider in providers)
        {
            await provider.StopAsync(CancellationToken.None);
        }
    }
}
