using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text;
using FieldOps.Agent.Location;
using FieldOps.NativeHealth;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class WindowsSensorLocationProviderTests
{
    [Fact]
    public void SuccessfulBrokerResponseIsNormalized()
    {
        var timestamp = new DateTimeOffset(2026, 8, 6, 12, 34, 56, TimeSpan.Zero);
        var result = WindowsSensorLocationProvider.Normalize(new(
            37.5407, -77.4360, null, 6.5, null, 184.0, timestamp,
            LocationBrokerStatus.Available));

        Assert.Equal(LocationStatus.Available, result.Status);
        Assert.Equal(37.5407, result.Latitude);
        Assert.Equal(-77.4360, result.Longitude);
        Assert.Null(result.Altitude);
        Assert.Equal(6.5, result.HorizontalAccuracy);
        Assert.Null(result.Speed);
        Assert.Equal(184.0, result.Heading);
        Assert.Equal(timestamp, result.TimestampUtc);
    }

    [Theory]
    [InlineData(LocationBrokerStatus.Unavailable, LocationStatus.Unavailable)]
    [InlineData(LocationBrokerStatus.PermissionDenied, LocationStatus.PermissionDenied)]
    [InlineData(LocationBrokerStatus.Disabled, LocationStatus.Disabled)]
    [InlineData(LocationBrokerStatus.Initializing, LocationStatus.Initializing)]
    [InlineData(LocationBrokerStatus.NoFix, LocationStatus.NoFix)]
    [InlineData(LocationBrokerStatus.Error, LocationStatus.Error)]
    public void NonAvailableResponseNeverLeaksOrFabricatesTelemetry(
        LocationBrokerStatus brokerStatus,
        LocationStatus expected)
    {
        var result = WindowsSensorLocationProvider.Normalize(new(
            1, 2, 3, 4, 5, 6, DateTimeOffset.UtcNow, brokerStatus));

        AssertEmpty(result, expected);
    }

    [Fact]
    public void AvailableWithoutCoordinatesBecomesNoFix()
    {
        var result = WindowsSensorLocationProvider.Normalize(
            LocationBrokerResponse.WithoutTelemetry(LocationBrokerStatus.Available));

        AssertEmpty(result, LocationStatus.NoFix);
    }

    [Fact]
    public async Task TrayAbsentReturnsUnavailable()
    {
        var provider = new WindowsSensorLocationProvider(
            NullLogger<WindowsSensorLocationProvider>.Instance,
            $"FieldOps.LocationBroker.Missing.{Guid.NewGuid():N}",
            TimeSpan.FromMilliseconds(50));

        var result = await provider.GetLocationAsync(CancellationToken.None);

        AssertEmpty(result, LocationStatus.Unavailable);
    }

    [Fact]
    public async Task ServiceCancellationIsPropagated()
    {
        var provider = new WindowsSensorLocationProvider(
            NullLogger<WindowsSensorLocationProvider>.Instance,
            $"FieldOps.LocationBroker.Cancel.{Guid.NewGuid():N}",
            TimeSpan.FromSeconds(5));
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(25));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => provider.GetLocationAsync(cancellation.Token));
    }

    [Fact]
    public async Task MalformedBrokerResponseFailsSafely()
    {
        var pipeName = $"FieldOps.LocationBroker.Malformed.{Guid.NewGuid():N}";
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await using var server = new NamedPipeServerStream(
            pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Message,
            PipeOptions.Asynchronous);
        var serverTask = Task.Run(async () =>
        {
            await server.WaitForConnectionAsync(timeout.Token);
            var request = await NativeHealthMessageFraming.ReadAsync<LocationBrokerRequest>(
                server,
                timeout.Token);
            Assert.Equal(LocationBrokerProtocol.GetLocationCommand, request.Command);
            var invalidPayload = Encoding.UTF8.GetBytes("not-json");
            var length = new byte[sizeof(int)];
            BinaryPrimitives.WriteInt32LittleEndian(length, invalidPayload.Length);
            await server.WriteAsync(length, timeout.Token);
            await server.WriteAsync(invalidPayload, timeout.Token);
            await server.FlushAsync(timeout.Token);
        }, timeout.Token);
        var provider = new WindowsSensorLocationProvider(
            NullLogger<WindowsSensorLocationProvider>.Instance,
            pipeName,
            TimeSpan.FromSeconds(1));

        var result = await provider.GetLocationAsync(timeout.Token);
        await serverTask;

        AssertEmpty(result, LocationStatus.Unavailable);
    }

    private static void AssertEmpty(LocationObservation observation, LocationStatus status)
    {
        Assert.Equal(status, observation.Status);
        Assert.Null(observation.Latitude);
        Assert.Null(observation.Longitude);
        Assert.Null(observation.Altitude);
        Assert.Null(observation.HorizontalAccuracy);
        Assert.Null(observation.Speed);
        Assert.Null(observation.Heading);
        Assert.Null(observation.TimestampUtc);
    }
}
