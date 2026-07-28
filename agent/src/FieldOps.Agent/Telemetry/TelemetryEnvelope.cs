using System.Text.Json;

namespace FieldOps.Agent.Telemetry;

internal enum TelemetryStatus
{
    Connecting,
    Ok,
    Degraded,
    Stale,
    Cached,
    Unavailable,
    Error,
}

internal sealed record TelemetrySource(
    string Id,
    string Type,
    string? Name = null,
    string? Version = null,
    JsonElement? Metadata = null);

internal sealed record TelemetryTimestamps(
    DateTimeOffset ObservedAt,
    DateTimeOffset ReceivedAt,
    DateTimeOffset? ExpiresAt = null);

internal sealed record TelemetryError(
    string Code,
    string Message,
    bool Retryable,
    JsonElement? Details = null,
    string? Cause = null);

/// <summary>
/// Transport-neutral telemetry snapshot. Ok and degraded states carry data;
/// stale and cached states may retain data; connecting and unavailable states
/// may omit data; error states carry structured error metadata.
/// </summary>
internal sealed record TelemetryEnvelope(
    TelemetryStatus Status,
    TelemetrySource Source,
    TelemetryTimestamps Timestamps,
    JsonElement? Data = null,
    TelemetryError? Error = null,
    JsonElement? Metadata = null)
{
    internal TelemetryEnvelope CreateOwnedCopy() => this with
    {
        Source = Source with { Metadata = CloneElement(Source.Metadata) },
        Data = CloneElement(Data),
        Error = Error is null ? null : Error with { Details = CloneElement(Error.Details) },
        Metadata = CloneElement(Metadata),
    };

    private static JsonElement? CloneElement(JsonElement? element)
    {
        if (element is not { } value || value.ValueKind == JsonValueKind.Undefined)
        {
            return element;
        }

        return value.Clone();
    }
}
