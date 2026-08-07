using FieldOps.Agent.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class WindowsSensorLocationProviderTests
{
    [Fact]
    public async Task SuccessfulProviderReturnsNativeReading()
    {
        var timestamp = new DateTimeOffset(2026, 8, 6, 12, 34, 56, TimeSpan.Zero);
        var client = new FakeWindowsLocationClient
        {
            Reading = new(37.5407, -77.4360, 52.4, 6.5, 1.25, 184.0, timestamp),
        };

        var result = await CreateProvider(client).GetLocationAsync(CancellationToken.None);

        Assert.Equal(LocationStatus.Available, result.Status);
        Assert.Equal(37.5407, result.Latitude);
        Assert.Equal(-77.4360, result.Longitude);
        Assert.Equal(52.4, result.Altitude);
        Assert.Equal(6.5, result.HorizontalAccuracy);
        Assert.Equal(1.25, result.Speed);
        Assert.Equal(184.0, result.Heading);
        Assert.Equal(timestamp, result.TimestampUtc);
    }

    [Fact]
    public async Task UnavailableProviderReturnsOnlyUnavailableStatus()
    {
        var result = await CreateProvider(new FakeWindowsLocationClient
        {
            State = WindowsLocationState.Unavailable,
        }).GetLocationAsync(CancellationToken.None);

        AssertEmpty(result, LocationStatus.Unavailable);
    }

    [Fact]
    public async Task PermissionDeniedReturnsOnlyPermissionStatus()
    {
        var result = await CreateProvider(new FakeWindowsLocationClient
        {
            GetReading = _ => throw new UnauthorizedAccessException(),
        }).GetLocationAsync(CancellationToken.None);

        AssertEmpty(result, LocationStatus.PermissionDenied);
    }

    [Fact]
    public async Task TimeoutReturnsNoFixWithoutFabricatedTelemetry()
    {
        var client = new FakeWindowsLocationClient
        {
            GetReading = cancellationToken => Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken)
                .ContinueWith<WindowsLocationReading?>(_ => null, cancellationToken),
        };

        var result = await CreateProvider(client, TimeSpan.FromMilliseconds(25))
            .GetLocationAsync(CancellationToken.None);

        AssertEmpty(result, LocationStatus.NoFix);
    }

    [Fact]
    public async Task NoFixReturnsNullTelemetry()
    {
        var result = await CreateProvider(new FakeWindowsLocationClient
        {
            State = WindowsLocationState.NoFix,
        }).GetLocationAsync(CancellationToken.None);

        AssertEmpty(result, LocationStatus.NoFix);
    }

    [Fact]
    public async Task CallerCancellationIsPropagated()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var client = new FakeWindowsLocationClient
        {
            GetReading = async cancellationToken =>
            {
                started.SetResult();
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                return null;
            },
        };
        using var cancellation = new CancellationTokenSource();
        var pending = CreateProvider(client).GetLocationAsync(cancellation.Token);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
    }

    [Fact]
    public async Task DisabledPlatformReturnsDisabledWithoutAcquiringReading()
    {
        var client = new FakeWindowsLocationClient { State = WindowsLocationState.Disabled };

        var result = await CreateProvider(client).GetLocationAsync(CancellationToken.None);

        AssertEmpty(result, LocationStatus.Disabled);
        Assert.False(client.ReadingRequested);
    }

    private static WindowsSensorLocationProvider CreateProvider(
        IWindowsLocationClient client,
        TimeSpan? timeout = null) =>
        new(client, NullLogger<WindowsSensorLocationProvider>.Instance, timeout);

    private static void AssertEmpty(LocationObservation observation, LocationStatus status)
    {
        Assert.Equal(status, observation.Status);
        Assert.Null(observation.Latitude);
        Assert.Null(observation.Longitude);
        Assert.Null(observation.Altitude);
        Assert.Null(observation.HorizontalAccuracy);
        Assert.Null(observation.Speed);
        Assert.Null(observation.Heading);
        Assert.Null(observation.TimestampUtc);
    }

    private sealed class FakeWindowsLocationClient : IWindowsLocationClient
    {
        public WindowsLocationState State { get; init; } = WindowsLocationState.Ready;
        public WindowsLocationReading? Reading { get; init; }
        public Func<CancellationToken, Task<WindowsLocationReading?>>? GetReading { get; init; }
        public bool ReadingRequested { get; private set; }

        public Task<WindowsLocationReading?> GetReadingAsync(CancellationToken cancellationToken)
        {
            ReadingRequested = true;
            return GetReading?.Invoke(cancellationToken) ?? Task.FromResult(Reading);
        }
    }
}
