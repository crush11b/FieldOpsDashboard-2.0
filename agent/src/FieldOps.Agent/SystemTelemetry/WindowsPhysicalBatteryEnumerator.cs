using System.Management;

namespace FieldOps.Agent.SystemTelemetry;

public interface IPhysicalBatteryEnumerator
{
    IReadOnlyList<PhysicalBatteryObservation> Enumerate(CancellationToken cancellationToken);
}

public sealed class WindowsPhysicalBatteryEnumerator : IPhysicalBatteryEnumerator
{
    public IReadOnlyList<PhysicalBatteryObservation> Enumerate(CancellationToken cancellationToken)
    {
        var observed = DateTimeOffset.UtcNow;
        var results = new List<PhysicalBatteryObservation>();
        using var searcher = new ManagementObjectSearcher("SELECT DeviceID,Name,EstimatedChargeRemaining,BatteryStatus,Status FROM Win32_Battery");
        foreach (ManagementObject item in searcher.Get())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var id = item["DeviceID"]?.ToString();
            if (string.IsNullOrWhiteSpace(id)) continue;
            int? percent = item["EstimatedChargeRemaining"] is null ? null : Convert.ToInt32(item["EstimatedChargeRemaining"]);
            if (percent is < 0 or > 100) percent = null;
            var statusCode = item["BatteryStatus"] is null ? (int?)null : Convert.ToInt32(item["BatteryStatus"]);
            bool? charging = statusCode == 2 ? true : statusCode is 1 or 3 or 4 or 5 or 6 or 7 or 8 or 9 ? false : null;
            results.Add(new(id, item["Name"]?.ToString(), true, percent, charging, item["Status"]?.ToString(), "Win32_Battery", observed));
        }
        return results.OrderBy(x => x.DeviceId, StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
