using Windows.Devices.Geolocation;
using FieldOps.NativeHealth;

namespace FieldOps.TrayPrototype.Location;

internal enum WindowsLocationPermission
{
    NotRequested,
    Allowed,
    Denied,
    Unspecified,
}

internal enum WindowsLocationPlatformStatus
{
    Ready,
    Disabled,
    Initializing,
    NoFix,
    Unavailable,
}

internal sealed record WindowsLocationReading(
    double Latitude,
    double Longitude,
    double? Altitude,
    double HorizontalAccuracy,
    double? Speed,
    double? Heading,
    DateTimeOffset TimestampUtc);

internal interface IWindowsLocationApi
{
    WindowsLocationPlatformStatus Status { get; }
    Task<WindowsLocationPermission> RequestPermissionAsync(CancellationToken cancellationToken);
    Task<WindowsLocationReading?> ReadAsync(CancellationToken cancellationToken);
}

internal sealed class WindowsLocationApi : IWindowsLocationApi
{
    private Geolocator? geolocator;

    private Geolocator Locator => geolocator ??= new Geolocator
    {
        DesiredAccuracy = PositionAccuracy.High,
    };

    public WindowsLocationPlatformStatus Status => Locator.LocationStatus switch
    {
        PositionStatus.Ready => WindowsLocationPlatformStatus.Ready,
        PositionStatus.Disabled => WindowsLocationPlatformStatus.Disabled,
        PositionStatus.Initializing => WindowsLocationPlatformStatus.Initializing,
        PositionStatus.NoData => WindowsLocationPlatformStatus.NoFix,
        _ => WindowsLocationPlatformStatus.Unavailable,
    };

    public async Task<WindowsLocationPermission> RequestPermissionAsync(
        CancellationToken cancellationToken)
    {
        var result = await Geolocator.RequestAccessAsync().AsTask(cancellationToken);
        return result switch
        {
            GeolocationAccessStatus.Allowed => WindowsLocationPermission.Allowed,
            GeolocationAccessStatus.Denied => WindowsLocationPermission.Denied,
            _ => WindowsLocationPermission.Unspecified,
        };
    }

    public async Task<WindowsLocationReading?> ReadAsync(CancellationToken cancellationToken)
    {
        var position = await Locator.GetGeopositionAsync().AsTask(cancellationToken);
        var coordinate = position.Coordinate;
        var point = coordinate.Point?.Position;
        if (point is null)
        {
            return null;
        }

        return new(
            point.Value.Latitude,
            point.Value.Longitude,
            coordinate.AltitudeAccuracy is null ? null : point.Value.Altitude,
            coordinate.Accuracy,
            coordinate.Speed,
            coordinate.Heading,
            coordinate.Timestamp.ToUniversalTime());
    }
}

internal sealed class WindowsLocationBroker(IWindowsLocationApi api)
{
    private WindowsLocationPermission permission = WindowsLocationPermission.NotRequested;

    public WindowsLocationPermission Permission => permission;

    public async Task<WindowsLocationPermission> RequestPermissionAsync(
        CancellationToken cancellationToken)
    {
        try
        {
            permission = await api.RequestPermissionAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (UnauthorizedAccessException)
        {
            permission = WindowsLocationPermission.Denied;
        }
        catch (Exception)
        {
            permission = WindowsLocationPermission.Unspecified;
        }

        return permission;
    }

    public async Task<LocationBrokerResponse> GetLocationAsync(CancellationToken cancellationToken)
    {
        if (api.Status == WindowsLocationPlatformStatus.Disabled)
        {
            return LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.Disabled);
        }

        if (permission != WindowsLocationPermission.Allowed)
        {
            return LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.PermissionDenied);
        }

        var status = api.Status switch
        {
            WindowsLocationPlatformStatus.Initializing => LocationBrokerStatus.Initializing,
            WindowsLocationPlatformStatus.NoFix => LocationBrokerStatus.NoFix,
            WindowsLocationPlatformStatus.Unavailable => LocationBrokerStatus.Unavailable,
            _ => LocationBrokerStatus.Available,
        };
        if (status != LocationBrokerStatus.Available)
        {
            return LocationBrokerResponse.WithoutTelemetry(status);
        }

        try
        {
            var reading = await api.ReadAsync(cancellationToken);
            return reading is null
                ? LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.NoFix)
                : new(
                    reading.Latitude,
                    reading.Longitude,
                    reading.Altitude,
                    reading.HorizontalAccuracy,
                    reading.Speed,
                    reading.Heading,
                    reading.TimestampUtc,
                    LocationBrokerStatus.Available);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (UnauthorizedAccessException)
        {
            permission = WindowsLocationPermission.Denied;
            return LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.PermissionDenied);
        }
        catch (Exception)
        {
            return LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.Error);
        }
    }
}
