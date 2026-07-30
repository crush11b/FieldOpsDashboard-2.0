using FieldOps.NativeHealth;

namespace FieldOps.TrayPrototype.Tests;

public sealed class NativeAgentHealthClientTests
{
    [Fact]
    public async Task Healthy_response_maps_to_healthy()
    {
        var result = await CreateClient(Response(NativeHealthResultCode.Ok, Snapshot("ok")))
            .ReadAsync(CancellationToken.None);

        Assert.Equal(AgentHealthState.Healthy, result.State);
        Assert.Equal("Native health reports healthy.", result.Detail);
    }

    [Fact]
    public async Task Unavailable_response_maps_to_unavailable()
    {
        var result = await CreateClient(Response(NativeHealthResultCode.Unavailable, null))
            .ReadAsync(CancellationToken.None);

        Assert.Equal(AgentHealthState.Unavailable, result.State);
    }

    [Fact]
    public async Task Access_denied_is_sanitized()
    {
        var result = await CreateClient(new UnauthorizedAccessException("sensitive"))
            .ReadAsync(CancellationToken.None);

        Assert.Equal(AgentHealthState.AccessDenied, result.State);
        Assert.DoesNotContain("sensitive", result.Detail, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Client_timeout_is_distinct_from_caller_cancellation()
    {
        var timeout = await CreateClient(new OperationCanceledException())
            .ReadAsync(CancellationToken.None);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var canceled = await CreateClient(new OperationCanceledException(cancellation.Token))
            .ReadAsync(cancellation.Token);

        Assert.Equal(AgentHealthState.Timeout, timeout.State);
        Assert.Equal(AgentHealthState.Canceled, canceled.State);
    }

    [Fact]
    public async Task Protocol_mismatch_and_rejected_response_remain_distinct()
    {
        var mismatch = await CreateClient(new NativeHealthProtocolMismatchException())
            .ReadAsync(CancellationToken.None);
        var rejected = await CreateClient(new NativeHealthResponseRejectedException())
            .ReadAsync(CancellationToken.None);

        Assert.Equal(AgentHealthState.ProtocolMismatch, mismatch.State);
        Assert.Equal(AgentHealthState.Rejected, rejected.State);
    }

    [Theory]
    [InlineData(NativeHealthResultCode.InvalidRequest)]
    [InlineData(NativeHealthResultCode.UnsupportedRequest)]
    public async Task Rejected_server_result_maps_to_rejected(NativeHealthResultCode resultCode)
    {
        var result = await CreateClient(Response(resultCode, null)).ReadAsync(CancellationToken.None);

        Assert.Equal(AgentHealthState.Rejected, result.State);
    }

    private static NativeAgentHealthClient CreateClient(NativeHealthResponse response) =>
        new(new FakeNativeHealthReader(response));

    private static NativeAgentHealthClient CreateClient(Exception exception) =>
        new(new FakeNativeHealthReader(exception));

    private static NativeHealthResponse Response(
        NativeHealthResultCode result,
        NativeHealthSnapshot? health) => new(
            NativeHealthProtocol.Version,
            Guid.NewGuid(),
            result,
            health);

    private static NativeHealthSnapshot Snapshot(string status) => new(
        status,
        "FieldOpsAgent",
        "test-version",
        DateTimeOffset.Parse("2026-07-30T00:00:00Z"),
        DateTimeOffset.Parse("2026-07-30T00:01:00Z"),
        60);

    private sealed class FakeNativeHealthReader : INativeHealthReader
    {
        private readonly NativeHealthResponse? response;
        private readonly Exception? exception;

        public FakeNativeHealthReader(NativeHealthResponse response) => this.response = response;

        public FakeNativeHealthReader(Exception exception) => this.exception = exception;

        public Task<NativeHealthResponse> ReadAsync(CancellationToken cancellationToken) =>
            exception is null
                ? Task.FromResult(response!)
                : Task.FromException<NativeHealthResponse>(exception);
    }
}
