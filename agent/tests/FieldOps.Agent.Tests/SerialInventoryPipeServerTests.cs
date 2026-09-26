using System.IO.Pipes;
using FieldOps.Agent.Health;
using FieldOps.Agent.Serial;
using FieldOps.Agent.Location;
using FieldOps.NativeHealth;
using Microsoft.Extensions.Logging.Abstractions;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace FieldOps.Agent.Tests;

public sealed class SerialInventoryPipeServerTests
{
    [Fact]
    public async Task ValidRequestReturnsInventoryAndZeroPorts()
    {
        var pipe = "FieldOps.SerialInventory.Test." + Guid.NewGuid().ToString("N");
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var expected = new SerialPortInventory(DateTimeOffset.UtcNow, SerialInventoryStatus.Ok, Array.Empty<SerialPortInfo>(), null);
        var server = new SerialInventoryPipeServer(new NativeHealthAuthorizationPolicy(null), new FakeEnumerator(expected), new FakeLocationProviderInventory(), NullLogger<SerialInventoryPipeServer>.Instance, pipe, TimeSpan.FromSeconds(5), TimeSpan.FromMilliseconds(10), TestSecurity);
        var run = server.RunAsync(stop.Token);
        using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(1000);
        await WriteLiteralAsync(client, "{\"command\":\"GetSerialPortInventory\"}", stop.Token);
        var actual = await NativeHealthMessageFraming.ReadAsync<JsonDocument>(client, stop.Token);
        Assert.Equal("Ok", actual.RootElement.GetProperty("status").GetString());
        Assert.Empty(actual.RootElement.GetProperty("ports").EnumerateArray());
        Assert.True(actual.RootElement.TryGetProperty("observedAtUtc", out _));
        stop.Cancel();
        await run;
    }

    [Fact]
    public async Task SilentClientTimesOutAndNextClientSucceeds()
    {
        var pipe = "FieldOps.SerialInventory.Test." + Guid.NewGuid().ToString("N");
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var expected = new SerialPortInventory(DateTimeOffset.UtcNow, SerialInventoryStatus.Ok, Array.Empty<SerialPortInfo>(), null);
        var server = new SerialInventoryPipeServer(new NativeHealthAuthorizationPolicy(null), new FakeEnumerator(expected), new FakeLocationProviderInventory(), NullLogger<SerialInventoryPipeServer>.Instance, pipe, TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(10), TestSecurity);
        var run = server.RunAsync(stop.Token);
        using (var silent = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous))
        {
            await silent.ConnectAsync(1000);
            await Task.Delay(150);
        }
        using var client = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous);
        await client.ConnectAsync(1000);
        await WriteLiteralAsync(client, "{\"command\":\"GetSerialPortInventory\"}", stop.Token);
        var actual = await NativeHealthMessageFraming.ReadAsync<JsonDocument>(client, stop.Token);
        Assert.Equal("Ok", actual.RootElement.GetProperty("status").GetString());
        stop.Cancel();
        await run;
    }

    [Fact]
    public async Task HandlerFailureReturnsStructuredErrorAndListenerRecovers()
    {
        var pipe = "FieldOps.SerialInventory.Test." + Guid.NewGuid().ToString("N");
        using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var expected = new SerialPortInventory(DateTimeOffset.UtcNow, SerialInventoryStatus.Ok, Array.Empty<SerialPortInfo>(), null);
        var server = new SerialInventoryPipeServer(new NativeHealthAuthorizationPolicy(null), new FakeEnumerator(expected), new ThrowingLocationProviderInventory(), NullLogger<SerialInventoryPipeServer>.Instance, pipe, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(10), TestSecurity);
        var run = server.RunAsync(stop.Token);

        using (var failedClient = new NamedPipeClientStream(".", pipe, PipeDirection.InOut, PipeOptions.Asynchronous))
        {
            await failedClient.ConnectAsync(1000);
            await WriteLiteralAsync(failedClient, "{\"command\":\"GetSerialPortInventory\"}", stop.Token);
            var error = await NativeHealthMessageFraming.ReadAsync<JsonDocument>(failedClient, stop.Token);
            Assert.Equal("Error", error.RootElement.GetProperty("status").GetString());
            Assert.Equal("Serial inventory request failed.", error.RootElement.GetProperty("error").GetString());
            Assert.Equal(0, error.RootElement.GetProperty("ports").GetArrayLength());
            Assert.Equal(0, error.RootElement.GetProperty("locationProviders").GetArrayLength());
        }

        stop.Cancel();
        await run;
    }

    private sealed class FakeEnumerator(SerialPortInventory result) : ISerialPortEnumerator
    {
        public SerialPortInventory Enumerate(CancellationToken cancellationToken) { cancellationToken.ThrowIfCancellationRequested(); return result; }
    }

    private sealed class FakeLocationProviderInventory : ILocationProviderInventory
    {
        public LocationProviderInventory Enumerate(CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return new(DateTimeOffset.UtcNow, Array.Empty<LocationProviderDescriptor>(), null);
        }
    }

    private sealed class ThrowingLocationProviderInventory : ILocationProviderInventory
    {
        public LocationProviderInventory Enumerate(CancellationToken cancellationToken) => throw new InvalidOperationException("provider enumeration failed");
    }

    private static async Task WriteLiteralAsync(Stream stream, string json, CancellationToken cancellationToken)
    {
        var payload = Encoding.UTF8.GetBytes(json);
        var length = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(length, payload.Length);
        await stream.WriteAsync(length, cancellationToken);
        await stream.WriteAsync(payload, cancellationToken);
        await stream.FlushAsync(cancellationToken);
    }

    private static PipeSecurity TestSecurity()
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.ReadWrite | PipeAccessRights.ReadPermissions, AccessControlType.Allow));
        return security;
    }
}
