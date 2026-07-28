using System.Security.Cryptography;
using FieldOps.Agent.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class AgentCredentialProviderTests : IDisposable
{
    private readonly string tempDirectory = Path.Combine(
        Path.GetTempPath(),
        $"fieldops-credential-tests-{Guid.NewGuid():N}");

    public AgentCredentialProviderTests()
    {
        Directory.CreateDirectory(tempDirectory);
    }

    [Fact]
    public async Task MissingCredentialFailsInitialization()
    {
        var provider = CreateProvider(Path.Combine(tempDirectory, "missing.dat"));

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.InitializeAsync(CancellationToken.None));

        Assert.Contains("not provisioned", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CorruptCredentialFailsInitialization()
    {
        var path = Path.Combine(tempDirectory, "corrupt.dat");
        await File.WriteAllBytesAsync(path, RandomNumberGenerator.GetBytes(64));
        var provider = CreateProvider(path);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.InitializeAsync(CancellationToken.None));

        Assert.Equal("Agent credential could not be decrypted.", exception.Message);
    }

    [Theory]
    [InlineData("short")]
    [InlineData("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")]
    public async Task InvalidCredentialFormatFailsInitialization(string credential)
    {
        var path = Path.Combine(tempDirectory, $"invalid-{Guid.NewGuid():N}.dat");
        AgentWebApplicationFactory.WriteProtectedCredential(path, credential);
        var provider = CreateProvider(path);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(
            () => provider.InitializeAsync(CancellationToken.None));

        Assert.Equal("Agent credential is invalid.", exception.Message);
    }

    public void Dispose()
    {
        if (Directory.Exists(tempDirectory))
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }

    private AgentCredentialProvider CreateProvider(string credentialPath)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Agent:CredentialPath"] = credentialPath,
            })
            .Build();

        return new AgentCredentialProvider(
            configuration,
            new TestHostEnvironment { ContentRootPath = tempDirectory },
            NullLogger<AgentCredentialProvider>.Instance);
    }

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "FieldOps.Agent.Tests";
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
