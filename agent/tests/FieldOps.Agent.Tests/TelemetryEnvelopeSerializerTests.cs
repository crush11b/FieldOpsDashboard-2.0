using System.Text.Json;
using FieldOps.Agent.Telemetry;
using FieldOps.Agent.Telemetry.Delivery;

namespace FieldOps.Agent.Tests;

public sealed class TelemetryEnvelopeSerializerTests
{
    private readonly TelemetryEnvelopeSerializer serializer = new();

    public static TheoryData<int, string> CanonicalStatuses => new()
    {
        { (int)TelemetryStatus.Connecting, "connecting" },
        { (int)TelemetryStatus.Ok, "ok" },
        { (int)TelemetryStatus.Degraded, "degraded" },
        { (int)TelemetryStatus.Stale, "stale" },
        { (int)TelemetryStatus.Cached, "cached" },
        { (int)TelemetryStatus.Unavailable, "unavailable" },
        { (int)TelemetryStatus.Error, "error" },
    };

    [Theory]
    [MemberData(nameof(CanonicalStatuses))]
    public void SerializesCanonicalStatusAsLowercase(int statusValue, string expected)
    {
        var envelope = Envelope(status: (TelemetryStatus)statusValue);

        using var document = JsonDocument.Parse(serializer.Serialize(envelope));

        Assert.Equal(expected, document.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public void SerializesCanonicalEnvelopeWithoutChangingJsonValues()
    {
        var observedAt = new DateTimeOffset(2026, 7, 28, 12, 0, 0, TimeSpan.FromHours(-4));
        var receivedAt = observedAt.AddSeconds(1);
        var expiresAt = observedAt.AddMinutes(2);
        var envelope = new TelemetryEnvelope(
            TelemetryStatus.Error,
            new TelemetrySource(
                "gps-1",
                "browser_geolocation",
                "Browser Geolocation",
                "1.0",
                JsonSerializer.SerializeToElement(new { device = "browser" })),
            new TelemetryTimestamps(observedAt, receivedAt, expiresAt),
            JsonSerializer.SerializeToElement(new { latitude = 37.5407, satellites = 0 }),
            new TelemetryError(
                "GPS_FAILED",
                "GPS failed.",
                true,
                JsonSerializer.SerializeToElement(new { adapter = "browser" }),
                "permission_denied"),
            JsonSerializer.SerializeToElement(new { correlation = 42 }));

        using var document = JsonDocument.Parse(serializer.Serialize(envelope));
        var root = document.RootElement;

        Assert.Equal("error", root.GetProperty("status").GetString());
        Assert.Equal("gps-1", root.GetProperty("source").GetProperty("id").GetString());
        Assert.Equal("browser_geolocation", root.GetProperty("source").GetProperty("type").GetString());
        Assert.Equal("Browser Geolocation", root.GetProperty("source").GetProperty("name").GetString());
        Assert.Equal("1.0", root.GetProperty("source").GetProperty("version").GetString());
        Assert.Equal("browser", root.GetProperty("source").GetProperty("metadata").GetProperty("device").GetString());
        Assert.Equal("2026-07-28T16:00:00.0000000Z", root.GetProperty("timestamps").GetProperty("observedAt").GetString());
        Assert.Equal("2026-07-28T16:00:01.0000000Z", root.GetProperty("timestamps").GetProperty("receivedAt").GetString());
        Assert.Equal("2026-07-28T16:02:00.0000000Z", root.GetProperty("timestamps").GetProperty("expiresAt").GetString());
        Assert.Equal(37.5407, root.GetProperty("data").GetProperty("latitude").GetDouble());
        Assert.Equal(0, root.GetProperty("data").GetProperty("satellites").GetInt32());
        Assert.Equal("GPS_FAILED", root.GetProperty("error").GetProperty("code").GetString());
        Assert.Equal("GPS failed.", root.GetProperty("error").GetProperty("message").GetString());
        Assert.True(root.GetProperty("error").GetProperty("retryable").GetBoolean());
        Assert.Equal("browser", root.GetProperty("error").GetProperty("details").GetProperty("adapter").GetString());
        Assert.Equal("permission_denied", root.GetProperty("error").GetProperty("cause").GetString());
        Assert.Equal(42, root.GetProperty("metadata").GetProperty("correlation").GetInt32());
    }

    [Fact]
    public void OmitsAbsentOptionalPropertiesAndUndefinedJsonElements()
    {
        var envelope = Envelope(data: default(JsonElement));

        using var document = JsonDocument.Parse(serializer.Serialize(envelope));
        var root = document.RootElement;

        Assert.False(root.TryGetProperty("data", out _));
        Assert.False(root.TryGetProperty("error", out _));
        Assert.False(root.TryGetProperty("metadata", out _));
        Assert.False(root.GetProperty("source").TryGetProperty("name", out _));
        Assert.False(root.GetProperty("source").TryGetProperty("version", out _));
        Assert.False(root.GetProperty("source").TryGetProperty("metadata", out _));
        Assert.False(root.GetProperty("timestamps").TryGetProperty("expiresAt", out _));
    }

    [Fact]
    public void PreservesExplicitJsonNullValues()
    {
        using var nullDocument = JsonDocument.Parse("null");
        var envelope = Envelope(
            data: nullDocument.RootElement.Clone(),
            metadata: nullDocument.RootElement.Clone());

        using var document = JsonDocument.Parse(serializer.Serialize(envelope));

        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("data").ValueKind);
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("metadata").ValueKind);
    }

    private static TelemetryEnvelope Envelope(
        TelemetryStatus status = TelemetryStatus.Ok,
        JsonElement? data = null,
        JsonElement? metadata = null)
    {
        var now = new DateTimeOffset(2026, 7, 28, 16, 0, 0, TimeSpan.Zero);
        return new TelemetryEnvelope(
            status,
            new TelemetrySource("test", "test"),
            new TelemetryTimestamps(now, now),
            data,
            Metadata: metadata);
    }
}
