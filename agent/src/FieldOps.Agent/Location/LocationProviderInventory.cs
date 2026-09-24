using System.Management;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace FieldOps.Agent.Location;

public enum LocationProviderType
{
    Automatic,
    SerialNmea,
    WindowsSensor,
}

public sealed record LocationProviderDescriptor(
    [property: JsonPropertyName("providerType")] LocationProviderType ProviderType,
    [property: JsonPropertyName("displayName")] string DisplayName,
    [property: JsonPropertyName("stableIdentity")] string? StableIdentity,
    [property: JsonPropertyName("deviceInstanceId")] string? DeviceInstanceId,
    [property: JsonPropertyName("portName")] string? PortName,
    [property: JsonPropertyName("baudRate")] int? BaudRate,
    [property: JsonPropertyName("present")] bool Present,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("error")] string? Error = null);

public sealed record LocationProviderInventory(
    [property: JsonPropertyName("observedAtUtc")] DateTimeOffset ObservedAtUtc,
    [property: JsonPropertyName("providers")] IReadOnlyList<LocationProviderDescriptor> Providers,
    [property: JsonPropertyName("error")] string? Error);

public interface ILocationProviderInventory
{
    LocationProviderInventory Enumerate(CancellationToken cancellationToken);
}

public sealed class WindowsLocationProviderInventory : ILocationProviderInventory
{
    internal const string UbloxIdentity = "VID_1546&PID_01A7";
    internal const string SierraNmeaIdentity = "VID_1199&PID_9071&MI_02";

    public LocationProviderInventory Enumerate(CancellationToken cancellationToken)
    {
        var providers = new List<LocationProviderDescriptor>
        {
            new(LocationProviderType.Automatic, "Automatic", null, null, null, null, true, "Available"),
        };
        try
        {
            using var searcher = new ManagementObjectSearcher("SELECT Name,PNPDeviceID,Status,ConfigManagerErrorCode FROM Win32_PnPEntity");
            foreach (ManagementObject item in searcher.Get())
            {
                cancellationToken.ThrowIfCancellationRequested();
                var pnp = item["PNPDeviceID"]?.ToString();
                if (string.IsNullOrWhiteSpace(pnp) || !pnp.Contains(UbloxIdentity, StringComparison.OrdinalIgnoreCase)) continue;
                var present = string.Equals(item["Status"]?.ToString(), "OK", StringComparison.OrdinalIgnoreCase)
                    && Convert.ToInt32(item["ConfigManagerErrorCode"] ?? 0) == 0;
                var instanceId = pnp!.ToUpperInvariant();
                providers.Add(new(
                    LocationProviderType.WindowsSensor,
                    "u-blox 7 GPS/GNSS Location Sensor - Windows Sensor",
                    UbloxIdentity,
                    instanceId,
                    null,
                    null,
                    present,
                    present ? "Available" : "Unplugged"));
            }
            return new(DateTimeOffset.UtcNow, providers, null);
        }
        catch (Exception exception) when (exception is ManagementException or IOException or InvalidOperationException)
        {
            return new(DateTimeOffset.UtcNow, providers, "Windows location sensor inventory unavailable.");
        }
    }

    internal static LocationProviderDescriptor Sierra(string portName, int baudRate, string? deviceInstanceId = null) => new(
        LocationProviderType.SerialNmea,
        $"Sierra Wireless X7 LTE-A NMEA - {portName}",
        SierraNmeaIdentity,
        deviceInstanceId,
        portName,
        baudRate,
        true,
        "Available");
}
