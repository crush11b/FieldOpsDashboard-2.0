using FieldOps.Agent.Location;
using FieldOps.Agent.Serial;

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

    protected static Func<IReadOnlyList<SerialPortInfo>> TestPortInventory(params string[] portNames) =>
        () => portNames.Select(portName => new SerialPortInfo(portName, null, null, null, null, null, null, null, null, null, null, true)).ToArray();

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        foreach (var provider in providers)
        {
            await provider.StopAsync(CancellationToken.None);
        }
    }
}
