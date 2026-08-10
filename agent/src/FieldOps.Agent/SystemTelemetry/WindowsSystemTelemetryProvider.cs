using System.ComponentModel;
using System.Runtime.InteropServices;

namespace FieldOps.Agent.SystemTelemetry;

public interface IWindowsPowerStatus { bool TryGet(out NativePowerStatus status); }

public sealed class WindowsSystemTelemetryProvider(IWindowsPowerStatus powerStatus, IPhysicalBatteryEnumerator? batteryEnumerator = null)
{
    public SystemTelemetryObservation GetObservation()
    {
        try
        {
            if (!powerStatus.TryGet(out var value)) return new(SystemTelemetryStatus.Error, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, "Windows power status acquisition failed.", PhysicalBatteryCollectionStatus.Unavailable, null, Array.Empty<PhysicalBatteryObservation>());
            var unknownBattery = value.BatteryFlag == 255;
            var present = unknownBattery ? (bool?)null : (value.BatteryFlag & 128) == 0;
            var source = value.ACLineStatus switch { 1 => SystemPowerSource.AC, 0 => SystemPowerSource.Battery, _ => SystemPowerSource.Unknown };
            var charge = value.BatteryLifePercent <= 100 ? (int?)value.BatteryLifePercent : null;
            var runtime = value.BatteryLifeTime != uint.MaxValue ? (int?)Math.Min((ulong)value.BatteryLifeTime, (ulong)int.MaxValue) : null;
            bool? charging = unknownBattery || present == false ? null : (value.BatteryFlag & 8) != 0;
            PhysicalBatteryCollection physical;
            try { physical = batteryEnumerator?.Enumerate(CancellationToken.None) ?? new(PhysicalBatteryCollectionStatus.Unavailable, Array.Empty<PhysicalBatteryObservation>(), null); }
            catch (Exception) { physical = new(PhysicalBatteryCollectionStatus.Error, Array.Empty<PhysicalBatteryObservation>(), "Physical battery enumeration failed."); }
            return new(SystemTelemetryStatus.Available, DateTimeOffset.UtcNow, "WindowsPowerStatus", present, charge, charging, source, runtime, null, physical.Status, physical.Error, physical.Batteries);
        }
        catch (Exception ex) { return new(SystemTelemetryStatus.Error, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, ex.Message, PhysicalBatteryCollectionStatus.Unavailable, null, Array.Empty<PhysicalBatteryObservation>()); }
    }
}

public readonly record struct NativePowerStatus(byte ACLineStatus, byte BatteryFlag, byte BatteryLifePercent, uint BatteryLifeTime);

public sealed class WindowsPowerStatus : IWindowsPowerStatus
{
    [StructLayout(LayoutKind.Sequential)] private struct Native { public byte AC; public byte Flag; public byte Percent; public byte Reserved; public uint Life; public uint Full; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemPowerStatus(out Native status);
    public bool TryGet(out NativePowerStatus status) { if (!GetSystemPowerStatus(out var n)) { status = default; return false; } status = new(n.AC, n.Flag, n.Percent, n.Life); return true; }
}
