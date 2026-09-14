using System.Runtime.InteropServices;
using System.Text;

namespace FieldOps.Agent.SystemTelemetry;

public interface IWifiSsidProvider
{
    bool TryGetSsid(Guid interfaceId, out string? ssid);
}

public sealed class WindowsWifiSsidProvider : IWifiSsidProvider
{
    private const int WlanClientVersion = 2;
    private const int CurrentConnectionOpcode = 7;

    public bool TryGetSsid(Guid interfaceId, out string? ssid)
    {
        ssid = null;
        if (!OperatingSystem.IsWindows()) return false;
        IntPtr client = IntPtr.Zero;
        IntPtr data = IntPtr.Zero;
        try
        {
            if (WlanOpenHandle(WlanClientVersion, IntPtr.Zero, out _, out client) != 0) return false;
            var id = interfaceId;
            if (WlanQueryInterface(client, ref id, CurrentConnectionOpcode, IntPtr.Zero, out _, out data, out _) != 0 || data == IntPtr.Zero) return false;
            var connection = Marshal.PtrToStructure<WlanConnectionAttributes>(data);
            ssid = WifiSsid.Decode(connection.Association.Dot11Ssid.Bytes, connection.Association.Dot11Ssid.Length);
            return ssid is not null;
        }
        catch
        {
            ssid = null;
            return false;
        }
        finally
        {
            if (data != IntPtr.Zero) WlanFreeMemory(data);
            if (client != IntPtr.Zero) WlanCloseHandle(client, IntPtr.Zero);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WlanConnectionAttributes
    {
        public int State;
        public int Mode;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string ProfileName;
        public WlanAssociationAttributes Association;
        public WlanSecurityAttributes Security;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WlanAssociationAttributes
    {
        public Dot11Ssid Dot11Ssid;
        public int BssType;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public byte[] Bssid;
        public int PhyType;
        public uint PhyIndex;
        public uint SignalQuality;
        public uint RxRate;
        public uint TxRate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Dot11Ssid
    {
        public uint Length;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Bytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WlanSecurityAttributes
    {
        [MarshalAs(UnmanagedType.Bool)] public bool SecurityEnabled;
        [MarshalAs(UnmanagedType.Bool)] public bool OneXEnabled;
        public int AuthAlgorithm;
        public int CipherAlgorithm;
    }

    [DllImport("wlanapi.dll")]
    private static extern int WlanOpenHandle(int clientVersion, IntPtr reserved, out int negotiatedVersion, out IntPtr clientHandle);

    [DllImport("wlanapi.dll")]
    private static extern int WlanCloseHandle(IntPtr clientHandle, IntPtr reserved);

    [DllImport("wlanapi.dll")]
    private static extern int WlanQueryInterface(IntPtr clientHandle, ref Guid interfaceGuid, int opcode, IntPtr reserved, out int dataSize, out IntPtr data, out int valueType);

    [DllImport("wlanapi.dll")]
    private static extern void WlanFreeMemory(IntPtr memory);
}

public static class WifiSsid
{
    public static string? Decode(byte[]? bytes, uint length)
    {
        if (bytes is null || length == 0 || length > 32 || length > bytes.Length) return null;
        var value = Encoding.UTF8.GetString(bytes, 0, (int)length).Trim();
        return string.IsNullOrWhiteSpace(value) || value.Any(char.IsControl) ? null : value;
    }
}
