using System.IO.Pipes;
using System.Security.AccessControl;
using FieldOps.Agent.Health;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Serial;

internal sealed record SerialInventoryRequest(string Command);
internal sealed class SerialInventoryPipeServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    ISerialPortEnumerator enumerator,
    ILogger<SerialInventoryPipeServer> logger,
    string pipeName = "FieldOps.SerialInventory.v1",
    TimeSpan? clientTimeout = null,
    TimeSpan? retryDelay = null,
    Func<PipeSecurity>? securityFactory = null)
{
    internal const string PipeName = "FieldOps.SerialInventory.v1";
    private readonly TimeSpan effectiveClientTimeout = clientTimeout ?? TimeSpan.FromSeconds(5);
    private readonly TimeSpan effectiveRetryDelay = retryDelay ?? TimeSpan.FromMilliseconds(250);
    internal async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = NamedPipeServerStreamAcl.Create(pipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Message, PipeOptions.Asynchronous, NativeHealthProtocol.MaximumMessageBytes, NativeHealthProtocol.MaximumMessageBytes, securityFactory?.Invoke() ?? authorizationPolicy.CreateSecurity());
                await pipe.WaitForConnectionAsync(cancellationToken);
                using var clientTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                clientTimeout.CancelAfter(effectiveClientTimeout);
                var request = await NativeHealthMessageFraming.ReadAsync<SerialInventoryRequest>(pipe, clientTimeout.Token);
                if (request.Command != "GetSerialPortInventory") throw new InvalidDataException("Unsupported serial inventory request.");
                await NativeHealthMessageFraming.WriteAsync(pipe, enumerator.Enumerate(clientTimeout.Token), clientTimeout.Token);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (OperationCanceledException) { logger.LogWarning("Serial inventory pipe client timed out."); if (!await DelayBeforeRetryAsync(cancellationToken)) break; }
            catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException) { logger.LogWarning("Serial inventory pipe request or ownership failed safely: {Message}", exception.Message); if (!await DelayBeforeRetryAsync(cancellationToken)) break; }
        }
    }

    private async Task<bool> DelayBeforeRetryAsync(CancellationToken cancellationToken)
    {
        try { await Task.Delay(effectiveRetryDelay, cancellationToken); return true; }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { return false; }
    }
}

internal sealed class SerialInventoryPipeService(SerialInventoryPipeServer server) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => server.RunAsync(stoppingToken);
}
