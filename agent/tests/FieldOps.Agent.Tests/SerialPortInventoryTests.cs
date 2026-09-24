using FieldOps.Agent.Serial;

namespace FieldOps.Agent.Tests;

public sealed class SerialPortInventoryTests
{
    [Fact]
    public void NamesAreDeduplicatedAndNaturallyOrderedWithoutOpeningPorts()
    {
        var ports = WindowsSerialPortEnumerator.NormalizeNames(new[] { "COM10", "COM2", "com2", "", "COM1" });
        Assert.Equal(new[] { "COM1", "COM2", "COM10" }, ports.Select(port => port.PortName));
        Assert.All(ports, port => Assert.True(port.Present));
        Assert.All(ports, port => Assert.Null(port.Manufacturer));
    }

    [Fact]
    public void EmptyEnumerationIsSuccessfulAndEmpty()
    {
        var ports = WindowsSerialPortEnumerator.NormalizeNames(Array.Empty<string>());
        Assert.Empty(ports);
    }

    [Fact]
    public void PnpInventoryAddsGnssPortMissingFromWin32SerialPortAndNormalizesIdentity()
    {
        var pnp = "USB\\VID_1199&PID_9071&MI_02\\6&1D988AEC&0&0002";
        var enumerator = new WindowsSerialPortEnumerator(new FakeMetadataProvider(new SerialPortMetadata("COM6", "Sierra Wireless Snapdragon X7 LTE-A NMEA Port (COM6)", "Sierra NMEA", "Sierra Wireless", "USB\\VID_1199&PID_9071&MI_02", pnp, "1199", "9071", "6&1D988AEC&0&0002", "VID_1199&PID_9071&MI_02", pnp)), () => Array.Empty<string>());

        var inventory = enumerator.Enumerate(CancellationToken.None);
        var port = Assert.Single(inventory.Ports);
        Assert.Equal("COM6", port.PortName);
        Assert.Equal("VID_1199&PID_9071&MI_02", port.InterfaceIdentity);
        Assert.Equal(pnp, port.DeviceInstanceId);
        Assert.True(SerialPortIdentityRules.IsAutomaticGnssCandidate(port));
    }

    [Fact]
    public void AutomaticCandidatesExcludeDmBluetoothIntelAndIcomPorts()
    {
        var ports = new[]
        {
            new SerialPortInfo("COM5", "Sierra Wireless DM Port (COM5)", null, "Sierra Wireless", null, "USB\\VID_1199&PID_9071&MI_00\\X", "1199", "9071", null, "VID_1199&PID_9071&MI_00", "USB\\VID_1199&PID_9071&MI_00\\X", true),
            new SerialPortInfo("COM8", "Standard Serial over Bluetooth link (COM8)", null, "Microsoft", null, null, null, null, null, null, null, true),
            new SerialPortInfo("COM4", "Intel(R) Active Management Technology - SOL (COM4)", null, "Intel", null, null, null, null, null, null, null, true),
            new SerialPortInfo("COM10", "Silicon Labs CP210x USB to UART Bridge (COM10)", "IC-7300", "Silicon Labs", null, "USB\\VID_10C4&PID_EA60\\IC-7300", "10C4", "EA60", "IC-7300", null, "USB\\VID_10C4&PID_EA60\\IC-7300", true),
        };
        Assert.All(ports, port => Assert.False(SerialPortIdentityRules.IsAutomaticGnssCandidate(port)));
    }

    private sealed class FakeMetadataProvider(params SerialPortMetadata[] metadata) : ISerialMetadataProvider
    {
        public IReadOnlyList<SerialPortMetadata> Read(CancellationToken cancellationToken) => metadata;
    }
}
