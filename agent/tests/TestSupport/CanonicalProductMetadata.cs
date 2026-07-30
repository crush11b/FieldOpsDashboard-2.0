using System.Text.Json;

namespace FieldOps.TestSupport;

internal sealed record CanonicalProductMetadata(
    string Version,
    Version AssemblyVersion,
    string FileVersion)
{
    internal static CanonicalProductMetadata Load()
    {
        var repositoryRoot = FindRepositoryRoot();
        var metadataPath = Path.Combine(repositoryRoot, "product-metadata.json");
        using var document = JsonDocument.Parse(File.ReadAllText(metadataPath));
        var version = document.RootElement.GetProperty("version").GetString()
            ?? throw new InvalidOperationException("Canonical product metadata has no version.");
        var parts = version.Split('.');
        if (parts.Length != 3 || parts.Any(part => !int.TryParse(part, out var value) || value < 0))
        {
            throw new InvalidOperationException(
                $"Canonical product version '{version}' is not numeric major.minor.patch metadata.");
        }

        return new(
            version,
            new Version(
                int.Parse(parts[0]),
                int.Parse(parts[1]),
                int.Parse(parts[2]),
                0),
            $"{version}.0");
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory);
             directory is not null;
             directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "product-metadata.json")) &&
                File.Exists(Path.Combine(directory.FullName, "agent", "FieldOps.Agent.sln")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("Could not locate canonical product metadata from the test output.");
    }
}
