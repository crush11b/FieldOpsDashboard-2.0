using System.Diagnostics;
using System.Reflection;
using FieldOps.NativeHealth;
using FieldOps.ServiceControlPrototype;

namespace FieldOps.TrayPrototype.Tests;

public sealed class ArtifactIdentityTests
{
    [Fact]
    public void Production_assemblies_use_approved_names_and_canonical_version()
    {
        AssertAssembly(typeof(TrayProcessLifecycle).Assembly, "FieldOps.Tray");
        AssertAssembly(typeof(RestartExitCode).Assembly, "FieldOps.ServiceControl");
        AssertAssembly(typeof(NativeHealthClient).Assembly, "FieldOps.NativeHealth");
    }

    [Fact]
    public void Fixed_helper_name_is_the_production_artifact()
    {
        Assert.Equal("FieldOps.ServiceControl.exe", CoLocatedPaths.RestartHelperFileName);
        Assert.DoesNotContain("Prototype", CoLocatedPaths.RestartHelperFileName, StringComparison.Ordinal);
    }

    [Fact]
    public void Lifecycle_and_mutex_contracts_remain_stable()
    {
        Assert.Equal("Local\\FieldOps.Tray.Instance.v1", WindowsTrayInstanceGate.MutexName);
        Assert.Equal("Global\\FieldOpsAgent.RestartPrototype", RestartCoordination.MutexName);
        Assert.Equal(0, (int)TrayProcessExitCode.Success);
        Assert.Equal(10, (int)TrayProcessExitCode.DuplicateInstance);
        Assert.Equal(20, (int)TrayProcessExitCode.LifecycleFailure);
        Assert.Equal(19, (int)RestartExitCode.InvalidInvocation);
    }

    private static void AssertAssembly(Assembly assembly, string expectedName)
    {
        Assert.Equal(expectedName, assembly.GetName().Name);
        Assert.Equal(new Version(2, 2, 0, 0), assembly.GetName().Version);

        var fileVersion = assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version;
        Assert.Equal("2.2.0.0", fileVersion);

        var informationalVersion = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        Assert.NotNull(informationalVersion);
        Assert.StartsWith("2.2.0", informationalVersion, StringComparison.Ordinal);
        Assert.DoesNotContain("0.1.0", informationalVersion, StringComparison.Ordinal);
        Assert.DoesNotContain("e2.001", informationalVersion, StringComparison.Ordinal);

        var productVersion = FileVersionInfo.GetVersionInfo(assembly.Location).ProductVersion;
        Assert.StartsWith("2.2.0", productVersion, StringComparison.Ordinal);
    }
}
