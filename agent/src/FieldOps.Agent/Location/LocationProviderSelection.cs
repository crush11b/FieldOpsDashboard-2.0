using System.Text.Json;
using System.Text.Json.Serialization;

namespace FieldOps.Agent.Location;

public sealed record LocationProviderSelectionState(
    [property: JsonPropertyName("providerType")] LocationProviderType ProviderType,
    [property: JsonPropertyName("stableIdentity")] string? StableIdentity,
    [property: JsonPropertyName("portName")] string? PortName,
    [property: JsonPropertyName("baudRate")] int? BaudRate);

public sealed class LocationProviderSelection
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };
    private readonly object gate = new();
    private readonly string path;
    private LocationProviderSelectionState state;

    public LocationProviderSelection(IConfiguration configuration)
    {
        path = configuration["Agent:Location:ProviderSettingsPath"] is { Length: > 0 } configured
            ? configured
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "FieldOpsDashboard", "location-provider.json");
        state = Load();
    }

    public LocationProviderSelectionState Get() { lock (gate) return state; }

    public LocationProviderSelectionState Select(LocationProviderSelectionState requested)
    {
        if (requested.ProviderType == LocationProviderType.WindowsSensor
            && !string.Equals(requested.StableIdentity, WindowsLocationProviderInventory.UbloxIdentity, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("The selected Windows sensor identity is not supported.", nameof(requested));
        if (requested.ProviderType == LocationProviderType.SerialNmea && string.IsNullOrWhiteSpace(requested.PortName))
            throw new ArgumentException("A serial NMEA selection requires a COM port.", nameof(requested));
        lock (gate)
        {
            state = requested;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(state, JsonOptions));
            return state;
        }
    }

    private LocationProviderSelectionState Load()
    {
        try
        {
            if (File.Exists(path))
                return JsonSerializer.Deserialize<LocationProviderSelectionState>(File.ReadAllText(path), JsonOptions)
                    ?? new(LocationProviderType.Automatic, null, null, null);
        }
        catch { }
        return new(LocationProviderType.Automatic, null, null, null);
    }
}
