using FieldOps.ServiceControlPrototype;

namespace FieldOps.TrayPrototype.Tests;

public sealed class RestartCoordinatorTests
{
    [Theory]
    [InlineData(RestartExitCode.Success, TrayRestartState.Success)]
    [InlineData(RestartExitCode.AccessDenied, TrayRestartState.AccessDenied)]
    [InlineData(RestartExitCode.ServiceNotInstalled, TrayRestartState.ServiceNotInstalled)]
    [InlineData(RestartExitCode.StopTimeout, TrayRestartState.StopTimeout)]
    [InlineData(RestartExitCode.StartRejected, TrayRestartState.StartRejected)]
    [InlineData(RestartExitCode.StartTimeout, TrayRestartState.StartTimeout)]
    [InlineData(RestartExitCode.HealthUnavailable, TrayRestartState.HealthUnavailable)]
    [InlineData(RestartExitCode.HealthUnhealthy, TrayRestartState.HealthUnhealthy)]
    [InlineData(RestartExitCode.RestartAlreadyInProgress, TrayRestartState.RestartAlreadyInProgress)]
    [InlineData(RestartExitCode.InvalidInvocation, TrayRestartState.InvalidHelperInvocation)]
    [InlineData(RestartExitCode.StopRejected, TrayRestartState.StopRejected)]
    public void Helper_exit_codes_are_not_collapsed(
        RestartExitCode exitCode,
        TrayRestartState expected)
    {
        var result = ElevatedRestartCoordinator.MapExitCode((int)exitCode);

        Assert.Equal(expected, result.State);
    }

    [Fact]
    public async Task Missing_fixed_helper_is_reported_without_launching_any_other_path()
    {
        var coordinator = new ElevatedRestartCoordinator(
            Path.Combine(Path.GetTempPath(), $"missing-{Guid.NewGuid():N}.exe"),
            TimeSpan.FromSeconds(1));

        var result = await coordinator.RestartAsync(CancellationToken.None);

        Assert.Equal(TrayRestartState.HelperUnavailable, result.State);
    }

    [Fact]
    public void Co_located_helper_path_ignores_working_directory_path_and_environment_configuration()
    {
        var originalDirectory = Environment.CurrentDirectory;
        var originalPath = Environment.GetEnvironmentVariable("PATH");
        var alternateDirectory = Path.GetTempPath();
        try
        {
            Environment.CurrentDirectory = alternateDirectory;
            Environment.SetEnvironmentVariable("PATH", alternateDirectory);
            Environment.SetEnvironmentVariable("FIELDOPS_HELPER_PATH", Path.Combine(alternateDirectory, "other.exe"));

            var path = CoLocatedPrototypePaths.GetRestartHelperPath();

            Assert.Equal(CoLocatedPrototypePaths.RestartHelperFileName, Path.GetFileName(path));
            Assert.Equal(
                Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar),
                Path.GetDirectoryName(path)!.TrimEnd(Path.DirectorySeparatorChar),
                ignoreCase: true);
        }
        finally
        {
            Environment.CurrentDirectory = originalDirectory;
            Environment.SetEnvironmentVariable("PATH", originalPath);
            Environment.SetEnvironmentVariable("FIELDOPS_HELPER_PATH", null);
        }
    }
}
