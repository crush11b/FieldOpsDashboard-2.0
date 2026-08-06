using System.IO.Pipes;
using FieldOps.Agent.Health;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Serial;

internal sealed record SerialInventoryRequest(string Command);
internal sealed class SerialInventoryPipeServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    ISerialPortEnumerator enumerator,
    ILogger<SerialInventoryPipeServer> logger)
{
    internal const string PipeName = "FieldOps.SerialInventory.v1";
    internal async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Message, PipeOptions.Asynchronous, NativeHealthProtocol.MaximumMessageBytes, NativeHealthProtocol.MaximumMessageBytes, authorizationPolicy.CreateSecurity());
                await pipe.WaitForConnectionAsync(cancellationToken); var request = await NativeHealthMessageFraming.ReadAsync<SerialInventoryRequest>(pipe, cancellationToken); if (request.Command != "GetSerialPortInventory") throw new InvalidDataException("Unsupported serial inventory request."); await NativeHealthMessageFraming.WriteAsync(pipe, enumerator.Enumerate(cancellationToken), cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException) { logger.LogWarning("Serial inventory pipe request or ownership failed safely: {Message}", exception.Message); await Task.Delay(250, cancellationToken); }
        }
    }
}

internal sealed class SerialInventoryPipeService(SerialInventoryPipeServer server) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => server.RunAsync(stoppingToken);
}
