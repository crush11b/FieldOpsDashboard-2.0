using FieldOps.NativeHealth;
using FieldOps.TrayPrototype.Location;

namespace FieldOps.TrayPrototype.Tests;

public sealed class WindowsLocationBrokerTests
{
    [Fact]
    public async Task PermissionNotYetRequestedIsDeniedWithoutCallingWindows()
    {
        var api = new FakeLocationApi();
        var result = await new WindowsLocationBroker(api).GetLocationAsync(CancellationToken.None);

        Assert.Equal(LocationBrokerStatus.PermissionDenied, result.Status);
        Assert.False(api.ReadCalled);
        AssertNullTelemetry(result);
    }

    [Fact]
    public async Task DisabledLocationTakesPrecedenceBeforePermissionRequest()
    {
        var api = new FakeLocationApi { Status = WindowsLocationPlatformStatus.Disabled };

        var result = await new WindowsLocationBroker(api).GetLocationAsync(CancellationToken.None);

        Assert.Equal(LocationBrokerStatus.Disabled, result.Status);
        Assert.False(api.ReadCalled);
        AssertNullTelemetry(result);
    }

    [Fact]
    public async Task AllowedPermissionEnablesReading()
    {
        var api = new FakeLocationApi { Permission = WindowsLocationPermission.Allowed };
        var broker = new WindowsLocationBroker(api);

        var report = await broker.RequestPermissionAsync(CancellationToken.None);

        Assert.Equal(WindowsLocationPermission.Allowed, report.Permission);
        Assert.Equal(WindowsLocationAcquisitionStatus.NoFix, report.AcquisitionStatus);
        Assert.Equal(WindowsLocationPermission.Allowed, broker.Permission);
    }

    [Theory]
    [InlineData((int)WindowsLocationPermission.Denied)]
    [InlineData((int)WindowsLocationPermission.Unspecified)]
    public async Task NonAllowedPermissionRemainsDenied(int permissionValue)
    {
        var permission = (WindowsLocationPermission)permissionValue;
        var broker = new WindowsLocationBroker(new FakeLocationApi { Permission = permission });
        await broker.RequestPermissionAsync(CancellationToken.None);

        var result = await broker.GetLocationAsync(CancellationToken.None);

        Assert.Equal(LocationBrokerStatus.PermissionDenied, result.Status);
        AssertNullTelemetry(result);
    }

    [Theory]
    [InlineData((int)WindowsLocationPlatformStatus.Disabled, LocationBrokerStatus.Disabled)]
    [InlineData((int)WindowsLocationPlatformStatus.Initializing, LocationBrokerStatus.Initializing)]
    [InlineData((int)WindowsLocationPlatformStatus.NoData, LocationBrokerStatus.NoFix)]
    [InlineData((int)WindowsLocationPlatformStatus.NotInitialized, LocationBrokerStatus.Initializing)]
    [InlineData((int)WindowsLocationPlatformStatus.NotAvailable, LocationBrokerStatus.Unavailable)]
    public async Task PlatformStateMapsHonestly(
        int platformStatusValue,
        LocationBrokerStatus expected)
    {
        var platformStatus = (WindowsLocationPlatformStatus)platformStatusValue;
        var api = new FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Status = platformStatus,
        };
        var broker = new WindowsLocationBroker(api);
        await broker.RequestPermissionAsync(CancellationToken.None);

        var result = await broker.GetLocationAsync(CancellationToken.None);

        Assert.Equal(expected, result.Status);
        AssertNullTelemetry(result);
    }

    [Fact]
    public async Task SuccessfulPositionPreservesHonestNullableFields()
    {
        var timestamp = new DateTimeOffset(2026, 8, 6, 20, 0, 0, TimeSpan.Zero);
        var api = new FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Reading = new(35.1, -80.2, null, 4.5, null, 90, timestamp),
        };
        var broker = new WindowsLocationBroker(api);
        await broker.RequestPermissionAsync(CancellationToken.None);

        var result = await broker.GetLocationAsync(CancellationToken.None);

        Assert.Equal(LocationBrokerStatus.Available, result.Status);
        Assert.Equal(35.1, result.Latitude);
        Assert.Equal(-80.2, result.Longitude);
        Assert.Null(result.Altitude);
        Assert.Equal(4.5, result.HorizontalAccuracy);
        Assert.Null(result.Speed);
        Assert.Equal(90, result.Heading);
        Assert.Equal(timestamp, result.TimestampUtc);
    }

    [Fact]
    public async Task NullPositionReturnsNoFix()
    {
        var api = new FakeLocationApi { Permission = WindowsLocationPermission.Allowed };
        var broker = new WindowsLocationBroker(api);
        await broker.RequestPermissionAsync(CancellationToken.None);

        var result = await broker.GetLocationAsync(CancellationToken.None);

        Assert.Equal(LocationBrokerStatus.NoFix, result.Status);
        AssertNullTelemetry(result);
    }

    [Fact]
    public async Task ReadCancellationIsPropagated()
    {
        var api = new FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Read = async token =>
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, token);
                return null;
            },
        };
        var broker = new WindowsLocationBroker(api);
        await broker.RequestPermissionAsync(CancellationToken.None);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(25));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => broker.GetLocationAsync(cancellation.Token));
    }

    private static void AssertNullTelemetry(LocationBrokerResponse result)
    {
        Assert.Null(result.Latitude);
        Assert.Null(result.Longitude);
        Assert.Null(result.Altitude);
        Assert.Null(result.HorizontalAccuracy);
        Assert.Null(result.Speed);
        Assert.Null(result.Heading);
        Assert.Null(result.TimestampUtc);
    }

    internal sealed class FakeLocationApi : IWindowsLocationApi
    {
        public bool GeolocatorCreated { get; init; } = true;
        public WindowsLocationPermission Permission { get; init; } = WindowsLocationPermission.Unspecified;
        public WindowsLocationPlatformStatus Status { get; init; } = WindowsLocationPlatformStatus.Ready;
        public WindowsLocationReading? Reading { get; init; }
        public Func<CancellationToken, Task<WindowsLocationPermission>>? Request { get; init; }
        public Func<CancellationToken, Task<WindowsLocationReading?>>? Read { get; init; }
        public bool ReadCalled { get; private set; }

        public Task<WindowsLocationPermission> RequestPermissionAsync(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Request?.Invoke(cancellationToken) ?? Task.FromResult(Permission);
        }

        public Task<WindowsLocationReading?> ReadAsync(CancellationToken cancellationToken)
        {
            ReadCalled = true;
            return Read?.Invoke(cancellationToken) ?? Task.FromResult(Reading);
        }
    }
}
