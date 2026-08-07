using System.IO.Pipes;
using System.Security.Principal;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Location;

public sealed class WindowsSensorLocationProvider : ILocationProvider
{
    private readonly ILogger<WindowsSensorLocationProvider> logger;
    private readonly string pipeName;
    private readonly TimeSpan timeout;

    public WindowsSensorLocationProvider(ILogger<WindowsSensorLocationProvider> logger)
        : this(logger, LocationBrokerProtocol.PipeName, LocationBrokerProtocol.OperationTimeout)
    {
    }

    internal WindowsSensorLocationProvider(
        ILogger<WindowsSensorLocationProvider> logger,
        string pipeName,
        TimeSpan timeout)
    {
        this.logger = logger;
        this.pipeName = pipeName;
        this.timeout = timeout;
    }

    public async Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken)
    {
        var connected = false;
        try
        {
            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutSource.CancelAfter(timeout);
            await using var pipe = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.InOut,
                PipeOptions.Asynchronous,
                TokenImpersonationLevel.Identification);
            await pipe.ConnectAsync(timeoutSource.Token);
            connected = true;
            await NativeHealthMessageFraming.WriteAsync(
                pipe,
                new LocationBrokerRequest(LocationBrokerProtocol.GetLocationCommand),
                timeoutSource.Token);
            var response = await NativeHealthMessageFraming.ReadAsync<LocationBrokerResponse>(
                pipe,
                timeoutSource.Token);
            return Normalize(response);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            if (connected)
            {
                logger.LogWarning("Windows Sensor location request timed out.");
                return LocationObservation.WithoutTelemetry(LocationStatus.NoFix);
            }

            logger.LogWarning("Windows Sensor location provider unavailable.");
            return LocationObservation.WithoutTelemetry(LocationStatus.Unavailable);
        }
        catch (TimeoutException)
        {
            logger.LogWarning("Windows Sensor location request timed out.");
            return LocationObservation.WithoutTelemetry(LocationStatus.NoFix);
        }
        catch (Exception exception) when (exception is IOException
            or UnauthorizedAccessException
            or InvalidDataException)
        {
            logger.LogWarning("Windows Sensor location provider unavailable.");
            return LocationObservation.WithoutTelemetry(LocationStatus.Unavailable);
        }
        catch (Exception)
        {
            logger.LogError("Unexpected Windows Sensor location provider failure.");
            return LocationObservation.WithoutTelemetry(LocationStatus.Error);
        }
    }

    internal static LocationObservation Normalize(LocationBrokerResponse response)
    {
        var status = response.Status switch
        {
            LocationBrokerStatus.Available => LocationStatus.Available,
            LocationBrokerStatus.Disabled => LocationStatus.Disabled,
            LocationBrokerStatus.PermissionDenied => LocationStatus.PermissionDenied,
            LocationBrokerStatus.Initializing => LocationStatus.Initializing,
            LocationBrokerStatus.NoFix => LocationStatus.NoFix,
            LocationBrokerStatus.Unavailable => LocationStatus.Unavailable,
            _ => LocationStatus.Error,
        };

        if (status != LocationStatus.Available
            || response.Latitude is null
            || response.Longitude is null)
        {
            return LocationObservation.WithoutTelemetry(
                status == LocationStatus.Available ? LocationStatus.NoFix : status);
        }

        return new(
            response.Latitude,
            response.Longitude,
            response.Altitude,
            response.HorizontalAccuracy,
            response.Speed,
            response.Heading,
            response.TimestampUtc,
            status);
    }
}
