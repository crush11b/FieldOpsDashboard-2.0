using System.Buffers.Binary;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using FieldOps.TrayPrototype.Launcher;

namespace FieldOps.TrayPrototype.Tests;

public sealed class LauncherPipeServerTests
{
    [Fact]
    public async Task Current_operator_can_launch_through_the_bounded_pipe()
    {
        var target = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.exe");
        File.WriteAllBytes(target, []);
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var executor = new RecordingExecutor();
        var server = CreateServer(pipeName, executor);
        var run = server.RunAsync(cancellation.Token);
        try
        {
            var workingDirectory = Path.GetDirectoryName(target)!;
            var response = await SendAsync(pipeName, new(LauncherProtocol.Version, LaunchType.Executable, target, ["two words", "&"], workingDirectory));

            Assert.Equal(LaunchResultCode.Launched, response.Result);
            Assert.Equal(target, executor.Target);
            Assert.Equal(["two words", "&"], executor.Arguments);
            Assert.Equal(workingDirectory, executor.WorkingDirectory);
        }
        finally
        {
            cancellation.Cancel();
            await run;
            File.Delete(target);
        }
    }

    [Fact]
    public async Task Unsupported_launch_type_returns_invalid_request()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            var response = await SendAsync(pipeName, new(LauncherProtocol.Version, (LaunchType)999, "C:\\Tools\\test.exe"));
            Assert.Equal(LaunchResultCode.InvalidRequest, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Version_one_through_the_pipe_returns_protocol_incompatible()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            var response = await SendAsync(pipeName, new(1, LaunchType.Uri, "https://example.test"));
            Assert.Equal(LaunchResultCode.ProtocolIncompatible, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Missing_protocol_version_returns_invalid_request()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            var response = await SendJsonAsync(pipeName, "{\"LaunchType\":2,\"Target\":\"https://example.test\"}");
            Assert.Equal(LaunchResultCode.InvalidRequest, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Unknown_json_member_returns_invalid_request()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            var response = await SendJsonAsync(pipeName, "{\"ProtocolVersion\":2,\"LaunchType\":2,\"Target\":\"https://example.test\",\"Extra\":true}");
            Assert.Equal(LaunchResultCode.InvalidRequest, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Trailing_data_returns_invalid_request_and_server_remains_usable()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            var response = await SendJsonAsync(pipeName, "{\"ProtocolVersion\":2,\"LaunchType\":2,\"Target\":\"https://example.test\"}", [1]);
            Assert.Equal(LaunchResultCode.InvalidRequest, response.Result);

            var valid = await SendAsync(pipeName, new(LauncherProtocol.Version, LaunchType.Uri, "https://example.test"));
            Assert.Equal(LaunchResultCode.UriOpened, valid.Result);
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Truncated_frame_is_rejected_safely()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            await using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.Asynchronous);
            await client.ConnectAsync(5000);
            var length = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(length, 20);
            await client.WriteAsync(length);
            await client.WriteAsync("{}"u8.ToArray());
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Malformed_json_returns_invalid_request()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        try
        {
            await using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await client.ConnectAsync(5000);
            var payload = System.Text.Encoding.UTF8.GetBytes("{}");
            var length = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(length, payload.Length);
            await client.WriteAsync(length);
            await client.WriteAsync(payload);
            await client.FlushAsync();

            var response = await FieldOps.NativeHealth.NativeHealthMessageFraming.ReadAsync<LaunchResponse>(client, CancellationToken.None);
            Assert.Equal(LaunchResultCode.InvalidRequest, response.Result);
        }
        finally
        {
            cancellation.Cancel();
            await run;
        }
    }

    [Fact]
    public async Task Oversized_request_is_rejected_and_server_can_shutdown()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var server = CreateServer(pipeName, new RecordingExecutor());
        var run = server.RunAsync(cancellation.Token);
        await using (var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out, PipeOptions.Asynchronous))
        {
            await client.ConnectAsync(5000);
            var length = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(length, LauncherProtocol.MaximumMessageBytes + 1);
            await client.WriteAsync(length);
            await client.FlushAsync();
        }

        cancellation.Cancel();
        await run;
    }

    [Fact]
    public async Task Cancellation_stops_the_pipe_server_without_a_listener_leak()
    {
        var pipeName = $"FieldOps.Tray.Launcher.Tests.{Guid.NewGuid():N}";
        using var cancellation = new CancellationTokenSource();
        var run = CreateServer(pipeName, new RecordingExecutor()).RunAsync(cancellation.Token);

        cancellation.Cancel();
        await run;

        await Assert.ThrowsAnyAsync<Exception>(async () =>
        {
            await using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            await client.ConnectAsync(100);
        });
    }

    [Fact]
    public void Launcher_acl_denies_anonymous_and_network_and_excludes_local_service()
    {
        var currentSid = WindowsIdentity.GetCurrent().User!;
        var rules = new LauncherAuthorizationPolicy(currentSid)
            .CreateSecurity()
            .GetAccessRules(true, false, typeof(SecurityIdentifier))
            .Cast<PipeAccessRule>()
            .ToArray();

        Assert.Contains(rules, rule => rule.IdentityReference.Equals(currentSid) && rule.AccessControlType == AccessControlType.Allow);
        Assert.Contains(rules, rule => rule.IdentityReference.Equals(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)) && rule.AccessControlType == AccessControlType.Allow);
        Assert.Contains(rules, rule => rule.IdentityReference.Equals(new SecurityIdentifier(WellKnownSidType.AnonymousSid, null)) && rule.AccessControlType == AccessControlType.Deny);
        Assert.Contains(rules, rule => rule.IdentityReference.Equals(new SecurityIdentifier(WellKnownSidType.NetworkSid, null)) && rule.AccessControlType == AccessControlType.Deny);
        Assert.DoesNotContain(rules, rule => rule.IdentityReference.Equals(new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null)) && rule.AccessControlType == AccessControlType.Allow);
    }

    private static LauncherPipeServer CreateServer(string pipeName, IApplicationExecutor executor) => new(
        new ApplicationLauncher(executor),
        new LauncherAuthorizationPolicy(WindowsIdentity.GetCurrent().User!),
        pipeName,
        TimeSpan.FromSeconds(2));

    private static async Task<LaunchResponse> SendAsync(string pipeName, LaunchRequest request)
    {
        await using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(5000);
        await FieldOps.NativeHealth.NativeHealthMessageFraming.WriteAsync(client, request, CancellationToken.None);
        return await FieldOps.NativeHealth.NativeHealthMessageFraming.ReadAsync<LaunchResponse>(client, CancellationToken.None);
    }

    private static async Task<LaunchResponse> SendJsonAsync(string pipeName, string json, byte[]? trailing = null)
    {
        await using var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(5000);
        var payload = System.Text.Encoding.UTF8.GetBytes(json);
        var frame = new byte[sizeof(int) + payload.Length + (trailing?.Length ?? 0)];
        BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(0, sizeof(int)), payload.Length);
        payload.CopyTo(frame, sizeof(int));
        trailing?.CopyTo(frame, sizeof(int) + payload.Length);
        await client.WriteAsync(frame);
        await client.FlushAsync();
        return await FieldOps.NativeHealth.NativeHealthMessageFraming.ReadAsync<LaunchResponse>(client, CancellationToken.None);
    }

    private sealed class RecordingExecutor : IApplicationExecutor
    {
        public string? Target { get; private set; }
        public IReadOnlyList<string>? Arguments { get; private set; }
        public string? WorkingDirectory { get; private set; }

        public void LaunchExecutable(string target, IReadOnlyList<string> arguments, string workingDirectory)
        {
            Target = target;
            Arguments = arguments;
            WorkingDirectory = workingDirectory;
        }

        public void OpenUri(string target) => Target = target;
    }
}
