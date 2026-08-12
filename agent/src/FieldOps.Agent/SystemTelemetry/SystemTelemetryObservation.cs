using System.Text.Json.Serialization;

namespace FieldOps.Agent.SystemTelemetry;

public enum SystemTelemetryStatus { Available, Unavailable, Error }
public enum SystemPowerSource { AC, Battery, Unknown }
public enum PhysicalBatteryCollectionStatus { Available, Unavailable, Error }

public sealed record PhysicalBatteryObservation(
    [property: JsonPropertyName("deviceId")] string DeviceId,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("present")] bool? Present,
    [property: JsonPropertyName("percentage")] int? Percentage,
    [property: JsonPropertyName("charging")] bool? Charging,
    [property: JsonPropertyName("status")] string? Status,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("observedAtUtc")] DateTimeOffset ObservedAtUtc);

public sealed record CpuObservation(
    [property: JsonPropertyName("usagePercent")] double UsagePercent,
    [property: JsonPropertyName("logicalProcessorCount")] int LogicalProcessorCount,
    [property: JsonPropertyName("model")] string? Model);

public sealed record MemoryObservation(
    [property: JsonPropertyName("totalBytes")] ulong TotalBytes,
    [property: JsonPropertyName("availableBytes")] ulong AvailableBytes,
    [property: JsonPropertyName("usedBytes")] ulong UsedBytes,
    [property: JsonPropertyName("usedPercent")] double UsedPercent);

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
    [property: JsonPropertyName("physicalBatteryStatus")] PhysicalBatteryCollectionStatus PhysicalBatteryStatus,
    [property: JsonPropertyName("physicalBatteryError")] string? PhysicalBatteryError,
    [property: JsonPropertyName("physicalBatteries")] IReadOnlyList<PhysicalBatteryObservation> PhysicalBatteries,
    [property: JsonPropertyName("cpu")] CpuObservation? Cpu,
    [property: JsonPropertyName("memory")] MemoryObservation? Memory)
{
    public static SystemTelemetryObservation Unavailable(string? error = null) =>
        new(SystemTelemetryStatus.Unavailable, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, error, PhysicalBatteryCollectionStatus.Unavailable, error, Array.Empty<PhysicalBatteryObservation>(), null, null);
}
