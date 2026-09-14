using System.Runtime.InteropServices;
using System.Text;

namespace FieldOps.Agent.SystemTelemetry;

internal interface IWifiSsidProvider
{
    string? GetConnectedSsid(string interfaceId);
}

internal sealed class WindowsWifiSsidProvider : IWifiSsidProvider
{
    private const uint ClientVersion = 2;

    public string? GetConnectedSsid(string interfaceId)
    {
        if (!OperatingSystem.IsWindows() || !Guid.TryParse(interfaceId, out var interfaceGuid)) return null;
        IntPtr clientHandle = IntPtr.Zero;
        IntPtr data = IntPtr.Zero;
        try
        {
            if (WlanOpenHandle(ClientVersion, IntPtr.Zero, out _, out clientHandle) != 0 || clientHandle == IntPtr.Zero) return null;
            if (WlanQueryInterface(
                clientHandle,
                ref interfaceGuid,
                WlanInterfaceOpcode.CurrentConnection,
                IntPtr.Zero,
                out _,
                out data,
                out _) != 0 || data == IntPtr.Zero) return null;

            var connection = Marshal.PtrToStructure<WlanConnectionAttributes>(data);
            if (connection.InterfaceState != WlanInterfaceState.Connected) return null;
            return NormalizeSsid(connection.AssociationAttributes.Ssid.Bytes, connection.AssociationAttributes.Ssid.Length);
        }
        catch
        {
            return null;
        }
        finally
        {
            if (data != IntPtr.Zero) WlanFreeMemory(data);
            if (clientHandle != IntPtr.Zero) _ = WlanCloseHandle(clientHandle, IntPtr.Zero);
        }
    }

    internal static string? NormalizeSsid(byte[]? bytes, uint length)
    {
        if (bytes is null || length is 0 or > 32 || length > bytes.Length) return null;
        try
        {
            var value = new UTF8Encoding(false, true).GetString(bytes, 0, checked((int)length)).Trim();
            if (value.Length == 0 || value.Any(char.IsControl)) return null;
            return value;
        }
        catch
        {
            return null;
        }
    }

    private enum WlanInterfaceOpcode
    {
        CurrentConnection = 7,
    }

    private enum WlanOpcodeValueType
    {
        QueryOnly = 0,
        SetByGroupPolicy = 1,
        SetByUser = 2,
        Invalid = 3,
    }

    private enum WlanInterfaceState
    {
        NotReady = 0,
        Connected = 1,
        AdHocNetworkFormed = 2,
        Disconnecting = 3,
        Disconnected = 4,
        Associating = 5,
        Discovering = 6,
        Authenticating = 7,
    }

    private enum WlanConnectionMode
    {
        Profile = 0,
        TemporaryProfile = 1,
        DiscoverySecure = 2,
        DiscoveryUnsecure = 3,
        Auto = 4,
        Invalid = 5,
    }

    private enum Dot11BssType
    {
        Infrastructure = 1,
        Independent = 2,
        Any = 3,
    }

    private enum Dot11PhyType
    {
        Unknown = 0,
    }

    private enum Dot11AuthAlgorithm
    {
        Open = 1,
    }

    private enum Dot11CipherAlgorithm
    {
        None = 0,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Dot11Ssid
    {
        public uint Length;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] Bytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WlanAssociationAttributes
    {
        public Dot11Ssid Ssid;
        public Dot11BssType BssType;

        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
        public byte[] Bssid;

        public Dot11PhyType PhyType;
        public uint PhyIndex;
        public uint SignalQuality;
        public uint RxRate;
        public uint TxRate;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WlanSecurityAttributes
    {
        [MarshalAs(UnmanagedType.Bool)] public bool SecurityEnabled;
        [MarshalAs(UnmanagedType.Bool)] public bool OneXEnabled;
        public Dot11AuthAlgorithm AuthAlgorithm;
        public Dot11CipherAlgorithm CipherAlgorithm;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WlanConnectionAttributes
    {
        public WlanInterfaceState InterfaceState;
        public WlanConnectionMode ConnectionMode;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string ProfileName;

        public WlanAssociationAttributes AssociationAttributes;
        public WlanSecurityAttributes SecurityAttributes;
    }

    [DllImport("wlanapi.dll")]
    private static extern uint WlanOpenHandle(
        uint clientVersion,
        IntPtr reserved,
        out uint negotiatedVersion,
        out IntPtr clientHandle);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanCloseHandle(IntPtr clientHandle, IntPtr reserved);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanQueryInterface(
        IntPtr clientHandle,
        ref Guid interfaceGuid,
        WlanInterfaceOpcode opcode,
        IntPtr reserved,
        out uint dataSize,
        out IntPtr data,
        out WlanOpcodeValueType opcodeValueType);

    [DllImport("wlanapi.dll")]
    private static extern void WlanFreeMemory(IntPtr memory);
}
