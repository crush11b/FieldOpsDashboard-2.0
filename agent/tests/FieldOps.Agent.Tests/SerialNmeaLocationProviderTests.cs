using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class SerialNmeaLocationProviderTests
{
    private const string Gga = "$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,";
    private const string Rmc = "$GPRMC,123519.00,A,4807.038,N,01131.000,E,000.0,000.0,230394,,,A";

    [Fact]
    public async Task MergesGgaAndRmcAndDisposesTransport()
    {
        var fake = new FakeReader(Gga, Rmc); var provider = Provider(fake);
        var result = await provider.GetLocationAsync(CancellationToken.None);
        Assert.Equal(LocationStatus.Available, result.Status); Assert.Equal(545.4, result.Altitude); Assert.Equal(8, result.Satellites); Assert.Equal(0, result.Speed); Assert.Equal(0, result.Heading); Assert.Equal("SerialNmea", result.Source); Assert.NotNull(result.TimestampUtc); Assert.True(fake.Disposed);
    }

    [Fact] public async Task GgaOnlyReturnsFixWithoutFabricatedTimestamp() { var result = await Provider(new FakeReader(Gga)).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.Available, result.Status); Assert.Null(result.TimestampUtc); }
    [Fact] public async Task RmcOnlyReturnsTimestamp() { var result = await Provider(new FakeReader(Rmc)).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.Available, result.Status); Assert.NotNull(result.TimestampUtc); }
    [Fact] public async Task EmptyOrMalformedStreamReturnsNoFix() { var result = await Provider(new FakeReader("garbage", "$GPGGA,1,2,3")).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.NoFix, result.Status); }
    [Fact] public async Task PortFailureIsUnavailable() { var result = await Provider(new FakeReader(openError: new UnauthorizedAccessException())).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.Unavailable, result.Status); }
    [Fact] public async Task CancellationPropagates() { using var cts = new CancellationTokenSource(); var fake = new FakeReader(delay: true); cts.Cancel(); await Assert.ThrowsAsync<OperationCanceledException>(() => Provider(fake).GetLocationAsync(cts.Token)); Assert.True(fake.Disposed); }
    [Fact] public async Task LaterInvalidRmcMakesGgaCycleNoFix() { var r = await Provider(new FakeReader(Gga, "$GPRMC,123519.00,V,4807.038,N,01131.000,E,0,0,230394,,,A")).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.NoFix, r.Status); }
    [Fact] public async Task LaterInvalidGgaMakesRmcCycleNoFix() { var r = await Provider(new FakeReader(Rmc, Gga.Replace(",1,08,", ",0,08,"))).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.NoFix, r.Status); }
    [Fact] public async Task InvalidThenValidProducesAvailable() { var r = await Provider(new FakeReader("$GPRMC,123519.00,V,4807.038,N,01131.000,E,0,0,230394,,,A", Gga)).GetLocationAsync(CancellationToken.None); Assert.Equal(LocationStatus.Available, r.Status); }

    private static SerialNmeaLocationProvider Provider(FakeReader fake) => new(NullLogger<SerialNmeaLocationProvider>.Instance, "COM6", 9600, TimeSpan.FromMilliseconds(80), () => fake);

    private sealed class FakeReader(params string[] lines) : INmeaSerialReader
    {
        private readonly Queue<string> values = new(lines); private readonly Exception? openError; private readonly bool delay; public bool Disposed { get; private set; }
        public FakeReader(Exception openError) : this(Array.Empty<string>()) => this.openError = openError;
        public FakeReader(bool delay) : this(Array.Empty<string>()) => this.delay = delay;
        public void Open() { if (openError is not null) throw openError; }
        public async Task<string?> ReadLineAsync(CancellationToken token) { if (delay) await Task.Delay(Timeout.Infinite, token); await Task.Yield(); return values.Count > 0 ? values.Dequeue() : null; }
        public void Dispose() => Disposed = true;
    }
}
