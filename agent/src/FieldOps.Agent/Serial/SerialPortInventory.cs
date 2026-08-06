using System.IO.Ports;

namespace FieldOps.Agent.Serial;

public enum SerialInventoryStatus { Ok, Unavailable, Error }

public sealed record SerialPortInfo(string PortName, string? FriendlyName, string? Description, string? Manufacturer, string? DeviceId, string? PnpDeviceId, string? Vid, string? Pid, string? SerialNumber, bool Present);
public sealed record SerialPortInventory(DateTimeOffset ObservedAtUtc, SerialInventoryStatus Status, IReadOnlyList<SerialPortInfo> Ports, string? Error);

public interface ISerialPortEnumerator { SerialPortInventory Enumerate(CancellationToken cancellationToken); }

public sealed class WindowsSerialPortEnumerator : ISerialPortEnumerator
{
    internal static IReadOnlyList<SerialPortInfo> NormalizeNames(IEnumerable<string> names) => names
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .OrderBy(name => int.TryParse(name.Trim().Substring(3), out var number) ? number : int.MaxValue)
        .ThenBy(name => name, StringComparer.OrdinalIgnoreCase)
        .Select(name => new SerialPortInfo(name, null, null, null, null, null, null, null, null, true))
        .ToArray();

    public SerialPortInventory Enumerate(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            var ports = NormalizeNames(SerialPort.GetPortNames());
            return new(DateTimeOffset.UtcNow, SerialInventoryStatus.Ok, ports, null);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return new(DateTimeOffset.UtcNow, SerialInventoryStatus.Error, Array.Empty<SerialPortInfo>(), "Serial-port enumeration failed.");
        }
    }
}
