using System.Security.Cryptography;
using System.Text;
using FieldOps.Agent.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace FieldOps.Agent.Tests;

public sealed class DpapiTelemetryCredentialStoreTests : IDisposable
{
    private readonly string tempDirectory = Path.Combine(
        Path.GetTempPath(),
        $"fieldops-telemetry-secret-tests-{Guid.NewGuid():N}");

    public DpapiTelemetryCredentialStoreTests() => Directory.CreateDirectory(tempDirectory);

    [Fact]
    public async Task DpapiRoundTripReturnsCanonicalTokenWithoutPersistingPlaintext()
    {
        var token = ToBase64Url(RandomNumberGenerator.GetBytes(32));
        var path = Path.Combine(tempDirectory, "telemetry.dat");
        WriteProtectedToken(path, token);
        var store = CreateStore(path);

        var actual = await store.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(token, actual);
        Assert.DoesNotContain(token, Convert.ToBase64String(await File.ReadAllBytesAsync(path)), StringComparison.Ordinal);
    }

    [Fact]
    public async Task MissingCredentialReturnsNull()
    {
        var store = CreateStore(Path.Combine(tempDirectory, "missing.dat"));

        Assert.Null(await store.ReadAsync());
    }

    [Fact]
    public async Task CorruptCredentialFailsClosed()
    {
        var path = Path.Combine(tempDirectory, "corrupt.dat");
        await File.WriteAllBytesAsync(path, RandomNumberGenerator.GetBytes(64));
        var store = CreateStore(path);

        Assert.Null(await store.ReadAsync());
    }

    [Fact]
    public async Task InvalidDecryptedFormatFailsClosed()
    {
        var path = Path.Combine(tempDirectory, "invalid.dat");
        WriteProtectedToken(path, "not-a-valid-token");
        var store = CreateStore(path);

        Assert.Null(await store.ReadAsync());
    }

    [Fact]
    public async Task InvalidConfiguredPathFailsClosed()
    {
        var store = CreateStore("invalid\0credential-path");

        Assert.Null(await store.ReadAsync());
    }

    [Fact]
    public async Task CancellationPropagates()
    {
        var store = CreateStore(Path.Combine(tempDirectory, "missing.dat"));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            async () => await store.ReadAsync(cancellation.Token));
    }

    public void Dispose()
    {
        if (Directory.Exists(tempDirectory))
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }

    private DpapiTelemetryCredentialStore CreateStore(string credentialPath)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telemetry:CredentialPath"] = credentialPath,
            })
            .Build();
        return new DpapiTelemetryCredentialStore(
            configuration,
            new TestHostEnvironment { ContentRootPath = tempDirectory },
            NullLogger<DpapiTelemetryCredentialStore>.Instance);
    }

    private static void WriteProtectedToken(string path, string token)
    {
        var plaintext = Encoding.ASCII.GetBytes(token);
        try
        {
            File.WriteAllBytes(path, ProtectedData.Protect(
                plaintext,
                optionalEntropy: null,
                DataProtectionScope.LocalMachine));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private static string ToBase64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed class TestHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "FieldOps.Agent.Tests";
        public string ContentRootPath { get; set; } = string.Empty;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
