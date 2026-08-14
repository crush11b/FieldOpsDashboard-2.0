using System.ComponentModel;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace FieldOps.Agent.SystemTelemetry;

public interface IWindowsPowerStatus { bool TryGet(out NativePowerStatus status); }
public interface IWindowsSystemMetrics
{
    bool TryGetCpu(out CpuObservation cpu);
    bool TryGetMemory(out MemoryObservation memory);
    bool TryGetStorage(out StorageObservation storage);
    bool TryGetNetwork(out NetworkObservation network);
}

public sealed class WindowsSystemTelemetryProvider(IWindowsPowerStatus powerStatus, IPhysicalBatteryEnumerator? batteryEnumerator = null, IWindowsSystemMetrics? systemMetrics = null)
{
    public SystemTelemetryObservation GetObservation()
    {
        try
        {
            if (!powerStatus.TryGet(out var value)) return new(SystemTelemetryStatus.Error, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, "Windows power status acquisition failed.", PhysicalBatteryCollectionStatus.Unavailable, null, Array.Empty<PhysicalBatteryObservation>(), null, null, null, null);
            var unknownBattery = value.BatteryFlag == 255;
            var present = unknownBattery ? (bool?)null : (value.BatteryFlag & 128) == 0;
            var source = value.ACLineStatus switch { 1 => SystemPowerSource.AC, 0 => SystemPowerSource.Battery, _ => SystemPowerSource.Unknown };
            var charge = value.BatteryLifePercent <= 100 ? (int?)value.BatteryLifePercent : null;
            var runtime = value.BatteryLifeTime != uint.MaxValue ? (int?)Math.Min((ulong)value.BatteryLifeTime, (ulong)int.MaxValue) : null;
            bool? charging = unknownBattery || present == false ? null : (value.BatteryFlag & 8) != 0;
            PhysicalBatteryCollection physical;
            try { physical = batteryEnumerator?.Enumerate(CancellationToken.None) ?? new(PhysicalBatteryCollectionStatus.Unavailable, Array.Empty<PhysicalBatteryObservation>(), null); }
            catch (Exception) { physical = new(PhysicalBatteryCollectionStatus.Error, Array.Empty<PhysicalBatteryObservation>(), "Physical battery enumeration failed."); }
            CpuObservation? cpu = null;
            MemoryObservation? memory = null;
            try { if (systemMetrics?.TryGetCpu(out var cpuValue) == true) cpu = cpuValue; } catch { }
            try { if (systemMetrics?.TryGetMemory(out var memoryValue) == true) memory = memoryValue; } catch { }
            StorageObservation? storage = null;
            try { if (systemMetrics?.TryGetStorage(out var storageValue) == true) storage = storageValue; } catch { }
            NetworkObservation? network = null;
            try { if (systemMetrics?.TryGetNetwork(out var networkValue) == true) network = networkValue; } catch { }
            return new(SystemTelemetryStatus.Available, DateTimeOffset.UtcNow, "WindowsPowerStatus", present, charge, charging, source, runtime, null, physical.Status, physical.Error, physical.Batteries, cpu, memory, storage, network);
        }
        catch (Exception ex) { return new(SystemTelemetryStatus.Error, DateTimeOffset.UtcNow, "WindowsPowerStatus", null, null, null, SystemPowerSource.Unknown, null, ex.Message, PhysicalBatteryCollectionStatus.Unavailable, null, Array.Empty<PhysicalBatteryObservation>(), null, null, null, null); }
    }
}

public readonly record struct NativePowerStatus(byte ACLineStatus, byte BatteryFlag, byte BatteryLifePercent, uint BatteryLifeTime);

public sealed class WindowsPowerStatus : IWindowsPowerStatus
{
    [StructLayout(LayoutKind.Sequential)] private struct Native { public byte AC; public byte Flag; public byte Percent; public byte Reserved; public uint Life; public uint Full; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemPowerStatus(out Native status);
    public bool TryGet(out NativePowerStatus status) { if (!GetSystemPowerStatus(out var n)) { status = default; return false; } status = new(n.AC, n.Flag, n.Percent, n.Life); return true; }
}

public sealed class WindowsSystemMetrics : IWindowsSystemMetrics
{
    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] private struct MemoryStatus { public uint Length; public uint MemoryLoad; public ulong Total; public ulong Available; public ulong PageFileTotal; public ulong PageFileAvailable; public ulong VirtualTotal; public ulong VirtualAvailable; public ulong AvailableExtendedVirtual; }
    [DllImport("kernel32.dll")] private static extern bool GetSystemTimes(out FileTime idle, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

    public bool TryGetCpu(out CpuObservation cpu)
    {
        cpu = default!;
        if (!GetSystemTimes(out var idleStart, out var kernelStart, out var userStart)) return false;
        Thread.Sleep(100);
        if (!GetSystemTimes(out var idleEnd, out var kernelEnd, out var userEnd)) return false;
        var idle = ToUInt64(idleEnd) - ToUInt64(idleStart);
        var kernel = ToUInt64(kernelEnd) - ToUInt64(kernelStart);
        var user = ToUInt64(userEnd) - ToUInt64(userStart);
        var total = kernel + user;
        if (total == 0 || kernel < idle) return false;
        var usage = Math.Clamp((double)(total - (kernel - idle)) / total * 100, 0, 100);
        cpu = new CpuObservation(Math.Round(usage, 1), Environment.ProcessorCount, GetProcessorModel());
        return true;
    }

    public bool TryGetMemory(out MemoryObservation memory)
    {
        var status = new MemoryStatus { Length = (uint)Marshal.SizeOf<MemoryStatus>() };
        if (!GlobalMemoryStatusEx(ref status) || status.Total == 0) { memory = default!; return false; }
        var used = status.Total >= status.Available ? status.Total - status.Available : 0;
        var usedPercent = (double)used / status.Total * 100;
        memory = new MemoryObservation(status.Total, status.Available, used, Math.Round(usedPercent, 1));
        return true;
    }

    public bool TryGetStorage(out StorageObservation storage)
    {
        storage = default!;
        var volume = Path.GetPathRoot(Environment.SystemDirectory);
        if (string.IsNullOrWhiteSpace(volume)) return false;
        var drive = new DriveInfo(volume);
        if (!drive.IsReady || drive.TotalSize == 0) return false;
        var total = (ulong)drive.TotalSize;
        var available = (ulong)Math.Max(0, drive.AvailableFreeSpace);
        var used = total >= available ? total - available : 0;
        storage = new StorageObservation(volume, total, available, used, Math.Round((double)used / total * 100, 1));
        return true;
    }

    public bool TryGetNetwork(out NetworkObservation network)
    {
        var interfaces = NetworkInterface.GetAllNetworkInterfaces()
            .Where(adapter => adapter.NetworkInterfaceType != NetworkInterfaceType.Loopback
                && adapter.NetworkInterfaceType != NetworkInterfaceType.Tunnel
                && adapter.OperationalStatus == OperationalStatus.Up)
            .Select(adapter =>
            {
                var ipv4 = adapter.GetIPProperties().UnicastAddresses
                    .FirstOrDefault(address => address.Address.AddressFamily == AddressFamily.InterNetwork)?.Address.ToString();
                long? speed = adapter.Speed >= 0 ? adapter.Speed : null;
                return new NetworkInterfaceObservation(adapter.Name, adapter.Description, adapter.NetworkInterfaceType.ToString(), ipv4, speed);
            })
            .ToArray();
        network = new NetworkObservation(interfaces.Length > 0, interfaces);
        return true;
    }

    private static ulong ToUInt64(FileTime value) => ((ulong)value.High << 32) | value.Low;
    private static string? GetProcessorModel()
    {
        try { return Microsoft.Win32.Registry.GetValue(@"HKEY_LOCAL_MACHINE\HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString", null) as string; }
        catch { return null; }
    }
}
