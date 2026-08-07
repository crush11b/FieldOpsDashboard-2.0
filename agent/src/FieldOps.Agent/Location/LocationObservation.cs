using System.Text.Json.Serialization;

namespace FieldOps.Agent.Location;

public enum LocationStatus
{
    Available,
    Disabled,
    PermissionDenied,
    Initializing,
    NoFix,
    Unavailable,
    Error,
}

public sealed record LocationObservation(
    [property: JsonPropertyName("latitude")] double? Latitude,
    [property: JsonPropertyName("longitude")] double? Longitude,
    [property: JsonPropertyName("altitude")] double? Altitude,
    [property: JsonPropertyName("horizontalAccuracy")] double? HorizontalAccuracy,
    [property: JsonPropertyName("speed")] double? Speed,
    [property: JsonPropertyName("heading")] double? Heading,
    [property: JsonPropertyName("timestampUtc")] DateTimeOffset? TimestampUtc,
    [property: JsonPropertyName("status")] LocationStatus Status)
{
    public static LocationObservation WithoutTelemetry(LocationStatus status) =>
        new(null, null, null, null, null, null, null, status);
}

public interface ILocationProvider
{
    Task<LocationObservation> GetLocationAsync(CancellationToken cancellationToken);
}
