using FieldOps.Agent.Location;

namespace FieldOps.Agent.Tests;

[CollectionDefinition("Serial NMEA", DisableParallelization = true)]
public sealed class SerialNmeaTestCollection;

public abstract class SerialNmeaTestBase : IAsyncLifetime
{
    private readonly List<SerialNmeaLocationProvider> providers = [];

    protected SerialNmeaLocationProvider Track(SerialNmeaLocationProvider provider)
    {
        providers.Add(provider);
        return provider;
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var provider in providers)
        {
            await provider.StopAsync(CancellationToken.None);
        }
    }
}
