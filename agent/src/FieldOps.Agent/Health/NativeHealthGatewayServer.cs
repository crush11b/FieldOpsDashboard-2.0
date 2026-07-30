using System.IO.Pipes;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Health;

internal enum NativeHealthServeResult
{
    Completed,
    OperationInProgress,
}

internal sealed class NativeHealthGatewayServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    INativeHealthSnapshotProvider snapshotProvider,
    TimeSpan operationTimeout)
{
    private readonly SemaphoreSlim operationGate = new(1, 1);

    public async Task<NativeHealthServeResult> ServeOnceAsync(CancellationToken cancellationToken)
    {
        if (!await operationGate.WaitAsync(0, cancellationToken))
        {
            return NativeHealthServeResult.OperationInProgress;
        }

        try
        {
            using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutSource.CancelAfter(operationTimeout);

            await using var server = NamedPipeServerStreamAcl.Create(
                NativeHealthProtocol.PipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.WriteThrough | PipeOptions.FirstPipeInstance,
                inBufferSize: NativeHealthProtocol.MaximumMessageBytes,
                outBufferSize: NativeHealthProtocol.MaximumMessageBytes,
                authorizationPolicy.CreateSecurity());

            await server.WaitForConnectionAsync(timeoutSource.Token);
            var request = await NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
                server,
                timeoutSource.Token);
            var response = await CreateResponseAsync(request, timeoutSource.Token);
            await NativeHealthMessageFraming.WriteAsync(server, response, timeoutSource.Token);
            return NativeHealthServeResult.Completed;
        }
        finally
        {
            operationGate.Release();
        }
    }

    private async Task<NativeHealthResponse> CreateResponseAsync(
        NativeHealthRequest request,
        CancellationToken cancellationToken)
    {
        if (request.CorrelationId == Guid.Empty)
        {
            return CreateFailure(request, NativeHealthResultCode.InvalidRequest);
        }

        if (request.ProtocolVersion != NativeHealthProtocol.Version)
        {
            return CreateFailure(request, NativeHealthResultCode.UnsupportedVersion);
        }

        if (request.RequestType != NativeHealthRequestType.ReadHealth)
        {
            return CreateFailure(request, NativeHealthResultCode.UnsupportedRequest);
        }

        try
        {
            var health = await snapshotProvider.ReadAsync(cancellationToken);
            return health is null
                ? CreateFailure(request, NativeHealthResultCode.Unavailable)
                : new(
                    NativeHealthProtocol.Version,
                    request.CorrelationId,
                    NativeHealthResultCode.Ok,
                    health);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return CreateFailure(request, NativeHealthResultCode.Unavailable);
        }
        catch (Exception)
        {
            return CreateFailure(request, NativeHealthResultCode.Unavailable);
        }
    }

    private static NativeHealthResponse CreateFailure(
        NativeHealthRequest request,
        NativeHealthResultCode result) => new(
            NativeHealthProtocol.Version,
            request.CorrelationId,
            result,
            Health: null);
}
