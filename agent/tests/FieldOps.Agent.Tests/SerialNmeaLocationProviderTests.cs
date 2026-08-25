using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SerialNmeaLocationProviderTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    private const string Rmc = "$GPRMC,123519.00,A,4807.038,N,01131.000,E,000.0,000.0,230394,,,A";

    [Fact]
    public async Task PersistentSessionRemainsOpenAndTransitionsFromNoFixToAvailable()
    {
        var fake = new FakeReader("$GPGGA,123519.00,4807.038,N,01131.000,E,0,08,0.9,545.4,M,46.9,M,,");
        var provider = Provider(fake);
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => fake.OpenCount == 1);
        Assert.Equal(LocationStatus.NoFix, (await provider.GetLocationAsync(CancellationToken.None)).Status);
        fake.Enqueue(Gga); fake.Enqueue(Rmc);
        await Eventually(async () => (await provider.GetLocationAsync(CancellationToken.None)).Status == LocationStatus.Available);
        var result = await provider.GetLocationAsync(CancellationToken.None);
        Assert.Equal(545.4, result.Altitude); Assert.Equal(8, result.Satellites); Assert.Equal(0, result.Speed); Assert.Equal(0, result.Heading); Assert.NotNull(result.TimestampUtc);
        Assert.Equal(1, fake.OpenCount); Assert.False(fake.Disposed);
        await provider.StopAsync(CancellationToken.None);
        Assert.True(fake.Disposed);
    }

    [Fact] public async Task GgaOnlyReturnsFixWithoutFabricatedTimestamp() { var result = await Run(new FakeReader(Gga)); Assert.Equal(LocationStatus.Available, result.Status); Assert.Null(result.TimestampUtc); }
    [Fact] public async Task RmcOnlyReturnsTimestamp() { var result = await Run(new FakeReader(Rmc)); Assert.Equal(LocationStatus.Available, result.Status); Assert.NotNull(result.TimestampUtc); }
    [Fact] public async Task RmcTimeIsAvailableEvenWithoutPositionFix() { var provider = Provider(new FakeReader("$GPRMC,123519.00,A,,,,,000.0,000.0,230394,,,A")); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).Status == NmeaTimeStatus.Available); var result = await provider.GetTimeEvidenceAsync(CancellationToken.None); Assert.Equal("1994-03-23T12:35:19.0000000+00:00", result.TimestampUtc?.ToString("O")); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task MalformedRmcTimeIsReportedSeparately() { var provider = Provider(new FakeReader("$GPRMC,not-a-time,A,4807.038,N,01131.000,E,000.0,000.0,230394,,,A")); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).Status == NmeaTimeStatus.Malformed); Assert.Null((await provider.GetTimeEvidenceAsync(CancellationToken.None)).TimestampUtc); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task EmptyOrMalformedStreamReturnsNoFix() { var result = await Run(new FakeReader("garbage", "$GPGGA,1,2,3")); Assert.Equal(LocationStatus.NoFix, result.Status); }
    [Fact] public async Task PortFailureIsUnavailable() { var result = await Run(new FakeReader(openError: new UnauthorizedAccessException())); Assert.Equal(LocationStatus.Unavailable, result.Status); }
    [Fact]
    public async Task SerialFailureRetriesAndRecoversWithoutDashboardRequest()
    {
        var recovered = new FakeReader(Gga);
        var readers = new Queue<INmeaSerialReader>(new INmeaSerialReader[] { new FaultingReader(), recovered });
        var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(1), () => readers.Dequeue());
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => recovered.OpenCount == 1);
        await Eventually(async () => (await provider.GetLocationAsync(CancellationToken.None)).Status == LocationStatus.Available);
        await provider.StopAsync(CancellationToken.None);
        Assert.True(recovered.Disposed);
    }
    [Fact] public async Task LaterInvalidRmcMakesGgaCycleNoFix() { var result = await Run(new FakeReader(Gga, "$GPRMC,123519.00,V,4807.038,N,01131.000,E,0,0,230394,,,A")); Assert.Equal(LocationStatus.NoFix, result.Status); }
    [Fact] public async Task LaterInvalidGgaMakesRmcCycleNoFix() { var result = await Run(new FakeReader(Rmc, Gga.Replace(",1,08,", ",0,08,"))); Assert.Equal(LocationStatus.NoFix, result.Status); }
    [Fact] public async Task InvalidThenValidProducesAvailable() { var result = await Run(new FakeReader("$GPRMC,123519.00,V,4807.038,N,01131.000,E,0,0,230394,,,A", Gga)); Assert.Equal(LocationStatus.Available, result.Status); }

    private static SerialNmeaLocationProvider Provider(FakeReader fake) => new(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(80), () => fake);
    private static async Task<LocationObservation> Run(FakeReader fake)
    {
        var provider = Provider(fake); await provider.StartAsync(CancellationToken.None); await Eventually(() => fake.OpenCount == 1);
        await Eventually(() => fake.Consumed == fake.Total);
        var result = await provider.GetLocationAsync(CancellationToken.None); await provider.StopAsync(CancellationToken.None); return result;
    }
    private static async Task Eventually(Func<bool> condition) { for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(5); Assert.True(condition()); }
    private static async Task Eventually(Func<Task<bool>> condition) { for (var i = 0; i < 100 && !await condition(); i++) await Task.Delay(5); Assert.True(await condition()); }

    private sealed class FakeReader(params string[] lines) : INmeaSerialReader
    {
        private readonly Queue<string> values = new(lines); private readonly SemaphoreSlim signal = new(lines.Length); private readonly Exception? openError; private int consumed; public bool Disposed { get; private set; } public int OpenCount { get; private set; } public int Total { get; } = lines.Length; public int Consumed => Volatile.Read(ref consumed);
        public FakeReader(Exception openError) : this(Array.Empty<string>()) => this.openError = openError;
        public void Open() { OpenCount++; if (openError is not null) throw openError; }
        public void Enqueue(string line) { lock (values) values.Enqueue(line); signal.Release(); }
        public async Task<string?> ReadLineAsync(CancellationToken token) { await signal.WaitAsync(token); lock (values) { var line = values.Dequeue(); Interlocked.Increment(ref consumed); return line; } }
        public void Dispose() => Disposed = true;
    }

    private sealed class FaultingReader : INmeaSerialReader
    {
        public void Open() { }
        public Task<string?> ReadLineAsync(CancellationToken cancellationToken) => Task.FromException<string?>(new IOException("device removed"));
        public void Dispose() { }
    }
}
