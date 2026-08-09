using System.Runtime.InteropServices;

namespace FieldOps.Agent.SystemTelemetry;

public interface IWindowsPowerStatus { bool TryGet(out NativePowerStatus status); }

public sealed class WindowsSystemTelemetryProvider(IWindowsPowerStatus powerStatus)
{
    public SystemTelemetryObservation GetObservation()
    {
        try
        {
            if (!powerStatus.TryGet(out var value)) return SystemTelemetryObservation.Unavailable();
            var present = (value.BatteryFlag & 128) == 0;
            var source = value.ACLineStatus switch { 1 => SystemPowerSource.AC, 0 => SystemPowerSource.Battery, _ => SystemPowerSource.Unknown };
            var charge = present && value.BatteryLifePercent <= 100 ? (int?)value.BatteryLifePercent : null;
            var runtime = present && value.BatteryLifeTime != uint.MaxValue ? (int?)Math.Min((ulong)value.BatteryLifeTime, (ulong)int.MaxValue) : null;
            return new(SystemTelemetryStatus.Available, DateTimeOffset.UtcNow, "WindowsPowerStatus", present, charge, source == SystemPowerSource.AC || (value.BatteryFlag & 8) != 0, source, runtime, null);
        }
        catch (Exception ex) { return new(SystemTelemetryStatus.Error, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, ex.Message); }
    }
}

public readonly record struct NativePowerStatus(byte ACLineStatus, byte BatteryFlag, byte BatteryLifePercent, uint BatteryLifeTime);

public sealed class WindowsPowerStatus : IWindowsPowerStatus
{
    [StructLayout(LayoutKind.Sequential)] private struct Native { public byte AC; public byte Flag; public byte Percent; public byte Reserved; public uint Life; public uint Full; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemPowerStatus(out Native status);
    public bool TryGet(out NativePowerStatus status) { if (!GetSystemPowerStatus(out var n)) { status = default; return false; } status = new(n.AC, n.Flag, n.Percent, n.Life); return true; }
}
