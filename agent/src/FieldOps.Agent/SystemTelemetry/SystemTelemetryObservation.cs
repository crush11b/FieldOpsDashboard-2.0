using System.Text.Json.Serialization;

namespace FieldOps.Agent.SystemTelemetry;

public enum SystemTelemetryStatus { Available, Unavailable, Error }
public enum SystemPowerSource { AC, Battery, Unknown }

public sealed record SystemTelemetryObservation(
    [property: JsonPropertyName("status")] SystemTelemetryStatus Status,
    [property: JsonPropertyName("observedAtUtc")] DateTimeOffset ObservedAtUtc,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("batteryPresent")] bool? BatteryPresent,
    [property: JsonPropertyName("chargePercent")] int? ChargePercent,
    [property: JsonPropertyName("charging")] bool? Charging,
    [property: JsonPropertyName("powerSource")] SystemPowerSource PowerSource,
    [property: JsonPropertyName("remainingRuntimeSeconds")] int? RemainingRuntimeSeconds,
    [property: JsonPropertyName("error")] string? Error)
{
    public static SystemTelemetryObservation Unavailable(string? error = null) =>
        new(SystemTelemetryStatus.Unavailable, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, error);
}
