using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace FieldOps.Agent.Tests;

public sealed class AgentWebApplicationFactory : WebApplicationFactory<Program>
{
    private readonly string tempDirectory = Path.Combine(
        Path.GetTempPath(),
        $"fieldops-agent-tests-{Guid.NewGuid():N}");

    public const string Token = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

    public AgentWebApplicationFactory()
    {
        Directory.CreateDirectory(tempDirectory);
        CredentialPath = Path.Combine(tempDirectory, "health-token.dat");
        WriteProtectedCredential(CredentialPath, Token);
    }

    public string CredentialPath { get; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, configuration) =>
        {
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Agent:CredentialPath"] = CredentialPath,
            });
        });
        builder.ConfigureLogging(logging => logging.ClearProviders());
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && Directory.Exists(tempDirectory))
        {
            Directory.Delete(tempDirectory, recursive: true);
        }
    }

    internal static void WriteProtectedCredential(string path, string value)
    {
        var plaintext = System.Text.Encoding.ASCII.GetBytes(value);
        try
        {
            var protectedCredential = ProtectedData.Protect(
                plaintext,
                optionalEntropy: null,
                DataProtectionScope.LocalMachine);
            File.WriteAllBytes(path, protectedCredential);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}
