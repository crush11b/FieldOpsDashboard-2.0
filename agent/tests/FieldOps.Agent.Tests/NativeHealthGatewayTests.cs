using System.Buffers.Binary;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using FieldOps.Agent.Health;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Tests;

[Collection("Native health fixed pipe")]
public sealed class NativeHealthGatewayTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task FixedPipeReturnsOnlySanitizedHealth()
    {
        var snapshot = CreateSnapshot();
        var server = CreateServer(new StaticSnapshotProvider(snapshot));
        var serveTask = server.ServeOnceAsync(CancellationToken.None);
        var response = await new NativeHealthClient(
            NativeHealthProtocol.PipeName,
            TestTimeout).ReadAsync(CancellationToken.None);

        Assert.Equal(NativeHealthServeResult.Completed, await serveTask);
        Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        Assert.Equal(snapshot, response.Health);
    }

    [Fact]
    public async Task ProviderFailureReturnsUnavailableWithoutDetails()
    {
        var server = CreateServer(new ThrowingSnapshotProvider());
        var serveTask = server.ServeOnceAsync(CancellationToken.None);
        var response = await new NativeHealthClient(
            NativeHealthProtocol.PipeName,
            TestTimeout).ReadAsync(CancellationToken.None);

        Assert.Equal(NativeHealthServeResult.Completed, await serveTask);
        Assert.Equal(NativeHealthResultCode.Unavailable, response.Result);
        Assert.Null(response.Health);
    }

    [Theory]
    [InlineData(0, NativeHealthRequestType.ReadHealth, NativeHealthResultCode.UnsupportedVersion)]
    [InlineData(NativeHealthProtocol.Version, (NativeHealthRequestType)999, NativeHealthResultCode.UnsupportedRequest)]
    public async Task UnsupportedRequestsFailClosed(
        int version,
        NativeHealthRequestType requestType,
        NativeHealthResultCode expectedResult)
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        var request = new NativeHealthRequest(version, Guid.NewGuid(), requestType);
        var serveTask = server.ServeOnceAsync(CancellationToken.None);
        var response = await ExchangeAsync(request, CancellationToken.None);

        Assert.Equal(NativeHealthServeResult.Completed, await serveTask);
        Assert.Equal(expectedResult, response.Result);
        Assert.Null(response.Health);
    }

    [Fact]
    public async Task EmptyCorrelationFailsClosed()
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        var request = new NativeHealthRequest(
            NativeHealthProtocol.Version,
            Guid.Empty,
            NativeHealthRequestType.ReadHealth);
        var serveTask = server.ServeOnceAsync(CancellationToken.None);
        var response = await ExchangeAsync(request, CancellationToken.None);

        Assert.Equal(NativeHealthServeResult.Completed, await serveTask);
        Assert.Equal(NativeHealthResultCode.InvalidRequest, response.Result);
        Assert.Null(response.Health);
    }

    [Theory]
    [InlineData(0, null)]
    [InlineData(NativeHealthProtocol.MaximumMessageBytes + 1, null)]
    [InlineData(1, "{")]
    public async Task InvalidFramesAreRejected(int length, string? payloadText)
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        var serveTask = server.ServeOnceAsync(CancellationToken.None);
        await using var client = await ConnectRawClientAsync(CancellationToken.None);
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(header, length);
        await client.WriteAsync(header, CancellationToken.None);
        if (payloadText is not null)
        {
            await client.WriteAsync(Encoding.UTF8.GetBytes(payloadText), CancellationToken.None);
        }

        await client.FlushAsync(CancellationToken.None);
        await Assert.ThrowsAsync<InvalidDataException>(() => serveTask);
    }

    [Fact]
    public async Task ConcurrentServeAttemptIsRejectedWithoutOpeningAnotherInstance()
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        var first = server.ServeOnceAsync(CancellationToken.None);
        var second = await server.ServeOnceAsync(CancellationToken.None);
        var response = await new NativeHealthClient(
            NativeHealthProtocol.PipeName,
            TestTimeout).ReadAsync(CancellationToken.None);

        Assert.Equal(NativeHealthServeResult.OperationInProgress, second);
        Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        Assert.Equal(NativeHealthServeResult.Completed, await first);
    }

    [Fact]
    public async Task SquattedFixedPipeNameFailsFirstInstanceSafely()
    {
        await using var squatter = new NamedPipeServerStream(
            NativeHealthProtocol.PipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous);
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));

        await Assert.ThrowsAsync<IOException>(
            () => server.ServeOnceAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ClientRejectsMismatchedResponseCorrelation()
    {
        var fakeServer = Task.Run(async () =>
        {
            await using var server = new NamedPipeServerStream(
                NativeHealthProtocol.PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance);
            await server.WaitForConnectionAsync(CancellationToken.None);
            _ = await NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
                server,
                CancellationToken.None);
            await NativeHealthMessageFraming.WriteAsync(
                server,
                new NativeHealthResponse(
                    NativeHealthProtocol.Version,
                    Guid.NewGuid(),
                    NativeHealthResultCode.Ok,
                    CreateSnapshot()),
                CancellationToken.None);
        });

        await Assert.ThrowsAsync<InvalidDataException>(
            () => new NativeHealthClient(
                NativeHealthProtocol.PipeName,
                TestTimeout).ReadAsync(CancellationToken.None));
        await fakeServer;
    }

    [Fact]
    public async Task ClientTimesOutWhenServerDoesNotRespond()
    {
        var fakeServer = Task.Run(async () =>
        {
            await using var server = new NamedPipeServerStream(
                NativeHealthProtocol.PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance);
            await server.WaitForConnectionAsync(CancellationToken.None);
            await Task.Delay(TimeSpan.FromMilliseconds(300));
        });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => new NativeHealthClient(
                NativeHealthProtocol.PipeName,
                TimeSpan.FromMilliseconds(50)).ReadAsync(CancellationToken.None));
        await fakeServer;
    }

    private static NativeHealthGatewayServer CreateServer(INativeHealthSnapshotProvider provider)
    {
        var currentSid = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("The current Windows identity does not have a SID.");
        return new(
            new NativeHealthAuthorizationPolicy(currentSid),
            provider,
            TestTimeout);
    }

    private static async Task<NativeHealthResponse> ExchangeAsync(
        NativeHealthRequest request,
        CancellationToken cancellationToken)
    {
        await using var client = await ConnectRawClientAsync(cancellationToken);
        await NativeHealthMessageFraming.WriteAsync(client, request, cancellationToken);
        return await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(client, cancellationToken);
    }

    private static async Task<NamedPipeClientStream> ConnectRawClientAsync(CancellationToken cancellationToken)
    {
        var client = new NamedPipeClientStream(
            ".",
            NativeHealthProtocol.PipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        await client.ConnectAsync(cancellationToken);
        return client;
    }

    private static NativeHealthSnapshot CreateSnapshot() => new(
        Status: "ok",
        Service: "FieldOpsAgent",
        Version: "test-version",
        StartedAt: DateTimeOffset.Parse("2026-07-29T10:00:00Z"),
        CheckedAt: DateTimeOffset.Parse("2026-07-29T10:01:00Z"),
        UptimeSeconds: 60);

    private sealed class StaticSnapshotProvider(NativeHealthSnapshot snapshot)
        : INativeHealthSnapshotProvider
    {
        public ValueTask<NativeHealthSnapshot?> ReadAsync(CancellationToken cancellationToken) =>
            ValueTask.FromResult<NativeHealthSnapshot?>(snapshot);
    }

    private sealed class ThrowingSnapshotProvider : INativeHealthSnapshotProvider
    {
        public ValueTask<NativeHealthSnapshot?> ReadAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("sensitive provider detail");
    }
}

[CollectionDefinition("Native health fixed pipe", DisableParallelization = true)]
public sealed class NativeHealthFixedPipeCollection;
