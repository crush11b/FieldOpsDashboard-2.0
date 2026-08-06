using System.IO.Ports;
using System.Management;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;

namespace FieldOps.Agent.Serial;

public enum SerialInventoryStatus { Ok, Unavailable, Error }

public sealed record SerialPortInfo(
    [property: JsonPropertyName("portName")] string PortName,
    [property: JsonPropertyName("friendlyName")] string? FriendlyName,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("manufacturer")] string? Manufacturer,
    [property: JsonPropertyName("deviceId")] string? DeviceId,
    [property: JsonPropertyName("pnpDeviceId")] string? PnpDeviceId,
    [property: JsonPropertyName("vid")] string? Vid,
    [property: JsonPropertyName("pid")] string? Pid,
    [property: JsonPropertyName("serialNumber")] string? SerialNumber,
    [property: JsonPropertyName("present")] bool Present);
public sealed record SerialPortInventory(DateTimeOffset ObservedAtUtc, SerialInventoryStatus Status, IReadOnlyList<SerialPortInfo> Ports, string? Error);

public interface ISerialPortEnumerator { SerialPortInventory Enumerate(CancellationToken cancellationToken); }
public interface ISerialMetadataProvider { IReadOnlyList<SerialPortMetadata> Read(CancellationToken cancellationToken); }
public sealed record SerialPortMetadata(string PortName, string? FriendlyName, string? Description, string? Manufacturer, string? DeviceId, string? PnpDeviceId, string? Vid, string? Pid, string? SerialNumber);
public sealed class WmiSerialMetadataProvider : ISerialMetadataProvider
{
    public IReadOnlyList<SerialPortMetadata> Read(CancellationToken cancellationToken)
    {
        var results = new List<SerialPortMetadata>();
        using var searcher = new ManagementObjectSearcher("SELECT Name,Description,Manufacturer,DeviceID,PNPDeviceID,Status FROM Win32_PnPEntity WHERE Name LIKE '%(COM%)'");
        foreach (ManagementObject item in searcher.Get())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var name = item["Name"]?.ToString() ?? string.Empty;
            var match = Regex.Match(name, @"\((COM\d+)\)", RegexOptions.IgnoreCase);
            if (!match.Success) continue;
            var pnp = item["PNPDeviceID"]?.ToString();
            var ids = ParseIds(pnp);
            results.Add(new(match.Groups[1].Value.ToUpperInvariant(), name, item["Description"]?.ToString(), item["Manufacturer"]?.ToString(), item["DeviceID"]?.ToString(), pnp, ids.Vid, ids.Pid, ids.Serial));
        }
        return results;
    }
    internal static (string? Vid, string? Pid, string? Serial) ParseIds(string? pnp)
    {
        if (string.IsNullOrWhiteSpace(pnp)) return (null, null, null);
        var vid = Regex.Match(pnp, @"VID_([0-9A-F]{4})", RegexOptions.IgnoreCase).Groups[1].Value.ToUpperInvariant();
        var pid = Regex.Match(pnp, @"PID_([0-9A-F]{4})", RegexOptions.IgnoreCase).Groups[1].Value.ToUpperInvariant();
        var serial = Regex.Match(pnp, @"(?:VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\)([^\\]+)$", RegexOptions.IgnoreCase).Groups[1].Value;
        return (string.IsNullOrEmpty(vid) ? null : vid, string.IsNullOrEmpty(pid) ? null : pid, string.IsNullOrEmpty(serial) ? null : serial);
    }
}

public sealed class WindowsSerialPortEnumerator(ISerialMetadataProvider metadataProvider) : ISerialPortEnumerator
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
            var ports = NormalizeNames(SerialPort.GetPortNames()).ToDictionary(p => p.PortName, StringComparer.OrdinalIgnoreCase);
            IReadOnlyList<SerialPortMetadata> metadata;
            try { metadata = metadataProvider.Read(cancellationToken); }
            catch (Exception exception) when (exception is ManagementException or IOException or InvalidOperationException) { metadata = Array.Empty<SerialPortMetadata>(); }
            foreach (var metadataItem in metadata.GroupBy(p => p.PortName, StringComparer.OrdinalIgnoreCase).Select(g => g.First()))
            {
                if (ports.TryGetValue(metadataItem.PortName, out var port)) ports[metadataItem.PortName] = port with { FriendlyName = metadataItem.FriendlyName, Description = metadataItem.Description, Manufacturer = metadataItem.Manufacturer, DeviceId = metadataItem.DeviceId, PnpDeviceId = metadataItem.PnpDeviceId, Vid = metadataItem.Vid, Pid = metadataItem.Pid, SerialNumber = metadataItem.SerialNumber };
            }
            return new(DateTimeOffset.UtcNow, SerialInventoryStatus.Ok, ports.Values.OrderBy(p => p.PortName, StringComparer.OrdinalIgnoreCase).ToArray(), null);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidOperationException or ManagementException)
        {
            return new(DateTimeOffset.UtcNow, SerialInventoryStatus.Error, Array.Empty<SerialPortInfo>(), "Serial-port enumeration failed.");
        }
    }
}
