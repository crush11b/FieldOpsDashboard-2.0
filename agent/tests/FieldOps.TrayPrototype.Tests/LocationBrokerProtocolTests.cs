using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using FieldOps.Agent.Location;
using FieldOps.NativeHealth;
using FieldOps.TrayPrototype.Location;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.TrayPrototype.Tests;

public sealed class LocationBrokerProtocolTests
{
    private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task RealTrayPipeReturnsSuccessfulResponseToAgentProvider()
    {
        var timestamp = new DateTimeOffset(2026, 8, 6, 21, 0, 0, TimeSpan.Zero);
        var api = new WindowsLocationBrokerTests.FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Reading = new(38.1, -79.2, null, 3.5, null, null, timestamp),
        };
        var broker = new WindowsLocationBroker(api);
        await broker.RequestPermissionAsync(CancellationToken.None);

        var result = await RunExchangeAsync(broker);

        Assert.Equal(LocationStatus.Available, result.Status);
        Assert.Equal(38.1, result.Latitude);
        Assert.Equal(-79.2, result.Longitude);
        Assert.Null(result.Altitude);
        Assert.Equal(3.5, result.HorizontalAccuracy);
        Assert.Null(result.Speed);
        Assert.Null(result.Heading);
        Assert.Equal(timestamp, result.TimestampUtc);
    }

    [Theory]
    [InlineData((int)WindowsLocationPermission.NotRequested)]
    [InlineData((int)WindowsLocationPermission.Denied)]
    public async Task RealPipeMapsPermissionDenied(int permissionValue)
    {
        var permission = (WindowsLocationPermission)permissionValue;
        var api = new WindowsLocationBrokerTests.FakeLocationApi { Permission = permission };
        var broker = new WindowsLocationBroker(api);
        if (permission != WindowsLocationPermission.NotRequested)
        {
            await broker.RequestPermissionAsync(CancellationToken.None);
        }

        var result = await RunExchangeAsync(broker);

        Assert.Equal(LocationStatus.PermissionDenied, result.Status);
        Assert.Null(result.Latitude);
        Assert.Null(result.Longitude);
    }

    [Fact]
    public void WireContractUsesOnlyFixedCamelCaseFields()
    {
        var json = JsonSerializer.Serialize(new LocationBrokerResponse(
            null, null, null, null, null, null, null, LocationBrokerStatus.PermissionDenied));
        using var document = JsonDocument.Parse(json);

        Assert.Equal(
            ["latitude", "longitude", "altitude", "horizontalAccuracy", "speed", "heading", "timestampUtc", "status"],
            document.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal("PermissionDenied", document.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task BrokerTimeoutIsBoundedAndDiagnosticsContainNoCoordinates()
    {
        var api = new WindowsLocationBrokerTests.FakeLocationApi
        {
            Permission = WindowsLocationPermission.Allowed,
            Read = async token =>
            {
                await Task.Delay(Timeout.InfiniteTimeSpan, token);
                return null;
            },
        };
        var broker = new WindowsLocationBroker(api);
        await broker.RequestPermissionAsync(CancellationToken.None);
        var diagnostics = new RecordingDiagnostics();
        var pipeName = $"FieldOps.LocationBroker.Timeout.{Guid.NewGuid():N}";
        using var stop = new CancellationTokenSource(TestTimeout);
        var server = CreateServer(broker, diagnostics, pipeName, TimeSpan.FromMilliseconds(50));
        var runTask = server.RunAsync(stop.Token);
        await diagnostics.Started.Task.WaitAsync(TestTimeout);
        var provider = new WindowsSensorLocationProvider(
            NullLogger<WindowsSensorLocationProvider>.Instance,
            pipeName,
            TimeSpan.FromSeconds(1));

        var result = await provider.GetLocationAsync(stop.Token);
        await diagnostics.TimedOut.Task.WaitAsync(TestTimeout);
        stop.Cancel();
        await runTask.WaitAsync(TestTimeout);

        Assert.Equal(LocationStatus.NoFix, result.Status);
        Assert.Null(result.Latitude);
        Assert.Null(result.Longitude);
        Assert.All(diagnostics.Messages, message =>
        {
            Assert.DoesNotContain("35.", message, StringComparison.Ordinal);
            Assert.DoesNotContain("-80.", message, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void ReversedAclHasOnlyOperatorOwnerLocalServiceAndAdministrators()
    {
        var operatorSid = WindowsIdentity.GetCurrent().User!;
        var security = new LocationBrokerAuthorizationPolicy(operatorSid).CreateSecurity();
        var rules = security.GetAccessRules(true, false, typeof(SecurityIdentifier))
            .Cast<PipeAccessRule>()
            .ToArray();

        Assert.Equal(operatorSid, security.GetOwner(typeof(SecurityIdentifier)));
        Assert.Contains(rules, rule => rule.IdentityReference == operatorSid
            && rule.AccessControlType == AccessControlType.Allow
            && rule.PipeAccessRights.HasFlag(PipeAccessRights.FullControl));
        Assert.Contains(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.LocalServiceSid, null)
            && rule.AccessControlType == AccessControlType.Allow);
        Assert.Contains(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)
            && rule.AccessControlType == AccessControlType.Allow);
        Assert.DoesNotContain(rules, rule => rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.WorldSid, null)
            || rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null)
            || rule.IdentityReference == new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null));
    }

    private static async Task<LocationObservation> RunExchangeAsync(WindowsLocationBroker broker)
    {
        var pipeName = $"FieldOps.LocationBroker.Test.{Guid.NewGuid():N}";
        var diagnostics = new RecordingDiagnostics();
        using var stop = new CancellationTokenSource(TestTimeout);
        var server = CreateServer(broker, diagnostics, pipeName, TimeSpan.FromSeconds(1));
        var runTask = server.RunAsync(stop.Token);
        await diagnostics.Started.Task.WaitAsync(TestTimeout);
        var provider = new WindowsSensorLocationProvider(
            NullLogger<WindowsSensorLocationProvider>.Instance,
            pipeName,
            TimeSpan.FromSeconds(1));

        var result = await provider.GetLocationAsync(stop.Token);
        stop.Cancel();
        await runTask.WaitAsync(TestTimeout);
        return result;
    }

    private static LocationBrokerPipeServer CreateServer(
        WindowsLocationBroker broker,
        RecordingDiagnostics diagnostics,
        string pipeName,
        TimeSpan timeout) => new(
            broker,
            new LocationBrokerAuthorizationPolicy(WindowsIdentity.GetCurrent().User!),
            diagnostics,
            pipeName,
            timeout,
            () => new LocationBrokerAuthorizationPolicy(WindowsIdentity.GetCurrent().User!).CreateSecurity());

    private sealed class RecordingDiagnostics : ILocationBrokerDiagnostics
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource TimedOut { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public List<string> Messages { get; } = [];

        public void BrokerStarted() { Messages.Add("initialized"); Started.TrySetResult(); }
        public void RequestTimedOut() { Messages.Add("timeout"); TimedOut.TrySetResult(); }
        public void RequestFailed() => Messages.Add("failure");
    }
}
