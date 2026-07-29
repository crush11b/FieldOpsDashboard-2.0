using System.Buffers.Binary;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text.Json;

namespace FieldOps.TrayPrototype.PipeSpike;

public enum PipeCommandType
{
    AuthorizationProbe,
}

public sealed record PipeProbeRequest(PipeCommandType Command, Guid CorrelationId);

public sealed record PipeProbeResponse(Guid CorrelationId, bool Accepted, string Result);

public sealed class NamedPipeAuthorizationProbe(
    string pipeName,
    PipeAuthorizationPolicy authorizationPolicy,
    TimeSpan operationTimeout)
{
    public const int MaximumMessageBytes = 4096;

    private readonly SemaphoreSlim operationGate = new(1, 1);

    public async Task<PipeProbeResponse> ServeOnceAsync(CancellationToken cancellationToken)
    {
        if (!await operationGate.WaitAsync(0, cancellationToken))
        {
            return new(Guid.Empty, false, "operation_in_progress");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(operationTimeout);
            await using var server = NamedPipeServerStreamAcl.Create(
                pipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.WriteThrough | PipeOptions.FirstPipeInstance,
                inBufferSize: MaximumMessageBytes,
                outBufferSize: MaximumMessageBytes,
                authorizationPolicy.CreateSecurity());

            await server.WaitForConnectionAsync(timeout.Token);
            var request = await ReadMessageAsync<PipeProbeRequest>(server, timeout.Token);
            var response = request.CorrelationId == Guid.Empty
                ? new PipeProbeResponse(Guid.Empty, false, "invalid_correlation_id")
                : request.Command == PipeCommandType.AuthorizationProbe
                    ? new PipeProbeResponse(request.CorrelationId, true, "authorized")
                    : new PipeProbeResponse(request.CorrelationId, false, "unsupported_command");
            await WriteMessageAsync(server, response, timeout.Token);
            return response;
        }
        finally
        {
            operationGate.Release();
        }
    }

    public static async Task<PipeProbeResponse> CallAsync(
        string pipeName,
        Guid correlationId,
        TimeSpan timeout,
        CancellationToken cancellationToken) => await CallRequestAsync(
            pipeName,
            new PipeProbeRequest(PipeCommandType.AuthorizationProbe, correlationId),
            timeout,
            cancellationToken);

    internal static async Task<PipeProbeResponse> CallRequestAsync(
        string pipeName,
        PipeProbeRequest request,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(timeout);
        await using var client = new NamedPipeClientStream(
            serverName: ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        await client.ConnectAsync(timeoutSource.Token);
        await WriteMessageAsync(client, request, timeoutSource.Token);
        var response = await ReadMessageAsync<PipeProbeResponse>(client, timeoutSource.Token);
        if (response.CorrelationId != request.CorrelationId)
        {
            throw new InvalidDataException("Named Pipe response correlation did not match the request.");
        }

        return response;
    }

    private static async Task<T> ReadMessageAsync<T>(Stream stream, CancellationToken cancellationToken)
    {
        var lengthBuffer = new byte[sizeof(int)];
        await stream.ReadExactlyAsync(lengthBuffer, cancellationToken);
        var length = BinaryPrimitives.ReadInt32LittleEndian(lengthBuffer);
        if (length <= 0 || length > MaximumMessageBytes)
        {
            throw new InvalidDataException("Named Pipe message length is outside the allowed range.");
        }

        var payload = new byte[length];
        await stream.ReadExactlyAsync(payload, cancellationToken);
        return JsonSerializer.Deserialize<T>(payload)
            ?? throw new InvalidDataException("Named Pipe message was invalid.");
    }

    private static async Task WriteMessageAsync<T>(
        Stream stream,
        T message,
        CancellationToken cancellationToken)
    {
        var payload = JsonSerializer.SerializeToUtf8Bytes(message);
        if (payload.Length > MaximumMessageBytes)
        {
            throw new InvalidDataException("Named Pipe message exceeds the allowed size.");
        }

        var lengthBuffer = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(lengthBuffer, payload.Length);
        await stream.WriteAsync(lengthBuffer, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }
}
