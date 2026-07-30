using System.Diagnostics;
using System.Reflection;
using FieldOps.NativeHealth;
using FieldOps.TestSupport;

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
        var canonical = CanonicalProductMetadata.Load();
        Assert.Equal(expectedName, assembly.GetName().Name);
        Assert.Equal(canonical.AssemblyVersion, assembly.GetName().Version);
        Assert.Equal(
            canonical.FileVersion,
            assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version);

        var informationalVersion = assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        Assert.NotNull(informationalVersion);
        Assert.StartsWith(canonical.Version, informationalVersion, StringComparison.Ordinal);
        Assert.DoesNotContain("0.1.0", informationalVersion, StringComparison.Ordinal);
        Assert.DoesNotContain("e2.001", informationalVersion, StringComparison.Ordinal);

        Assert.StartsWith(
            canonical.Version,
            FileVersionInfo.GetVersionInfo(assembly.Location).ProductVersion,
            StringComparison.Ordinal);
    }
}
