using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SerialNmeaLocationProviderTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    private const string Gns = "$GNGNS,123519.00,4807.038,N,01131.000,E,AA,08,0.9,545.4, M,0.0";
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
    [Fact] public async Task GnsOnlyReturnsFixWithoutRequiringTrustedTime() { var result = await Run(new FakeReader(Gns)); Assert.Equal(LocationStatus.Available, result.Status); Assert.InRange(result.Latitude!.Value, 48.1172, 48.1174); Assert.InRange(result.Longitude!.Value, 11.5165, 11.5168); Assert.Null(result.TimestampUtc); }
    [Fact] public async Task IncoherentRmcDoesNotInvalidateValidGgaFix() { var result = await Run(new FakeReader(Gga, Rmc)); Assert.Equal(LocationStatus.Available, result.Status); Assert.InRange(result.Latitude!.Value, 48.1172, 48.1174); }
    [Fact] public async Task MalformedRmcTimeDoesNotInvalidateValidRmcPosition() { var provider = Provider(new FakeReader("$GPRMC,not-a-time,A,4807.038,N,01131.000,E,000.0,000.0,230394,,,A")); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetLocationAsync(CancellationToken.None)).Status == LocationStatus.Available); Assert.Equal(LocationStatus.Available, (await provider.GetLocationAsync(CancellationToken.None)).Status); Assert.Equal(NmeaTimeStatus.Malformed, (await provider.GetTimeEvidenceAsync(CancellationToken.None)).Status); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task RmcOnlyReturnsTimestamp() { var result = await Run(new FakeReader(Rmc)); Assert.Equal(LocationStatus.Available, result.Status); Assert.NotNull(result.TimestampUtc); }
    [Fact] public async Task RmcTimeIsAvailableEvenWithoutPositionFix() { var provider = Provider(new FakeReader("$GPRMC,123519.00,A,,,,,000.0,000.0,230394,,,A")); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).Status == NmeaTimeStatus.Available); var result = await provider.GetTimeEvidenceAsync(CancellationToken.None); Assert.Equal("1994-03-23T12:35:19.0000000+00:00", result.TimestampUtc?.ToString("O")); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task NewlyReceivedOldRmcIsNotTrustedAsCurrentTime() { var provider = Provider(new FakeReader(Rmc)); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).Status == NmeaTimeStatus.Available); var result = await provider.GetTimeEvidenceAsync(CancellationToken.None); Assert.False(result.TemporalCoherent); Assert.Contains("two sequential", result.RejectionReason); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task ReplayedAndBurstRmcTimestampsAreRejected() { var provider = Provider(new FakeReader(Rmc, Rmc, Rmc.Replace("123519", "123520"))); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).TimestampDeltaSeconds is not null); var result = await provider.GetTimeEvidenceAsync(CancellationToken.None); Assert.False(result.TemporalCoherent); Assert.NotNull(result.ReceiptElapsedSeconds); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task ReplayedRmcDoesNotInvalidateCurrentValidLocation() { var result = await Run(new FakeReader(Gga, Rmc, Rmc)); Assert.Equal(LocationStatus.Available, result.Status); Assert.InRange(result.Latitude!.Value, 48.1172, 48.1174); }
    [Fact] public async Task SequentialUtcObservationsWithMatchingReceiptIntervalsBecomeTrusted() { var provider = Provider(new FakeReader(50, Rmc, Rmc.Replace("123519.00", "123519.05"))); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).TimestampDeltaSeconds is not null); var result = await provider.GetTimeEvidenceAsync(CancellationToken.None); Assert.True(result.TemporalCoherent); Assert.Equal(0.05, result.TimestampDeltaSeconds); await provider.StopAsync(CancellationToken.None); }
    [Fact] public async Task SequentialOneHzRmcWithRealisticReceiptJitterRemainsTrusted() { var provider = Provider(new FakeReader(850, Rmc, Rmc.Replace("123519", "123520"))); await provider.StartAsync(CancellationToken.None); await Eventually(async () => (await provider.GetTimeEvidenceAsync(CancellationToken.None)).TimestampDeltaSeconds is not null, 500); var result = await provider.GetTimeEvidenceAsync(CancellationToken.None); Assert.True(result.TemporalCoherent); Assert.Equal(1, result.TimestampDeltaSeconds); Assert.InRange(result.ReceiptElapsedSeconds!.Value, 0.8, 1.1); await provider.StopAsync(CancellationToken.None); }
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
    [Fact]
    public async Task RestartCreatesFreshSerialAcquisitionSession()
    {
        var first = new FakeReader(Gga);
        var second = new FakeReader(Rmc);
        var readers = new Queue<INmeaSerialReader>(new INmeaSerialReader[] { first, second });
        var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(1), () => readers.Dequeue());

        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => first.OpenCount == 1);
        await Eventually(() => first.Consumed == first.Total);
        await provider.StopAsync(CancellationToken.None);

        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => second.OpenCount == 1);
        await Eventually(() => second.Consumed == second.Total);

        Assert.True(first.Disposed);
        Assert.Equal(LocationStatus.Available, (await provider.GetLocationAsync(CancellationToken.None)).Status);
        await provider.StopAsync(CancellationToken.None);
        Assert.True(second.Disposed);
    }

    [Fact]
    public async Task StopDisposesBlockedReaderAndIsSafeToRepeat()
    {
        var reader = new BlockingReader();
        var provider = Provider(reader);
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => reader.OpenCount == 1);

        await provider.StopAsync(CancellationToken.None);
        await provider.StopAsync(CancellationToken.None);

        Assert.True(reader.Disposed);
    }
    [Fact]
    public async Task ContinuousNmeaTrafficDoesNotTriggerWatchdogReconnect()
    {
        var reader = new FakeReader();
        var provider = Provider(reader, TimeSpan.FromMilliseconds(60));
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => reader.OpenCount == 1);

        for (var index = 0; index < 6; index++)
        {
            reader.Enqueue(Gga);
            await Task.Delay(20);
        }

        Assert.Equal(1, reader.OpenCount);
        Assert.False(reader.Disposed);
        await provider.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ContinuousNoFixTrafficDoesNotTriggerWatchdogReconnect()
    {
        var reader = new FakeReader();
        var provider = Provider(reader, TimeSpan.FromMilliseconds(60));
        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => reader.OpenCount == 1);

        for (var index = 0; index < 6; index++)
        {
            reader.Enqueue("$GPGGA,123519.00,4807.038,N,01131.000,E,0,00,99.9,545.4,M,46.9,M,,");
            await Task.Delay(20);
        }

        Assert.Equal(LocationStatus.NoFix, (await provider.GetLocationAsync(CancellationToken.None)).Status);
        Assert.Equal(1, reader.OpenCount);
        await provider.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task SilentSessionIsDisposedAndReopened()
    {
        var silent = new BlockingReader();
        var recovered = new FakeReader(Gga);
        var readers = new Queue<INmeaSerialReader>(new INmeaSerialReader[] { silent, recovered });
        var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(1), () => readers.Dequeue(), TimeSpan.FromMilliseconds(30));

        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => recovered.OpenCount == 1, 500);
        await Eventually(async () => (await provider.GetLocationAsync(CancellationToken.None)).Status == LocationStatus.Available);

        Assert.True(silent.Disposed);
        await provider.StopAsync(CancellationToken.None);
        Assert.True(recovered.Disposed);
    }

    [Fact]
    public async Task TrafficStoppingAfterAWorkingSessionStartsAReplacementSession()
    {
        var first = new FakeReader(Gga);
        var second = new FakeReader(Gga);
        var readers = new Queue<INmeaSerialReader>(new INmeaSerialReader[] { first, second });
        var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(1), () => readers.Dequeue(), TimeSpan.FromMilliseconds(30));

        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => first.OpenCount == 1);
        await Eventually(() => second.OpenCount == 1, 500);

        Assert.True(first.Disposed);
        await provider.StopAsync(CancellationToken.None);
        Assert.True(second.Disposed);
    }

    [Fact]
    public async Task ShutdownDuringSilentWatchdogPreventsReopen()
    {
        var silent = new BlockingReader();
        var readers = new Queue<INmeaSerialReader>(new INmeaSerialReader[] { silent });
        var provider = new SerialNmeaLocationProvider(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(1), () => readers.Dequeue(), TimeSpan.FromMilliseconds(30));

        await provider.StartAsync(CancellationToken.None);
        await Eventually(() => silent.OpenCount == 1);
        await provider.StopAsync(CancellationToken.None);

        Assert.True(silent.Disposed);
        Assert.Equal(1, silent.OpenCount);
    }
    [Fact] public async Task LaterInvalidRmcMakesGgaCycleNoFix() { var result = await Run(new FakeReader(Gga, "$GPRMC,123519.00,V,4807.038,N,01131.000,E,0,0,230394,,,A")); Assert.Equal(LocationStatus.NoFix, result.Status); }
    [Fact] public async Task LaterInvalidGgaMakesRmcCycleNoFix() { var result = await Run(new FakeReader(Rmc, Gga.Replace(",1,08,", ",0,08,"))); Assert.Equal(LocationStatus.NoFix, result.Status); }
    [Fact] public async Task InvalidThenValidProducesAvailable() { var result = await Run(new FakeReader("$GPRMC,123519.00,V,4807.038,N,01131.000,E,0,0,230394,,,A", Gga)); Assert.Equal(LocationStatus.Available, result.Status); }

    private static SerialNmeaLocationProvider Provider(INmeaSerialReader reader, TimeSpan? noDataTimeout = null) => new(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(80), () => reader, noDataTimeout);
    private static async Task<LocationObservation> Run(FakeReader fake)
    {
        var provider = Provider(fake); await provider.StartAsync(CancellationToken.None); await Eventually(() => fake.OpenCount == 1);
        await Eventually(() => fake.Consumed == fake.Total);
        var result = await provider.GetLocationAsync(CancellationToken.None); await provider.StopAsync(CancellationToken.None); return result;
    }
    private static async Task Eventually(Func<bool> condition) { for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(5); Assert.True(condition()); }
    private static async Task Eventually(Func<bool> condition, int attempts) { for (var i = 0; i < attempts && !condition(); i++) await Task.Delay(5); Assert.True(condition()); }
    private static async Task Eventually(Func<Task<bool>> condition, int attempts = 100) { for (var i = 0; i < attempts && !await condition(); i++) await Task.Delay(5); Assert.True(await condition()); }

    private sealed class FakeReader(params string[] lines) : INmeaSerialReader
    {
        private readonly Queue<string> values = new(lines); private readonly SemaphoreSlim signal = new(lines.Length); private readonly Exception? openError; private readonly int delayMs; private int consumed; public bool Disposed { get; private set; } public int OpenCount { get; private set; } public int Total { get; } = lines.Length; public int Consumed => Volatile.Read(ref consumed);
        public FakeReader(int delayMs, params string[] lines) : this(lines) => this.delayMs = delayMs;
        public FakeReader(Exception openError) : this(Array.Empty<string>()) => this.openError = openError;
        public void Open() { OpenCount++; if (openError is not null) throw openError; }
        public void Enqueue(string line) { lock (values) values.Enqueue(line); signal.Release(); }
        public async Task<string?> ReadLineAsync(CancellationToken token) { await signal.WaitAsync(token); if (delayMs > 0) await Task.Delay(delayMs, token); lock (values) { var line = values.Dequeue(); Interlocked.Increment(ref consumed); return line; } }
        public void Dispose() => Disposed = true;
    }

    private sealed class FaultingReader : INmeaSerialReader
    {
        public void Open() { }
        public Task<string?> ReadLineAsync(CancellationToken cancellationToken) => Task.FromException<string?>(new IOException("device removed"));
        public void Dispose() { }
    }

    private sealed class BlockingReader : INmeaSerialReader
    {
        private readonly TaskCompletionSource<string?> released = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Disposed { get; private set; }
        public int OpenCount { get; private set; }
        public void Open() => OpenCount++;
        public Task<string?> ReadLineAsync(CancellationToken cancellationToken) => released.Task;
        public void Dispose() { Disposed = true; released.TrySetResult(null); }
    }
}
