using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using FieldOps.ServiceControlPrototype;

namespace FieldOps.TrayPrototype.Tests;

public sealed class RestartCoordinatorTests
{
    [Fact]
    public async Task Machine_wide_restart_mutex_rejects_a_concurrent_owner()
    {
        Assert.StartsWith("Global\\", RestartCoordination.MutexName, StringComparison.Ordinal);
        var firstAcquired = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirst = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstCompleted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstThread = new Thread(() =>
        {
            try
            {
                using var first = RestartCoordination.TryAcquire();
                firstAcquired.SetResult(first.State == RestartCoordinationState.Acquired);
                releaseFirst.Task.GetAwaiter().GetResult();
            }
            catch (Exception exception)
            {
                firstAcquired.TrySetException(exception);
                firstCompleted.TrySetException(exception);
                return;
            }

            firstCompleted.SetResult();
        });
        firstThread.Start();
        Assert.True(await firstAcquired.Task);

        try
        {
            var secondAcquired = await Task.Run(() =>
            {
                using var second = RestartCoordination.TryAcquire();
                return second.State == RestartCoordinationState.Acquired;
            });

            Assert.False(secondAcquired);
        }
        finally
        {
            releaseFirst.TrySetResult();
            await firstCompleted.Task;
        }

        using var afterRelease = RestartCoordination.TryAcquire();
        Assert.Equal(RestartCoordinationState.Acquired, afterRelease.State);
    }

    [Fact]
    public void Machine_wide_restart_mutex_acl_is_explicit_and_narrow()
    {
        var security = RestartCoordination.CreateSecurity();
        Assert.True(security.AreAccessRulesProtected);
        Assert.Equal(
            WindowsIdentity.GetCurrent().User,
            security.GetOwner(typeof(SecurityIdentifier)));

        var rules = security
            .GetAccessRules(includeExplicit: true, includeInherited: false, typeof(SecurityIdentifier))
            .Cast<MutexAccessRule>()
            .ToArray();
        Assert.Equal(3, rules.Length);
        Assert.All(rules, rule =>
        {
            Assert.Equal(AccessControlType.Allow, rule.AccessControlType);
            Assert.Equal(MutexRights.FullControl, rule.MutexRights);
        });
        Assert.Contains(rules, rule => rule.IdentityReference.Equals(
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)));
        Assert.Contains(rules, rule => rule.IdentityReference.Equals(
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null)));
        Assert.Contains(rules, rule => rule.IdentityReference.Equals(WindowsIdentity.GetCurrent().User));
        Assert.DoesNotContain(rules, rule => rule.IdentityReference.Equals(
            new SecurityIdentifier(WellKnownSidType.WorldSid, null)));
        Assert.DoesNotContain(rules, rule => rule.IdentityReference.Equals(
            new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null)));
    }

    [Fact]
    public async Task Abandoned_machine_wide_mutex_transfers_ownership_safely()
    {
        using var observer = MutexAcl.Create(
            initiallyOwned: false,
            RestartCoordination.MutexName,
            out _,
            RestartCoordination.CreateSecurity());
        var ownerFinished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var owner = new Thread(() =>
        {
            using var abandoned = MutexAcl.Create(
                initiallyOwned: false,
                RestartCoordination.MutexName,
                out _,
                RestartCoordination.CreateSecurity());
            abandoned.WaitOne();
            ownerFinished.SetResult();
        });
        owner.Start();
        await ownerFinished.Task;
        await Task.Run(owner.Join);

        using var recovered = RestartCoordination.TryAcquire();
        Assert.Equal(RestartCoordinationState.Acquired, recovered.State);
    }

    [Fact]
    public void Existing_mutex_access_denial_fails_closed()
    {
        var currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("Current Windows identity does not have a user SID.");
        var security = new MutexSecurity();
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        security.AddAccessRule(new MutexAccessRule(
            currentUser,
            MutexRights.FullControl,
            AccessControlType.Deny));
        using var denied = MutexAcl.Create(
            initiallyOwned: false,
            RestartCoordination.MutexName,
            out _,
            security);

        using var coordination = RestartCoordination.TryAcquire();
        Assert.Equal(RestartCoordinationState.AccessDenied, coordination.State);
    }

    [Fact]
    public async Task Helper_rejects_arguments_at_the_executable_boundary()
    {
        var helperPath = Path.Combine(
            AppContext.BaseDirectory,
            CoLocatedPaths.RestartHelperFileName);
        Assert.True(File.Exists(helperPath), $"Helper executable was not found at '{helperPath}'.");
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = helperPath,
            ArgumentList = { "unexpectedArgument" },
            UseShellExecute = false,
            CreateNoWindow = true,
        }) ?? throw new InvalidOperationException("The helper process did not start.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await process.WaitForExitAsync(timeout.Token);

        Assert.Equal((int)RestartExitCode.InvalidInvocation, process.ExitCode);
    }

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

            var path = CoLocatedPaths.GetRestartHelperPath();

            Assert.Equal(CoLocatedPaths.RestartHelperFileName, Path.GetFileName(path));
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
