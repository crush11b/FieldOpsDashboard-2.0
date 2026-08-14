using FieldOps.Agent.Location;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SerialNmeaProviderRegistrationTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    private const string Rmc = "$GPRMC,123519.00,A,4807.038,N,01131.000,E,000.0,000.0,230394,,,A";

    [Fact]
    public async Task HostedProviderAndLocationServiceShareTheSamePersistentState()
    {
        var reader = new Reader();
        using var services = new ServiceCollection()
            .AddSingleton<SerialNmeaLocationProvider>(_ => new SerialNmeaLocationProvider(
                NullLogger<SerialNmeaLocationProvider>.Instance,
                "COM6",
                9600,
                TimeSpan.FromMilliseconds(1),
                () => reader))
            .AddSingleton<ISerialNmeaLocationService, SerialNmeaLocationService>()
            .AddSingleton<IHostedService>(sp => sp.GetRequiredService<SerialNmeaLocationProvider>())
            .BuildServiceProvider();

        var provider = services.GetRequiredService<SerialNmeaLocationProvider>();
        var hosted = services.GetServices<IHostedService>().Single(service => service is SerialNmeaLocationProvider);
        var locationService = services.GetRequiredService<ISerialNmeaLocationService>();

        Assert.Same(provider, hosted);
        await ((IHostedService)hosted).StartAsync(CancellationToken.None);
        await Eventually(() => reader.OpenCount == 1);
        Assert.Equal(LocationStatus.NoFix, (await locationService.AcquireAsync(CancellationToken.None)).Status);

        reader.Enqueue(Gga);
        reader.Enqueue(Rmc);
        await Eventually(async () => (await locationService.AcquireAsync(CancellationToken.None)).Status == LocationStatus.Available);
        var observations = await Task.WhenAll(
            locationService.AcquireAsync(CancellationToken.None),
            locationService.AcquireAsync(CancellationToken.None));

        Assert.All(observations, observation => Assert.Equal(LocationStatus.Available, observation.Status));
        Assert.Equal(1, reader.OpenCount);
        await ((IHostedService)hosted).StopAsync(CancellationToken.None);
        Assert.True(reader.Disposed);
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 100 && !condition(); attempt++) await Task.Delay(5);
        Assert.True(condition());
    }

    private static async Task Eventually(Func<Task<bool>> condition)
    {
        for (var attempt = 0; attempt < 100 && !await condition(); attempt++) await Task.Delay(5);
        Assert.True(await condition());
    }

    private sealed class Reader : INmeaSerialReader
    {
        private readonly Queue<string> lines = new();
        private readonly SemaphoreSlim signal = new(0);
        private int openCount;

        public int OpenCount => Volatile.Read(ref openCount);
        public bool Disposed { get; private set; }

        public void Open() => Interlocked.Increment(ref openCount);

        public void Enqueue(string line)
        {
            lock (lines) lines.Enqueue(line);
            signal.Release();
        }

        public async Task<string?> ReadLineAsync(CancellationToken cancellationToken)
        {
            await signal.WaitAsync(cancellationToken);
            lock (lines) return lines.Dequeue();
        }

        public void Dispose() => Disposed = true;
    }
}
