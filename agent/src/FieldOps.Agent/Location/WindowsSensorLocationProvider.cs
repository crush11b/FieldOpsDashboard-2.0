using System.Runtime.InteropServices;
using Windows.Devices.Geolocation;

namespace FieldOps.Agent.Location;

internal enum WindowsLocationState { Ready, Disabled, Initializing, NoFix, Unavailable }

internal sealed record WindowsLocationReading(
    double Latitude,
    double Longitude,
    double? Altitude,
    double HorizontalAccuracy,
    double? Speed,
    double? Heading,
    DateTimeOffset TimestampUtc);

internal interface IWindowsLocationClient
{
    WindowsLocationState State { get; }
    Task<WindowsLocationReading?> GetReadingAsync(CancellationToken cancellationToken);
}

internal sealed class WindowsLocationClient : IWindowsLocationClient
{
    private Geolocator? geolocator;

    private Geolocator Locator => geolocator ??= new Geolocator
    {
        DesiredAccuracy = PositionAccuracy.High,
    };

    public WindowsLocationState State => Locator.LocationStatus switch
    {
        PositionStatus.Ready => WindowsLocationState.Ready,
        PositionStatus.Disabled => WindowsLocationState.Disabled,
        PositionStatus.Initializing => WindowsLocationState.Initializing,
        PositionStatus.NoData => WindowsLocationState.NoFix,
        _ => WindowsLocationState.Unavailable,
    };

    public async Task<WindowsLocationReading?> GetReadingAsync(CancellationToken cancellationToken)
    {
        var position = await Locator.GetGeopositionAsync().AsTask(cancellationToken);
        var coordinate = position.Coordinate;
        var point = coordinate.Point?.Position;
        if (point is null)
        {
            return null;
        }

        return new WindowsLocationReading(
            point.Value.Latitude,
            point.Value.Longitude,
            coordinate.AltitudeAccuracy is null ? null : point.Value.Altitude,
            coordinate.Accuracy,
            coordinate.Speed,
            coordinate.Heading,
            coordinate.Timestamp.ToUniversalTime());
    }
}

public sealed class WindowsSensorLocationProvider : ILocationProvider
{
    internal static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(10);

    private readonly IWindowsLocationClient client;
    private readonly ILogger<WindowsSensorLocationProvider> logger;
    private readonly TimeSpan timeout;

    internal WindowsSensorLocationProvider(
        IWindowsLocationClient client,
        ILogger<WindowsSensorLocationProvider> logger,
        TimeSpan? timeout = null)
    {
        this.client = client;
        this.logger = logger;
        this.timeout = timeout ?? DefaultTimeout;
    }

    public async Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
    {
        if (!OperatingSystem.IsWindows())
        {
            logger.LogWarning("Windows Sensor location provider unavailable.");
            return LocationObservation.WithoutTelemetry(LocationStatus.Unavailable);
        }

        try
        {
            if (client.State == WindowsLocationState.Disabled)
            {
                return LocationObservation.WithoutTelemetry(LocationStatus.Disabled);
            }

            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutSource.CancelAfter(timeout);
            var stateResult = ObservationForState(client.State);
            if (stateResult is not null)
            {
                if (stateResult.Status == LocationStatus.Unavailable)
                {
                    logger.LogWarning("Windows Sensor location provider unavailable.");
                }

                return stateResult;
            }

            logger.LogInformation("Windows Sensor location provider initialized.");
            var reading = await client.GetReadingAsync(timeoutSource.Token);
            return reading is null
                ? LocationObservation.WithoutTelemetry(LocationStatus.NoFix)
                : new LocationObservation(
                    reading.Latitude,
                    reading.Longitude,
                    reading.Altitude,
                    reading.HorizontalAccuracy,
                    reading.Speed,
                    reading.Heading,
                    reading.TimestampUtc,
                    LocationStatus.Available);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Windows Sensor location request timed out.");
            return LocationObservation.WithoutTelemetry(LocationStatus.NoFix);
        }
        catch (UnauthorizedAccessException)
        {
            logger.LogWarning("Windows Sensor location permission denied.");
            return LocationObservation.WithoutTelemetry(LocationStatus.PermissionDenied);
        }
        catch (COMException exception) when ((uint)exception.HResult == 0x80070005)
        {
            logger.LogWarning("Windows Sensor location permission denied.");
            return LocationObservation.WithoutTelemetry(LocationStatus.PermissionDenied);
        }
        catch (COMException exception) when ((uint)exception.HResult == 0x800705B4)
        {
            logger.LogWarning("Windows Sensor location request timed out.");
            return LocationObservation.WithoutTelemetry(LocationStatus.NoFix);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception)
        {
            logger.LogError("Unexpected Windows Sensor location provider failure.");
            return LocationObservation.WithoutTelemetry(LocationStatus.Error);
        }
    }

    private static LocationObservation? ObservationForState(WindowsLocationState state) => state switch
    {
        WindowsLocationState.Ready => null,
        WindowsLocationState.Disabled => LocationObservation.WithoutTelemetry(LocationStatus.Disabled),
        WindowsLocationState.Initializing => LocationObservation.WithoutTelemetry(LocationStatus.Initializing),
        WindowsLocationState.NoFix => LocationObservation.WithoutTelemetry(LocationStatus.NoFix),
        _ => LocationObservation.WithoutTelemetry(LocationStatus.Unavailable),
    };
}
