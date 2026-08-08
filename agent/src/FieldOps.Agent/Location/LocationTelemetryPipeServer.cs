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
    internal async Task RunAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Message, PipeOptions.Asynchronous, NativeHealthProtocol.MaximumMessageBytes, NativeHealthProtocol.MaximumMessageBytes, authorizationPolicy.CreateSecurity());
                await pipe.WaitForConnectionAsync(stoppingToken);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); timeout.CancelAfter(TimeSpan.FromSeconds(5));
                var request = await NativeHealthMessageFraming.ReadAsync<LocationTelemetryRequest>(pipe, timeout.Token);
                if (request.Command != "GetLocation") throw new InvalidDataException("Unsupported location request.");
                await NativeHealthMessageFraming.WriteAsync(pipe, await service.AcquireAsync(timeout.Token), timeout.Token);
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
