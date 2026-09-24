using System.IO.Pipes;
using System.Text.Json.Serialization;
using FieldOps.Agent.Health;
using FieldOps.Agent.Location;
using FieldOps.Agent.Clock;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Location;

internal sealed record LocationTelemetryRequest([property: JsonPropertyName("command")] string Command, [property: JsonPropertyName("confirmed")] bool Confirmed = false, [property: JsonPropertyName("port")] string? Port = null, [property: JsonPropertyName("baud")] int? Baud = null, [property: JsonPropertyName("providerType")] string? ProviderType = null, [property: JsonPropertyName("stableIdentity")] string? StableIdentity = null);
internal sealed class LocationTelemetryPipeServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    ISerialNmeaLocationService service,
    SerialNmeaLocationProvider provider,
    WindowsSensorLocationProvider windowsSensorProvider,
    LocationProviderSelection selection,
    GpsClockSynchronizer synchronizer,
    GnssRecoveryCoordinator recovery,
    ILogger<LocationTelemetryPipeServer> logger)
{
    internal const string PipeName = "FieldOps.LocationTelemetry.v1";
    private static readonly TimeSpan OperationTimeout = TimeSpan.FromSeconds(15);
    internal async Task RunAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Message, PipeOptions.Asynchronous, NativeHealthProtocol.MaximumMessageBytes, NativeHealthProtocol.MaximumMessageBytes, authorizationPolicy.CreateSecurity());
                await pipe.WaitForConnectionAsync(stoppingToken);
                using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); requestTimeout.CancelAfter(OperationTimeout);
                var request = await NativeHealthMessageFraming.ReadAsync<LocationTelemetryRequest>(pipe, requestTimeout.Token);
                if (request.Command is not ("GetLocation" or "GetDiagnostics" or "GetGnssTime" or "GetClockStatus" or "SynchronizeClock" or "RecoverGnss" or "ConfigureNmea" or "ConfigureProvider")) throw new InvalidDataException("Unsupported location request.");
                using var operationTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                operationTimeout.CancelAfter(request.Command == "RecoverGnss" ? TimeSpan.FromSeconds(45) : OperationTimeout);
                object observation = request.Command switch
                {
                    "GetLocation" => await AcquireSelectedLocationAsync(operationTimeout.Token),
                    "GetDiagnostics" => GetSelectedDiagnostics(),
                    "GetGnssTime" => await service.AcquireTimeAsync(operationTimeout.Token),
                    "GetClockStatus" => await synchronizer.VerifyAsync(operationTimeout.Token),
                    "SynchronizeClock" => await synchronizer.SynchronizeAsync(request.Confirmed, operationTimeout.Token),
                    "ConfigureNmea" => await ConfigureNmeaAsync(request, operationTimeout.Token),
                    "ConfigureProvider" => await ConfigureProviderAsync(request, operationTimeout.Token),
                    _ => await recovery.RecoverAsync(operationTimeout.Token),
                };
                await NativeHealthMessageFraming.WriteAsync(pipe, observation, operationTimeout.Token);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogInformation(ex, "Location telemetry pipe client failed."); }
        }
    }

    private async Task<LocationObservation> AcquireSelectedLocationAsync(CancellationToken cancellationToken)
        => selection.Get().ProviderType == LocationProviderType.WindowsSensor
            ? await windowsSensorProvider.GetLocationAsync(cancellationToken)
            : await service.AcquireAsync(cancellationToken);

    private GnssSerialDiagnostics GetSelectedDiagnostics()
    {
        var requested = selection.Get();
        var diagnostics = provider.GetDiagnostics();
        return requested.ProviderType == LocationProviderType.WindowsSensor
            ? diagnostics with { ProviderType = LocationProviderType.WindowsSensor, RequestedProviderType = requested.ProviderType, RequestedStableIdentity = requested.StableIdentity, ActiveStableIdentity = requested.StableIdentity, PortName = string.Empty, BaudRate = 0, DeviceName = "u-blox 7 GPS/GNSS Location Sensor - Windows Sensor", ProviderError = windowsSensorProvider.LastError }
            : diagnostics with { ProviderType = LocationProviderType.SerialNmea, RequestedProviderType = requested.ProviderType, RequestedStableIdentity = requested.StableIdentity, ActiveStableIdentity = diagnostics.DeviceInstanceId ?? diagnostics.InterfaceIdentity };
    }

    private async Task<GnssSerialDiagnostics> ConfigureProviderAsync(LocationTelemetryRequest request, CancellationToken cancellationToken)
    {
        var providerType = Enum.TryParse<LocationProviderType>(request.ProviderType, true, out var parsed) ? parsed : LocationProviderType.Automatic;
        var effectiveType = providerType == LocationProviderType.Automatic && string.Equals(request.StableIdentity, WindowsLocationProviderInventory.UbloxIdentity, StringComparison.OrdinalIgnoreCase)
            ? LocationProviderType.WindowsSensor
            : providerType == LocationProviderType.Automatic ? LocationProviderType.SerialNmea : providerType;
        var state = selection.Select(new(providerType, request.StableIdentity, request.Port, request.Baud));
        if (effectiveType == LocationProviderType.SerialNmea)
        {
            var diagnostics = await provider.ConfigureAsync(request.Port ?? state.PortName ?? "", request.Baud ?? state.BaudRate ?? 9600, cancellationToken);
            return diagnostics with { ProviderType = LocationProviderType.SerialNmea, RequestedProviderType = state.ProviderType, RequestedStableIdentity = state.StableIdentity, ActiveStableIdentity = diagnostics.InterfaceIdentity ?? diagnostics.DeviceInstanceId };
        }
        return provider.GetDiagnostics() with { ProviderType = LocationProviderType.WindowsSensor, RequestedProviderType = state.ProviderType, RequestedStableIdentity = state.StableIdentity, ActiveStableIdentity = state.StableIdentity, PortName = string.Empty, BaudRate = 0, DeviceName = "u-blox 7 GPS/GNSS Location Sensor - Windows Sensor", ProviderError = windowsSensorProvider.LastError };
    }

    private async Task<GnssSerialDiagnostics> ConfigureNmeaAsync(LocationTelemetryRequest request, CancellationToken cancellationToken)
    {
        var diagnostics = await provider.ConfigureAsync(request.Port ?? "", request.Baud ?? 0, cancellationToken);
        var identity = diagnostics.InterfaceIdentity ?? diagnostics.DeviceInstanceId;
        selection.Select(new(LocationProviderType.SerialNmea, identity, diagnostics.PortName, diagnostics.BaudRate));
        return diagnostics with { ProviderType = LocationProviderType.SerialNmea, RequestedProviderType = LocationProviderType.SerialNmea, ActiveStableIdentity = identity };
    }
}

internal sealed class LocationTelemetryPipeService(LocationTelemetryPipeServer server) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => server.RunAsync(stoppingToken);
}
