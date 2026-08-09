using System.Text.Json.Serialization;

namespace FieldOps.NativeHealth;

public static class LocationBrokerProtocol
{
    public const string PipeName = "FieldOps.LocationBroker.v1";
    public const string GetLocationCommand = "GetLocation";
    public static readonly TimeSpan OperationTimeout = TimeSpan.FromSeconds(5);
}

public enum LocationBrokerStatus
{
    Available,
    Disabled,
    PermissionDenied,
    Initializing,
    NoFix,
    Unavailable,
    Error,
}

public sealed record LocationBrokerRequest(
    [property: JsonPropertyName("command")] string Command);

public sealed record LocationBrokerResponse(
    [property: JsonPropertyName("latitude")] double? Latitude,
    [property: JsonPropertyName("longitude")] double? Longitude,
    [property: JsonPropertyName("altitude")] double? Altitude,
    [property: JsonPropertyName("horizontalAccuracy")] double? HorizontalAccuracy,
    [property: JsonPropertyName("speed")] double? Speed,
    [property: JsonPropertyName("heading")] double? Heading,
    [property: JsonPropertyName("timestampUtc")] DateTimeOffset? TimestampUtc,
    [property: JsonPropertyName("status"), JsonConverter(typeof(JsonStringEnumConverter))]
    LocationBrokerStatus Status)
{
    public static LocationBrokerResponse WithoutTelemetry(LocationBrokerStatus status) =>
        new(null, null, null, null, null, null, null, status);
}
