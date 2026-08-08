using System.IO.Pipes;
using System.Text.Json.Serialization;
using FieldOps.Agent.Health;
using FieldOps.Agent.Location;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Location;

internal sealed record LocationTelemetryRequest([property: JsonPropertyName("command")] string Command);
internal sealed class LocationTelemetryPipeServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    ISerialNmeaLocationService service,
    ILogger<LocationTelemetryPipeServer> logger)
{
    internal const string PipeName = "FieldOps.LocationTelemetry.v1";
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan AcquisitionTimeout = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan ResponseTimeout = TimeSpan.FromSeconds(2);
    internal async Task RunAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Message, PipeOptions.Asynchronous, NativeHealthProtocol.MaximumMessageBytes, NativeHealthProtocol.MaximumMessageBytes, authorizationPolicy.CreateSecurity());
                await pipe.WaitForConnectionAsync(stoppingToken);
                using var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); requestTimeout.CancelAfter(RequestTimeout);
                var request = await NativeHealthMessageFraming.ReadAsync<LocationTelemetryRequest>(pipe, requestTimeout.Token);
                if (request.Command != "GetLocation") throw new InvalidDataException("Unsupported location request.");
                using var acquisitionTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); acquisitionTimeout.CancelAfter(AcquisitionTimeout);
                var observation = await service.AcquireAsync(acquisitionTimeout.Token);
                using var responseTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); responseTimeout.CancelAfter(ResponseTimeout);
                await NativeHealthMessageFraming.WriteAsync(pipe, observation, responseTimeout.Token);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogInformation(ex, "Location telemetry pipe client failed."); }
        }
    }
}

internal sealed class LocationTelemetryPipeService(LocationTelemetryPipeServer server) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => server.RunAsync(stoppingToken);
}
