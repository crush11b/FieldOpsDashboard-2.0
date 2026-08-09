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
}
