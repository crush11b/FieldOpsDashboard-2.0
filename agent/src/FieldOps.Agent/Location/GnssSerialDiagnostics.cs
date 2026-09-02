using System.Text.Json.Serialization;

namespace FieldOps.Agent.Location;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GnssSerialState
{
    Opening,
    Open,
    Receiving,
    Silent,
    OpenFailed,
    Reconnecting,
    Stopped,
}

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum GnssSerialFailureCategory
{
    None,
    AccessDenied,
    IoError,
    SerialSilence,
    UnexpectedError,
}

public sealed record GnssSerialDiagnostics(
    [property: JsonPropertyName("portName")] string PortName,
    [property: JsonPropertyName("baudRate")] int BaudRate,
    [property: JsonPropertyName("state")] GnssSerialState State,
    [property: JsonPropertyName("sessionGeneration")] long SessionGeneration,
    [property: JsonPropertyName("reconnectCount")] long ReconnectCount,
    [property: JsonPropertyName("lastOpenAttemptUtc")] DateTimeOffset? LastOpenAttemptUtc,
    [property: JsonPropertyName("lastSuccessfulOpenUtc")] DateTimeOffset? LastSuccessfulOpenUtc,
    [property: JsonPropertyName("lastSerialDataUtc")] DateTimeOffset? LastSerialDataUtc,
    [property: JsonPropertyName("lastValidNmeaUtc")] DateTimeOffset? LastValidNmeaUtc,
    [property: JsonPropertyName("lastFixUtc")] DateTimeOffset? LastFixUtc,
    [property: JsonPropertyName("lastFailureUtc")] DateTimeOffset? LastFailureUtc,
    [property: JsonPropertyName("lastFailureCategory")] GnssSerialFailureCategory LastFailureCategory,
    [property: JsonPropertyName("lastFailureMessage")] string? LastFailureMessage)
{
    public static GnssSerialDiagnostics Stopped(string portName, int baudRate) => new(
        portName, baudRate, GnssSerialState.Stopped, 0, 0, null, null, null, null, null, null,
        GnssSerialFailureCategory.None, null);
}
