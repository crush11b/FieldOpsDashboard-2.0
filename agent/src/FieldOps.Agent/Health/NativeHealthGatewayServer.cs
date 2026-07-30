using System.IO.Pipes;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Health;

internal sealed class NativeHealthPipeOwnershipException : IOException
{
    public NativeHealthPipeOwnershipException(Exception innerException)
        : base("The fixed native health pipe could not be exclusively created.", innerException)
    {
    }
}

internal sealed class NativeHealthPipeRecoveryException : IOException
{
    public NativeHealthPipeRecoveryException(Exception innerException)
        : base("The native health pipe could not be recycled safely.", innerException)
    {
    }
}

internal sealed class NativeHealthGatewayServer(
    NativeHealthAuthorizationPolicy authorizationPolicy,
    INativeHealthSnapshotProvider snapshotProvider,
    TimeSpan operationTimeout,
    ILogger<NativeHealthGatewayServer> logger,
    string pipeName = NativeHealthProtocol.PipeName)
{
    private readonly SemaphoreSlim operationGate = new(1, 1);

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        await operationGate.WaitAsync(cancellationToken);
        try
        {
            var ownershipLogged = false;

            while (!cancellationToken.IsCancellationRequested)
            {
                var server = CreateServer();
                try
                {
                    if (!ownershipLogged)
                    {
                        logger.LogInformation(
                            "Native read-only health gateway owns the fixed local pipe using protocol version {ProtocolVersion}",
                            NativeHealthProtocol.Version);
                        ownershipLogged = true;
                    }

                    await server.WaitForConnectionAsync(cancellationToken);
                    using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(
                        cancellationToken);
                    timeoutSource.CancelAfter(operationTimeout);
                    using var disposalRegistration = timeoutSource.Token.Register(
                        static state => DisposeWithoutThrowing((NamedPipeServerStream)state!),
                        server);
                    await ProcessConnectedClientAsync(server, timeoutSource.Token);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception exception) when (exception is IOException
                    or InvalidDataException
                    or UnauthorizedAccessException
                    or OperationCanceledException
                    or ObjectDisposedException)
                {
                    logger.LogWarning("Native health gateway request failed safely");
                }
                finally
                {
                    DisposeSafely(server);
                }
            }
        }
        finally
        {
            operationGate.Release();
        }
    }

    private NamedPipeServerStream CreateServer()
    {
        try
        {
            return NamedPipeServerStreamAcl.Create(
                pipeName,
                PipeDirection.InOut,
                maxNumberOfServerInstances: 1,
                PipeTransmissionMode.Message,
                PipeOptions.Asynchronous | PipeOptions.WriteThrough | PipeOptions.FirstPipeInstance,
                inBufferSize: NativeHealthProtocol.MaximumMessageBytes,
                outBufferSize: NativeHealthProtocol.MaximumMessageBytes,
                authorizationPolicy.CreateSecurity());
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            throw new NativeHealthPipeOwnershipException(exception);
        }
    }

    private static void DisposeSafely(NamedPipeServerStream server)
    {
        try
        {
            server.Dispose();
        }
        catch (Exception exception) when (exception is IOException
            or InvalidOperationException
            or ObjectDisposedException)
        {
            throw new NativeHealthPipeRecoveryException(exception);
        }
    }

    private static void DisposeWithoutThrowing(NamedPipeServerStream server)
    {
        try
        {
            server.Dispose();
        }
        catch (Exception exception) when (exception is IOException
            or InvalidOperationException
            or ObjectDisposedException)
        {
            // The loop's finally block retries disposal and reports a typed recovery failure if needed.
        }
    }

    internal async Task ProcessConnectedClientAsync(
        Stream server,
        CancellationToken cancellationToken)
    {
        var request = await NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
            server,
            cancellationToken);
        var response = await CreateResponseAsync(request, cancellationToken);
        await NativeHealthMessageFraming.WriteAsync(server, response, cancellationToken);
        var acknowledgement = await NativeHealthMessageFraming.ReadAsync<NativeHealthAcknowledgement>(
            server,
            cancellationToken);
        if (acknowledgement.ProtocolVersion != NativeHealthProtocol.Version
            || acknowledgement.CorrelationId == Guid.Empty
            || acknowledgement.CorrelationId != request.CorrelationId)
        {
            throw new InvalidDataException("Native health acknowledgement was invalid.");
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
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
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
