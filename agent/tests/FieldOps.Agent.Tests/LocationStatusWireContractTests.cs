using System.Text;
using FieldOps.Agent.Location;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Tests;

public sealed class LocationStatusWireContractTests
{
    [Theory]
    [InlineData(LocationStatus.Available, "Available")]
    [InlineData(LocationStatus.NoFix, "NoFix")]
    [InlineData(LocationStatus.Unavailable, "Unavailable")]
    [InlineData(LocationStatus.Error, "Error")]
    public async Task FramingWritesStringStatus(LocationStatus status, string expected)
    {
        await using var stream = new MemoryStream();
        await NativeHealthMessageFraming.WriteAsync(stream, LocationObservation.WithoutTelemetry(status), CancellationToken.None);
        var payload = Encoding.UTF8.GetString(stream.ToArray().AsSpan(sizeof(int)));
        Assert.Contains($"\"status\":\"{expected}\"", payload, StringComparison.Ordinal);
        Assert.DoesNotContain($"\"status\":{(int)status}", payload, StringComparison.Ordinal);
    }
}
