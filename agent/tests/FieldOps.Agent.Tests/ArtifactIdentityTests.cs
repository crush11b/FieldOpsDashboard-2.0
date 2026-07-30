using System.Diagnostics;
using System.Reflection;
using FieldOps.NativeHealth;

namespace FieldOps.Agent.Tests;

public sealed class ArtifactIdentityTests
{
    [Fact]
    public void Agent_and_native_health_use_canonical_product_identity()
    {
        AssertAssembly(typeof(Program).Assembly, "FieldOps.Agent");
        AssertAssembly(typeof(NativeHealthClient).Assembly, "FieldOps.NativeHealth");
    }

    private static void AssertAssembly(Assembly assembly, string expectedName)
    {
        Assert.Equal(expectedName, assembly.GetName().Name);
        Assert.Equal(new Version(2, 2, 0, 0), assembly.GetName().Version);
        Assert.Equal(
            "2.2.0.0",
            assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version);

        var informationalVersion = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        Assert.NotNull(informationalVersion);
        Assert.StartsWith("2.2.0", informationalVersion, StringComparison.Ordinal);
        Assert.DoesNotContain("0.1.0", informationalVersion, StringComparison.Ordinal);
        Assert.DoesNotContain("e2.001", informationalVersion, StringComparison.Ordinal);

        Assert.StartsWith(
            "2.2.0",
            FileVersionInfo.GetVersionInfo(assembly.Location).ProductVersion,
            StringComparison.Ordinal);
    }
}
