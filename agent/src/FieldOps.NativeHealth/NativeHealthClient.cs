using System.IO.Pipes;
using System.Security.Principal;

namespace FieldOps.NativeHealth;

public sealed class NativeHealthClient(
    string pipeName,
    TimeSpan operationTimeout)
{
    public NativeHealthClient()
        : this(NativeHealthProtocol.PipeName, TimeSpan.FromSeconds(5))
    {
    }

    public async Task<NativeHealthResponse> ReadAsync(CancellationToken cancellationToken = default)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(operationTimeout);

        await using var client = new NamedPipeClientStream(
            serverName: ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        await client.ConnectAsync(timeoutSource.Token);

        var correlationId = Guid.NewGuid();
        var request = new NativeHealthRequest(
            NativeHealthProtocol.Version,
            correlationId,
            NativeHealthRequestType.ReadHealth);
        await NativeHealthMessageFraming.WriteAsync(client, request, timeoutSource.Token);
        var response = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(
            client,
            timeoutSource.Token);

        if (response.ProtocolVersion != NativeHealthProtocol.Version)
        {
            throw new InvalidDataException("Native health response protocol version was invalid.");
        }

        if (response.CorrelationId == Guid.Empty || response.CorrelationId != correlationId)
        {
            throw new InvalidDataException("Native health response correlation did not match the request.");
        }

        return response;
    }
}
