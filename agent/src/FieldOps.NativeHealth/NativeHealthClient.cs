using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;

namespace FieldOps.NativeHealth;

public sealed class NativeHealthClient
{
    private readonly string pipeName;
    private readonly TimeSpan operationTimeout;
    private readonly SecurityIdentifier trustedServerOwner;
    private readonly Func<Stream, NativeHealthAcknowledgement, CancellationToken, Task>
        writeAcknowledgement;

    public NativeHealthClient()
        : this(
            NativeHealthProtocol.PipeName,
            NativeHealthProtocol.ClientOperationTimeout,
            new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null))
    {
    }

    internal NativeHealthClient(
        string pipeName,
        TimeSpan operationTimeout,
        SecurityIdentifier trustedServerOwner,
        Func<Stream, NativeHealthAcknowledgement, CancellationToken, Task>? writeAcknowledgement = null)
    {
        this.pipeName = pipeName;
        this.operationTimeout = operationTimeout;
        this.trustedServerOwner = trustedServerOwner;
        this.writeAcknowledgement = writeAcknowledgement
            ?? ((stream, acknowledgement, token) => NativeHealthMessageFraming.WriteAsync(
                stream,
                acknowledgement,
                token));
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
        ValidateServerOwner(client);

        var correlationId = Guid.NewGuid();
        var request = new NativeHealthRequest(
            NativeHealthProtocol.Version,
            correlationId,
            NativeHealthRequestType.ReadHealth);
        await NativeHealthMessageFraming.WriteAsync(client, request, timeoutSource.Token);
        NativeHealthResponse response;
        try
        {
            response = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(
                client,
                timeoutSource.Token);
        }
        catch (InvalidDataException exception)
        {
            throw new NativeHealthResponseRejectedException(exception);
        }
        catch (EndOfStreamException exception)
        {
            throw new NativeHealthResponseRejectedException(exception);
        }

        if (response.ProtocolVersion != NativeHealthProtocol.Version)
        {
            throw new NativeHealthProtocolMismatchException();
        }

        if (response.CorrelationId == Guid.Empty || response.CorrelationId != correlationId)
        {
            throw new NativeHealthResponseRejectedException();
        }

        try
        {
            ValidateResponse(response);
        }
        catch (InvalidDataException exception)
        {
            throw new NativeHealthResponseRejectedException(exception);
        }

        await writeAcknowledgement(
            client,
            new NativeHealthAcknowledgement(NativeHealthProtocol.Version, correlationId),
            timeoutSource.Token);

        return response;
    }


    private void ValidateServerOwner(NamedPipeClientStream client)
    {
        var security = client.GetAccessControl();
        var owner = security.GetOwner(typeof(SecurityIdentifier)) as SecurityIdentifier;
        if (owner is null || owner != trustedServerOwner)
        {
            throw new UnauthorizedAccessException("Native health pipe server identity was not trusted.");
        }
    }

    private static void ValidateResponse(NativeHealthResponse response)
    {
        if (!Enum.IsDefined(response.Result))
        {
            throw new InvalidDataException("Native health response result was invalid.");
        }

        if (response.Result != NativeHealthResultCode.Ok)
        {
            if (response.Health is not null)
            {
                throw new InvalidDataException("Native health failure response contained health data.");
            }

            return;
        }

        var health = response.Health
            ?? throw new InvalidDataException("Native health success response did not contain health data.");
        if (string.IsNullOrWhiteSpace(health.Status)
            || string.IsNullOrWhiteSpace(health.Service)
            || string.IsNullOrWhiteSpace(health.Version)
            || health.UptimeSeconds < 0)
        {
            throw new InvalidDataException("Native health response fields were invalid.");
        }
    }
}

public sealed class NativeHealthProtocolMismatchException()
    : IOException("Native health response protocol version was invalid.");

public sealed class NativeHealthResponseRejectedException : IOException
{
    public NativeHealthResponseRejectedException()
        : base("Native health response was rejected.")
    {
    }

    public NativeHealthResponseRejectedException(Exception innerException)
        : base("Native health response was rejected.", innerException)
    {
    }
}
