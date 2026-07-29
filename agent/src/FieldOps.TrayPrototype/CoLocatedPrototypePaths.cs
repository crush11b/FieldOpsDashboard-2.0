namespace FieldOps.TrayPrototype;

internal static class CoLocatedPrototypePaths
{
    internal const string RestartHelperFileName = "FieldOps.ServiceControlPrototype.exe";

    internal static string GetRestartHelperPath()
    {
        var baseDirectory = Path.GetFullPath(AppContext.BaseDirectory);
        var helperPath = Path.GetFullPath(Path.Combine(baseDirectory, RestartHelperFileName));
        if (!string.Equals(
                Path.GetDirectoryName(helperPath)?.TrimEnd(Path.DirectorySeparatorChar),
                baseDirectory.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Restart helper must be co-located with the Tray prototype.");
        }

        return helperPath;
    }
}
