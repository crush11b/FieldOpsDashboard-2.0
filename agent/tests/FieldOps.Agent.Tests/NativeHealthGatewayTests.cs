using System.Buffers.Binary;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using FieldOps.Agent.Health;
using FieldOps.NativeHealth;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Tests;

[Collection("Native health fixed pipe")]
public sealed class NativeHealthGatewayTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(5);
    private static readonly SecurityIdentifier CurrentSid = WindowsIdentity.GetCurrent().User
        ?? throw new InvalidOperationException("The current Windows identity does not have a SID.");
    private readonly string pipeName = $"{NativeHealthProtocol.PipeName}.{Guid.NewGuid():N}";

    [Fact]
    public async Task FixedPipeReturnsOnlySanitizedHealth()
    {
        var snapshot = CreateSnapshot();
        await WithRunningServerAsync(new StaticSnapshotProvider(snapshot), async () =>
        {
            var response = await CreateClient().ReadAsync();
            Assert.Equal(NativeHealthResultCode.Ok, response.Result);
            Assert.Equal(snapshot, response.Health);
        });
    }

    [Fact]
    public void ServerProcessingBoundLeavesClientRecoveryBudget()
    {
        Assert.True(
            NativeHealthProtocol.ServerClientProcessingTimeout
                < NativeHealthProtocol.ClientOperationTimeout);
    }

    [Fact]
    public async Task ProviderFailureReturnsUnavailableWithoutDetails()
    {
        await WithRunningServerAsync(new ThrowingSnapshotProvider(), async () =>
        {
            var response = await CreateClient().ReadAsync();
            Assert.Equal(NativeHealthResultCode.Unavailable, response.Result);
            Assert.Null(response.Health);
        });
    }

    [Theory]
    [InlineData(0, NativeHealthRequestType.ReadHealth, NativeHealthResultCode.UnsupportedVersion)]
    [InlineData(NativeHealthProtocol.Version, (NativeHealthRequestType)999, NativeHealthResultCode.UnsupportedRequest)]
    public async Task UnsupportedRequestsFailClosed(
        int version,
        NativeHealthRequestType requestType,
        NativeHealthResultCode expectedResult)
    {
        await WithRunningServerAsync(new StaticSnapshotProvider(CreateSnapshot()), async () =>
        {
            var response = await ExchangeAsync(new(version, Guid.NewGuid(), requestType));
            Assert.Equal(expectedResult, response.Result);
            Assert.Null(response.Health);
        });
    }

    [Fact]
    public async Task EmptyCorrelationFailsClosed()
    {
        await WithRunningServerAsync(new StaticSnapshotProvider(CreateSnapshot()), async () =>
        {
            var response = await ExchangeAsync(new(
                NativeHealthProtocol.Version,
                Guid.Empty,
                NativeHealthRequestType.ReadHealth));
            Assert.Equal(NativeHealthResultCode.InvalidRequest, response.Result);
            Assert.Null(response.Health);
        });
    }

    [Theory]
    [InlineData(0, null)]
    [InlineData(NativeHealthProtocol.MaximumMessageBytes + 1, null)]
    [InlineData(1, "{")]
    public async Task InvalidFramesDoNotTerminateTheListener(int length, string? payloadText)
    {
        await WithRunningServerAsync(new StaticSnapshotProvider(CreateSnapshot()), async () =>
        {
            await using (var client = await ConnectRawClientAsync())
            {
                var header = new byte[sizeof(int)];
                BinaryPrimitives.WriteInt32LittleEndian(header, length);
                await client.WriteAsync(header);
                if (payloadText is not null)
                {
                    await client.WriteAsync(Encoding.UTF8.GetBytes(payloadText));
                }

                await client.FlushAsync();
            }

            await Task.Delay(TimeSpan.FromMilliseconds(50));
            var response = await CreateClient().ReadAsync();
            Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        });
    }

    [Fact]
    public async Task IdleListenerOutlivesTheProcessingTimeoutAndStillServesARequest()
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()), TimeSpan.FromMilliseconds(50));
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = server.RunAsync(cancellation.Token);

        await Task.Delay(TimeSpan.FromMilliseconds(200), cancellation.Token);
        Assert.False(runTask.IsCompleted);
        var response = await CreateClient().ReadAsync(cancellation.Token);
        Assert.Equal(NativeHealthResultCode.Ok, response.Result);

        cancellation.Cancel();
        await runTask;
    }

    [Fact]
    public async Task AbandonedSixtyFourByteFrameImmediatelyAllowsAValidRequest()
    {
        var server = CreateServer(
            new StaticSnapshotProvider(CreateSnapshot()),
            NativeHealthProtocol.ServerClientProcessingTimeout);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var runTask = server.RunAsync(cancellation.Token);
        try
        {
            await using (var abandonedClient = await ConnectRawClientAsync())
            {
                var header = new byte[sizeof(int)];
                BinaryPrimitives.WriteInt32LittleEndian(header, 64);
                await abandonedClient.WriteAsync(header, cancellation.Token);
                await abandonedClient.WriteAsync(new byte[] { 1 }, cancellation.Token);
                await abandonedClient.FlushAsync(cancellation.Token);
            }

            var response = await CreateClient().ReadAsync(cancellation.Token);
            Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await runTask;
        }
    }

    [Fact]
    public Task DeclaredFrameWithNoPayloadImmediatelyAllowsAValidRequest() =>
        AssertImmediateRequestReadRecoveryAsync(async (client, cancellationToken) =>
        {
            var header = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(header, 64);
            await client.WriteAsync(header, cancellationToken);
            await client.FlushAsync(cancellationToken);
        });

    [Fact]
    public Task PartialLengthPrefixImmediatelyAllowsAValidRequest() =>
        AssertImmediateRequestReadRecoveryAsync(async (client, cancellationToken) =>
        {
            await client.WriteAsync(new byte[] { 64, 0 }, cancellationToken);
            await client.FlushAsync(cancellationToken);
        });

    [Fact]
    public async Task RepeatedTruncatedClientsImmediatelyAllowAValidRequest()
    {
        var server = CreateServer(
            new StaticSnapshotProvider(CreateSnapshot()),
            TimeSpan.FromMilliseconds(100));
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = server.RunAsync(cancellation.Token);
        try
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                await using (var client = await ConnectRawClientAsync())
                {
                    var header = new byte[sizeof(int)];
                    BinaryPrimitives.WriteInt32LittleEndian(header, 64);
                    await client.WriteAsync(header, cancellation.Token);
                    await client.WriteAsync(new byte[] { 1 }, cancellation.Token);
                    await client.FlushAsync(cancellation.Token);
                }
            }

            var response = await CreateClient().ReadAsync(cancellation.Token);
            Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await runTask.WaitAsync(TestTimeout);
        }
    }

    [Fact]
    public async Task ShutdownDuringAbandonedPartialRequestCompletesPromptly()
    {
        var server = CreateServer(
            new StaticSnapshotProvider(CreateSnapshot()),
            NativeHealthProtocol.ServerClientProcessingTimeout);
        using var cancellation = new CancellationTokenSource();
        var runTask = server.RunAsync(cancellation.Token);
        await using var client = await ConnectRawClientAsync();
        var header = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(header, 64);
        await client.WriteAsync(header);
        await client.WriteAsync(new byte[] { 1 });
        await client.FlushAsync();

        cancellation.Cancel();
        await runTask.WaitAsync(TestTimeout);
    }

    [Fact]
    public async Task ShutdownWhileWaitingForAConnectionCompletesPromptly()
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        using var cancellation = new CancellationTokenSource();
        var runTask = server.RunAsync(cancellation.Token);

        cancellation.Cancel();
        await runTask.WaitAsync(TestTimeout);
    }

    [Fact]
    public async Task StalledConnectedClientTimesOutWithoutTerminatingTheListener()
    {
        var server = CreateServer(
            new StaticSnapshotProvider(CreateSnapshot()),
            TimeSpan.FromMilliseconds(50));
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = server.RunAsync(cancellation.Token);

        await using (var stalledClient = await ConnectRawClientAsync())
        {
            await Task.Delay(TimeSpan.FromMilliseconds(150), cancellation.Token);
        }

        await Task.Delay(TimeSpan.FromMilliseconds(50), cancellation.Token);
        var response = await CreateClient().ReadAsync(cancellation.Token);
        Assert.Equal(NativeHealthResultCode.Ok, response.Result);

        cancellation.Cancel();
        await runTask;
    }

    [Fact]
    public Task ClientThatRemainsConnectedWithoutReadingResponseDoesNotBlockListener() =>
        AssertListenerRecoversAsync(async client =>
        {
            await WriteRequestAsync(client);
        });

    [Fact]
    public Task ClientThatClosesImmediatelyAfterRequestDoesNotBlockListener() =>
        AssertListenerRecoversAsync(async client =>
        {
            await WriteRequestAsync(client);
            await client.DisposeAsync();
        });

    [Fact]
    public Task ClientThatClosesAfterPartialResponseDoesNotBlockListener() =>
        AssertListenerRecoversAsync(async client =>
        {
            await WriteRequestAsync(client);
            var singleByte = new byte[1];
            await client.ReadExactlyAsync(singleByte);
            await client.DisposeAsync();
        });

    [Fact]
    public Task MissingAcknowledgementDoesNotBlockListener() =>
        AssertListenerRecoversAsync(async client =>
        {
            await WriteRequestAsync(client);
            _ = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(
                client,
                CancellationToken.None);
        });

    [Fact]
    public Task TruncatedAcknowledgementDoesNotBlockListener() =>
        AssertListenerRecoversAsync(async client =>
        {
            await WriteRequestAsync(client);
            _ = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(
                client,
                CancellationToken.None);
            var header = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(header, 100);
            await client.WriteAsync(header);
            await client.WriteAsync(new byte[] { 1 });
            await client.FlushAsync();
        });

    [Fact]
    public Task MismatchedAcknowledgementDoesNotBlockListener() =>
        AssertListenerRecoversAsync(async client =>
        {
            await WriteRequestAsync(client);
            _ = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(
                client,
                CancellationToken.None);
            await NativeHealthMessageFraming.WriteAsync(
                client,
                new NativeHealthAcknowledgement(NativeHealthProtocol.Version, Guid.NewGuid()),
                CancellationToken.None);
        });

    [Fact]
    public async Task ShutdownDuringAcknowledgementWaitCompletesPromptly()
    {
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = server.RunAsync(cancellation.Token);
        await using var client = await ConnectRawClientAsync();
        await WriteRequestAsync(client);
        _ = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(
            client,
            CancellationToken.None);

        cancellation.Cancel();
        await runTask.WaitAsync(TestTimeout);
    }

    [Fact]
    public async Task ShutdownDuringResponseWriteCancelsProductionProcessingPath()
    {
        var request = new NativeHealthRequest(
            NativeHealthProtocol.Version,
            Guid.NewGuid(),
            NativeHealthRequestType.ReadHealth);
        await using var stream = await BlockingWriteStream.CreateAsync(request);
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));
        using var cancellation = new CancellationTokenSource(TestTimeout);

        var processing = server.ProcessConnectedClientAsync(stream, cancellation.Token);
        await stream.WriteStarted.Task.WaitAsync(TestTimeout);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => processing);
    }

    [Fact]
    public async Task ListenerRetainsFirstPipeOwnershipAcrossRequests()
    {
        await WithRunningServerAsync(new StaticSnapshotProvider(CreateSnapshot()), async () =>
        {
            Assert.Equal(NativeHealthResultCode.Ok, (await CreateClient().ReadAsync()).Result);
            var ownershipFailure = Record.Exception(() => new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance));
            Assert.True(ownershipFailure is IOException or UnauthorizedAccessException);
            Assert.Equal(NativeHealthResultCode.Ok, (await CreateClient().ReadAsync()).Result);
        });
    }

    [Fact]
    public async Task SquattedFixedPipeNameProducesTypedOwnershipFailure()
    {
        await using var squatter = new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous);
        var server = CreateServer(new StaticSnapshotProvider(CreateSnapshot()));

        await Assert.ThrowsAsync<NativeHealthPipeOwnershipException>(
            () => server.RunAsync(CancellationToken.None));
    }

    [Fact]
    public async Task HostedGatewayReportsDistinctSanitizedOwnershipFailure()
    {
        await using var squatter = new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous);
        var logger = new CapturingLogger<NativeHealthGatewayService>();
        var service = new NativeHealthGatewayService(
            CreateServer(new StaticSnapshotProvider(CreateSnapshot())),
            logger);

        await service.StartAsync(CancellationToken.None);
        var entry = await logger.Entry.Task.WaitAsync(TestTimeout);
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(NativeHealthGatewayService.PipeOwnershipFailureEvent, entry.EventId);
        Assert.Contains("exclusive ownership", entry.Message, StringComparison.Ordinal);
        Assert.Null(entry.Exception);
    }

    [Fact]
    public void OwnershipRetryUsesCappedBackoffAndRateLimitedLogging()
    {
        Assert.Equal(TimeSpan.FromMilliseconds(250), NativeHealthGatewayService.GetRetryDelay(1));
        Assert.Equal(TimeSpan.FromSeconds(30), NativeHealthGatewayService.GetRetryDelay(8));
        Assert.Equal(TimeSpan.FromSeconds(30), NativeHealthGatewayService.GetRetryDelay(100));
        Assert.True(NativeHealthGatewayService.ShouldLogFailure(1));
        Assert.False(NativeHealthGatewayService.ShouldLogFailure(2));
        Assert.True(NativeHealthGatewayService.ShouldLogFailure(20));
    }

    [Fact]
    public async Task ClientRejectsUntrustedPipeOwnerBeforeSendingARequest()
    {
        var fakeServer = RunFakeServerAsync(request => CreateSnapshotResponse(request), CurrentSid);
        var untrustedOwner = new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(
            () => new NativeHealthClient(
                pipeName,
                TestTimeout,
                untrustedOwner).ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ClientRejectsMismatchedResponseCorrelation()
    {
        var fakeServer = RunFakeServerAsync(
            request => CreateSnapshotResponse(request with { CorrelationId = Guid.NewGuid() }),
            CurrentSid);

        await Assert.ThrowsAsync<NativeHealthResponseRejectedException>(() => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ClientReportsProtocolVersionMismatchWithTypedFailure()
    {
        var fakeServer = RunFakeServerAsync(
            request => CreateSnapshotResponse(request) with { ProtocolVersion = 999 },
            CurrentSid);

        await Assert.ThrowsAsync<NativeHealthProtocolMismatchException>(
            () => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Theory]
    [InlineData(999, true)]
    [InlineData((int)NativeHealthResultCode.Ok, false)]
    [InlineData((int)NativeHealthResultCode.Unavailable, true)]
    public async Task ClientRejectsInvalidResultAndPayloadCombinations(int result, bool includeHealth)
    {
        var fakeServer = RunFakeServerAsync(
            request => new(
                NativeHealthProtocol.Version,
                request.CorrelationId,
                (NativeHealthResultCode)result,
                includeHealth ? CreateSnapshot() : null),
            CurrentSid);

        await Assert.ThrowsAsync<NativeHealthResponseRejectedException>(() => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ClientRejectsInvalidHealthFields()
    {
        var invalid = CreateSnapshot() with { Service = "", UptimeSeconds = -1 };
        var fakeServer = RunFakeServerAsync(
            request => CreateSnapshotResponse(request, invalid),
            CurrentSid);

        await Assert.ThrowsAsync<NativeHealthResponseRejectedException>(() => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ClientRejectsPartialResponseLengthPrefix()
    {
        var fakeServer = RunRawResponseServerAsync(async (server, _) =>
        {
            await server.WriteAsync(new byte[] { 64, 0 });
            await server.FlushAsync();
        });

        await Assert.ThrowsAsync<NativeHealthResponseRejectedException>(() => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ClientRejectsTruncatedResponsePayload()
    {
        var fakeServer = RunRawResponseServerAsync(async (server, _) =>
        {
            var header = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(header, 64);
            await server.WriteAsync(header);
            await server.WriteAsync(new byte[] { 1 });
            await server.FlushAsync();
        });

        await Assert.ThrowsAsync<NativeHealthResponseRejectedException>(() => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ClientRejectsStructurallyInvalidResponseBeforeAcknowledgement()
    {
        var fakeServer = RunRawResponseServerAsync(async (server, request) =>
        {
            await NativeHealthMessageFraming.WriteAsync(
                server,
                CreateSnapshotResponse(request) with { Health = null },
                CancellationToken.None);
        });

        await Assert.ThrowsAsync<NativeHealthResponseRejectedException>(() => CreateClient().ReadAsync());
        await fakeServer;
    }

    [Fact]
    public async Task ValidResponseAcknowledgementFailureRemainsAnAvailabilityFailure()
    {
        var fakeServer = RunFakeServerAsync(
            request => CreateSnapshotResponse(request),
            CurrentSid);
        var client = new NativeHealthClient(
            pipeName,
            TestTimeout,
            CurrentSid,
            (_, _, _) => Task.FromException(new IOException("Acknowledgement failed.")));

        var exception = await Assert.ThrowsAnyAsync<IOException>(() => client.ReadAsync());
        Assert.IsNotType<NativeHealthResponseRejectedException>(exception);
        await fakeServer;
    }

    [Fact]
    public async Task ClientAcceptsBackwardWallClockAdjustmentWithNonnegativeUptime()
    {
        var adjusted = CreateSnapshot() with
        {
            StartedAt = DateTimeOffset.Parse("2026-07-29T10:02:00Z"),
            CheckedAt = DateTimeOffset.Parse("2026-07-29T10:01:00Z"),
            UptimeSeconds = 0,
        };
        var fakeServer = RunFakeServerAsync(
            request => CreateSnapshotResponse(request, adjusted),
            CurrentSid);

        var response = await CreateClient().ReadAsync();
        Assert.Equal(adjusted, response.Health);
        await fakeServer;
    }

    [Fact]
    public async Task ClientTimesOutWhenConnectedServerDoesNotRespond()
    {
        var fakeServer = RunFakeServerAsync(
            async (_, cancellationToken) =>
            {
                await Task.Delay(TimeSpan.FromMilliseconds(300), cancellationToken);
                return null;
            },
            CurrentSid,
            CancellationToken.None);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => new NativeHealthClient(
                pipeName,
                TimeSpan.FromMilliseconds(50),
                CurrentSid).ReadAsync());
        await fakeServer;
    }

    private async Task WithRunningServerAsync(
        INativeHealthSnapshotProvider provider,
        Func<Task> action)
    {
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = CreateServer(provider).RunAsync(cancellation.Token);
        try
        {
            await action();
        }
        finally
        {
            cancellation.Cancel();
            await runTask;
        }
    }

    private async Task AssertListenerRecoversAsync(Func<NamedPipeClientStream, Task> failureScenario)
    {
        var server = CreateServer(
            new StaticSnapshotProvider(CreateSnapshot()),
            TimeSpan.FromMilliseconds(100));
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = server.RunAsync(cancellation.Token);
        try
        {
            await using var failedClient = await ConnectRawClientAsync();
            await failureScenario(failedClient);

            var response = await CreateClient().ReadAsync(cancellation.Token);
            Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await runTask;
        }
    }

    private async Task AssertImmediateRequestReadRecoveryAsync(
        Func<NamedPipeClientStream, CancellationToken, Task> failureScenario)
    {
        var server = CreateServer(
            new StaticSnapshotProvider(CreateSnapshot()),
            TimeSpan.FromMilliseconds(100));
        using var cancellation = new CancellationTokenSource(TestTimeout);
        var runTask = server.RunAsync(cancellation.Token);
        try
        {
            await using (var failedClient = await ConnectRawClientAsync())
            {
                await failureScenario(failedClient, cancellation.Token);
            }

            var response = await CreateClient().ReadAsync(cancellation.Token);
            Assert.Equal(NativeHealthResultCode.Ok, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await runTask.WaitAsync(TestTimeout);
        }
    }

    private NativeHealthGatewayServer CreateServer(
        INativeHealthSnapshotProvider provider,
        TimeSpan? timeout = null) => new(
            new NativeHealthAuthorizationPolicy(CurrentSid, CurrentSid),
            provider,
            timeout ?? TestTimeout,
            NullLogger<NativeHealthGatewayServer>.Instance,
            pipeName);

    private NativeHealthClient CreateClient() => new(
        pipeName,
        TestTimeout,
        CurrentSid);

    private async Task<NativeHealthResponse> ExchangeAsync(NativeHealthRequest request)
    {
        await using var client = await ConnectRawClientAsync();
        await NativeHealthMessageFraming.WriteAsync(client, request, CancellationToken.None);
        var response = await NativeHealthMessageFraming.ReadAsync<NativeHealthResponse>(client, CancellationToken.None);
        await NativeHealthMessageFraming.WriteAsync(
            client,
            new NativeHealthAcknowledgement(NativeHealthProtocol.Version, request.CorrelationId),
            CancellationToken.None);
        return response;
    }

    private async Task<NamedPipeClientStream> ConnectRawClientAsync()
    {
        var client = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        using var cancellation = new CancellationTokenSource(TestTimeout);
        await client.ConnectAsync(cancellation.Token);
        return client;
    }

    private static async Task WriteRequestAsync(NamedPipeClientStream client)
    {
        await NativeHealthMessageFraming.WriteAsync(
            client,
            new NativeHealthRequest(
                NativeHealthProtocol.Version,
                Guid.NewGuid(),
                NativeHealthRequestType.ReadHealth),
            CancellationToken.None);
    }

    private Task RunFakeServerAsync(
        Func<NativeHealthRequest, NativeHealthResponse> responseFactory,
        SecurityIdentifier owner) => RunFakeServerAsync(
            (request, _) => Task.FromResult<NativeHealthResponse?>(responseFactory(request)),
            owner,
            CancellationToken.None);

    private async Task RunRawResponseServerAsync(
        Func<NamedPipeServerStream, NativeHealthRequest, Task> writeResponse)
    {
        var security = new PipeSecurity();
        security.SetOwner(CurrentSid);
        security.AddAccessRule(new PipeAccessRule(
            CurrentSid,
            PipeAccessRights.FullControl,
            AccessControlType.Allow));
        await using var server = NamedPipeServerStreamAcl.Create(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance,
            NativeHealthProtocol.MaximumMessageBytes,
            NativeHealthProtocol.MaximumMessageBytes,
            security);
        await server.WaitForConnectionAsync();
        var request = await NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(
            server,
            CancellationToken.None);
        await writeResponse(server, request);
    }

    private async Task RunFakeServerAsync(
        Func<NativeHealthRequest, CancellationToken, Task<NativeHealthResponse?>> responseFactory,
        SecurityIdentifier owner,
        CancellationToken cancellationToken)
    {
        var security = new PipeSecurity();
        security.SetOwner(owner);
        security.AddAccessRule(new PipeAccessRule(CurrentSid, PipeAccessRights.FullControl, AccessControlType.Allow));
        await using var server = NamedPipeServerStreamAcl.Create(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance,
            NativeHealthProtocol.MaximumMessageBytes,
            NativeHealthProtocol.MaximumMessageBytes,
            security);
        await server.WaitForConnectionAsync(cancellationToken);
        try
        {
            var request = await NativeHealthMessageFraming.ReadAsync<NativeHealthRequest>(server, cancellationToken);
            var response = await responseFactory(request, cancellationToken);
            if (response is not null)
            {
                await NativeHealthMessageFraming.WriteAsync(server, response, cancellationToken);
                using var acknowledgementTimeout = CancellationTokenSource.CreateLinkedTokenSource(
                    cancellationToken);
                acknowledgementTimeout.CancelAfter(TimeSpan.FromMilliseconds(250));
                try
                {
                    _ = await NativeHealthMessageFraming.ReadAsync<NativeHealthAcknowledgement>(
                        server,
                        acknowledgementTimeout.Token);
                }
                catch (OperationCanceledException) when (acknowledgementTimeout.IsCancellationRequested)
                {
                    // A client that rejects correlation does not acknowledge the response.
                }
            }
        }
        catch (IOException)
        {
            // A client that rejects the owner can disconnect before sending a request.
        }
    }

    private static NativeHealthResponse CreateSnapshotResponse(
        NativeHealthRequest request,
        NativeHealthSnapshot? snapshot = null) => new(
            NativeHealthProtocol.Version,
            request.CorrelationId,
            NativeHealthResultCode.Ok,
            snapshot ?? CreateSnapshot());

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

    private sealed class CapturingLogger<T> : ILogger<T>
    {
        public TaskCompletionSource<LogEntry> Entry { get; } = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (eventId == NativeHealthGatewayService.PipeOwnershipFailureEvent)
            {
                Entry.TrySetResult(new(eventId, formatter(state, exception), exception));
            }
        }
    }

    private sealed record LogEntry(EventId EventId, string Message, Exception? Exception);

    private sealed class BlockingWriteStream(byte[] requestBytes) : Stream
    {
        private readonly MemoryStream request = new(requestBytes, writable: false);

        public TaskCompletionSource WriteStarted { get; } = new(
            TaskCreationOptions.RunContinuationsAsynchronously);

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public static async Task<BlockingWriteStream> CreateAsync(NativeHealthRequest request)
        {
            await using var serialized = new MemoryStream();
            await NativeHealthMessageFraming.WriteAsync(serialized, request, CancellationToken.None);
            return new(serialized.ToArray());
        }

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default) => request.ReadAsync(buffer, cancellationToken);

        public override async ValueTask WriteAsync(
            ReadOnlyMemory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            WriteStarted.TrySetResult();
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
        }

        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}

[CollectionDefinition("Native health fixed pipe", DisableParallelization = true)]
public sealed class NativeHealthFixedPipeCollection;
