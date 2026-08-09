using System.IO.Pipes;
using System.Security.AccessControl;
using FieldOps.Agent.Health;
using FieldOps.NativeHealth;
using System.Text.Json.Serialization;

namespace FieldOps.Agent.Serial;

internal sealed record SerialInventoryRequest([property: JsonPropertyName("command")] string Command);
internal sealed record SerialInventoryWireResponse(
    [property: JsonPropertyName("observedAtUtc")] DateTimeOffset ObservedAtUtc,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("ports")] IReadOnlyList<SerialPortInfo> Ports,
    [property: JsonPropertyName("error")] string? Error);
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
                var inventory = enumerator.Enumerate(clientTimeout.Token);
                await NativeHealthMessageFraming.WriteAsync(pipe, new SerialInventoryWireResponse(inventory.ObservedAtUtc, inventory.Status.ToString(), inventory.Ports, inventory.Error), clientTimeout.Token);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (OperationCanceledException) { logger.LogWarning("Serial inventory pipe client timed out."); if (!await DelayBeforeRetryAsync(cancellationToken)) break; }
            catch (InvalidDataException exception) { logger.LogWarning("Serial inventory pipe rejected malformed or unsupported request: {Message}", exception.Message); if (!await DelayBeforeRetryAsync(cancellationToken)) break; }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { logger.LogWarning("Serial inventory pipe ownership or transport failure: {Message}", exception.Message); if (!await DelayBeforeRetryAsync(cancellationToken)) break; }
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
