using System.Text.Json.Serialization;

namespace FieldOps.Agent.SystemTelemetry;

public enum SystemTelemetryStatus { Available, Unavailable, Error }
public enum SystemPowerSource { AC, Battery, Unknown }

public sealed record PhysicalBatteryObservation(
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("present")] bool? Present,
    [property: JsonPropertyName("percentage")] int? Percentage,
    [property: JsonPropertyName("charging")] bool? Charging,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("observedAtUtc")] DateTimeOffset ObservedAtUtc);

public sealed record SystemTelemetryObservation(
    [property: JsonPropertyName("status")] SystemTelemetryStatus Status,
    [property: JsonPropertyName("observedAtUtc")] DateTimeOffset ObservedAtUtc,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("batteryPresent")] bool? BatteryPresent,
    [property: JsonPropertyName("chargePercent")] int? ChargePercent,
    [property: JsonPropertyName("charging")] bool? Charging,
    [property: JsonPropertyName("powerSource")] SystemPowerSource PowerSource,
    [property: JsonPropertyName("remainingRuntimeSeconds")] int? RemainingRuntimeSeconds,
    [property: JsonPropertyName("error")] string? Error,
    [property: JsonPropertyName("physicalBatteries")] IReadOnlyList<PhysicalBatteryObservation> PhysicalBatteries)
{
    public static SystemTelemetryObservation Unavailable(string? error = null) =>
        new(SystemTelemetryStatus.Unavailable, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, error, Array.Empty<PhysicalBatteryObservation>());
}
