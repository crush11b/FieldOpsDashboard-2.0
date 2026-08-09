using System.Diagnostics;
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
    Initializing,
    NoData,
    Disabled,
    NotInitialized,
    NotAvailable,
}

internal enum WindowsLocationAcquisitionStatus { NotAttempted, Available, NoFix, Failed }

internal sealed record WindowsLocationPermissionReport(
    WindowsLocationPermission Permission,
    WindowsLocationPlatformStatus PositionStatus,
    WindowsLocationAcquisitionStatus AcquisitionStatus,
    bool GeolocatorCreated,
    bool RequestFailed);

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
    bool GeolocatorCreated { get; }
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

    public bool GeolocatorCreated => geolocator is not null;

    public WindowsLocationPlatformStatus Status => Locator.LocationStatus switch
    {
        PositionStatus.Ready => WindowsLocationPlatformStatus.Ready,
        PositionStatus.Initializing => WindowsLocationPlatformStatus.Initializing,
        PositionStatus.NoData => WindowsLocationPlatformStatus.NoData,
        PositionStatus.Disabled => WindowsLocationPlatformStatus.Disabled,
        PositionStatus.NotInitialized => WindowsLocationPlatformStatus.NotInitialized,
        PositionStatus.NotAvailable => WindowsLocationPlatformStatus.NotAvailable,
        _ => throw new InvalidOperationException("Windows returned an unknown location position status."),
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

internal interface IWindowsLocationDiagnostics
{
    void PermissionRequestInvoked();
    void AccessStatusReturned(WindowsLocationPermission status);
    void PositionStatusObserved(WindowsLocationPlatformStatus status);
    void GeolocatorCreationObserved(bool created);
    void PermissionRequestFailed();
}

internal sealed class TraceWindowsLocationDiagnostics : IWindowsLocationDiagnostics
{
    public void PermissionRequestInvoked() =>
        Trace.TraceInformation("Windows location RequestAccessAsync invoked.");
    public void AccessStatusReturned(WindowsLocationPermission status) =>
        Trace.TraceInformation("Windows location access status returned: {0}.", status);
    public void PositionStatusObserved(WindowsLocationPlatformStatus status) =>
        Trace.TraceInformation("Windows location PositionStatus after access: {0}.", status);
    public void GeolocatorCreationObserved(bool created) =>
        Trace.TraceInformation("Windows location Geolocator instance created: {0}.", created);
    public void PermissionRequestFailed() =>
        Trace.TraceInformation("Windows location RequestAccessAsync failed safely.");
}

internal sealed class NullWindowsLocationDiagnostics : IWindowsLocationDiagnostics
{
    public static NullWindowsLocationDiagnostics Instance { get; } = new();
    public void PermissionRequestInvoked() { }
    public void AccessStatusReturned(WindowsLocationPermission status) { }
    public void PositionStatusObserved(WindowsLocationPlatformStatus status) { }
    public void GeolocatorCreationObserved(bool created) { }
    public void PermissionRequestFailed() { }
}

internal sealed class WindowsLocationBroker(
    IWindowsLocationApi api,
    IWindowsLocationDiagnostics? diagnostics = null)
{
    private WindowsLocationPermission permission = WindowsLocationPermission.NotRequested;
    private readonly IWindowsLocationDiagnostics diagnostics =
        diagnostics ?? NullWindowsLocationDiagnostics.Instance;

    public WindowsLocationPermission Permission => permission;

    public async Task<WindowsLocationPermissionReport> RequestPermissionAsync(
        CancellationToken cancellationToken)
    {
        diagnostics.PermissionRequestInvoked();
        try
        {
            permission = await api.RequestPermissionAsync(cancellationToken);
            diagnostics.AccessStatusReturned(permission);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            permission = WindowsLocationPermission.Unspecified;
            diagnostics.PermissionRequestFailed();
            return new(
                permission,
                WindowsLocationPlatformStatus.NotAvailable,
                WindowsLocationAcquisitionStatus.NotAttempted,
                api.GeolocatorCreated,
                RequestFailed: true);
        }

        WindowsLocationPlatformStatus positionStatus;
        try
        {
            positionStatus = api.Status;
        }
        catch (Exception)
        {
            diagnostics.PermissionRequestFailed();
            diagnostics.GeolocatorCreationObserved(api.GeolocatorCreated);
            return new(
                permission,
                WindowsLocationPlatformStatus.NotAvailable,
                WindowsLocationAcquisitionStatus.NotAttempted,
                api.GeolocatorCreated,
                RequestFailed: true);
        }
        diagnostics.PositionStatusObserved(positionStatus);
        diagnostics.GeolocatorCreationObserved(api.GeolocatorCreated);
        if (permission != WindowsLocationPermission.Allowed
            || positionStatus == WindowsLocationPlatformStatus.Disabled)
        {
            return new(
                permission,
                positionStatus,
                WindowsLocationAcquisitionStatus.NotAttempted,
                api.GeolocatorCreated,
                RequestFailed: false);
        }

        var acquisition = WindowsLocationAcquisitionStatus.NoFix;
        using var acquisitionTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        acquisitionTimeout.CancelAfter(LocationBrokerProtocol.OperationTimeout);
        try
        {
            acquisition = await api.ReadAsync(acquisitionTimeout.Token) is null
                ? WindowsLocationAcquisitionStatus.NoFix
                : WindowsLocationAcquisitionStatus.Available;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            acquisition = WindowsLocationAcquisitionStatus.Failed;
        }

        try
        {
            positionStatus = api.Status;
        }
        catch (Exception)
        {
            positionStatus = WindowsLocationPlatformStatus.NotAvailable;
        }
        diagnostics.PositionStatusObserved(positionStatus);
        diagnostics.GeolocatorCreationObserved(api.GeolocatorCreated);
        return new(
            permission,
            positionStatus,
            acquisition,
            api.GeolocatorCreated,
            RequestFailed: false);
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
            WindowsLocationPlatformStatus.NoData => LocationBrokerStatus.NoFix,
            WindowsLocationPlatformStatus.NotInitialized => LocationBrokerStatus.Initializing,
            WindowsLocationPlatformStatus.NotAvailable => LocationBrokerStatus.Unavailable,
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
