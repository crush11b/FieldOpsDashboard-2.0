using System.Security.Principal;
using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text;
using FieldOps.TrayPrototype.PipeSpike;

namespace FieldOps.TrayPrototype.Tests;

public sealed class NamedPipeIntegrationTests
{
    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Current_operator_can_complete_bounded_authorization_probe()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var currentSid = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Current Windows identity does not have a user SID.");
        var pipeName = $"FieldOps.TrayPrototype.Tests.{Guid.NewGuid():N}";
        var probe = new NamedPipeAuthorizationProbe(
            pipeName,
            new PipeAuthorizationPolicy(currentSid),
            TimeSpan.FromSeconds(5));
        var correlationId = Guid.NewGuid();

        var server = probe.ServeOnceAsync(CancellationToken.None);
        var response = await NamedPipeAuthorizationProbe.CallAsync(
            pipeName,
            correlationId,
            TimeSpan.FromSeconds(5),
            CancellationToken.None);
        var serverResponse = await server;

        Assert.True(response.Accepted);
        Assert.Equal(correlationId, response.CorrelationId);
        Assert.Equal(response, serverResponse);
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task A_second_operation_is_rejected_while_the_first_is_waiting()
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        var currentSid = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Current Windows identity does not have a user SID.");
        var pipeName = $"FieldOps.TrayPrototype.Tests.{Guid.NewGuid():N}";
        var probe = new NamedPipeAuthorizationProbe(
            pipeName,
            new PipeAuthorizationPolicy(currentSid),
            TimeSpan.FromSeconds(5));

        var first = probe.ServeOnceAsync(CancellationToken.None);
        var second = await probe.ServeOnceAsync(CancellationToken.None);
        var response = await NamedPipeAuthorizationProbe.CallAsync(
            pipeName,
            Guid.NewGuid(),
            TimeSpan.FromSeconds(5),
            CancellationToken.None);
        await first;

        Assert.False(second.Accepted);
        Assert.Equal("operation_in_progress", second.Result);
        Assert.True(response.Accepted);
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Empty_correlation_id_is_rejected()
    {
        var (probe, pipeName) = CreateCurrentOperatorProbe();
        var server = probe.ServeOnceAsync(CancellationToken.None);

        var response = await NamedPipeAuthorizationProbe.CallAsync(
            pipeName,
            Guid.Empty,
            TimeSpan.FromSeconds(5),
            CancellationToken.None);
        await server;

        Assert.False(response.Accepted);
        Assert.Equal("invalid_correlation_id", response.Result);
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Unsupported_command_is_rejected_before_execution()
    {
        var (probe, pipeName) = CreateCurrentOperatorProbe();
        var correlationId = Guid.NewGuid();
        var server = probe.ServeOnceAsync(CancellationToken.None);

        var response = await NamedPipeAuthorizationProbe.CallRequestAsync(
            pipeName,
            new PipeProbeRequest((PipeCommandType)999, correlationId),
            TimeSpan.FromSeconds(5),
            CancellationToken.None);
        await server;

        Assert.False(response.Accepted);
        Assert.Equal(correlationId, response.CorrelationId);
        Assert.Equal("unsupported_command", response.Result);
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Malformed_correlation_id_closes_request_without_accepting_a_command()
    {
        var (probe, pipeName) = CreateCurrentOperatorProbe();
        var server = probe.ServeOnceAsync(CancellationToken.None);
        await WriteRawMessageAsync(
            pipeName,
            "{\"Command\":0,\"CorrelationId\":\"not-a-guid\"}",
            declaredLength: null);

        await Assert.ThrowsAsync<System.Text.Json.JsonException>(async () => await server);
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Oversized_frame_is_rejected_before_deserialization()
    {
        var (probe, pipeName) = CreateCurrentOperatorProbe();
        var server = probe.ServeOnceAsync(CancellationToken.None);
        await WriteRawMessageAsync(
            pipeName,
            "{}",
            NamedPipeAuthorizationProbe.MaximumMessageBytes + 1);

        var exception = await Assert.ThrowsAsync<InvalidDataException>(async () => await server);
        Assert.Contains("outside the allowed range", exception.Message);
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Server_times_out_when_no_client_connects()
    {
        var currentSid = WindowsIdentity.GetCurrent().User!;
        var probe = new NamedPipeAuthorizationProbe(
            $"FieldOps.TrayPrototype.Tests.{Guid.NewGuid():N}",
            new PipeAuthorizationPolicy(currentSid),
            TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await probe.ServeOnceAsync(CancellationToken.None));
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Precreated_pipe_name_causes_safe_failure_instead_of_fallback()
    {
        var currentSid = WindowsIdentity.GetCurrent().User!;
        var pipeName = $"FieldOps.TrayPrototype.Tests.{Guid.NewGuid():N}";
        await using var squatted = new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            maxNumberOfServerInstances: 1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.FirstPipeInstance);
        var probe = new NamedPipeAuthorizationProbe(
            pipeName,
            new PipeAuthorizationPolicy(currentSid),
            TimeSpan.FromSeconds(1));

        await Assert.ThrowsAnyAsync<IOException>(
            async () => await probe.ServeOnceAsync(CancellationToken.None));
    }

    [Fact]
    [Trait("Category", "WindowsIntegration")]
    public async Task Windows_denies_current_standard_user_when_acl_names_a_different_operator()
    {
        var current = WindowsIdentity.GetCurrent();
        if (new WindowsPrincipal(current).IsInRole(WindowsBuiltInRole.Administrator))
        {
            return;
        }

        var differentOperator = new SecurityIdentifier("S-1-5-21-100-200-300-4242");
        var pipeName = $"FieldOps.TrayPrototype.Tests.{Guid.NewGuid():N}";
        var probe = new NamedPipeAuthorizationProbe(
            pipeName,
            new PipeAuthorizationPolicy(differentOperator),
            TimeSpan.FromSeconds(2));
        using var serverCancellation = new CancellationTokenSource();
        var server = probe.ServeOnceAsync(serverCancellation.Token);

        await Assert.ThrowsAnyAsync<UnauthorizedAccessException>(async () =>
            await NamedPipeAuthorizationProbe.CallAsync(
                pipeName,
                Guid.NewGuid(),
                TimeSpan.FromSeconds(1),
                CancellationToken.None));
        serverCancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await server);
    }

    private static (NamedPipeAuthorizationProbe Probe, string PipeName) CreateCurrentOperatorProbe()
    {
        var currentSid = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Current Windows identity does not have a user SID.");
        var pipeName = $"FieldOps.TrayPrototype.Tests.{Guid.NewGuid():N}";
        return (
            new NamedPipeAuthorizationProbe(
                pipeName,
                new PipeAuthorizationPolicy(currentSid),
                TimeSpan.FromSeconds(5)),
            pipeName);
    }

    private static async Task WriteRawMessageAsync(
        string pipeName,
        string payload,
        int? declaredLength)
    {
        await using var client = new NamedPipeClientStream(
            ".",
            pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await client.ConnectAsync(timeout.Token);
        var bytes = Encoding.UTF8.GetBytes(payload);
        var length = new byte[sizeof(int)];
        BinaryPrimitives.WriteInt32LittleEndian(length, declaredLength ?? bytes.Length);
        await client.WriteAsync(length);
        if (declaredLength is null || declaredLength <= NamedPipeAuthorizationProbe.MaximumMessageBytes)
        {
            await client.WriteAsync(bytes);
        }
        await client.FlushAsync();
    }
}
