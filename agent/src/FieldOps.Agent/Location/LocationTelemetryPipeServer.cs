using System.IO.Pipes;
using System.Text.Json.Serialization;
using FieldOps.Agent.Health;
using FieldOps.Agent.Location;
using FieldOps.Agent.Clock;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Location;

internal sealed record LocationTelemetryRequest([property: JsonPropertyName("command")] string Command, [property: JsonPropertyName("confirmed")] bool Confirmed = false);
internal sealed class LocationTelemetryPipeServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    ISerialNmeaLocationService service,
    SerialNmeaLocationProvider provider,
    GpsClockSynchronizer synchronizer,
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
                using var operationTimeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken); operationTimeout.CancelAfter(OperationTimeout);
                var request = await NativeHealthMessageFraming.ReadAsync<LocationTelemetryRequest>(pipe, operationTimeout.Token);
                if (request.Command is not ("GetLocation" or "GetDiagnostics" or "GetGnssTime" or "GetClockStatus" or "SynchronizeClock")) throw new InvalidDataException("Unsupported location request.");
                object observation = request.Command switch
                {
                    "GetLocation" => await service.AcquireAsync(operationTimeout.Token),
                    "GetDiagnostics" => provider.GetDiagnostics(),
                    "GetGnssTime" => await service.AcquireTimeAsync(operationTimeout.Token),
                    "GetClockStatus" => await synchronizer.VerifyAsync(operationTimeout.Token),
                    _ => await synchronizer.SynchronizeAsync(request.Confirmed, operationTimeout.Token),
                };
                await NativeHealthMessageFraming.WriteAsync(pipe, observation, operationTimeout.Token);
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
