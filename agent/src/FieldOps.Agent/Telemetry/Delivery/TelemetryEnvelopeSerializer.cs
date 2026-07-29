using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FieldOps.Agent.Telemetry.Delivery;

internal sealed class TelemetryEnvelopeSerializer
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public byte[] Serialize(TelemetryEnvelope envelope)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        var wireEnvelope = new TelemetryEnvelopeWireDto(
            Status: ToWireStatus(envelope.Status),
            Source: new TelemetrySourceWireDto(
                envelope.Source.Id,
                envelope.Source.Type,
                envelope.Source.Name,
                envelope.Source.Version,
                NormalizeElement(envelope.Source.Metadata)),
            Timestamps: new TelemetryTimestampsWireDto(
                ToUtcTimestamp(envelope.Timestamps.ObservedAt),
                ToUtcTimestamp(envelope.Timestamps.ReceivedAt),
                envelope.Timestamps.ExpiresAt is { } expiresAt
                    ? ToUtcTimestamp(expiresAt)
                    : null),
            Data: NormalizeElement(envelope.Data),
            Error: envelope.Error is null
                ? null
                : new TelemetryErrorWireDto(
                    envelope.Error.Code,
                    envelope.Error.Message,
                    envelope.Error.Retryable,
                    NormalizeElement(envelope.Error.Details),
                    envelope.Error.Cause),
            Metadata: NormalizeElement(envelope.Metadata));

        return JsonSerializer.SerializeToUtf8Bytes(wireEnvelope, SerializerOptions);
    }

    private static JsonElement? NormalizeElement(JsonElement? element) =>
        element is { ValueKind: not JsonValueKind.Undefined } ? element : null;

    private static string ToUtcTimestamp(DateTimeOffset timestamp) =>
        timestamp.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    private static string ToWireStatus(TelemetryStatus status) => status switch
    {
        TelemetryStatus.Connecting => "connecting",
        TelemetryStatus.Ok => "ok",
        TelemetryStatus.Degraded => "degraded",
        TelemetryStatus.Stale => "stale",
        TelemetryStatus.Cached => "cached",
        TelemetryStatus.Unavailable => "unavailable",
        TelemetryStatus.Error => "error",
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, "Unknown telemetry status."),
    };

    private sealed record TelemetryEnvelopeWireDto(
        string Status,
        TelemetrySourceWireDto Source,
        TelemetryTimestampsWireDto Timestamps,
        JsonElement? Data,
        TelemetryErrorWireDto? Error,
        JsonElement? Metadata);

    private sealed record TelemetrySourceWireDto(
        string Id,
        string Type,
        string? Name,
        string? Version,
        JsonElement? Metadata);

    private sealed record TelemetryTimestampsWireDto(
        string ObservedAt,
        string ReceivedAt,
        string? ExpiresAt);

    private sealed record TelemetryErrorWireDto(
        string Code,
        string Message,
        bool Retryable,
        JsonElement? Details,
        string? Cause);
}
